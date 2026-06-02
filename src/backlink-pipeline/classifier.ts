import * as cheerio from 'cheerio';
import type {
  AuthorityMetrics,
  CandidateRecord,
  LinkTechnicalEvidence,
  OpportunityRecord,
  OpportunityType,
  PipelineConfig,
  ScrapeRecord,
  SearchResult,
} from './types.js';
import {
  clamp,
  firstNonEmpty,
  getDomain,
  hashValue,
  normalizeUrl,
  nowIso,
  scoreByPhrases,
  truncateText,
  uniqueValues,
} from './utils.js';

const POSITIVE_PHRASES = [
  'submit article',
  'submit your article',
  'article submission',
  'submission guidelines',
  'author guidelines',
  'write for us',
  'guest post',
  'guest article',
  'contribute',
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
  'submit listing',
  'add listing',
  'social bookmarking',
  'submit bookmark',
  'add bookmark',
  'share link',
  'member profile',
  'profile website',
  'website field',
];

const BACKLINK_ELIGIBILITY_PHRASES = [
  'include a link',
  'author bio',
  'bio link',
  'profile link',
  'website url',
  'website field',
  'homepage link',
  'link to your website',
  'do-follow',
  'dofollow',
  'followed link',
  'resource link',
  'external link',
  'source link',
  'reference link',
  'company website',
];

const EDITORIAL_QUALITY_PHRASES = [
  'editorial guidelines',
  'review process',
  'quality guidelines',
  'original content',
  'human-written',
  'editorial team',
  'we review',
  'no duplicate content',
  'minimum word count',
  'references',
  'citations',
];

const RISK_PHRASES = [
  'instant approval',
  'auto approve',
  'automatic approval',
  'unlimited links',
  'buy backlinks',
  'paid link',
  'link exchange',
  'reciprocal link required',
  'private blog network',
  'pbn',
  'spun article',
  'casino',
  'payday',
  'adult links',
  'viagra',
  'essay writing',
  'sponsored post only',
  'payment required',
];

const SUBMISSION_PATH_TERMS = [
  'submit',
  'write-for-us',
  'guest-post',
  'contribute',
  'add-url',
  'add-site',
  'submit-url',
  'submit-link',
  'submit-article',
  'submit-bookmark',
  'add-listing',
  'submit-listing',
  'suggest',
];

const SIGNUP_PATH_TERMS = ['register', 'signup', 'sign-up', 'join', 'login', 'account'];
const LOGIN_PATH_TERMS = ['login', 'log-in', 'signin', 'sign-in', 'auth', 'account', 'member', 'dashboard'];
const LOGIN_GATE_PHRASES = [
  'login required',
  'log in to continue',
  'sign in to continue',
  'please log in',
  'please login',
  'please sign in',
  'you must be logged in',
  'you need to login',
  'you need to sign in',
  'members only',
  'create an account',
  'register to submit',
  'sign up to submit',
  'log in to submit',
  'login to submit',
  'sign in to submit',
  'submit after login',
  'access denied',
  'authentication required',
  'protected page',
];

export function buildCandidate(
  result: SearchResult,
  discoveryQuery: string,
  discoveryPage: number,
  discoveryRank: number,
  niche: string
): CandidateRecord | null {
  const normalizedUrl = normalizeUrl(result.url);
  if (!normalizedUrl) {
    return null;
  }

  const domain = getDomain(normalizedUrl);
  if (!domain) {
    return null;
  }

  const haystack = `${result.title || ''} ${result.content || ''} ${normalizedUrl}`;
  const { type, score: typeScore, signals } = classifyOpportunityType(haystack);
  const positive = scoreByPhrases(haystack, POSITIVE_PHRASES, 5);
  const risks = scoreByPhrases(haystack, RISK_PHRASES, 1).matches;
  const topicalScore = scoreTopicalRelevance(haystack, niche);
  const discoveryScore = Number(result.score || 1);
  const candidateScore = clamp(typeScore + positive.score + topicalScore + discoveryScore * 4 - risks.length * 8, 0, 100);

  return {
    id: hashValue(`${normalizedUrl}:${discoveryQuery}`),
    url: result.url,
    normalizedUrl,
    domain,
    title: truncateText(result.title || domain, 240),
    snippet: truncateText(result.content || '', 500),
    discoveryQuery,
    discoveryPage,
    discoveryRank,
    discoveryScore,
    opportunityType: type,
    candidateScore,
    signals: uniqueValues([...signals, ...positive.matches]),
    risks,
    discoveredAt: nowIso(),
  };
}

