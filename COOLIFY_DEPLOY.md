# Coolify Deployment

This project can be deployed in Coolify either as a Docker Compose resource or as a single Dockerfile application.

Docker Compose is the recommended end-to-end mode because it starts SearXNG, Crawl4AI, Redis, the MCP server, and the pipeline UI together.

## Services

- `pipeline-ui` - browser dashboard, exposed on port `3004`
- `searxng` - internal metasearch service
- `crawl4ai` - internal scraping service
- `redis` - internal cache
- `mcp-server` - optional MCP service

## Coolify Setup

### Recommended: Docker Compose Resource

1. Create a new Coolify resource from the GitHub repository.
2. Select Docker Compose deployment.
3. Use `docker-compose.coolify.yml` from the repository root.
4. Expose only the `pipeline-ui` service on port `3000`.
5. Keep `searxng`, `crawl4ai`, `redis`, and `mcp-server` internal.
6. The compose file already defines persistent named volumes for:

```text
backlink_runs
logs_data
redis_data
```

7. Set environment variables:

```env
SEARXNG_SECRET=replace-with-a-long-random-secret
PROXY_URL=
```

`PROXY_URL` is optional for small tests. For high-volume discovery, use a reliable rotating proxy or paid search data source.

## Start Command

Coolify should run the compose stack automatically. For manual VPS deployment:

```bash
docker compose -f docker-compose.coolify.yml up -d --build pipeline-ui
```

Then open:

```text
http://YOUR_DOMAIN_OR_IP:3004
```

## Notes

- The UI uses the existing pipeline CLI; it does not replace pipeline logic.
- Results are written to `data/backlink-runs`.
- Do not browser-verify every candidate at very large scale. Use browser verification for top-scored or ambiguous targets.
- Large-scale discovery may be throttled by upstream search engines unless proxies or paid search APIs are used.

### Fallback: Dockerfile Application

If Coolify is configured as a normal application instead of a Docker Compose resource, it will route traffic to `PORT=3000`. The default `Dockerfile` supports that mode and starts the pipeline UI.

For full pipeline runs in single-application mode, configure reachable service URLs:

```env
SEARXNG_URL=http://your-searxng-host:8080
CRAWL4AI_URL=http://your-crawl4ai-host:8000
PIPELINE_OUTPUT_DIR=/app/data/backlink-runs
```

Single-application mode is useful for the dashboard, but Docker Compose mode is still the correct end-to-end installation.
