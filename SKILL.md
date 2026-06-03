---
name: searxng-crawl4ai-mcp
description: Use the locally installed SearXNG + Crawl4AI MCP server for self-hosted web search, page scraping, and search-then-scrape workflows. Trigger when the user asks to scrape web data, search the web through this local stack, connect an MCP client to it, validate the server, configure proxies, or troubleshoot this specific installation.
---

# SearXNG + Crawl4AI MCP

This skill describes how to use the local self-hosted search and scraping stack installed at:

```text
/root/backlinks/searxng-crawl4ai-mcp-master
```

The working stack has four services:

- `searxng`: metasearch service exposed on `http://localhost:8081`
- `crawl4ai`: scraping service exposed on `http://localhost:8001`
- `redis`: cache exposed on `localhost:6380`
- `mcp-server`: stdio MCP server container; do not treat port `3003` as an HTTP MCP API

The usable self-hosted MCP entrypoint is:

```text
/root/backlinks/searxng-crawl4ai-mcp-master/fixed-mcp-server.js
```

Do not use `dist/index.js` for normal self-hosted scraping. That original entrypoint initializes Firecrawl and requires `FIRECRAWL_API_KEY`. Use `npm run start:firecrawl` only when the user explicitly wants the Firecrawl-compatible path and has credentials.

The same workspace also includes a backlink opportunity intelligence pipeline. Use it when the user asks to discover, scrape, score, validate, or export backlink opportunities from article directories, social bookmarking sites, niche directories, resource pages, editorial submission pages, or community/profile pages.

```bash
npm run pipeline -- run --niche "cybersecurity" --target 10000 --scrape-limit 10000
```

Read `BACKLINK_PIPELINE.md` before changing or running the pipeline at scale.

For a dedicated pipeline operating skill, read:

```text
skills/backlink-opportunity-pipeline/SKILL.md
```

For the supervised content creation, approved publishing, and backlink verification layer, read:

```text
skills/backlink-content-publishing-agent/SKILL.md
```

## Core Workflow

1. Go to the install directory:

```bash
cd /root/backlinks/searxng-crawl4ai-mcp-master
```

2. Start or rebuild the backend stack:

```bash
docker compose up -d --build
```

3. Check service status:

```bash
docker compose ps
```

Expected state:

- `searxng` is `healthy`
- `redis` is `healthy`
- `crawl4ai` is `Up`
- `mcp-server` is `Up` and not restarting

4. Validate direct backend health:

```bash
curl -fsS http://localhost:8001/health
```

Expected response:

```json
{"status":"ok","service":"crawl4ai"}
```

5. Validate direct scraping:

```bash
curl -fsS -X POST http://localhost:8001/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","formats":["markdown","links"]}'
```

6. Validate SearXNG search:

```bash
curl -fsS 'http://localhost:8081/search?q=example%20domain&format=json'
```

## MCP Client Configuration

Use stdio. Point the MCP client to `fixed-mcp-server.js`.

For a client running on the host:

```json
{
  "command": "node",
  "args": ["/root/backlinks/searxng-crawl4ai-mcp-master/fixed-mcp-server.js"],
  "env": {
    "MCP_MODE": "true",
    "SEARXNG_URL": "http://localhost:8081",
    "CRAWL4AI_URL": "http://localhost:8001"
  }
}
```

For a client running inside the Compose network:

```json
{
  "command": "node",
  "args": ["/app/fixed-mcp-server.js"],
  "env": {
    "MCP_MODE": "true",
    "SEARXNG_URL": "http://searxng:8080",
    "CRAWL4AI_URL": "http://crawl4ai:8000"
  }
}
```

Always set `MCP_MODE=true` for stdio MCP usage. It suppresses startup logging that would otherwise corrupt JSON-RPC over stdout.

## MCP Tools

The self-hosted MCP server exposes three tools.

### `search_web`

Searches the web through SearXNG.

Arguments:

```json
{
  "query": "example domain",
  "maxResults": 10
}
```

Behavior:

- Calls `GET /search?q=...&format=json&safesearch=0`
- Returns a JSON string in `content[0].text`
- Includes `success`, `query`, `resultCount`, `results`, and `unresponsive_engines`

Use this when the user wants search results, source URLs, snippets, or a first pass before scraping.

### `crawl4ai_scrape`

Scrapes one URL through Crawl4AI.