export function analyzeScrape(
  config: PipelineConfig,
  candidate: CandidateRecord,
  scrape: ScrapeRecord,
  authority: AuthorityMetrics
): OpportunityRecord {
  const body = `${scrape.markdown || ''}\n${scrape.html || ''}`;
  const text = normalizeBodyText(body);
  const linkEvidence = extractLinkEvidence(scrape, candidate.domain);
  const positive = scoreByPhrases(text, POSITIVE_PHRASES, 6);
  const eligibility = scoreByPhrases(text, BACKLINK_ELIGIBILITY_PHRASES, 8);
  const editorial = scoreByPhrases(text, EDITORIAL_QUALITY_PHRASES, 7);
  const risk = scoreByPhrases(text, RISK_PHRASES, 1);
  const topicalRelevanceScore = scoreTopicalRelevance(text, config.niche);
  const backlinkEligibilityScore = scoreBacklinkEligibility(eligibility.matches, positive.matches, linkEvidence);
  const technicalValueScore = scoreTechnicalValue(linkEvidence);
  const editorialQualityScore = scoreEditorialQuality(scrape, editorial.matches, risk.matches);
  const lowRiskScore = scoreLowRisk(risk.matches, linkEvidence);
  const opportunityScore = weightedScore(config, {
    topicalRelevanceScore,
    authorityScore: authority.authorityScore,
    backlinkEligibilityScore,
    technicalValueScore,
    editorialQualityScore,
    lowRiskScore,
  });

  const risks = uniqueValues([...candidate.risks, ...risk.matches]);
  if (linkEvidence.hasNoindex) {
    risks.push('noindex');
  }
  if (!linkEvidence.hasSubmissionForm && linkEvidence.submissionUrls.length === 0 && eligibility.matches.length === 0) {
    risks.push('no clear submission path');
  }

  return {
    candidateId: candidate.id,
    url: candidate.normalizedUrl,
    domain: candidate.domain,
    title: firstNonEmpty(scrape.metadata.title, candidate.title, candidate.domain),
    opportunityType: refineOpportunityType(candidate.opportunityType, text),
    opportunityScore,
    recommendedAction: recommendAction(opportunityScore, risks, linkEvidence),
    topicalRelevanceScore,
    authorityScore: authority.authorityScore,
    backlinkEligibilityScore,
    technicalValueScore,
    editorialQualityScore,
    lowRiskScore,
    signals: uniqueValues([...candidate.signals, ...positive.matches, ...eligibility.matches, ...editorial.matches]),
    risks,
    evidenceSnippets: buildEvidenceSnippets(text, [...positive.matches, ...eligibility.matches, ...editorial.matches]),
    linkEvidence,
    authority,
    discoveredAt: candidate.discoveredAt,
    scrapedAt: scrape.scrapedAt,
    scoredAt: nowIso(),
  };
}

