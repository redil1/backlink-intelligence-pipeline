import { loadConfig } from './config.js';
import { BacklinkOpportunityPipeline } from './pipeline.js';
import { PipelineStore } from './store.js';
import type { PipelineConfig } from './types.js';

type Command = 'run' | 'discover' | 'scrape' | 'browser-verify' | 'export' | 'help';

interface ParsedArgs {
  command: Command;
  configPath?: string;
  overrides: Partial<PipelineConfig>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'help') {
    printHelp();
    return;
  }

  const config = await loadConfig(args.configPath, args.overrides);
  const store = await PipelineStore.open(config);
  const pipeline = new BacklinkOpportunityPipeline(config, store);

  try {
    await pipeline.init();

    if (args.command === 'run') {
      await pipeline.run();
    } else if (args.command === 'discover') {
      await pipeline.discover();
    } else if (args.command === 'scrape') {
      await pipeline.scrapeAndScore();
      await pipeline.export();
    } else if (args.command === 'browser-verify') {
      await pipeline.browserVerify();
    } else if (args.command === 'export') {
      await pipeline.export();
    }
  } finally {
    await store.close();
  }

  console.log(`Run directory: ${store.runDir}`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const [first, ...rest] = argv;
  const command = normalizeCommand(first);
  const tokens = command === 'help' ? argv : rest;
  const overrides: Partial<PipelineConfig> = {};
  let configPath: string | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];

    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const value = next && !next.startsWith('--') ? next : 'true';
    if (value !== 'true') {
      index += 1;
    }

    switch (key) {
      case 'config':
        configPath = value;
        break;
      case 'niche':
        overrides.niche = value;
        break;
      case 'target':
        overrides.targetCandidates = Number(value);
        break;
      case 'output-dir':
        overrides.outputDir = value;
        break;
      case 'run-id':
        overrides.runId = value;
        break;
      case 'resume-dir':
        overrides.resumeDir = value;
        break;
      case 'searxng-url':
        overrides.searxngUrl = value;
        break;
      case 'crawl4ai-url':
        overrides.crawl4aiUrl = value;
        break;
      case 'search-pages':
        overrides.search = { ...(overrides.search || {}), pagesPerQuery: Number(value) } as PipelineConfig['search'];
        break;
      case 'search-concurrency':
        overrides.search = { ...(overrides.search || {}), concurrency: Number(value) } as PipelineConfig['search'];
        break;
      case 'max-queries':
        overrides.search = { ...(overrides.search || {}), maxQueries: Number(value) } as PipelineConfig['search'];
        break;
      case 'scrape-limit':
        overrides.scrape = { ...(overrides.scrape || {}), limit: Number(value) } as PipelineConfig['scrape'];
        break;
      case 'scrape-concurrency':
        overrides.scrape = { ...(overrides.scrape || {}), concurrency: Number(value) } as PipelineConfig['scrape'];
        break;
      case 'min-candidate-score':
        overrides.scrape = { ...(overrides.scrape || {}), minCandidateScore: Number(value) } as PipelineConfig['scrape'];
        break;
      case 'no-scrape':
        overrides.scrape = { ...(overrides.scrape || {}), enabled: false } as PipelineConfig['scrape'];
        break;
      case 'browser-verify':
        overrides.browserVerification = {
          ...(overrides.browserVerification || {}),
          enabled: value === 'true' || value === '1',
        } as PipelineConfig['browserVerification'];
        break;
      case 'browser-limit':
        overrides.browserVerification = {
          ...(overrides.browserVerification || {}),
          limit: Number(value),
        } as PipelineConfig['browserVerification'];
        break;
      case 'browser-command':
        overrides.browserVerification = {
          ...(overrides.browserVerification || {}),
          command: value,
        } as PipelineConfig['browserVerification'];
        break;
      case 'browser-bu-name':
        overrides.browserVerification = {
          ...(overrides.browserVerification || {}),
          buName: value,
        } as PipelineConfig['browserVerification'];
        break;
      case 'browser-cdp-url':
        overrides.browserVerification = {
          ...(overrides.browserVerification || {}),
          cdpUrl: value,
        } as PipelineConfig['browserVerification'];
        break;
      case 'browser-local-command':
        overrides.browserVerification = {
          ...(overrides.browserVerification || {}),
          localChromiumCommand: value,
        } as PipelineConfig['browserVerification'];
        break;
      case 'no-browser-local-chromium':
        overrides.browserVerification = {
          ...(overrides.browserVerification || {}),
          autoStartLocalChromium: false,
        } as PipelineConfig['browserVerification'];
        break;
      case 'authority-csv':
        overrides.authority = {
          provider: 'csv',
          csvPath: value,
        };
        break;
      case 'min-export-score':
        overrides.scoring = { ...(overrides.scoring || {}), minExportScore: Number(value) } as PipelineConfig['scoring'];
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  return { command, configPath, overrides };
}

function normalizeCommand(command?: string): Command {
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    return 'help';
  }

  if (['run', 'discover', 'scrape', 'browser-verify', 'export'].includes(command)) {
    return command as Command;
  }

  throw new Error(`Unknown command: ${command}`);
}

function printHelp(): void {
  console.log(`Backlink Opportunity Pipeline

Usage:
  npm run pipeline -- run --niche "cybersecurity" --target 10000 --scrape-limit 10000
  npm run pipeline -- discover --niche "real estate" --target 100000 --no-scrape
  npm run pipeline -- scrape --resume-dir data/backlink-runs/<run>
  npm run pipeline -- browser-verify --resume-dir data/backlink-runs/<run> --browser-limit 100
  npm run pipeline -- export --resume-dir data/backlink-runs/<run>

Commands:
  run              discovery -> scrape/score -> optional browser verification -> CSV export
  discover         search only, appends candidates.jsonl
  scrape           scrape candidates, score opportunities, export CSV
  browser-verify   use browser-harness for top scored opportunities
  export           regenerate opportunities.csv

Important options:
  --config <file>               JSON config path
  --niche <text>                niche/topic to search
  --target <number>             candidate target: 1000, 10000, 1000000, etc.
  --resume-dir <dir>            resume an existing run directory
  --search-pages <number>       SearXNG pages per query
  --max-queries <number>        query budget
  --scrape-limit <number>       scrape budget for this run
  --scrape-concurrency <n>      Crawl4AI concurrency
  --authority-csv <file>        CSV with domain,authority_score columns
  --browser-verify true         enable browser-harness during run
  --browser-limit <number>      browser verification budget
  --browser-bu-name <name>      Browser Harness daemon namespace
  --browser-cdp-url <url>       DevTools HTTP/WS URL, default http://127.0.0.1:9222
  --no-browser-local-chromium   do not auto-start isolated local Chromium
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