Arguments:

```json
{
  "url": "https://example.com",
  "formats": ["markdown", "html", "links", "media"],
  "wait_for": 0,
  "timeout": 30000
}
```

Supported formats:

- `markdown`: cleaned page content as markdown
- `html`: cleaned HTML
- `links`: internal/external link data
- `media`: discovered media assets

Behavior:

- Calls `POST /scrape`
- Defaults to `formats: ["markdown"]`
- Returns a JSON string in `content[0].text`
- Typical result contains `success`, `url`, `data.markdown`, `data.metadata`, and optional `data.links` or `data.media`

Use this when the user already has a target URL and wants content extracted.

### `search_and_scrape`

Searches through SearXNG and scrapes the top results through Crawl4AI.

Arguments:

```json
{
  "query": "example domain",
  "maxResults": 3
}
```

Behavior:

- Searches SearXNG first
- Scrapes top results with Crawl4AI
- Caps `maxResults` at 5
- Uses markdown scraping for each top result
- Returns successful and failed scrape results together

Use this when the user wants data gathering from search terms rather than known URLs.

## Direct HTTP API

Use direct HTTP endpoints when MCP is not necessary or when debugging.

Search:

```bash
curl -fsS 'http://localhost:8081/search?q=your%20query&format=json'
```

Scrape markdown:

```bash
curl -fsS -X POST http://localhost:8001/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","formats":["markdown"]}'
```

Scrape markdown plus links:

```bash
curl -fsS -X POST http://localhost:8001/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","formats":["markdown","links"]}'
```

Batch scrape:

```bash
curl -fsS -X POST http://localhost:8001/batch-scrape \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://example.com","https://www.iana.org/help/example-domains"],"formats":["markdown"],"concurrency":2}'
```

## Local Node Entrypoints

Install dependencies if needed:

```bash
npm install
```

Build TypeScript:

```bash
npm run build
```

Run the self-hosted MCP server:

```bash
MCP_MODE=true \
SEARXNG_URL=http://localhost:8081 \
CRAWL4AI_URL=http://localhost:8001 \
npm start
```

This starts a stdio MCP server. It will appear to wait silently because it expects a client to speak MCP JSON-RPC over stdin/stdout.

Run the original Firecrawl-compatible path only if required:

```bash
FIRECRAWL_API_KEY=... npm run start:firecrawl
```

## Proxy Configuration

SearXNG engines may show `CAPTCHA`, `too many requests`, or `access denied` without a proxy. This is normal for metasearch.

To use a proxy, set `PROXY_URL` before starting Compose:

```bash
PROXY_URL='http://user:pass@host:port' docker compose up -d --build
```

Supported proxy URL styles depend on the underlying browser/network libraries, but HTTP proxy URLs are the safest default.

After changing `PROXY_URL`, recreate services:

```bash
docker compose up -d --build
```

## Logs And Troubleshooting

Check all service status:

```bash
docker compose ps
```

Read service logs:

```bash
docker compose logs --no-color --tail=120 searxng
docker compose logs --no-color --tail=120 crawl4ai
docker compose logs --no-color --tail=120 mcp-server
```

Common issues:

- `mcp-server` restarting: ensure it starts `node fixed-mcp-server.js`, has `stdin_open: true`, and `MCP_MODE=true`.
- `dist/index.js` fails with `API key is required`: use `fixed-mcp-server.js` instead, or provide Firecrawl credentials intentionally.
- Search works but has `unresponsive_engines`: upstream search engines are rate-limiting or blocking; try fewer engines or set `PROXY_URL`.
- Crawl4AI health works but scraping fails: inspect `crawl4ai` logs and try a simpler URL such as `https://example.com`.
- Browser-related scrape errors after rebuild: rebuild Crawl4AI with `docker compose up -d --build crawl4ai`.

## Operational Notes

- Prefer the MCP tools for agent workflows.
- Prefer direct HTTP calls for quick validation or bulk scripting.
- Do not use the exposed `3003` port as an HTTP API; the MCP server is stdio-based.
- Keep `fixed-mcp-server.js` as the default self-hosted entrypoint.
- The Docker image is large because Crawl4AI installs Chromium, Playwright, Chrome, and browser dependencies.
- `npm audit` reports vulnerabilities in the dependency tree; do not run forced audit fixes unless the user asks, because they may introduce breaking changes.