function classifyOpportunityType(text: string): { type: OpportunityType; score: number; signals: string[] } {
  const checks: Array<{ type: OpportunityType; phrases: string[]; score: number }> = [
    {
      type: 'article_directory',
      phrases: ['article directory', 'submit article', 'article submission', 'submit your article'],
      score: 28,
    },
    {
      type: 'social_bookmarking',
      phrases: ['social bookmarking', 'submit bookmark', 'add bookmark', 'bookmarking site', 'share link'],
      score: 26,
    },
    {
      type: 'niche_directory',
      phrases: ['business directory', 'resource directory', 'submit listing', 'add listing', 'add your site'],
      score: 24,
    },
    {
      type: 'guest_post_editorial',
      phrases: ['write for us', 'guest post', 'author guidelines', 'become a contributor', 'contribute an article'],
      score: 25,
    },
    {
      type: 'community_profile',
      phrases: ['member profile', 'user profile', 'profile website', 'community profile'],
      score: 18,
    },
    {
      type: 'resource_page',
      phrases: ['suggest a resource', 'resource links', 'useful resources', 'recommended resources'],
      score: 20,
    },
  ];

  const normalized = text.toLowerCase();
  let best = { type: 'unknown' as OpportunityType, score: 0, signals: [] as string[] };

  for (const check of checks) {
    const matches = check.phrases.filter((phrase) => normalized.includes(phrase));
    if (matches.length > 0 && check.score + matches.length * 4 > best.score) {
      best = {
        type: check.type,
        score: check.score + matches.length * 4,
        signals: matches,
      };
    }
  }

  return best;
}

function refineOpportunityType(current: OpportunityType, text: string): OpportunityType {
  const refined = classifyOpportunityType(text);
  return refined.type === 'unknown' ? current : refined.type;
}

function scoreTopicalRelevance(text: string, niche: string): number {
  const normalized = text.toLowerCase();
  const nicheTerms = niche
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3);

  if (nicheTerms.length === 0) {
    return 50;
  }

  const hits = nicheTerms.filter((term) => normalized.includes(term)).length;
  return clamp((hits / nicheTerms.length) * 80 + (normalized.includes(niche.toLowerCase()) ? 20 : 0), 0, 100);
}

function scoreBacklinkEligibility(
  eligibilityMatches: string[],
  positiveMatches: string[],
  evidence: LinkTechnicalEvidence
): number {
  let score = 0;
  score += clamp(eligibilityMatches.length * 16, 0, 55);
  score += clamp(positiveMatches.length * 7, 0, 30);
  if (evidence.hasSubmissionForm) {
    score += 18;
  }
  if (evidence.submissionUrls.length > 0) {
    score += 15;
  }
  if (evidence.signupUrls.length > 0) {
    score += 8;
  }
  return clamp(score, 0, 100);
}

function scoreTechnicalValue(evidence: LinkTechnicalEvidence): number {
  let score = 35;
  if (evidence.hasFollowedExternalLinks) {
    score += 30;
  }
  if (evidence.hasUgcExternalLinks) {
    score += 10;
  }
  if (evidence.hasNofollowExternalLinks) {
    score -= 8;
  }
  if (evidence.hasSponsoredExternalLinks) {
    score -= 18;
  }
  if (evidence.hasNoindex) {
    score -= 35;
  }
  if (evidence.outboundDomainCount > 0 && evidence.outboundDomainCount <= 80) {
    score += 15;
  }
  if (evidence.outboundDomainCount > 150) {
    score -= 20;
  }
  return clamp(score, 0, 100);
}

function scoreEditorialQuality(scrape: ScrapeRecord, editorialMatches: string[], riskMatches: string[]): number {
  const wordCount = scrape.metadata.wordCount || normalizeBodyText(scrape.markdown || scrape.html || '').split(/\s+/).length;
  let score = clamp(wordCount / 25, 10, 55);
  score += clamp(editorialMatches.length * 12, 0, 35);
  score -= riskMatches.length * 8;
  return clamp(score, 0, 100);
}

function scoreLowRisk(riskMatches: string[], evidence: LinkTechnicalEvidence): number {
  let score = 100 - riskMatches.length * 14;
  if (evidence.hasNoindex) {
    score -= 25;
  }
  if (evidence.outboundDomainCount > 200) {
    score -= 20;
  }
  if (evidence.hasSponsoredExternalLinks) {
    score -= 10;
  }
  return clamp(score, 0, 100);
}

