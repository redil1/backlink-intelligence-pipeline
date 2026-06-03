---
name: backlink-opportunity-pipeline
description: Use when the user wants to discover, scrape, score, validate, resume, scale, export, or operate the backlink opportunity pipeline for article directories, social bookmarking sites, niche directories, resource pages, editorial submission pages, and community/profile backlink opportunities using the local SearXNG + Crawl4AI stack and optional Browser Harness verification.
---

# Backlink Opportunity Pipeline

Use this skill when working with the production backlink opportunity pipeline installed at:

```text
/root/backlinks/searxng-crawl4ai-mcp-master
```

The pipeline is an intelligence and verification system. It discovers public backlink opportunities, scrapes candidate pages, extracts technical evidence, scores opportunity quality, and exports review queues. By itself, this is not a complete backlink-creation pipeline for the user's goal, because a complete campaign must also create content, publish on owned or explicitly authorized destinations, and verify a live backlink.

This skill does not submit content, create accounts, place links, or bypass access controls. When the user wants actual backlink creation instead of only opportunity intelligence, hand off to:

```text
skills/backlink-content-publishing-agent/SKILL.md
```

## System Map

The pipeline uses:

- `SearXNG` on `http://localhost:8081` for large-scale web discovery.
- `Crawl4AI` on `http://localhost:8001` for public page scraping.
- `src/backlink-pipeline/*` for orchestration, scoring, persistence, and exports.
- `browser-harness` only for rendered-browser verification of top or ambiguous opportunities.
- Append-only JSONL files for resumable high-volume runs.
- CSV export for review, filtering, enrichment, and outreach planning.

Primary docs:

- `BACKLINK_PIPELINE.md` - full user-facing runbook.
- `config/backlink-pipeline.example.json` - production config template.
## First Checks

Always start from the repo root:

```bash
cd /root/backlinks/searxng-crawl4ai-mcp-master
```

Check backend services:

```bash
docker compose ps
curl -fsS http://localhost:8001/health
curl -fsS 'http://localhost:8081/search?q=example&format=json'
```

Build before running newly edited code:

```bash
npm run build
```

Use the CLI help when in doubt:

```bash
npm run pipeline -- help
```

## Pipeline Stages

The pipeline can run all stages at once or stage-by-stage.

### Full Run

Use this when the target size is moderate and the process can run continuously:

```bash
npm run pipeline -- run \
  --niche "cybersecurity" \
  --target 10000 \
  --max-queries 1000 \
  --search-pages 8 \
  --scrape-limit 10000 \
  --scrape-concurrency 4
```

The command performs:

1. Search query generation.
2. SearXNG discovery.
3. URL normalization and dedupe.
4. Candidate classification.
5. Crawl4AI scrape.
6. Evidence extraction.
7. Authority scoring.
8. Opportunity scoring.
9. CSV export.
10. Optional Browser Harness verification if enabled.

### Discovery Only

Use discovery-only for 100k to 1M scale, or when SearXNG/proxy conditions are unstable:

```bash
npm run pipeline -- discover \
  --niche "cybersecurity" \
  --target 100000 \
  --max-queries 8000 \
  --search-pages 10 \
  --run-id cybersecurity-100k
```

Discovery writes:

- `queries.jsonl`
- `candidates.jsonl`
- `summary.json`

### Scrape And Score

Use after discovery, or repeat in waves for large runs:

```bash
npm run pipeline -- scrape \
  --resume-dir data/backlink-runs/cybersecurity-100k \
  --scrape-limit 25000 \
  --scrape-concurrency 4
```

Scrape/score writes:

- `scrapes.jsonl`
- `opportunities.jsonl`
- `opportunities.csv`
- updated `summary.json`

Repeat the scrape command with the same `--resume-dir`; already scraped/scored records are skipped.

### Export Only

Use when filters/config changed or when regenerating CSV from existing `opportunities.jsonl`:

```bash
npm run pipeline -- export \
  --resume-dir data/backlink-runs/<run>
```

## Scale Profiles

### 1,000 Candidates

```bash
npm run pipeline -- run \
  --niche "cybersecurity" \
  --target 1000 \
  --max-queries 150 \
  --search-pages 4 \
  --scrape-limit 1000 \
  --scrape-concurrency 4
```

Use this for first validation of a niche.

### 10,000 Candidates

