# Coolify Deployment

This project can be deployed as a Docker Compose application in Coolify.

## Services

- `pipeline-ui` - browser dashboard, exposed on port `3004`
- `searxng` - internal metasearch service
- `crawl4ai` - internal scraping service
- `redis` - internal cache
- `mcp-server` - optional MCP service

## Coolify Setup

1. Create a new Coolify resource from the GitHub repository.
2. Select Docker Compose deployment.
3. Use `docker-compose.yml` from the repository root.
4. Expose only the `pipeline-ui` service on port `3004`.
5. Add persistent storage for:

```text
./data/backlink-runs
./logs
```

6. Set environment variables:

```env
SEARXNG_SECRET=replace-with-a-long-random-secret
PROXY_URL=
PIPELINE_UI_PORT=3004
```

`PROXY_URL` is optional for small tests. For high-volume discovery, use a reliable rotating proxy or paid search data source.

## Start Command

Coolify should run the compose stack automatically. For manual VPS deployment:

```bash
docker compose up -d --build pipeline-ui
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