function weightedScore(
  config: PipelineConfig,
  values: {
    topicalRelevanceScore: number;
    authorityScore: number;
    backlinkEligibilityScore: number;
    technicalValueScore: number;
    editorialQualityScore: number;
    lowRiskScore: number;
  }
): number {
  const weights = config.scoring.weights;
  const total =
    values.topicalRelevanceScore * weights.topicalRelevance +
    values.authorityScore * weights.authority +
    values.backlinkEligibilityScore * weights.backlinkEligibility +
    values.technicalValueScore * weights.technicalValue +
    values.editorialQualityScore * weights.editorialQuality +
    values.lowRiskScore * weights.lowRisk;

  return clamp(total, 0, 100);
}

function recommendAction(
  score: number,
  risks: string[],
  evidence: LinkTechnicalEvidence
): 'manual_review' | 'browser_verify' | 'likely_eligible' | 'reject' {
  if (risks.includes('noindex') || risks.includes('paid link') || risks.includes('buy backlinks')) {
    return 'reject';
  }
  if (score >= 75 && (evidence.hasSubmissionForm || evidence.submissionUrls.length > 0)) {
    return 'likely_eligible';
  }
  if (score >= 55) {
    return 'browser_verify';
  }
  if (score >= 35) {
    return 'manual_review';
  }
  return 'reject';
}

function extractLinkEvidence(scrape: ScrapeRecord, candidateDomain: string): LinkTechnicalEvidence {
  const html = scrape.html || '';
  const $ = cheerio.load(html || '<html></html>');
  const visibleText = normalizeBodyText(`${scrape.markdown || ''}\n${html}`);
  const linksFromHtml = $('a')
    .map((_, el) => ({
      href: normalizeHref($(el).attr('href'), scrape.url),
      rel: ($(el).attr('rel') || '').toLowerCase(),
      text: $(el).text().replace(/\s+/g, ' ').trim(),
    }))
    .get()
    .filter((link) => link.href);

  const links = linksFromHtml.length > 0
    ? linksFromHtml
    : (scrape.links || []).map((href) => ({ href: normalizeHref(href, scrape.url), rel: '', text: '' })).filter((link) => link.href);

  const externalLinks = links.filter((link) => {
    const domain = getDomain(link.href);
    return domain && domain !== candidateDomain;
  });

  const relCounts: Record<string, number> = {};
  for (const link of externalLinks) {
    const relValues = link.rel.split(/\s+/).filter(Boolean);
    if (relValues.length === 0) {
      relCounts.followed = (relCounts.followed || 0) + 1;
      continue;
    }
    for (const rel of relValues) {
      relCounts[rel] = (relCounts[rel] || 0) + 1;
    }
  }

  const submissionUrls = uniqueValues(
    links
      .filter((link) => SUBMISSION_PATH_TERMS.some((term) => link.href.toLowerCase().includes(term)))
      .map((link) => link.href)
  ).slice(0, 20);

  const signupUrls = uniqueValues(
    links
      .filter((link) => SIGNUP_PATH_TERMS.some((term) => link.href.toLowerCase().includes(term)))
      .map((link) => link.href)
  ).slice(0, 20);
  const loginUrls = uniqueValues(
    links
      .filter((link) => {
        const haystack = `${link.href} ${link.text}`.toLowerCase();
        return LOGIN_PATH_TERMS.some((term) => haystack.includes(term));
      })
      .map((link) => link.href)
  ).slice(0, 20);
  const loginGate = detectLoginGate($, visibleText, loginUrls);

  const metaRobots = $('meta[name="robots"], meta[name="googlebot"]')
    .map((_, el) => $(el).attr('content') || '')
    .get()
    .join(' ')
    .toLowerCase();

  return {
    hasSubmissionForm: $('form').length > 0 && formLooksLikeSubmission($),
    submissionUrls,
    signupUrls,
    loginRequired: loginGate.required,
    loginConfidence: loginGate.confidence,
    loginUrls,
    loginEvidence: loginGate.evidence,
    sampleOutboundUrls: uniqueValues(externalLinks.map((link) => link.href)).slice(0, 25),
    outboundDomainCount: new Set(externalLinks.map((link) => getDomain(link.href)).filter(Boolean)).size,
    relCounts,
    hasFollowedExternalLinks: (relCounts.followed || 0) > 0,
    hasNofollowExternalLinks: (relCounts.nofollow || 0) > 0,
    hasUgcExternalLinks: (relCounts.ugc || 0) > 0,
    hasSponsoredExternalLinks: (relCounts.sponsored || 0) > 0,
    hasNoindex: metaRobots.includes('noindex'),
    canonicalUrl: $('link[rel="canonical"]').attr('href'),
  };
}

