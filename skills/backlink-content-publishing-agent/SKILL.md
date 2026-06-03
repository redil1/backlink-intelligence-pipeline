---
name: backlink-content-publishing-agent
description: Use when the user wants an AI agent to run the backlink opportunity pipeline, analyze iptv.shopping or another authorized website, create relevant backlink-ready posts, publish only to owned or explicitly authorized destinations, and verify the final backlinks end to end.
---

# Backlink Content Publishing Agent

Use this skill when the user wants an agent to move from backlink opportunity discovery into content planning, drafting, approved publishing, and verification for `iptv.shopping` or another website the user owns or is authorized to promote.

This skill extends the local backlink opportunity pipeline. It does not replace it.

Pipeline root:

```text
/root/backlinks/searxng-crawl4ai-mcp-master
```

Primary pipeline skill:

```text
skills/backlink-opportunity-pipeline/SKILL.md
```

## Operating Boundary

The agent may automate:

- Running discovery, scrape, scoring, browser verification, filtering, and export.
- Crawling and analyzing the user's owned website.
- Selecting target pages from the owned website for natural backlinks.
- Creating original posts, article drafts, descriptions, summaries, author bios, and submission packets.
- Publishing directly to owned or explicitly authorized CMS/API destinations.
- Verifying published URLs and backlink attributes after publication.
- Producing a final report with evidence and next actions.

The agent must not blindly publish to third-party websites. For third-party opportunities, it must prepare a submission packet and require user approval before any submission attempt. It must also follow each target site's rules.

Hard stops:

- Stop if the target site requires payment and the user did not explicitly approve paid placement.
- Stop if the target site prohibits commercial/self-promotional links.
- Stop if no clear submission path exists.
- Stop if account creation is required and the user has not provided an authorized account.
- Stop if CAPTCHA, email confirmation, phone verification, or manual identity checks appear.
- Stop if the page is classified as `reject`, `paymentRequired=true`, `strictEvidence.tier=reject`, or high risk.
- Stop if the generated content would be irrelevant to the target site's topic.

## Desired End State

For each campaign, the user should receive:

- A verified opportunity shortlist.
- A profile of `iptv.shopping` or the promoted website.
- A map of target backlink pages and anchors.
- Original content briefs.
- Publishable drafts.
- Submission packets for third-party sites.
- Published URLs for owned or explicitly authorized destinations.
- Verification records showing the backlink target, anchor, link `rel`, dofollow status, indexability, and screenshots or extracted evidence when available.
- A final campaign report.

Recommended output directory:

```text
data/backlink-publishing/<campaign-id>/
```

Recommended files:

```text
site-profile.json
target-pages.json
opportunity-shortlist.csv
content-briefs.jsonl
drafts/<target-domain>-<topic>.md
submission-packets/<target-domain>.json
publish-log.jsonl
verification.jsonl
final-report.md
```

## Inputs To Collect

Minimum inputs:

- Promoted site URL, for example `https://iptv.shopping`.
- Campaign keyword, for example `watch TV online`.
- Desired scale, for example `1000`, `10000`, or larger staged runs.
- Allowed target pages on the promoted site.
- Publishing permissions.

Publishing permission examples:

- Owned WordPress site with REST API credentials.
- Owned blog/admin panel where the user has provided authorized login.
- Owned static site repository where the agent may add posts and deploy.
- Explicitly approved third-party submission page for one specific post.

If publishing permissions are missing, the agent may still create drafts and submission packets, but it must not submit or publish.

## Step 1: Prepare The Local Stack

Start from the repo root:

```bash
cd /root/backlinks/searxng-crawl4ai-mcp-master
```

Check services:

```bash
docker compose ps
curl -fsS http://localhost:8001/health
curl -fsS 'http://localhost:8081/search?q=example&format=json'
```

Build the TypeScript pipeline after code changes:

```bash
npm run build
```

If the UI is needed:

```bash
npm run pipeline:ui
```

If running on Docker/Coolify, confirm the app container has:

- `SEARXNG_URL=http://searxng:8080`
- `CRAWL4AI_URL=http://backlink-crawl4ai:8000`
- `PIPELINE_OUTPUT_DIR=/app/data/backlink-runs`

## Step 2: Run Opportunity Discovery

For a first campaign around `iptv.shopping`, use the niche and keyword together:

```bash
npm run pipeline -- run \
  --niche "IPTV watch TV online" \
  --target 1000 \
  --max-queries 150 \
  --search-pages 4 \
  --scrape-limit 500 \
  --scrape-concurrency 4 \
  --browser-verify true \
  --browser-limit 100 \
  --run-id iptv-watch-tv-online-1000
```

For larger campaigns, split discovery and scraping:

```bash
npm run pipeline -- discover \
  --niche "IPTV watch TV online" \
  --target 100000 \
  --max-queries 8000 \
  --search-pages 10 \
  --run-id iptv-watch-tv-online-100k

npm run pipeline -- scrape \
  --resume-dir data/backlink-runs/iptv-watch-tv-online-100k \
  --scrape-limit 25000 \
  --scrape-concurrency 4

npm run pipeline -- browser-verify \
  --resume-dir data/backlink-runs/iptv-watch-tv-online-100k \
  --browser-limit 500

npm run pipeline -- export \
  --resume-dir data/backlink-runs/iptv-watch-tv-online-100k
```

For 1M scale, use multiple staged discovery runs, external seed lists, real authority data, and repeated scrape waves. Do not browser-verify everything.

## Step 3: Filter To Realistic Targets

Start from:

```text
data/backlink-runs/<run-id>/opportunities.csv
data/backlink-runs/<run-id>/opportunities.jsonl
data/backlink-runs/<run-id>/browser-verifications.jsonl
data/backlink-runs/<run-id>/summary.json
```

Prefer records with:

- `strictEvidence.tier=tier_a` or `tier_b`.
- `recommendedAction=likely_eligible` or `browser_verify`.
- `paymentRequired=false`.
- `strictDofollow=true` or high `dofollowConfidence`.
- high `acceptanceProbability`.
- high `submissionPathConfidence`.
- low `riskScore`.
- clear `submissionUrls`.
- visible evidence that accepted external links are followed.
- topical relevance to IPTV, streaming, television, entertainment, technology, consumer software, or digital media.

Reject records with:

- `paymentRequired=true`.
- `strictEvidence.tier=reject`.
- `recommendedAction=reject`.
- `noindex=true`.
- `nofollow`, `ugc`, or `sponsored` evidence on accepted external links.
- link exchange requirements.
- article spinning, auto-approval, doorway pages, or irrelevant outbound-link pages.
- login requirement without a provided authorized account.
- no public accepted-post examples.

The shortlist should be saved as:

```text
data/backlink-publishing/<campaign-id>/opportunity-shortlist.csv
```

## Step 4: Understand iptv.shopping

The agent must crawl the promoted website before writing content.

Minimum crawl targets:

- homepage
- main navigation pages
- product/service pages
- pricing or plan pages
- FAQ/help pages
- blog or article pages
- contact/about pages
- sitemap URLs if available

Extract:

- brand name and positioning
- primary offer
- target customers
- countries/languages served
- product categories
- plan names or service tiers
- important differentiators
- content tone
- recurring terminology
- pages that deserve backlinks
- pages that should not be linked
- canonical URLs
- title tags, meta descriptions, H1s, H2s, and internal linking structure

Save:

```text
data/backlink-publishing/<campaign-id>/site-profile.json
data/backlink-publishing/<campaign-id>/target-pages.json
```

`site-profile.json` should contain:

```json
{
  "site": "https://iptv.shopping",
  "brand": "",
  "primaryOffer": "",
  "audience": [],
  "topics": [],
  "tone": "",
  "avoidClaims": [],
  "targetPages": []
}
```

`target-pages.json` should contain:

```json
[
  {
    "url": "https://iptv.shopping/",
    "purpose": "homepage",
    "bestAnchors": ["IPTV service", "watch TV online"],
    "avoidAnchors": ["cheap IPTV", "free IPTV"],
    "notes": ""
  }
]
```

## Step 5: Match Opportunities To Content Angles

For every shortlisted opportunity, classify:

- target site topic
- accepted content format
- editorial strictness
- backlink allowance
- likely link placement
- safest target page on `iptv.shopping`
- natural anchor text
- article angle

Good article angles for IPTV should be educational and useful, for example:

- how online TV viewing works
- how to compare streaming and IPTV services
- checklist for choosing a TV subscription
- device compatibility guide
- streaming quality and bandwidth guide
- legal and practical questions consumers should ask
- setup guides for common devices

Avoid exaggerated claims, unsupported legality claims, misleading "free TV" claims, or keyword-stuffed anchors.

Save content briefs to:

```text
data/backlink-publishing/<campaign-id>/content-briefs.jsonl
```

Each brief should include:

```json
{
  "opportunityUrl": "",
  "submissionUrl": "",
  "targetDomain": "",
  "topic": "",
  "format": "article",
  "targetPage": "https://iptv.shopping/",
  "anchorText": "",
  "linkIntent": "",
  "titleOptions": [],
  "outline": [],
  "requiredEvidence": [],
  "siteRules": [],
  "publishMode": "owned_auto|third_party_packet|manual_review"
}
```

## Step 6: Draft The Content

Every draft must be original, useful, and specific to the target site's audience.

Draft requirements:

- Match the target site's accepted format and topic.
- Include a clear title.
- Include a short intro.
- Use useful subheadings.
- Add practical details, examples, or checklists.
- Include one natural backlink unless the target site allows more and the extra links are justified.
- Use a relevant target page from `target-pages.json`.
- Use natural anchor text.
- Avoid repeated exact-match anchors.
- Avoid unverifiable claims.
- Avoid copying `iptv.shopping` marketing text.
- Avoid thin, generic, or template-like writing.

Recommended draft front matter:

```yaml
---
campaign: iptv-watch-tv-online
target_domain: example.com
submission_url: https://example.com/submit
promoted_site: https://iptv.shopping
target_page: https://iptv.shopping/
anchor_text: watch TV online
publish_mode: third_party_packet
approval_status: pending
---
```

Save drafts to:

```text
data/backlink-publishing/<campaign-id>/drafts/
```

## Step 7: Review Gate

Before publishing or submitting, the agent must verify:

- The opportunity is not rejected by the pipeline.
- The target site allows the content type.
- The target site allows relevant outbound links.
- The draft follows the target site's rules.
- The link is useful in context.
- The anchor is not manipulative or over-optimized.
- The target page on `iptv.shopping` is relevant.
- The user has authorized the publishing destination.

Publishing modes:

- `owned_auto`: publish automatically to a property the user owns or explicitly controls.
- `authorized_auto`: publish automatically only when credentials and permission are explicit for that destination.
- `third_party_packet`: create a complete packet for manual or approved submission.
- `manual_review`: stop and ask for decision.
- `reject`: do not publish.

For third-party sites, default to `third_party_packet`, not automatic submission.

## Step 8: Publish To Authorized Destinations

Only publish when `publishMode` is `owned_auto` or `authorized_auto`.

Examples of valid automated publishing:

- WordPress REST API with user-provided application password.
- A static blog repository where the user asked the agent to add posts.
- A first-party CMS API with provided credentials.
- A partner site where the user has explicitly provided an authorized account and asked for one specific submission.

The publish log must record:

```json
{
  "timestamp": "",
  "campaignId": "",
  "mode": "owned_auto",
  "destination": "",
  "draftPath": "",
  "publishedUrl": "",
  "targetPage": "",
  "anchorText": "",
  "status": "published|failed|skipped",
  "reason": ""
}
```

Save logs to:

```text
data/backlink-publishing/<campaign-id>/publish-log.jsonl
```

## Step 9: Create Third-Party Submission Packets

For third-party opportunities, create a packet instead of blind submission.

