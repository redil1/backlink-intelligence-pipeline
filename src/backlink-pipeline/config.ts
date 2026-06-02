import fs from 'fs/promises';
import path from 'path';
import type { PipelineConfig } from './types.js';
import { createRunId } from './utils.js';

const DEFAULT_QUERY_TEMPLATES = [
  '"{niche}" "submit article"',
  '"{niche}" "article submission"',
  '"{niche}" "submit your article"',
  '"{niche}" "submit guest post"',
  '"{niche}" "write for us"',
  '"{niche}" "contribute an article"',
  '"{niche}" "author guidelines"',
  '"{niche}" "submission guidelines"',
  '"{niche}" "become a contributor"',
  '"{niche}" "submit a story"',
  '"{niche}" "submit news"',
  '"{niche}" "submit press release"',
  '"{niche}" "add your site"',
  '"{niche}" "submit url"',
  '"{niche}" "submit link"',
  '"{niche}" "suggest a resource"',
  '"{niche}" "resource directory"',
  '"{niche}" "business directory"',
  '"{niche}" "add listing"',
  '"{niche}" "submit listing"',
  '"{niche}" "directory submission"',
  '"{niche}" "social bookmarking"',
  '"{niche}" "submit bookmark"',
  '"{niche}" "add bookmark"',
  '"{niche}" "share link"',
  '"{niche}" "bookmark this site"',
  '"{niche}" "profile website"',
  '"{niche}" "member profile" "website"',
  '"{niche}" "community profile" "website"',
  '"{niche}" "user profile" "website"',
  '"{niche}" "dofollow" "submit article"',
  '"{niche}" "dofollow" "write for us"',
  '"{niche}" "author bio" "dofollow"',
  '"{niche}" "website field" "submit"',
  '"{niche}" "add url" "dofollow"',
  '"{niche}" "submit your site" "approved"',
  '"{niche}" "recent submissions" "website"',
  '"{niche}" "accepted articles" "author bio"',
  '"{niche}" intitle:"submit article"',
  '"{niche}" intitle:"write for us"',
  '"{niche}" intitle:"add your site"',
  '"{niche}" intitle:"submit link"',
  '"{niche}" intitle:"submit bookmark"',
  '"{niche}" inurl:submit-article',
  '"{niche}" inurl:write-for-us',
  '"{niche}" inurl:add-url',
  '"{niche}" inurl:submit-url',
  '"{niche}" inurl:submit-link',
  '"{niche}" inurl:submit-site',
  '"{niche}" inurl:submit-bookmark',
  '"{niche}" inurl:contribute',
  '"{niche}" inurl:guest-post',
  '"{seed}" "{niche}" "submit article"',
  '"{seed}" "{niche}" "write for us"',
  '"{seed}" "{niche}" "add your site"',
  '"{seed}" "{niche}" "submit bookmark"',
  '"{seed}" "{niche}" "resource directory"',
  '"{location}" "{niche}" "business directory"',
  '"{location}" "{niche}" "submit listing"',
  '"{location}" "{niche}" "add your business"',
  '"{location}" "{niche}" "write for us"',
  '"{location}" "{niche}" "submit article"',
];

const DEFAULT_SEED_TERMS = [
  'marketing',
  'business',
  'startup',
  'technology',
  'software',
  'finance',
  'health',
  'education',
  'real estate',
  'travel',
  'legal',
  'home improvement',
  'ecommerce',
  'professional services',
];

const DEFAULT_FOOTPRINTS = [
  'submit article',
  'article submission',
  'submit your article',
  'write for us',
  'guest post',
  'author guidelines',
  'submission guidelines',
  'become a contributor',
  'submit story',
  'submit news',
  'submit press release',
  'add your site',
  'submit url',
  'submit link',
  'suggest a resource',
  'resource directory',
  'business directory',
  'add listing',
  'submit listing',
  'directory submission',
  'social bookmarking',
  'submit bookmark',
  'add bookmark',
  'share link',
  'member profile website',
  'community profile website',
  'user profile website',
  'dofollow submit article',
  'dofollow write for us',
  'author bio dofollow',
  'website field submit',
  'add url dofollow',
  'submit your site approved',
  'recent submissions website',
  'accepted articles author bio',
];

