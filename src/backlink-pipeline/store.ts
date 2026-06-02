import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import readline from 'readline';
import type {
  BrowserVerificationRecord,
  CandidateRecord,
  OpportunityRecord,
  PipelineConfig,
  PipelineSummary,
  ScrapeRecord,
  SearchQueryRecord,
} from './types.js';
import { csvEscape, nowIso, safeJoin } from './utils.js';

type JsonRecord =
  | SearchQueryRecord
  | CandidateRecord
  | ScrapeRecord
  | OpportunityRecord
  | BrowserVerificationRecord;

class JsonlWriter<T extends JsonRecord> {
  private readonly stream: fs.WriteStream;

  constructor(filePath: string) {
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
  }

  async write(record: T): Promise<void> {
    if (!this.stream.write(`${JSON.stringify(record)}\n`)) {
      await new Promise<void>((resolve) => this.stream.once('drain', resolve));
    }
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.stream.once('error', reject);
      this.stream.end(resolve);
    });
  }
}

export class PipelineStore {
  readonly runDir: string;
  readonly queriesPath: string;
  readonly candidatesPath: string;
  readonly scrapesPath: string;
  readonly opportunitiesPath: string;
  readonly browserVerificationsPath: string;
  readonly csvPath: string;
  readonly summaryPath: string;

  seenCandidateUrls = new Set<string>();
  seenDomains = new Set<string>();
  scrapedUrls = new Set<string>();
  scoredCandidateIds = new Set<string>();
  browserVerifiedCandidateIds = new Set<string>();

  private queryWriter!: JsonlWriter<SearchQueryRecord>;
  private candidateWriter!: JsonlWriter<CandidateRecord>;
  private scrapeWriter!: JsonlWriter<ScrapeRecord>;
  private opportunityWriter!: JsonlWriter<OpportunityRecord>;
  private browserWriter!: JsonlWriter<BrowserVerificationRecord>;

  private constructor(runDir: string) {
    this.runDir = runDir;
    this.queriesPath = safeJoin(runDir, 'queries.jsonl');
    this.candidatesPath = safeJoin(runDir, 'candidates.jsonl');
    this.scrapesPath = safeJoin(runDir, 'scrapes.jsonl');
    this.opportunitiesPath = safeJoin(runDir, 'opportunities.jsonl');
    this.browserVerificationsPath = safeJoin(runDir, 'browser-verifications.jsonl');
    this.csvPath = safeJoin(runDir, 'opportunities.csv');
    this.summaryPath = safeJoin(runDir, 'summary.json');
  }

  static async open(config: PipelineConfig): Promise<PipelineStore> {
    const runDir = config.resumeDir
      ? path.resolve(config.resumeDir)
      : path.resolve(config.outputDir, config.runId || 'run');

    await fsp.mkdir(runDir, { recursive: true });
    const store = new PipelineStore(runDir);
    await store.init(config);
    return store;
  }