Each packet should include:

- target domain
- opportunity URL
- submission URL
- site rules summary
- login requirement status
- payment requirement status
- dofollow evidence
- accepted-post examples
- draft title
- draft body
- author bio
- target page
- anchor text
- suggested category
- tags
- risk notes
- approval checklist

Save packets to:

```text
data/backlink-publishing/<campaign-id>/submission-packets/
```

Packet schema:

```json
{
  "targetDomain": "",
  "opportunityUrl": "",
  "submissionUrl": "",
  "pipelineRun": "",
  "strictTier": "",
  "dofollowConfidence": 0,
  "acceptanceProbability": 0,
  "paymentRequired": false,
  "loginRequired": false,
  "siteRules": [],
  "draftPath": "",
  "title": "",
  "targetPage": "",
  "anchorText": "",
  "approvalRequired": true,
  "approvedByUser": false,
  "status": "ready_for_review"
}
```

## Step 10: Verify Published Backlinks

After a post is published or submitted and accepted, verify:

- published URL returns HTTP 200
- page is indexable unless intentionally private
- target link exists
- target URL matches the intended `iptv.shopping` page
- anchor text matches or is acceptable
- link does not include `nofollow`, `ugc`, or `sponsored` unless the campaign accepts that
- canonical URL is stable
- page is not blocked by robots/meta noindex
- screenshot or extracted HTML evidence is stored when possible

Use Crawl4AI for initial verification. Use Browser Harness when the link is rendered by JavaScript or when Crawl4AI output is incomplete.

Save records to:

```text
data/backlink-publishing/<campaign-id>/verification.jsonl
```

Verification schema:

```json
{
  "timestamp": "",
  "publishedUrl": "",
  "statusCode": 200,
  "indexability": "indexable|noindex|blocked|unknown",
  "targetPage": "",
  "anchorText": "",
  "linkFound": true,
  "rel": [],
  "isDofollow": true,
  "canonicalUrl": "",
  "evidence": [],
  "screenshotPath": "",
  "result": "verified|manual_review|failed"
}
```

## Step 11: Final Report

Create:

```text
data/backlink-publishing/<campaign-id>/final-report.md
```

The report should include:

- campaign keyword
- pipeline run ID
- promoted site
- total candidates discovered
- total pages scraped
- total opportunities scored
- total shortlisted
- total drafts created
- total third-party packets created
- total posts published to owned/authorized destinations
- total backlinks verified
- dofollow verified count
- manual review queue
- rejected targets and reasons
- recommended next wave

## Agent Decision Logic

Use this decision flow:

1. Run or resume the opportunity pipeline.
2. Export and inspect `summary.json` and `opportunities.csv`.
3. Build a strict shortlist from dofollow, acceptance, submission-path, payment, login, risk, and topical evidence.
4. Crawl and profile `iptv.shopping`.
5. Select target pages and natural anchors.
6. Create content briefs for each shortlisted opportunity.
7. Draft content.
8. Decide publish mode.
9. Publish only to owned or explicitly authorized destinations.
10. Create submission packets for third-party opportunities.
11. Verify every published backlink.
12. Write the final report.

## Quality Bar

The agent should optimize for verified, relevant, durable backlinks, not raw count.

A strong opportunity has:

- clear editorial or submission path
- real accepted examples
- followed external links in accepted examples
- topical fit
- no payment requirement unless approved
- low outbound-link abuse signals
- reasonable authority
- content standards that can be met with a useful article

A strong post has:

- real informational value
- audience fit
- natural link placement
- varied anchor text
- factual claims that can be supported
- no copied content
- no keyword stuffing
- no irrelevant promotion

## When To Ask The User

Ask for user input when:

- publishing credentials are needed
- a login-gated destination requires an account
- a target asks for payment
- site rules are unclear
- a draft contains business claims that need confirmation
- the agent wants to submit to a third-party site
- the promoted site's target page strategy is unclear

Do not ask before routine discovery, scraping, scoring, drafting, exporting, or verification.
