# Backlink Opportunity Pipeline

This repository now includes a production-oriented pipeline for finding and validating backlink opportunities from article directories, social bookmarking sites, niche directories, resource pages, guest/editorial submission pages, and community/profile pages.

The pipeline is an intelligence and verification system. It discovers opportunities, scrapes public pages, scores evidence, and exports review queues. It does not create accounts, submit posts, or place links automatically.

## Architecture

```text
SearXNG discovery
  -> candidate normalization and dedupe
  -> Crawl4AI scrape
  -> opportunity classifier
  -> technical link evidence extraction
  -> authority scoring
  -> risk scoring
  -> CSV/JSONL review queue
  -> optional Browser Harness verification for top/ambiguous targets
```

## Files Added

- `src/backlink-pipeline/cli.ts` - command-line entrypoint.
- `src/backlink-pipeline/pipeline.ts` - orchestration for discovery, scrape/score, browser verification, and export.
- `src/backlink-pipeline/classifier.ts` - opportunity classification, evidence extraction, and scoring.
- `src/backlink-pipeline/clients.ts` - SearXNG and Crawl4AI HTTP clients.
- `src/backlink-pipeline/authority.ts` - fallback authority scoring plus CSV authority import.
- `src/backlink-pipeline/browser-harness.ts` - optional rendered-browser verification.
- `src/backlink-pipeline/store.ts` - resumable JSONL/CSV persistence.
- `config/backlink-pipeline.example.json` - production config template.

## Start Services

```bash
cd /root/backlinks/searxng-crawl4ai-mcp-master
docker compose up -d
docker compose ps
```

Expected local services:

- SearXNG: `http://localhost:8081`
- Crawl4AI: `http://localhost:8001`
- MCP stdio server: `node fixed-mcp-server.js`

## Build

```bash
npm run build
```

## Pipeline UI

The repository includes a browser console for operating the same pipeline without changing its logic. The UI starts the existing CLI commands, watches job logs, reads the same JSONL/CSV artifacts, and exposes filters/export links for review.

Run locally:

```bash
npm run build
npm run pipeline:ui
```

Open:

```text
http://localhost:3004
```

The UI supports:

- starting full runs or discovery-only runs
- selecting target size, query budget, search pages, scrape budget, and worker counts
- resuming scrape, Browser Harness verification, and CSV export for an existing run
- filtering opportunities by score, action, type, login status, browser status, and text search
- viewing candidates, scored opportunities, browser verification evidence, and job logs
- downloading full or filtered `opportunities.csv`

## Docker UI

Build and run the full stack with the pipeline UI:

```bash
docker compose up -d --build pipeline-ui
```

Open:

```text
http://localhost:3004
```

The `pipeline-ui` service uses the compose network URLs:

- SearXNG: `http://searxng:8080`
- Crawl4AI: `http://crawl4ai:8000`

Run output is persisted through:

```text
./data/backlink-runs:/app/data/backlink-runs
```

So CLI runs and UI runs share the same artifacts.

## Run A Small Test

```bash
npm run pipeline -- run \
  --niche "cybersecurity" \
  --target 100 \
  --max-queries 20 \
  --search-pages 2 \
  --scrape-limit 50 \
  --scrape-concurrency 2
```

The run directory is printed at the end, for example:

```text
data/backlink-runs/2026-06-02_10-30-00-000_cybersecurity
```

## Production Runs

### 1,000 candidates

```bash
npm run pipeline -- run \
  --niche "cybersecurity" \
  --target 1000 \
  --max-queries 150 \
  --search-pages 4 \
  --scrape-limit 1000 \
  --scrape-concurrency 4
```

### 10,000 candidates

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

### 100,000+ candidates

Run discovery and scraping separately so the process can be resumed and tuned:

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

Repeat the `scrape` command until the scrape budget is complete.

### 1,000,000 candidates

The code supports million-candidate runs through JSONL streaming and resume. The infrastructure must also be scaled:

- Use a large query budget across many seed terms, locations, and languages.
- Expect public search engines behind SearXNG to throttle. Add proxies or paid search APIs if you need consistent million-scale discovery.
- Keep Crawl4AI concurrency conservative per host, and run multiple machines/workers if you need speed.
- Use authority CSV import. Fallback authority is only a proxy.
- Run Browser Harness only for the top scored subset, not all million candidates.

Suggested flow:

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
  --scrape-concurrency 4 \
  --authority-csv data/authority.csv
