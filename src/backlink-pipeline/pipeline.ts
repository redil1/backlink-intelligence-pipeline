import type {
  CandidateRecord,
  OpportunityRecord,
  PipelineConfig,
  PipelineSummary,
  ScrapeRecord,
  SearchQueryRecord,
} from './types.js';
import { AuthorityProvider } from './authority.js';
import { buildCandidate, analyzeScrape, selectEvidenceUrls } from './classifier.js';
import { Crawl4AIHttpClient, SearxngSearchClient } from './clients.js';
import { generateSearchQueries } from './config.js';
import { BrowserHarnessVerifier } from './browser-harness.js';
import { PipelineStore, countJsonl, initialSummary } from './store.js';
import { formatError, isLikelySearchOrCacheUrl, nowIso, retry } from './utils.js';

export class BacklinkOpportunityPipeline {
  private readonly searchClient: SearxngSearchClient;
  private readonly crawlClient: Crawl4AIHttpClient;
  private readonly domainOccurrences = new Map<string, number>();
  private authorityProvider!: AuthorityProvider;
  private summary!: PipelineSummary;

  constructor(
    private readonly config: PipelineConfig,
    private readonly store: PipelineStore
  ) {
    this.searchClient = new SearxngSearchClient(config.searxngUrl);
    this.crawlClient = new Crawl4AIHttpClient(config.crawl4aiUrl);
  }

  async init(): Promise<void> {
    this.authorityProvider = await AuthorityProvider.create(this.config.authority);
    this.summary = (await this.store.readSummary()) || initialSummary(this.config, this.store.runDir);
    this.summary.runId = this.config.runId || this.summary.runId;
    this.summary.niche = this.config.niche;
    this.summary.targetCandidates = this.config.targetCandidates;
    this.summary.outputDir = this.store.runDir;
    this.summary.discoveredCandidates = await countJsonl(this.store.candidatesPath);
    this.summary.scrapedCandidates = await countJsonl(this.store.scrapesPath);
    this.summary.opportunities = await countJsonl(this.store.opportunitiesPath);
    this.summary.browserVerified = await this.store.countSuccessfulBrowserVerifications();

    for await (const candidate of this.store.readCandidates()) {
      this.domainOccurrences.set(candidate.domain, (this.domainOccurrences.get(candidate.domain) || 0) + 1);
    }

    await this.writeSummary();
  }

  async run(): Promise<void> {
    await this.discover();
    if (this.config.scrape.enabled) {
      await this.scrapeAndScore();
    }
    if (this.config.browserVerification.enabled) {
      await this.browserVerify();
    }
    await this.export();
  }

  async discover(): Promise<void> {
    const queries = generateSearchQueries(this.config);
    console.log(`Discovery: ${queries.length} generated queries, target=${this.config.targetCandidates}`);

    let queryIndex = 0;
    const workers = Array.from(
      { length: Math.max(1, this.config.search.concurrency) },
      async () => {
        while (queryIndex < queries.length && this.store.seenCandidateUrls.size < this.config.targetCandidates) {
          const query = queries[queryIndex];
          queryIndex += 1;
          await this.runQuery(query);
        }
      }
    );

    await Promise.all(workers);
    await this.writeSummary();
  }

  async scrapeAndScore(): Promise<void> {
    console.log(
      `Scrape/score: concurrency=${this.config.scrape.concurrency}, limit=${this.config.scrape.limit}, minCandidateScore=${this.config.scrape.minCandidateScore}`
    );

    let processed = 0;
    const running = new Set<Promise<void>>();

    for await (const candidate of this.store.readCandidates()) {
      if (processed >= this.config.scrape.limit) {
        break;
      }
      if (candidate.candidateScore < this.config.scrape.minCandidateScore) {
        continue;
      }
      if (this.store.scrapedUrls.has(candidate.normalizedUrl) || this.store.scoredCandidateIds.has(candidate.id)) {
        continue;
      }

      const task = this.scrapeScoreCandidate(candidate)
        .catch((error) => {
          console.error(`Scrape/score failed for ${candidate.normalizedUrl}: ${formatError(error)}`);
        })
        .finally(() => running.delete(task));

      running.add(task);
      processed += 1;

      if (running.size >= this.config.scrape.concurrency) {
        await Promise.race(running);
      }
    }

    await Promise.all(running);
    await this.writeSummary();
  }

  async browserVerify(): Promise<void> {
    console.log(
      `Browser verify: command=${this.config.browserVerification.command}, limit=${this.config.browserVerification.limit}, cdp=${this.config.browserVerification.cdpUrl}`
    );

    const verifier = new BrowserHarnessVerifier({
      command: this.config.browserVerification.command,
      buName: this.config.browserVerification.buName,
      autoStartLocalChromium: this.config.browserVerification.autoStartLocalChromium,
      localChromiumCommand: this.config.browserVerification.localChromiumCommand,
      cdpUrl: this.config.browserVerification.cdpUrl,
      timeoutMs: this.config.browserVerification.timeoutMs,
    });
    await verifier.prepare();
    const queue = await this.selectTopOpportunities(
      this.config.browserVerification.limit,
      this.config.browserVerification.minOpportunityScore
    );

    let index = 0;
    const workers = Array.from(
      { length: Math.max(1, this.config.browserVerification.concurrency) },
      async () => {
        while (index < queue.length) {
          const opportunity = queue[index];
          index += 1;
          if (this.store.browserVerifiedCandidateIds.has(opportunity.candidateId)) {
            continue;
          }
          const verification = await verifier.verify(opportunity);
          await this.store.appendBrowserVerification(verification);
          if (verification.success) {
            this.summary.browserVerified += 1;
          }
        }
      }
    );

    await Promise.all(workers);
    await this.writeSummary();
  }

