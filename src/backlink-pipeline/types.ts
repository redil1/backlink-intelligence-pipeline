export type OpportunityType =
  | 'article_directory'
  | 'social_bookmarking'
  | 'niche_directory'
  | 'guest_post_editorial'
  | 'community_profile'
  | 'resource_page'
  | 'unknown';

export type RecommendedAction =
  | 'manual_review'
  | 'browser_verify'
  | 'likely_eligible'
  | 'reject';

export interface PipelineConfig {
  niche: string;
  targetCandidates: number;
  outputDir: string;
  runId?: string;
  resumeDir?: string;
  searxngUrl: string;
  crawl4aiUrl: string;
  search: SearchConfig;
  scrape: ScrapeConfig;
  browserVerification: BrowserVerificationConfig;
  scoring: ScoringConfig;
  authority: AuthorityConfig;
}

export interface SearchConfig {
  pagesPerQuery: number;
  concurrency: number;
  maxQueries: number;
  language: string;
  engines?: string;
  safesearch: 0 | 1 | 2;
  queryTemplates: string[];
  footprints: string[];
  seedTerms: string[];
  locations: string[];
  modifiers: string[];
  tlds: string[];
  pathTerms: string[];
  includeGenericQueries: boolean;
}

export interface ScrapeConfig {
  enabled: boolean;
  limit: number;
  concurrency: number;
  timeoutMs: number;
  retries: number;
  formats: string[];
  minCandidateScore: number;
}

export interface BrowserVerificationConfig {
  enabled: boolean;
  command: string;
  buName: string;
  autoStartLocalChromium: boolean;
  localChromiumCommand: string;
  cdpUrl: string;
  limit: number;
  concurrency: number;
  timeoutMs: number;
  minOpportunityScore: number;
}

export interface ScoringConfig {
  minExportScore: number;
  weights: {
    topicalRelevance: number;
    authority: number;
    backlinkEligibility: number;
    technicalValue: number;
    editorialQuality: number;
    lowRisk: number;
  };
}

export interface AuthorityConfig {
  provider: 'fallback' | 'csv';
  csvPath?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  content?: string;
  score?: number;
  publishedDate?: string;
  engine?: string;
}

export interface SearchQueryRecord {
  query: string;
  pageno: number;
  resultCount: number;
  newCandidates: number;
  unresponsiveEngines: string[];
  searchedAt: string;
  error?: string;
}

export interface CandidateRecord {
  id: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  title: string;
  snippet: string;
  discoveryQuery: string;
  discoveryPage: number;
  discoveryRank: number;
  discoveryScore: number;
  opportunityType: OpportunityType;
  candidateScore: number;
  signals: string[];
  risks: string[];
  discoveredAt: string;
}

export interface ScrapeRecord {
  candidateId: string;
  url: string;
  domain: string;
  success: boolean;
  scrapedAt: string;
  markdown?: string;
  html?: string;
  links: string[];
  metadata: ScrapeMetadata;
  error?: string;
}

export interface ScrapeMetadata {
  title?: string;
  description?: string;
  language?: string;
  wordCount?: number;
  finalUrl?: string;
}

export interface AuthorityMetrics {
  domain: string;
  authorityScore: number;
  referringDomains?: number;
  organicTraffic?: number;
  source: 'fallback' | 'csv';
  notes?: string[];
}

export interface LinkTechnicalEvidence {
  hasSubmissionForm: boolean;
  submissionUrls: string[];
  signupUrls: string[];
  loginRequired: boolean;
  loginConfidence: number;
  loginUrls: string[];
  loginEvidence: string[];
  sampleOutboundUrls: string[];
  outboundDomainCount: number;
  relCounts: Record<string, number>;
  hasFollowedExternalLinks: boolean;
  hasNofollowExternalLinks: boolean;
  hasUgcExternalLinks: boolean;
  hasSponsoredExternalLinks: boolean;
  hasNoindex: boolean;
  canonicalUrl?: string;
}

export interface OpportunityRecord {
  candidateId: string;
  url: string;
  domain: string;
  title: string;
  opportunityType: OpportunityType;
  opportunityScore: number;
  recommendedAction: RecommendedAction;
  topicalRelevanceScore: number;
  authorityScore: number;
  backlinkEligibilityScore: number;
  technicalValueScore: number;
  editorialQualityScore: number;
  lowRiskScore: number;
  signals: string[];
  risks: string[];
  evidenceSnippets: string[];
  linkEvidence: LinkTechnicalEvidence;
  authority: AuthorityMetrics;
  discoveredAt: string;
  scrapedAt: string;
  scoredAt: string;
}

export interface BrowserVerificationRecord {
  candidateId: string;
  url: string;
  domain: string;
  success: boolean;
  verifiedAt: string;
  finalUrl?: string;
  title?: string;
  forms?: number;
  loginRequired?: boolean;
  loginConfidence?: number;
  loginEvidence?: string[];
  loginUrls?: string[];
  visibleTextSample?: string;
  outboundLinks?: Array<{
    href: string;
    rel: string;
    text: string;
  }>;
  metaRobots?: string;
  error?: string;
}

export interface PipelineSummary {
  runId: string;
  niche: string;
  targetCandidates: number;
  discoveredCandidates: number;
  scrapedCandidates: number;
  opportunities: number;
  browserVerified: number;
  startedAt: string;
  updatedAt: string;
  outputDir: string;
}