  async init(config: PipelineConfig): Promise<void> {
    await Promise.all([
      touch(this.queriesPath),
      touch(this.candidatesPath),
      touch(this.scrapesPath),
      touch(this.opportunitiesPath),
      touch(this.browserVerificationsPath),
    ]);

    await fsp.writeFile(safeJoin(this.runDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
    await this.loadIndexes();

    this.queryWriter = new JsonlWriter<SearchQueryRecord>(this.queriesPath);
    this.candidateWriter = new JsonlWriter<CandidateRecord>(this.candidatesPath);
    this.scrapeWriter = new JsonlWriter<ScrapeRecord>(this.scrapesPath);
    this.opportunityWriter = new JsonlWriter<OpportunityRecord>(this.opportunitiesPath);
    this.browserWriter = new JsonlWriter<BrowserVerificationRecord>(this.browserVerificationsPath);
  }

  async loadIndexes(): Promise<void> {
    for await (const candidate of readJsonl<CandidateRecord>(this.candidatesPath)) {
      this.seenCandidateUrls.add(candidate.normalizedUrl);
      this.seenDomains.add(candidate.domain);
    }

    for await (const scrape of readJsonl<ScrapeRecord>(this.scrapesPath)) {
      this.scrapedUrls.add(scrape.url);
    }

    for await (const opportunity of readJsonl<OpportunityRecord>(this.opportunitiesPath)) {
      this.scoredCandidateIds.add(opportunity.candidateId);
    }

    for await (const verification of readJsonl<BrowserVerificationRecord>(this.browserVerificationsPath)) {
      if (verification.success) {
        this.browserVerifiedCandidateIds.add(verification.candidateId);
      }
    }
  }

  async appendQuery(record: SearchQueryRecord): Promise<void> {
    await this.queryWriter.write(record);
  }

  async appendCandidate(record: CandidateRecord): Promise<void> {
    this.seenCandidateUrls.add(record.normalizedUrl);
    this.seenDomains.add(record.domain);
    await this.candidateWriter.write(record);
  }

  async appendScrape(record: ScrapeRecord): Promise<void> {
    this.scrapedUrls.add(record.url);
    await this.scrapeWriter.write(record);
  }

  async appendOpportunity(record: OpportunityRecord): Promise<void> {
    this.scoredCandidateIds.add(record.candidateId);
    await this.opportunityWriter.write(record);
  }

  async appendBrowserVerification(record: BrowserVerificationRecord): Promise<void> {
    if (record.success) {
      this.browserVerifiedCandidateIds.add(record.candidateId);
    }
    await this.browserWriter.write(record);
  }

  readCandidates(): AsyncGenerator<CandidateRecord> {
    return readJsonl<CandidateRecord>(this.candidatesPath);
  }

  readOpportunities(): AsyncGenerator<OpportunityRecord> {
    return readJsonl<OpportunityRecord>(this.opportunitiesPath);
  }

  readBrowserVerifications(): AsyncGenerator<BrowserVerificationRecord> {
    return readJsonl<BrowserVerificationRecord>(this.browserVerificationsPath);
  }

  async countSuccessfulBrowserVerifications(): Promise<number> {
    let count = 0;
    for await (const verification of this.readBrowserVerifications()) {
      if (verification.success) {
        count += 1;
      }
    }
    return count;
  }

  async exportOpportunitiesCsv(minScore: number): Promise<number> {
    const header = [
      'score',
      'tier',
      'recommended_action',
      'domain',
      'url',
      'type',
      'title',
      'dofollow_confidence',
      'acceptance_probability',
      'submission_path_confidence',
      'strict_dofollow',
      'risk_score',
      'indexability_status',
      'payment_required',
      'evidence_page_count',
      'authority_score',
      'topical_relevance',
      'backlink_eligibility',
      'technical_value',
      'editorial_quality',
      'low_risk',
      'has_submission_form',
      'login_required',
      'login_confidence',
      'has_followed_external_links',
      'has_noindex',
      'submission_urls',
      'signup_urls',
      'login_urls',
      'sample_accepted_urls',
      'sample_external_link_rel',
      'proof_urls',
      'sample_outbound_urls',
      'signals',
      'risks',
      'payment_evidence',
      'disqualification_reasons',
      'last_accepted_date',
      'login_evidence',
      'evidence',
    ];

    const rows: string[] = [header.join(',')];
    let count = 0;

    for await (const opportunity of this.readOpportunities()) {
      if (opportunity.opportunityScore < minScore) {
        continue;
      }

      count += 1;
      rows.push(
        [
          opportunity.opportunityScore.toFixed(2),
          opportunity.strictEvidence?.tier || '',
          opportunity.recommendedAction,
          opportunity.domain,
          opportunity.url,
          opportunity.opportunityType,
          opportunity.title,
          opportunity.strictEvidence?.dofollowConfidence?.toFixed(2) || '',
          opportunity.strictEvidence?.acceptanceProbability?.toFixed(2) || '',
          opportunity.strictEvidence?.submissionPathConfidence?.toFixed(2) || '',
          opportunity.strictEvidence?.strictDofollow ?? '',
          opportunity.strictEvidence?.riskScore?.toFixed(2) || '',
          opportunity.strictEvidence?.indexabilityStatus || '',
          opportunity.strictEvidence?.paymentRequired ?? '',
          opportunity.strictEvidence?.evidencePageCount ?? '',
          opportunity.authorityScore.toFixed(2),
          opportunity.topicalRelevanceScore.toFixed(2),
          opportunity.backlinkEligibilityScore.toFixed(2),
          opportunity.technicalValueScore.toFixed(2),
          opportunity.editorialQualityScore.toFixed(2),
          opportunity.lowRiskScore.toFixed(2),
          opportunity.linkEvidence.hasSubmissionForm,
          opportunity.linkEvidence.loginRequired,
          opportunity.linkEvidence.loginConfidence.toFixed(2),
          opportunity.linkEvidence.hasFollowedExternalLinks,
          opportunity.linkEvidence.hasNoindex,
          opportunity.linkEvidence.submissionUrls,
          opportunity.linkEvidence.signupUrls,
          opportunity.linkEvidence.loginUrls,
          opportunity.strictEvidence?.sampleAcceptedUrls || [],
          opportunity.strictEvidence?.sampleExternalLinkRel || [],
          opportunity.strictEvidence?.proofUrls || [],
          opportunity.linkEvidence.sampleOutboundUrls,
          opportunity.signals,
          opportunity.risks,
          opportunity.strictEvidence?.paymentEvidence || [],
          opportunity.strictEvidence?.disqualificationReasons || [],
          opportunity.strictEvidence?.lastAcceptedDate || '',
          opportunity.linkEvidence.loginEvidence,
          opportunity.evidenceSnippets,
        ]
          .map(csvEscape)
          .join(',')
      );
    }

    await fsp.writeFile(this.csvPath, `${rows.join('\n')}\n`);
    return count;
  }

  async writeSummary(summary: PipelineSummary): Promise<void> {
    await fsp.writeFile(this.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  }

  async readSummary(): Promise<PipelineSummary | null> {
    try {
      return JSON.parse(await fsp.readFile(this.summaryPath, 'utf8')) as PipelineSummary;
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    await Promise.all([
      this.queryWriter.close(),
      this.candidateWriter.close(),
      this.scrapeWriter.close(),
      this.opportunityWriter.close(),
      this.browserWriter.close(),
    ]);
  }
}

export async function* readJsonl<T>(filePath: string): AsyncGenerator<T> {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      yield JSON.parse(trimmed) as T;
    } catch {
      // Ignore a partial tail line from an interrupted previous run.
    }
  }
}

async function touch(filePath: string): Promise<void> {
  const handle = await fsp.open(filePath, 'a');
  await handle.close();
}

export async function countJsonl(filePath: string): Promise<number> {
  let count = 0;
  for await (const _record of readJsonl<unknown>(filePath)) {
    count += 1;
  }
  return count;
}

export function initialSummary(config: PipelineConfig, runDir: string): PipelineSummary {
  return {
    runId: config.runId || path.basename(runDir),
    niche: config.niche,
    targetCandidates: config.targetCandidates,
    discoveredCandidates: 0,
    scrapedCandidates: 0,
    opportunities: 0,
    browserVerified: 0,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    outputDir: runDir,
  };
}