const DEFAULT_MODIFIERS = [
  'blog',
  'magazine',
  'journal',
  'community',
  'forum',
  'portal',
  'directory',
  'resources',
  'links',
  'bookmark',
  'submit',
  'contribute',
  'guidelines',
  'editorial',
  'authors',
  'contributors',
  'companies',
  'vendors',
  'professionals',
  'services',
  'tools',
  'software',
  'news',
  'reviews',
  'local',
  'global',
  'free',
  'open',
  'membership',
  'profile',
  'listing',
  'startup',
  'enterprise',
];

const DEFAULT_TLDS = [
  '.com',
  '.org',
  '.net',
  '.edu',
  '.gov',
  '.co',
  '.io',
  '.us',
  '.uk',
  '.ca',
  '.au',
  '.in',
];

const DEFAULT_PATH_TERMS = [
  'submit',
  'submit-article',
  'article-submission',
  'write-for-us',
  'guest-post',
  'contribute',
  'author-guidelines',
  'submission-guidelines',
  'add-url',
  'submit-url',
  'submit-link',
  'add-site',
  'submit-site',
  'submit-bookmark',
  'add-listing',
  'submit-listing',
  'directory',
  'resources',
  'profile',
  'register',
];

const DEFAULT_LOCATIONS = [
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'India',
  'Europe',
  'New York',
  'California',
  'London',
  'Toronto',
];

export function defaultConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  const niche = overrides.niche || 'business';
  const outputDir = overrides.outputDir || 'data/backlink-runs';

  return deepMerge(
    {
      niche,
      targetCandidates: 1000,
      outputDir,
      runId: createRunId(niche),
      searxngUrl: process.env.SEARXNG_URL || 'http://localhost:8081',
      crawl4aiUrl: process.env.CRAWL4AI_URL || 'http://localhost:8001',
      search: {
        pagesPerQuery: 5,
        concurrency: 2,
        maxQueries: 500,
        language: 'en',
        safesearch: 0,
        queryTemplates: DEFAULT_QUERY_TEMPLATES,
        footprints: DEFAULT_FOOTPRINTS,
        seedTerms: DEFAULT_SEED_TERMS,
        locations: DEFAULT_LOCATIONS,
        modifiers: DEFAULT_MODIFIERS,
        tlds: DEFAULT_TLDS,
        pathTerms: DEFAULT_PATH_TERMS,
        includeGenericQueries: true,
      },
      scrape: {
        enabled: true,
        limit: 1000,
        concurrency: 4,
        timeoutMs: 30000,
        retries: 1,
        formats: ['markdown', 'html', 'links'],
        minCandidateScore: 12,
      },
      browserVerification: {
        enabled: false,
        command: 'browser-harness',
        buName: 'backlink-pipeline',
        autoStartLocalChromium: true,
        localChromiumCommand: 'browser-harness-local-chromium',
        cdpUrl: 'http://127.0.0.1:9222',
        limit: 100,
        concurrency: 1,
        timeoutMs: 45000,
        minOpportunityScore: 65,
      },
      evidence: {
        strictMode: true,
        deepCrawlEnabled: true,
        maxEvidencePagesPerCandidate: 3,
        minTierADofollowConfidence: 80,
        minTierAAcceptanceProbability: 70,
        minTierASubmissionPathConfidence: 75,
        minTierAAuthorityScore: 50,
        maxTierARiskScore: 20,
      },
      scoring: {
        minExportScore: 35,
        weights: {
          topicalRelevance: 0.2,
          authority: 0.2,
          backlinkEligibility: 0.2,
          technicalValue: 0.15,
          editorialQuality: 0.15,
          lowRisk: 0.1,
        },
      },
      authority: {
        provider: 'fallback',
      },
    } satisfies PipelineConfig,
    overrides
  );
}

