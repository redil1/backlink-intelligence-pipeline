import * as cheerio from 'cheerio';
import type {
  AuthorityMetrics,
  CandidateRecord,
  IndexabilityStatus,
  LinkTechnicalEvidence,
  OpportunityRecord,
  OpportunityTier,
  OpportunityType,
  PipelineConfig,
  ScrapeRecord,
  SearchResult,
  StrictOpportunityEvidence,
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

const PAYMENT_PHRASES = [
  'payment required',
  'paid submission',
  'paid listing',
  'listing fee',
  'submission fee',
  'review fee',
  'sponsored post only',
  'sponsored post',
  'advertise with us',
  'pricing',
  'pay to submit',
  'premium listing',
  'featured listing',
];

const CLOSED_SUBMISSION_PHRASES = [
  'submissions are closed',
  'not accepting submissions',
  'we are not accepting',
  'guest posts are closed',
  'currently closed',
  'no longer accepting',
];

const ACCEPTANCE_PROOF_PHRASES = [
  'recent submissions',
  'latest submissions',
  'accepted articles',
  'published articles',
  'submitted by',
  'author bio',
  'member profile',
  'listed in',
  'approved listings',
  'new listings',
  'latest articles',
  'archive',
];

const GUIDELINE_PATH_TERMS = ['guideline', 'guidelines', 'rules', 'editorial', 'contributor', 'contribute'];
const SAMPLE_ACCEPTED_PATH_TERMS = [
  'article',
  'articles',
  'post',
  'posts',
  'author',
  'profile',
  'member',
  'listing',
  'directory',
  'resources',
  'category',
  'archive',
  'news',
  'story',
  'bookmark',
];
const STRICT_NONFOLLOW_RELS = new Set(['nofollow', 'sponsored', 'ugc']);

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
  authority: AuthorityMetrics,
  evidenceScrapes: ScrapeRecord[] = []
): OpportunityRecord {
  const successfulScrapes = [scrape, ...evidenceScrapes].filter((record) => record.success);
  const body = successfulScrapes.map((record) => `${record.markdown || ''}\n${record.html || ''}`).join('\n');
  const text = normalizeBodyText(body);
  const linkEvidence = mergeLinkEvidence(successfulScrapes.map((record) => extractLinkEvidence(record, candidate.domain)));
  const positive = scoreByPhrases(text, POSITIVE_PHRASES, 6);
  const eligibility = scoreByPhrases(text, BACKLINK_ELIGIBILITY_PHRASES, 8);
  const editorial = scoreByPhrases(text, EDITORIAL_QUALITY_PHRASES, 7);
  const risk = scoreByPhrases(text, RISK_PHRASES, 1);
  const topicalRelevanceScore = scoreTopicalRelevance(text, config.niche);
  const backlinkEligibilityScore = scoreBacklinkEligibility(eligibility.matches, positive.matches, linkEvidence);
  const technicalValueScore = scoreTechnicalValue(linkEvidence);
  const editorialQualityScore = scoreEditorialQuality(scrape, editorial.matches, risk.matches);
  const lowRiskScore = scoreLowRisk(risk.matches, linkEvidence);
  const baseScore = weightedScore(config, {
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
  const strictEvidence = buildStrictEvidence(config, candidate, successfulScrapes, linkEvidence, authority, risks);
  risks.push(...strictEvidence.disqualificationReasons);
  const cleanRisks = uniqueValues(risks);
  const opportunityScore = scoreStrictOpportunity(config, baseScore, strictEvidence);

  return {
    candidateId: candidate.id,
    url: candidate.normalizedUrl,
    domain: candidate.domain,
    title: firstNonEmpty(scrape.metadata.title, candidate.title, candidate.domain),
    opportunityType: refineOpportunityType(candidate.opportunityType, text),
    opportunityScore,
    recommendedAction: recommendAction(opportunityScore, cleanRisks, linkEvidence, strictEvidence.tier),
    topicalRelevanceScore,
    authorityScore: authority.authorityScore,
    backlinkEligibilityScore,
    technicalValueScore,
    editorialQualityScore,
    lowRiskScore,
    signals: uniqueValues([
      ...candidate.signals,
      ...positive.matches,
      ...eligibility.matches,
      ...editorial.matches,
      ...strictEvidence.paymentEvidence.map((item) => `payment evidence: ${item}`),
    ]),
    risks: cleanRisks,
    evidenceSnippets: buildEvidenceSnippets(text, [...positive.matches, ...eligibility.matches, ...editorial.matches]),
    linkEvidence,
    strictEvidence,
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
    score -= 6;
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

function buildStrictEvidence(
  config: PipelineConfig,
  candidate: CandidateRecord,
  scrapes: ScrapeRecord[],
  evidence: LinkTechnicalEvidence,
  authority: AuthorityMetrics,
  risks: string[]
): StrictOpportunityEvidence {
  const text = normalizeBodyText(scrapes.map((record) => `${record.markdown || ''}\n${record.html || ''}`).join('\n'));
  const payment = scoreByPhrases(text, PAYMENT_PHRASES, 1);
  const closed = scoreByPhrases(text, CLOSED_SUBMISSION_PHRASES, 1);
  const acceptanceProof = scoreByPhrases(text, ACCEPTANCE_PROOF_PHRASES, 1);
  const sampleAcceptedUrls = collectSampleAcceptedUrls(candidate.domain, scrapes);
  const sampleExternalLinkRel = collectExternalLinkRelSamples(candidate.domain, scrapes);
  const followedCount = evidence.relCounts.followed || 0;
  const nonFollowCount = (evidence.relCounts.nofollow || 0) + (evidence.relCounts.sponsored || 0) + (evidence.relCounts.ugc || 0);
  const indexabilityStatus: IndexabilityStatus = evidence.hasNoindex ? 'noindex' : 'indexable';
  const paymentRequired = payment.matches.length > 0;
  const lastAcceptedDate = extractLatestDate(text);

  const strictDofollow =
    followedCount > 0 &&
    !evidence.hasNoindex &&
    !evidence.hasSponsoredExternalLinks &&
    !paymentRequired;

  let dofollowConfidence = 15;
  if (followedCount > 0) dofollowConfidence += 45;
  if (strictDofollow) dofollowConfidence += 20;
  if (sampleExternalLinkRel.length > 0) dofollowConfidence += 10;
  if (sampleAcceptedUrls.length > 0) dofollowConfidence += 8;
  if (scrapes.length > 1) dofollowConfidence += 5;
  dofollowConfidence -= Math.min(28, nonFollowCount * 4);
  if (evidence.hasUgcExternalLinks) dofollowConfidence -= 12;
  if (evidence.hasSponsoredExternalLinks) dofollowConfidence -= 25;
  if (evidence.hasNoindex) dofollowConfidence -= 35;

  let acceptanceProbability = 20;
  if (evidence.hasSubmissionForm) acceptanceProbability += 30;
  if (evidence.submissionUrls.length > 0) acceptanceProbability += 22;
  if (evidence.signupUrls.length > 0) acceptanceProbability += 5;
  if (acceptanceProof.matches.length > 0) acceptanceProbability += Math.min(18, acceptanceProof.matches.length * 6);
  if (sampleAcceptedUrls.length > 0) acceptanceProbability += 10;
  if (lastAcceptedDate) acceptanceProbability += 8;
  if (evidence.loginRequired) acceptanceProbability -= Math.max(10, evidence.loginConfidence * 0.35);
  if (paymentRequired) acceptanceProbability -= 35;
  if (closed.matches.length > 0) acceptanceProbability -= 45;
  if (risks.includes('no clear submission path')) acceptanceProbability -= 25;

  let submissionPathConfidence = 10;
  if (evidence.hasSubmissionForm) submissionPathConfidence += 38;
  if (evidence.submissionUrls.length > 0) submissionPathConfidence += 35;
  if (evidence.signupUrls.length > 0) submissionPathConfidence += 8;
  if (scrapes.length > 1) submissionPathConfidence += 8;
  if (evidence.loginRequired) submissionPathConfidence -= Math.max(8, evidence.loginConfidence * 0.25);
  if (paymentRequired) submissionPathConfidence -= 25;
  if (closed.matches.length > 0) submissionPathConfidence -= 35;

  let riskScore = risks.length * 12;
  if (evidence.hasNoindex) riskScore += 35;
  if (paymentRequired) riskScore += 35;
  if (closed.matches.length > 0) riskScore += 35;
  if (evidence.hasSponsoredExternalLinks) riskScore += 30;
  if (evidence.hasUgcExternalLinks) riskScore += 12;
  if (evidence.outboundDomainCount > 150) riskScore += 20;
  if (evidence.loginRequired) riskScore += 10;
  if (authority.source === 'fallback') riskScore += 6;

  const disqualificationReasons: string[] = [];
  if (evidence.hasNoindex) disqualificationReasons.push('strict reject: noindex');
  if (!strictDofollow) disqualificationReasons.push('strict warning: no proven clean dofollow sample');
  if (paymentRequired) disqualificationReasons.push('strict reject: payment required');
  if (closed.matches.length > 0) disqualificationReasons.push('strict reject: submissions closed');
  if (!evidence.hasSubmissionForm && evidence.submissionUrls.length === 0) {
    disqualificationReasons.push('strict warning: weak submission path');
  }

  const cleanDofollowConfidence = clamp(dofollowConfidence, 0, 100);
  const cleanAcceptanceProbability = clamp(acceptanceProbability, 0, 100);
  const cleanSubmissionPathConfidence = clamp(submissionPathConfidence, 0, 100);
  const cleanRiskScore = clamp(riskScore, 0, 100);
  const tier = classifyTier(config, {
    authorityScore: authority.authorityScore,
    dofollowConfidence: cleanDofollowConfidence,
    acceptanceProbability: cleanAcceptanceProbability,
    submissionPathConfidence: cleanSubmissionPathConfidence,
    riskScore: cleanRiskScore,
    strictDofollow,
    paymentRequired,
    indexabilityStatus,
  });

  return {
    tier,
    dofollowConfidence: cleanDofollowConfidence,
    acceptanceProbability: cleanAcceptanceProbability,
    submissionPathConfidence: cleanSubmissionPathConfidence,
    riskScore: cleanRiskScore,
    strictDofollow,
    indexabilityStatus,
    paymentRequired,
    paymentEvidence: payment.matches,
    disqualificationReasons: uniqueValues(disqualificationReasons),
    sampleAcceptedUrls,
    sampleExternalLinkRel,
    lastAcceptedDate,
    proofUrls: uniqueValues([...scrapes.map((record) => record.url), ...evidence.submissionUrls]).slice(0, 30),
    evidencePageCount: scrapes.length,
  };
}

function classifyTier(
  config: PipelineConfig,
  values: {
    authorityScore: number;
    dofollowConfidence: number;
    acceptanceProbability: number;
    submissionPathConfidence: number;
    riskScore: number;
    strictDofollow: boolean;
    paymentRequired: boolean;
    indexabilityStatus: IndexabilityStatus;
  }
): OpportunityTier {
  if (values.indexabilityStatus === 'noindex' || values.paymentRequired) {
    return 'reject';
  }

  const tierA =
    values.strictDofollow &&
    values.dofollowConfidence >= config.evidence.minTierADofollowConfidence &&
    values.acceptanceProbability >= config.evidence.minTierAAcceptanceProbability &&
    values.submissionPathConfidence >= config.evidence.minTierASubmissionPathConfidence &&
    values.authorityScore >= config.evidence.minTierAAuthorityScore &&
    values.riskScore <= config.evidence.maxTierARiskScore;
  if (tierA) {
    return 'tier_a';
  }

  const tierB =
    values.strictDofollow &&
    values.dofollowConfidence >= 65 &&
    values.acceptanceProbability >= 55 &&
    values.submissionPathConfidence >= 55 &&
    values.riskScore <= 45;
  if (tierB) {
    return 'tier_b';
  }

  if (values.dofollowConfidence >= 45 || values.acceptanceProbability >= 45 || values.submissionPathConfidence >= 45) {
    return 'manual_review';
  }

  return 'reject';
}

function scoreStrictOpportunity(
  config: PipelineConfig,
  baseScore: number,
  evidence: StrictOpportunityEvidence
): number {
  if (!config.evidence.strictMode) {
    return baseScore;
  }

  const strictScore =
    evidence.dofollowConfidence * 0.28 +
    evidence.acceptanceProbability * 0.3 +
    evidence.submissionPathConfidence * 0.22 +
    (100 - evidence.riskScore) * 0.12 +
    (evidence.tier === 'tier_a' ? 8 : evidence.tier === 'tier_b' ? 4 : 0);

  return clamp(baseScore * 0.45 + strictScore * 0.55, 0, 100);
}

function recommendAction(
  score: number,
  risks: string[],
  evidence: LinkTechnicalEvidence,
  tier: OpportunityTier
): 'manual_review' | 'browser_verify' | 'likely_eligible' | 'reject' {
  if (tier === 'reject' || risks.includes('noindex') || risks.includes('paid link') || risks.includes('buy backlinks')) {
    return 'reject';
  }
  if (tier === 'tier_a') {
    return 'likely_eligible';
  }
  if (tier === 'tier_b') {
    return 'browser_verify';
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

function mergeLinkEvidence(records: LinkTechnicalEvidence[]): LinkTechnicalEvidence {
  const relCounts: Record<string, number> = {};
  for (const record of records) {
    for (const [rel, count] of Object.entries(record.relCounts)) {
      relCounts[rel] = (relCounts[rel] || 0) + count;
    }
  }

  return {
    hasSubmissionForm: records.some((record) => record.hasSubmissionForm),
    submissionUrls: uniqueValues(records.flatMap((record) => record.submissionUrls)).slice(0, 50),
    signupUrls: uniqueValues(records.flatMap((record) => record.signupUrls)).slice(0, 50),
    loginRequired: records.some((record) => record.loginRequired),
    loginConfidence: Math.max(0, ...records.map((record) => record.loginConfidence)),
    loginUrls: uniqueValues(records.flatMap((record) => record.loginUrls)).slice(0, 50),
    loginEvidence: uniqueValues(records.flatMap((record) => record.loginEvidence)).slice(0, 50),
    sampleOutboundUrls: uniqueValues(records.flatMap((record) => record.sampleOutboundUrls)).slice(0, 50),
    outboundDomainCount: new Set(records.flatMap((record) => record.sampleOutboundUrls).map((url) => getDomain(url)).filter(Boolean)).size,
    relCounts,
    hasFollowedExternalLinks: (relCounts.followed || 0) > 0,
    hasNofollowExternalLinks: (relCounts.nofollow || 0) > 0,
    hasUgcExternalLinks: (relCounts.ugc || 0) > 0,
    hasSponsoredExternalLinks: (relCounts.sponsored || 0) > 0,
    hasNoindex: records.some((record) => record.hasNoindex),
    canonicalUrl: records.find((record) => record.canonicalUrl)?.canonicalUrl,
  };
}

function collectSampleAcceptedUrls(candidateDomain: string, scrapes: ScrapeRecord[]): string[] {
  const urls: string[] = [];

  for (const scrape of scrapes) {
    const pageUrl = normalizeUrl(scrape.url) || scrape.url;
    const pagePath = pathAndText(pageUrl, scrape.metadata.title || '');
    if (SAMPLE_ACCEPTED_PATH_TERMS.some((term) => pagePath.includes(term))) {
      urls.push(pageUrl);
    }

    for (const link of extractPageLinks(scrape)) {
      const domain = getDomain(link.href);
      if (domain !== candidateDomain) {
        continue;
      }

      const haystack = pathAndText(link.href, link.text);
      if (SAMPLE_ACCEPTED_PATH_TERMS.some((term) => haystack.includes(term))) {
        urls.push(link.href);
      }
    }
  }

  return uniqueValues(urls).slice(0, 30);
}

function collectExternalLinkRelSamples(candidateDomain: string, scrapes: ScrapeRecord[]): string[] {
  const samples: string[] = [];

  for (const scrape of scrapes) {
    for (const link of extractPageLinks(scrape)) {
      const domain = getDomain(link.href);
      if (!domain || domain === candidateDomain) {
        continue;
      }

      const relValues = link.rel.split(/\s+/).filter(Boolean);
      const blocked = relValues.some((rel) => STRICT_NONFOLLOW_RELS.has(rel));
      const rel = blocked ? relValues.join(' ') : 'followed';
      samples.push(`${scrape.url} -> ${link.href} [rel=${rel}]`);
    }
  }

  return uniqueValues(samples).slice(0, 30);
}

function extractLatestDate(text: string): string | undefined {
  const matches = text.match(/\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\b/gi) || [];
  let latest = 0;

  for (const match of matches) {
    const parsed = Date.parse(match);
    if (Number.isFinite(parsed) && parsed > latest) {
      latest = parsed;
    }
  }

  return latest > 0 ? new Date(latest).toISOString().slice(0, 10) : undefined;
}

export function extractLinkEvidence(scrape: ScrapeRecord, candidateDomain: string): LinkTechnicalEvidence {
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
    const nonFollow = relValues.some((rel) => STRICT_NONFOLLOW_RELS.has(rel));
    if (relValues.length === 0 || !nonFollow) {
      relCounts.followed = (relCounts.followed || 0) + 1;
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

function extractPageLinks(scrape: ScrapeRecord): Array<{ href: string; rel: string; text: string }> {
  const html = scrape.html || '';
  const $ = cheerio.load(html || '<html></html>');
  const linksFromHtml = $('a')
    .map((_, el) => ({
      href: normalizeHref($(el).attr('href'), scrape.url),
      rel: ($(el).attr('rel') || '').toLowerCase(),
      text: $(el).text().replace(/\s+/g, ' ').trim(),
    }))
    .get()
    .filter((link) => link.href);

  if (linksFromHtml.length > 0) {
    return linksFromHtml;
  }

  return (scrape.links || [])
    .map((href) => ({ href: normalizeHref(href, scrape.url), rel: '', text: '' }))
    .filter((link) => link.href);
}

function pathAndText(url: string, text: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname} ${parsed.search} ${text}`.toLowerCase().replace(/[_/]+/g, '-');
  } catch {
    return `${url} ${text}`.toLowerCase();
  }
}

export function selectEvidenceUrls(candidate: CandidateRecord, scrape: ScrapeRecord, limit: number): string[] {
  if (limit <= 0) {
    return [];
  }

  const scored = new Map<string, number>();
  for (const link of extractPageLinks(scrape)) {
    const normalized = normalizeUrl(link.href);
    if (!normalized || normalized === candidate.normalizedUrl || getDomain(normalized) !== candidate.domain) {
      continue;
    }

    const haystack = pathAndText(normalized, link.text);
    let score = 0;
    if (SUBMISSION_PATH_TERMS.some((term) => haystack.includes(term))) score += 50;
    if (GUIDELINE_PATH_TERMS.some((term) => haystack.includes(term))) score += 35;
    if (SAMPLE_ACCEPTED_PATH_TERMS.some((term) => haystack.includes(term))) score += 25;
    if (ACCEPTANCE_PROOF_PHRASES.some((term) => haystack.includes(term.replace(/\s+/g, '-')) || haystack.includes(term))) score += 15;
    if (LOGIN_PATH_TERMS.some((term) => haystack.includes(term))) score += 8;
    if (score === 0) {
      continue;
    }

    scored.set(normalized, Math.max(scored.get(normalized) || 0, score));
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
    .slice(0, limit);
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
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
    return '';
  }

  try {
    const parsed = new URL(href, baseUrl);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
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