```bash
npm run pipeline -- run \
  --config config/backlink-pipeline.example.json \
  --niche "cybersecurity" \
  --target 10000 \
  --max-queries 1000 \
  --search-pages 8 \
  --scrape-limit 10000 \
  --scrape-concurrency 4
```

Use this for a serious production list in one niche.

### 100,000 Candidates

```bash
npm run pipeline -- discover \
  --niche "cybersecurity" \
  --target 100000 \
  --max-queries 8000 \
  --search-pages 10 \
  --run-id cybersecurity-100k

npm run pipeline -- scrape \
  --resume-dir data/backlink-runs/cybersecurity-100k \
  --scrape-limit 25000 \
  --scrape-concurrency 4
```

Repeat scrape in waves until enough candidates are processed.

### 1,000,000 Candidates

Use stage-by-stage execution. Do not try to browser-verify or scrape everything in one pass.

```bash
npm run pipeline -- discover \
  --niche "cybersecurity" \
  --target 1000000 \
  --max-queries 100000 \
  --search-pages 10 \
  --run-id cybersecurity-1m

npm run pipeline -- scrape \
  --resume-dir data/backlink-runs/cybersecurity-1m \
  --scrape-limit 50000 \
  --scrape-concurrency 4
```

For million-scale discovery, search infrastructure matters more than code. SearXNG upstream engines may throttle. Use proxies, multiple SearXNG instances, paid search APIs, Common Crawl/domain seeds, or authority-provider exports as seed lists when needed.

## Query Generation

The generator expands:

- niche terms
- footprint phrases like `submit article`, `write for us`, `add your site`, `submit bookmark`
- seed terms
- locations
- modifiers
- TLD filters
- `inurl:` path terms

For high budgets, the default cybersecurity config currently produces tens of thousands of deterministic search queries before page expansion. `--search-pages 10` multiplies that by search result pages.

Tune these in `config/backlink-pipeline.example.json`:

- `search.queryTemplates`
- `search.footprints`
- `search.seedTerms`
- `search.locations`
- `search.modifiers`
- `search.tlds`
- `search.pathTerms`
- `search.pagesPerQuery`
- `search.maxQueries`

## Scoring

Each opportunity receives component scores:

- `topical_relevance`
- `authority_score`
- `backlink_eligibility`
- `technical_value`
- `editorial_quality`
- `low_risk`

Default weighted score:

- 20% topical relevance
- 20% authority
- 20% backlink eligibility
- 15% technical value
- 15% editorial quality
- 10% low risk

Recommended actions:

- `likely_eligible` - strong evidence and clear submission path.
- `browser_verify` - promising but rendered-page verification is needed.
- `manual_review` - possible opportunity with lower confidence.
- `reject` - weak, risky, noindex, unclear, or low-value.

## Evidence Extracted

The classifier extracts:

- opportunity type
- submission URLs
- signup/login URLs
- explicit `login_required`, `login_confidence`, `login_urls`, and `login_evidence`
- forms that look like submission forms
- outbound links
- outbound domain count
- `rel` counts
- followed external link presence
- `nofollow`, `ugc`, and `sponsored` evidence
- `noindex`
- canonical URL
- evidence snippets
- positive signals
- risk signals

Opportunity types:

- `article_directory`
- `social_bookmarking`
- `niche_directory`
- `guest_post_editorial`
- `community_profile`
- `resource_page`
- `unknown`

## Authority Data

Fallback authority is only a triage proxy. For production, import authority metrics from Ahrefs, Moz, Semrush, Majestic, Similarweb, or another provider.

CSV format:

```csv
domain,authority_score,referring_domains,organic_traffic
example.com,72,18420,95000
```

Run with authority CSV:

```bash
npm run pipeline -- scrape \
  --resume-dir data/backlink-runs/<run> \
  --authority-csv data/authority.csv
```

Accepted authority headers:

- `authority_score`
- `authority`
- `domain_authority`
- `dr`
- `da`

## Browser Harness Verification

Browser Harness is optional and should be used only for high-value or ambiguous records.

Use it for JavaScript-rendered forms, login-gated workflows, rendered `rel` confirmation, incomplete Crawl4AI output, and high-value evidence capture. Rendered browser evidence records `loginRequired`, `loginConfidence`, `loginUrls`, and `loginEvidence`.

The pipeline uses an isolated local Chromium CDP browser by default:

- `browser-harness-local-chromium`
- `http://127.0.0.1:9222/json/version`
- resolved `BU_CDP_WS`
- `BU_NAME=backlink-pipeline`

`browser-harness --doctor` can report the default daemon as unattached while the pipeline verification path works.

Run verification after scoring:

```bash
npm run pipeline -- browser-verify \
  --resume-dir data/backlink-runs/<run> \
  --browser-limit 100
```

Useful overrides:
```bash
npm run pipeline -- browser-verify \
  --resume-dir data/backlink-runs/<run> \
  --browser-cdp-url http://127.0.0.1:9222 \
  --browser-bu-name backlink-pipeline
```

Or enable during a full run:

```bash
npm run pipeline -- run \
  --niche "cybersecurity" \
  --target 10000 \
  --scrape-limit 10000 \
  --browser-verify true \
  --browser-limit 100
```

## Output Files

Each run writes to:

```text
data/backlink-runs/<run>/
```

Files:

- `config.json` - resolved config used by the run.
- `queries.jsonl` - query/page results and errors.
- `candidates.jsonl` - discovered and normalized candidates.
- `scrapes.jsonl` - Crawl4AI scrape outputs and errors.
- `opportunities.jsonl` - scored opportunity records.
- `browser-verifications.jsonl` - optional rendered-browser evidence.
- `opportunities.csv` - review-ready export.
- `summary.json` - counts, timestamps, run metadata.

Use `summary.json` first when auditing a run.

## Review Workflow

Start with `opportunities.csv`.

Prioritize:

1. `score >= 70`
2. `recommended_action` is `likely_eligible` or `browser_verify`
3. topical relevance is high
4. authority score is high or imported from a real authority provider
5. submission URL or form exists
6. no `noindex`
7. low-risk score is high

Reject or deprioritize:

- `noindex`
- unclear submission path
- sponsored-only evidence
- payment-required pages
- excessive outbound-link pages
- auto-approval language
- link-exchange requirements
- irrelevant topic

## Resume Rules

Use `--resume-dir` whenever continuing an existing run.

The pipeline reloads:

- seen candidate URLs
- scraped URLs
- scored candidate IDs
- browser-verified candidate IDs
- previous run config from `config.json`

Examples:

```bash
npm run pipeline -- scrape --resume-dir data/backlink-runs/<run>
npm run pipeline -- export --resume-dir data/backlink-runs/<run>
npm run pipeline -- browser-verify --resume-dir data/backlink-runs/<run> --browser-limit 100
```

Do not manually edit JSONL files while a run is active.

## Troubleshooting

### SearXNG returns few results

Check `queries.jsonl` for `unresponsiveEngines` and errors. Upstream engines may throttle or block.

Mitigations:

- reduce `search.concurrency`
- add proxies to SearXNG infrastructure
- use more seed terms and footprints
- use paid search APIs for large production discovery
- run discovery in waves

### Crawl4AI fails many pages

Check `scrapes.jsonl` errors.

Mitigations:

- reduce `--scrape-concurrency`
- increase `scrape.timeoutMs` in config
- retry the scrape stage with the same `--resume-dir`
- use Browser Harness for the top failed-but-promising domains

### Browser Harness is unavailable

The core pipeline still works without Browser Harness. Disable browser verification or run:

```bash
browser-harness --doctor
```

Then follow `/root/browser-harness/SKILL.md` for local or remote browser setup.

## Validation Commands

After edits:

```bash
npm run build
npm test -- --runInBand
```

Tiny live smoke test:

```bash
npm run pipeline -- run \
  --niche "cybersecurity" \
  --target 5 \
  --max-queries 4 \
  --search-pages 1 \
  --scrape-limit 2 \
  --scrape-concurrency 1 \
  --run-id smoke-cybersecurity
```

Then inspect:

```bash
sed -n '1,160p' data/backlink-runs/smoke-cybersecurity/summary.json
sed -n '1,4p' data/backlink-runs/smoke-cybersecurity/opportunities.csv
```

## Operating Principles

- Use SearXNG and Crawl4AI for scale.
- Use Browser Harness for verification, not bulk crawling.
- Use real authority metrics for production decisions.
- Run large jobs in resumable waves.
- Treat the output as an evidence-backed review queue.
- Keep concurrency conservative until the environment proves stable.
- Prefer adding better footprints, seeds, and authority data before increasing raw volume.