export async function loadConfig(configPath?: string, overrides: Partial<PipelineConfig> = {}): Promise<PipelineConfig> {
  let rawConfig: Partial<PipelineConfig> = {};

  if (configPath) {
    const absolutePath = path.resolve(configPath);
    rawConfig = JSON.parse(await fs.readFile(absolutePath, 'utf8')) as Partial<PipelineConfig>;
  } else if (overrides.resumeDir) {
    const resumeConfigPath = path.resolve(overrides.resumeDir, 'config.json');
    try {
      rawConfig = JSON.parse(await fs.readFile(resumeConfigPath, 'utf8')) as Partial<PipelineConfig>;
    } catch {
      rawConfig = {};
    }
  }

  return defaultConfig(deepMerge(rawConfig, overrides));
}

export function generateSearchQueries(config: PipelineConfig): string[] {
  const replacements = {
    niche: config.niche,
    seed: '',
    location: '',
  };
  const queries = new Set<string>();

  for (const template of config.search.queryTemplates) {
    const usesSeed = template.includes('{seed}');
    const usesLocation = template.includes('{location}');
    const seeds = usesSeed ? config.search.seedTerms : [''];
    const locations = usesLocation ? config.search.locations : [''];

    for (const seed of seeds) {
      for (const location of locations) {
        const query = template
          .split('{niche}')
          .join(replacements.niche)
          .split('{seed}')
          .join(seed)
          .split('{location}')
          .join(location)
          .replace(/\s+/g, ' ')
          .trim();

        if (query.length > 0 && !query.includes('""')) {
          queries.add(query);
        }
      }
    }
  }

  if (config.search.includeGenericQueries) {
    [
      '"submit article" "author guidelines"',
      '"article directory" "submit article"',
      '"social bookmarking" "submit bookmark"',
      '"submit link" "add url"',
      '"resource directory" "suggest a resource"',
    ].forEach((query) => queries.add(query));
  }

  addExpandedQueries(config, queries);

  return [...queries].slice(0, config.search.maxQueries);
}

function addExpandedQueries(config: PipelineConfig, queries: Set<string>): void {
  const maxQueries = config.search.maxQueries;
  const niche = config.niche;

  function add(query: string): boolean {
    if (queries.size >= maxQueries) {
      return false;
    }
    queries.add(query.replace(/\s+/g, ' ').trim());
    return queries.size < maxQueries;
  }

  for (const footprint of config.search.footprints) {
    if (!add(`"${niche}" "${footprint}"`)) return;

    for (const seed of config.search.seedTerms) {
      if (!add(`"${niche}" "${footprint}" "${seed}"`)) return;
    }

    for (const location of config.search.locations) {
      if (!add(`"${niche}" "${footprint}" "${location}"`)) return;
    }

    for (const modifier of config.search.modifiers) {
      if (!add(`"${niche}" "${footprint}" "${modifier}"`)) return;
    }

    for (const tld of config.search.tlds) {
      if (!add(`"${niche}" "${footprint}" site:${tld}`)) return;
    }

    for (const pathTerm of config.search.pathTerms) {
      if (!add(`"${niche}" "${footprint}" inurl:${pathTerm}`)) return;
    }
  }

  for (const seed of config.search.seedTerms) {
    for (const modifier of config.search.modifiers) {
      for (const footprint of config.search.footprints) {
        if (!add(`"${seed}" "${niche}" "${footprint}" "${modifier}"`)) return;
      }
    }
  }

  for (const location of config.search.locations) {
    for (const seed of config.search.seedTerms) {
      for (const footprint of config.search.footprints) {
        if (!add(`"${location}" "${seed}" "${niche}" "${footprint}"`)) return;
      }
    }
  }

  for (const pathTerm of config.search.pathTerms) {
    for (const tld of config.search.tlds) {
      for (const footprint of config.search.footprints) {
        if (!add(`"${niche}" "${footprint}" inurl:${pathTerm} site:${tld}`)) return;
      }
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMerge<T>(base: T, override: Partial<T>): T {
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };

  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (value === undefined) {
      continue;
    }

    if (isObject(result[key]) && isObject(value)) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}