  async export(): Promise<void> {
    const exported = await this.store.exportOpportunitiesCsv(this.config.scoring.minExportScore);
    console.log(`Exported ${exported} opportunities to ${this.store.csvPath}`);
    await this.writeSummary();
  }

  private async runQuery(query: string): Promise<void> {
    for (let pageno = 1; pageno <= this.config.search.pagesPerQuery; pageno += 1) {
      if (this.store.seenCandidateUrls.size >= this.config.targetCandidates) {
        return;
      }

      let record: SearchQueryRecord;
      try {
        const response = await retry(
          () =>
            this.searchClient.search({
              query,
              pageno,
              language: this.config.search.language,
              engines: this.config.search.engines,
              safesearch: this.config.search.safesearch,
            }),
          1,
          `SearXNG search ${query} page ${pageno}`,
          1200
        );

        let newCandidates = 0;
        for (const [rankIndex, result] of response.results.entries()) {
          if (isLikelySearchOrCacheUrl(result.url)) {
            continue;
          }

          const candidate = buildCandidate(result, query, pageno, rankIndex + 1, this.config.niche);
          if (!candidate || this.store.seenCandidateUrls.has(candidate.normalizedUrl)) {
            continue;
          }

          await this.store.appendCandidate(candidate);
          this.domainOccurrences.set(candidate.domain, (this.domainOccurrences.get(candidate.domain) || 0) + 1);
          newCandidates += 1;
          this.summary.discoveredCandidates += 1;

          if (this.store.seenCandidateUrls.size >= this.config.targetCandidates) {
            break;
          }
        }

        record = {
          query,
          pageno,
          resultCount: response.results.length,
          newCandidates,
          unresponsiveEngines: response.unresponsiveEngines,
          searchedAt: nowIso(),
        };
      } catch (error) {
        record = {
          query,
          pageno,
          resultCount: 0,
          newCandidates: 0,
          unresponsiveEngines: [],
          searchedAt: nowIso(),
          error: formatError(error),
        };
      }

      await this.store.appendQuery(record);

      if (record.resultCount === 0 && !record.error) {
        break;
      }
    }
  }

  private async scrapeScoreCandidate(candidate: CandidateRecord): Promise<void> {
    const scrape = await retry(
      () =>
        this.crawlClient.scrape({
          candidateId: candidate.id,
          url: candidate.normalizedUrl,
          domain: candidate.domain,
          formats: this.config.scrape.formats,
          timeoutMs: this.config.scrape.timeoutMs,
        }),
      this.config.scrape.retries,
      `Crawl4AI scrape ${candidate.normalizedUrl}`,
      1500
    );

    await this.store.appendScrape(scrape);
    this.summary.scrapedCandidates += 1;

    if (!scrape.success) {
      return;
    }

    const evidenceScrapes = await this.scrapeEvidencePages(candidate, scrape);
    const authority = this.authorityProvider.getAuthority(
      candidate,
      this.domainOccurrences.get(candidate.domain) || 1
    );
    const opportunity = analyzeScrape(this.config, candidate, scrape, authority, evidenceScrapes);
    await this.store.appendOpportunity(opportunity);
    this.summary.opportunities += 1;
  }

  private async scrapeEvidencePages(candidate: CandidateRecord, scrape: ScrapeRecord): Promise<ScrapeRecord[]> {
    if (!this.config.evidence.deepCrawlEnabled || this.config.evidence.maxEvidencePagesPerCandidate <= 0) {
      return [];
    }

    const urls = selectEvidenceUrls(candidate, scrape, this.config.evidence.maxEvidencePagesPerCandidate);
    const evidenceScrapes: ScrapeRecord[] = [];
    for (const [index, url] of urls.entries()) {
      const evidenceScrape = await retry(
        () =>
          this.crawlClient.scrape({
            candidateId: `${candidate.id}:evidence:${index + 1}`,
            url,
            domain: candidate.domain,
            formats: this.config.scrape.formats,
            timeoutMs: Math.min(this.config.scrape.timeoutMs, 20000),
          }),
        0,
        `Crawl4AI evidence scrape ${url}`,
        1000
      ).catch((error) => ({
        candidateId: `${candidate.id}:evidence:${index + 1}`,
        url,
        domain: candidate.domain,
        success: false,
        scrapedAt: nowIso(),
        links: [],
        metadata: {},
        error: formatError(error),
      }));

      if (evidenceScrape.success) {
        evidenceScrapes.push(evidenceScrape);
      }
    }

    return evidenceScrapes;
  }

  private async selectTopOpportunities(limit: number, minScore: number): Promise<OpportunityRecord[]> {
    const top: OpportunityRecord[] = [];

    for await (const opportunity of this.store.readOpportunities()) {
      if (
        opportunity.opportunityScore < minScore ||
        this.store.browserVerifiedCandidateIds.has(opportunity.candidateId) ||
        opportunity.recommendedAction === 'reject'
      ) {
        continue;
      }

      top.push(opportunity);
      top.sort((a, b) => b.opportunityScore - a.opportunityScore);
      if (top.length > limit) {
        top.pop();
      }
    }

    return top;
  }

  private async writeSummary(): Promise<void> {
    this.summary.updatedAt = nowIso();
    await this.store.writeSummary(this.summary);
  }
}