function detectLoginGate(
  $: cheerio.CheerioAPI,
  visibleText: string,
  loginUrls: string[]
): { required: boolean; confidence: number; evidence: string[] } {
  const evidence: string[] = [];
  let confidence = 0;

  const phraseMatches = LOGIN_GATE_PHRASES.filter((phrase) => visibleText.includes(phrase));
  if (phraseMatches.length > 0) {
    evidence.push(...phraseMatches.slice(0, 8));
    confidence += Math.min(70, phraseMatches.length * 18);
  }

  const passwordInputs = $('input[type="password"]').length;
  if (passwordInputs > 0) {
    evidence.push(`${passwordInputs} password input(s)`);
    confidence += 30;
  }

  const loginFormCount = $('form')
    .filter((_, form) => {
      const formText = $(form).text().toLowerCase();
      const fields = $(form)
        .find('input, button')
        .map((_, input) => `${$(input).attr('name') || ''} ${$(input).attr('id') || ''} ${$(input).attr('placeholder') || ''} ${$(input).text() || ''}`)
        .get()
        .join(' ')
        .toLowerCase();
      return /login|log in|sign in|signin|password|email|username/.test(`${formText} ${fields}`);
    }).length;

  if (loginFormCount > 0) {
    evidence.push(`${loginFormCount} login-like form(s)`);
    confidence += 25;
  }

  if (loginUrls.length > 0) {
    evidence.push(`login urls: ${loginUrls.slice(0, 3).join(', ')}`);
    confidence += 15;
  }

  const required = confidence >= 45 || phraseMatches.some((phrase) => /required|must|need|continue|submit|members only|access denied|authentication/.test(phrase));
  return {
    required,
    confidence: clamp(confidence, 0, 100),
    evidence: uniqueValues(evidence).slice(0, 12),
  };
}

function formLooksLikeSubmission($: cheerio.CheerioAPI): boolean {
  const formText = $('form')
    .map((_, form) => $(form).text())
    .get()
    .join(' ')
    .toLowerCase();

  const inputNames = $('form input, form textarea, form select')
    .map((_, input) => `${$(input).attr('name') || ''} ${$(input).attr('id') || ''} ${$(input).attr('placeholder') || ''}`)
    .get()
    .join(' ')
    .toLowerCase();

  const haystack = `${formText} ${inputNames}`;
  return [
    'url',
    'website',
    'link',
    'title',
    'article',
    'content',
    'description',
    'submit',
    'bio',
  ].some((term) => haystack.includes(term));
}

function normalizeHref(href: string | undefined, baseUrl: string): string {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return '';
  }

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return '';
  }
}

function normalizeBodyText(text: string): string {
  if (!text) {
    return '';
  }

  const withoutTags = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  return cheerio.load(withoutTags).text().replace(/\s+/g, ' ').trim().toLowerCase();
}

function buildEvidenceSnippets(text: string, matches: string[]): string[] {
  const snippets: string[] = [];
  const normalized = text.replace(/\s+/g, ' ').trim();

  for (const match of uniqueValues(matches).slice(0, 8)) {
    const index = normalized.toLowerCase().indexOf(match.toLowerCase());
    if (index === -1) {
      continue;
    }

    snippets.push(truncateText(normalized.slice(Math.max(0, index - 100), index + match.length + 140), 280));
  }

  return uniqueValues(snippets);
}