```

Repeat scraping in waves. Each wave skips already-scraped URLs.

## Output Artifacts

Each run writes:

- `config.json` - final resolved config.
- `queries.jsonl` - every SearXNG query/page and errors.
- `candidates.jsonl` - normalized candidate URLs and discovery evidence.
- `scrapes.jsonl` - Crawl4AI scrape results and errors.
- `opportunities.jsonl` - scored opportunity records.
- `browser-verifications.jsonl` - optional Browser Harness evidence.
- `opportunities.csv` - review-ready export.
- `summary.json` - counts and timestamps.

## CSV Columns

`opportunities.csv` includes:

- `score`
- `recommended_action`
- `domain`
- `url`
- `type`
- `title`
- `authority_score`
- `topical_relevance`
- `backlink_eligibility`
- `technical_value`
- `editorial_quality`
- `low_risk`
- `has_submission_form`
- `login_required`
- `login_confidence`
- `has_followed_external_links`
- `has_noindex`
- `submission_urls`
- `signup_urls`
- `login_urls`
- `sample_outbound_urls`
- `signals`
- `risks`
- `login_evidence`
- `evidence`

## Authority Metrics

Fallback authority scoring uses discovery/rank/domain-shape proxies and is useful for early triage only.

For production, export a CSV from Ahrefs, Moz, Semrush, Majestic, or another authority source:

```csv
domain,authority_score,referring_domains,organic_traffic
example.com,72,18420,95000
```

Then run:

```bash
npm run pipeline -- scrape \
  --resume-dir data/backlink-runs/<run> \
  --authority-csv data/authority.csv
```

Accepted authority headers include `authority_score`, `authority`, `domain_authority`, `dr`, or `da`.

## Browser Harness Verification

Browser Harness is for rendered-page validation:

- JavaScript-rendered forms.
- Login gates and account-required workflows.
- Popups/modals.
- Login or registration gates.
- Rendered `rel` attributes.
- Pages where Crawl4AI sees incomplete HTML.
- High-score pages that need human-grade evidence.

The pipeline defaults to an isolated local Chromium CDP browser instead of the default Browser Harness user-browser daemon:

- starts `browser-harness-local-chromium`
- resolves `http://127.0.0.1:9222/json/version`
- passes the resolved WebSocket through `BU_CDP_WS`
- uses `BU_NAME=backlink-pipeline`

This avoids relying on the normal `browser-harness --doctor` default daemon, which may be unattached if the user's regular Chrome profile has not enabled remote debugging.

After setup:

```bash
npm run pipeline -- browser-verify \
  --resume-dir data/backlink-runs/<run> \
  --browser-limit 100
```

Override the CDP browser when needed:

```bash
npm run pipeline -- browser-verify \
  --resume-dir data/backlink-runs/<run> \
  --browser-cdp-url http://127.0.0.1:9222 \
  --browser-bu-name backlink-pipeline
```

Or enable during a run:

```bash
npm run pipeline -- run \
  --niche "cybersecurity" \
  --target 10000 \
  --scrape-limit 10000 \
  --browser-verify true \
  --browser-limit 100
```

Do not browser-verify every candidate at large scale. Use it for the top scored or ambiguous records.

## Scoring Model

Default weighted score:

- 20% topical relevance
- 20% authority
- 20% backlink eligibility
- 15% technical link value
- 15% editorial quality
- 10% low-risk score

Recommended actions:

- `likely_eligible` - strong evidence and clear submission path.
- `browser_verify` - promising but needs rendered-page validation.
- `manual_review` - usable but lower confidence.
- `reject` - low score, no clear path, noindex, or severe risk signals.

## Resume Behavior

Use `--resume-dir` to continue a run:

```bash
npm run pipeline -- scrape --resume-dir data/backlink-runs/<run>
npm run pipeline -- export --resume-dir data/backlink-runs/<run>
```

The pipeline reloads:

- seen candidate URLs
- scraped URLs
- scored candidate IDs
- browser-verified candidate IDs

It appends new records and skips completed work.

## Scaling Notes

SearXNG is a metasearch engine, so large-scale discovery depends on the health and throttling behavior of upstream engines. For reliable 100k to 1M runs, use at least one of:

- private SearXNG engines with proxy rotation
- paid search APIs
- Common Crawl/domain-list seed imports
- authority-provider exports as seed domains
- multiple SearXNG/Crawl4AI workers

The current implementation is single-process and resumable. For very high throughput, the next production step would be splitting discovery, scrape, and browser verification into queue workers backed by Redis/Bull or a database. The JSONL format already gives a clean migration path because every stage has append-only records.

## Quality Controls

The pipeline intentionally flags:

- `noindex`
- unclear submission path
- sponsored-only links
- payment-required pages
- excessive outbound-link pages
- auto-approval or low-quality directory language
- risky verticals and link-exchange language

The best use is to produce a high-quality human review queue, not a blind target list.
