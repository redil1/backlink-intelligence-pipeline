import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { fileURLToPath } from 'url';
import type {
  BrowserVerificationRecord,
  CandidateRecord,
  OpportunityRecord,
  PipelineSummary,
  ScrapeRecord,
  SearchQueryRecord,
} from '../backlink-pipeline/types.js';
import { createRunId, csvEscape, formatError, safeJoin, sanitizeSlug } from '../backlink-pipeline/utils.js';
import { readJsonl } from '../backlink-pipeline/store.js';

type JobStatus = 'running' | 'completed' | 'failed' | 'stopped';
type PipelineCommand = 'run' | 'discover' | 'scrape' | 'browser-verify' | 'export';

interface PipelineJob {
  id: string;
  command: PipelineCommand;
  runId: string;
  runDir: string;
  status: JobStatus;
  startedAt: string;
  updatedAt: string;
  exitedAt?: string;
  exitCode?: number | null;
  args: string[];
  logPath: string;
  logTail: string[];
  process?: ChildProcessWithoutNullStreams;
}

const app = express();
const port = Number(process.env.PIPELINE_UI_PORT || process.env.PORT || 3004);
const projectRoot = process.cwd();
const outputDir = path.resolve(process.env.PIPELINE_OUTPUT_DIR || 'data/backlink-runs');
const publicDir = path.resolve(projectRoot, 'pipeline-ui/public');
const jobs = new Map<string, PipelineJob>();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    service: 'backlink-pipeline-ui',
    outputDir,
    searxngUrl: process.env.SEARXNG_URL || 'http://localhost:8081',
    crawl4aiUrl: process.env.CRAWL4AI_URL || 'http://localhost:8001',
    time: new Date().toISOString(),
  });
});

app.get('/api/runs', async (_req, res) => {
  try {
    const runs = await listRuns();
    res.json({ runs });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/runs', async (req, res) => {
  try {
    const body = req.body || {};
    const command = normalizeCommand(body.command || body.mode || 'run', ['run', 'discover']);
    const niche = stringValue(body.niche, 'business');
    const runId = sanitizeRunId(body.runId || createRunId(niche));
    const runDir = runDirFor(runId);
    await fsp.mkdir(runDir, { recursive: true });

    const args = buildNewRunArgs(command, runId, body, niche);
    const job = await startJob(command, runId, runDir, args);
    res.status(202).json({ job: publicJob(job), runId, runDir });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/runs/:runId', async (req, res) => {
  try {
    const runDir = runDirFor(req.params.runId);
    const summary = await readSummary(runDir);
    const counts = await artifactCounts(runDir);
    const latestJob = [...jobs.values()].reverse().find((job) => job.runId === req.params.runId);
    res.json({ runId: req.params.runId, runDir, summary, counts, latestJob: latestJob ? publicJob(latestJob) : null });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/runs/:runId/actions', async (req, res) => {
  try {
    const runId = sanitizeRunId(req.params.runId);
    const runDir = runDirFor(runId);
    await assertRunExists(runDir);
    const body = req.body || {};
    const command = normalizeCommand(body.action || body.command, ['scrape', 'browser-verify', 'export']);
    const args = buildResumeArgs(command, runDir, body);
    const job = await startJob(command, runId, runDir, args);
    res.status(202).json({ job: publicJob(job) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/runs/:runId/opportunities', async (req, res) => {
  try {
    const runDir = runDirFor(req.params.runId);
    await assertRunExists(runDir);
    const browserByCandidate = await latestBrowserVerifications(runDir);
    const rows = await readAll<OpportunityRecord>(safeJoin(runDir, 'opportunities.jsonl'));
    const filtered = filterOpportunities(rows, browserByCandidate, req.query);
    res.json({
      total: filtered.length,
      offset: numberQuery(req.query.offset, 0),
      limit: numberQuery(req.query.limit, 100),
      opportunities: paginate(filtered, req.query).map((opportunity) => ({
        ...opportunity,
        browserVerification: browserByCandidate.get(opportunity.candidateId) || null,
      })),
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/runs/:runId/candidates', async (req, res) => {
  try {
    const runDir = runDirFor(req.params.runId);
    await assertRunExists(runDir);
    const rows = await readAll<CandidateRecord>(safeJoin(runDir, 'candidates.jsonl'));
    res.json({ total: rows.length, candidates: paginate(rows, req.query) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/runs/:runId/scrapes', async (req, res) => {
  try {
    const runDir = runDirFor(req.params.runId);
    await assertRunExists(runDir);
    const rows = await readAll<ScrapeRecord>(safeJoin(runDir, 'scrapes.jsonl'));
    res.json({ total: rows.length, scrapes: paginate(rows, req.query) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/runs/:runId/browser-verifications', async (req, res) => {
  try {
    const runDir = runDirFor(req.params.runId);
    await assertRunExists(runDir);
    const rows = await readAll<BrowserVerificationRecord>(safeJoin(runDir, 'browser-verifications.jsonl'));
    res.json({ total: rows.length, verifications: paginate(rows.reverse(), req.query) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/runs/:runId/queries', async (req, res) => {
  try {
    const runDir = runDirFor(req.params.runId);
    await assertRunExists(runDir);
    const rows = await readAll<SearchQueryRecord>(safeJoin(runDir, 'queries.jsonl'));
    res.json({ total: rows.length, queries: paginate(rows, req.query) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/runs/:runId/download/opportunities.csv', async (req, res) => {
  try {
    const runDir = runDirFor(req.params.runId);
    const csvPath = safeJoin(runDir, 'opportunities.csv');
    await assertReadableFile(csvPath);
    res.download(csvPath, `${req.params.runId}-opportunities.csv`);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/runs/:runId/export/opportunities-filtered.csv', async (req, res) => {
  try {
    const runDir = runDirFor(req.params.runId);
    const browserByCandidate = await latestBrowserVerifications(runDir);
    const rows = filterOpportunities(await readAll<OpportunityRecord>(safeJoin(runDir, 'opportunities.jsonl')), browserByCandidate, req.query);
    const csv = opportunitiesToCsv(rows, browserByCandidate);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.runId}-filtered-opportunities.csv"`);
    res.send(csv);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/jobs', (_req, res) => {
  res.json({ jobs: [...jobs.values()].map(publicJob).sort((a, b) => b.startedAt.localeCompare(a.startedAt)) });
});

app.get('/api/jobs/:jobId', async (req, res) => {
  try {
    const job = jobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json({ job: publicJob(job), log: await readLog(job.logPath, 20000) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/jobs/:jobId/stop', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (job.status !== 'running' || !job.process) {
    res.json({ job: publicJob(job) });
    return;
  }
  job.process.kill('SIGTERM');
  job.status = 'stopped';
  job.updatedAt = new Date().toISOString();
  res.json({ job: publicJob(job) });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Backlink Pipeline UI listening on http://0.0.0.0:${port}`);
});

function buildNewRunArgs(command: PipelineCommand, runId: string, body: Record<string, unknown>, niche: string): string[] {
  const args = [command, '--niche', niche, '--run-id', runId, '--output-dir', path.relative(projectRoot, outputDir) || outputDir];
  addNumberArg(args, '--target', body.targetCandidates ?? body.target);
  addNumberArg(args, '--max-queries', body.maxQueries);
  addNumberArg(args, '--search-pages', body.searchPages);
  addNumberArg(args, '--search-concurrency', body.searchConcurrency);
  addNumberArg(args, '--scrape-limit', body.scrapeLimit);
  addNumberArg(args, '--scrape-concurrency', body.scrapeConcurrency);
  addNumberArg(args, '--min-candidate-score', body.minCandidateScore);
  addNumberArg(args, '--browser-limit', body.browserLimit);
  addNumberArg(args, '--evidence-pages', body.evidencePages);
  addStringArg(args, '--authority-csv', body.authorityCsv);
  addStringArg(args, '--browser-bu-name', body.browserBuName);
  addStringArg(args, '--browser-cdp-url', body.browserCdpUrl);
  addStringArg(args, '--browser-local-command', body.browserLocalCommand);
  if (body.browserVerify === true || body.browserVerify === 'true') {
    args.push('--browser-verify', 'true');
  }
  if (body.noBrowserLocalChromium === true) {
    args.push('--no-browser-local-chromium');
  }
  if (body.noDeepEvidence === true) {
    args.push('--no-deep-evidence');
  }
  if (body.strictMode === false) {
    args.push('--strict-mode', 'false');
  }
  if (command === 'discover' || body.noScrape === true) {
    args.push('--no-scrape');
  }
  return args;
}

function buildResumeArgs(command: PipelineCommand, runDir: string, body: Record<string, unknown>): string[] {
  const args = [command, '--resume-dir', runDir];
  addNumberArg(args, '--scrape-limit', body.scrapeLimit);
  addNumberArg(args, '--scrape-concurrency', body.scrapeConcurrency);
  addNumberArg(args, '--min-candidate-score', body.minCandidateScore);
  addNumberArg(args, '--browser-limit', body.browserLimit);
  addNumberArg(args, '--evidence-pages', body.evidencePages);
  addStringArg(args, '--authority-csv', body.authorityCsv);
  addStringArg(args, '--browser-bu-name', body.browserBuName);
  addStringArg(args, '--browser-cdp-url', body.browserCdpUrl);
  addStringArg(args, '--browser-local-command', body.browserLocalCommand);
  if (body.noBrowserLocalChromium === true) {
    args.push('--no-browser-local-chromium');
  }
  if (body.noDeepEvidence === true) {
    args.push('--no-deep-evidence');
  }
  if (body.strictMode === false) {
    args.push('--strict-mode', 'false');
  }
  return args;
}

async function startJob(command: PipelineCommand, runId: string, runDir: string, args: string[]): Promise<PipelineJob> {
  await fsp.mkdir(runDir, { recursive: true });
  const jobId = `${Date.now()}-${sanitizeSlug(command)}-${sanitizeSlug(runId)}`;
  const logPath = safeJoin(runDir, `ui-job-${jobId}.log`);
  const now = new Date().toISOString();
  const job: PipelineJob = {
    id: jobId,
    command,
    runId,
    runDir,
    status: 'running',
    startedAt: now,
    updatedAt: now,
    args,
    logPath,
    logTail: [],
  };
  jobs.set(jobId, job);

  const child = spawn(process.execPath, ['dist/backlink-pipeline/cli.js', ...args], {
    cwd: projectRoot,
    env: process.env,
  });
  job.process = child;
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(`$ node dist/backlink-pipeline/cli.js ${args.join(' ')}\n`);

  function capture(chunk: Buffer): void {
    const text = chunk.toString();
    logStream.write(text);
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      job.logTail.push(line);
    }
    job.logTail = job.logTail.slice(-80);
    job.updatedAt = new Date().toISOString();
  }

  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('error', (error) => {
    job.status = 'failed';
    job.updatedAt = new Date().toISOString();
    job.exitedAt = job.updatedAt;
    job.logTail.push(formatError(error));
    logStream.write(`${formatError(error)}\n`);
    logStream.end();
  });
  child.on('close', (code) => {
    if (job.status !== 'stopped') {
      job.status = code === 0 ? 'completed' : 'failed';
    }
    job.exitCode = code;
    job.updatedAt = new Date().toISOString();
    job.exitedAt = job.updatedAt;
    logStream.write(`\n[exit ${code}]\n`);
    logStream.end();
    delete job.process;
  });

  return job;
}

async function listRuns(): Promise<Array<{ runId: string; summary: PipelineSummary | null; counts: Record<string, number>; latestJob: ReturnType<typeof publicJob> | null }>> {
  await fsp.mkdir(outputDir, { recursive: true });
  const entries = await fsp.readdir(outputDir, { withFileTypes: true });
  const runs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const runId = entry.name;
        const runDir = runDirFor(runId);
        const latestJob = [...jobs.values()].reverse().find((job) => job.runId === runId);
        return {
          runId,
          summary: await readSummary(runDir),
          counts: await artifactCounts(runDir),
          latestJob: latestJob ? publicJob(latestJob) : null,
        };
      })
  );
  return runs.sort((a, b) => {
    const aTime = a.summary?.updatedAt || '';
    const bTime = b.summary?.updatedAt || '';
    return bTime.localeCompare(aTime);
  });
}

async function readSummary(runDir: string): Promise<PipelineSummary | null> {
  try {
    return JSON.parse(await fsp.readFile(safeJoin(runDir, 'summary.json'), 'utf8')) as PipelineSummary;
  } catch {
    return null;
  }
}

async function artifactCounts(runDir: string): Promise<Record<string, number>> {
  const files = ['queries.jsonl', 'candidates.jsonl', 'scrapes.jsonl', 'opportunities.jsonl', 'browser-verifications.jsonl'];
  const pairs = await Promise.all(
    files.map(async (file) => [file.replace('.jsonl', ''), await countLines(safeJoin(runDir, file))] as const)
  );
  return Object.fromEntries(pairs);
}

async function countLines(filePath: string): Promise<number> {
  try {
    const text = await fsp.readFile(filePath, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function latestBrowserVerifications(runDir: string): Promise<Map<string, BrowserVerificationRecord>> {
  const records = await readAll<BrowserVerificationRecord>(safeJoin(runDir, 'browser-verifications.jsonl'));
  const map = new Map<string, BrowserVerificationRecord>();
  for (const record of records) {
    map.set(record.candidateId, record);
  }
  return map;
}

async function readAll<T>(filePath: string): Promise<T[]> {
  const rows: T[] = [];
  for await (const row of readJsonl<T>(filePath)) {
    rows.push(row);
  }
  return rows;
}

function filterOpportunities(
  rows: OpportunityRecord[],
  browserByCandidate: Map<string, BrowserVerificationRecord>,
  query: Record<string, unknown>
): OpportunityRecord[] {
  const minScore = numberQuery(query.minScore, 0);
  const action = stringQuery(query.action);
  const type = stringQuery(query.type);
  const loginRequired = stringQuery(query.loginRequired);
  const browserStatus = stringQuery(query.browserStatus);
  const q = stringQuery(query.q).toLowerCase();
  const risk = stringQuery(query.risk).toLowerCase();
  const tier = stringQuery(query.tier);
  const minDofollow = numberQuery(query.minDofollow, 0);
  const minAcceptance = numberQuery(query.minAcceptance, 0);
  const minSubmission = numberQuery(query.minSubmission, 0);
  const maxRisk = numberQuery(query.maxRisk, 100);
  const strictDofollow = stringQuery(query.strictDofollow);

  const filtered = rows.filter((row) => {
    if (row.opportunityScore < minScore) return false;
    if (action && row.recommendedAction !== action) return false;
    if (type && row.opportunityType !== type) return false;
    if (tier && row.strictEvidence?.tier !== tier) return false;
    if ((row.strictEvidence?.dofollowConfidence || 0) < minDofollow) return false;
    if ((row.strictEvidence?.acceptanceProbability || 0) < minAcceptance) return false;
    if ((row.strictEvidence?.submissionPathConfidence || 0) < minSubmission) return false;
    if ((row.strictEvidence?.riskScore || 0) > maxRisk) return false;
    if (strictDofollow && (strictDofollow === 'true') !== Boolean(row.strictEvidence?.strictDofollow)) return false;
    if (loginRequired) {
      const required = Boolean(row.linkEvidence?.loginRequired || browserByCandidate.get(row.candidateId)?.loginRequired);
      if ((loginRequired === 'true') !== required) return false;
    }
    if (browserStatus) {
      const verification = browserByCandidate.get(row.candidateId);
      if (browserStatus === 'verified' && !verification?.success) return false;
      if (browserStatus === 'failed' && verification?.success !== false) return false;
      if (browserStatus === 'unverified' && verification) return false;
    }
    if (risk && !(row.risks || []).some((item) => item.toLowerCase().includes(risk))) return false;
    if (q) {
      const haystack = `${row.domain} ${row.url} ${row.title} ${(row.signals || []).join(' ')} ${(row.risks || []).join(' ')}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return filtered.sort((a, b) => {
    const tierRank = tierWeight(b.strictEvidence?.tier) - tierWeight(a.strictEvidence?.tier);
    return tierRank || b.opportunityScore - a.opportunityScore;
  });
}

function paginate<T>(rows: T[], query: Record<string, unknown>): T[] {
  const offset = numberQuery(query.offset, 0);
  const limit = Math.min(numberQuery(query.limit, 100), 1000);
  return rows.slice(offset, offset + limit);
}

function opportunitiesToCsv(rows: OpportunityRecord[], browserByCandidate: Map<string, BrowserVerificationRecord>): string {
  const header = [
    'score',
    'tier',
    'recommended_action',
    'domain',
    'url',
    'type',
    'dofollow_confidence',
    'acceptance_probability',
    'submission_path_confidence',
    'strict_dofollow',
    'risk_score',
    'authority_score',
    'indexability_status',
    'payment_required',
    'evidence_page_count',
    'login_required',
    'login_confidence',
    'browser_verified',
    'browser_login_required',
    'proof_urls',
    'sample_accepted_urls',
    'sample_external_link_rel',
    'signals',
    'risks',
    'disqualification_reasons',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    const browser = browserByCandidate.get(row.candidateId);
    lines.push(
      [
        row.opportunityScore.toFixed(2),
        row.strictEvidence?.tier || '',
        row.recommendedAction,
        row.domain,
        row.url,
        row.opportunityType,
        row.strictEvidence?.dofollowConfidence?.toFixed(2) || '',
        row.strictEvidence?.acceptanceProbability?.toFixed(2) || '',
        row.strictEvidence?.submissionPathConfidence?.toFixed(2) || '',
        row.strictEvidence?.strictDofollow ?? '',
        row.strictEvidence?.riskScore?.toFixed(2) || '',
        row.authorityScore?.toFixed(2) || '',
        row.strictEvidence?.indexabilityStatus || '',
        row.strictEvidence?.paymentRequired ?? '',
        row.strictEvidence?.evidencePageCount ?? '',
        row.linkEvidence?.loginRequired,
        row.linkEvidence?.loginConfidence,
        browser?.success ?? false,
        browser?.loginRequired ?? '',
        row.strictEvidence?.proofUrls || [],
        row.strictEvidence?.sampleAcceptedUrls || [],
        row.strictEvidence?.sampleExternalLinkRel || [],
        row.signals,
        row.risks,
        row.strictEvidence?.disqualificationReasons || [],
      ].map(csvEscape).join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

function tierWeight(tier?: string): number {
  if (tier === 'tier_a') return 4;
  if (tier === 'tier_b') return 3;
  if (tier === 'manual_review') return 2;
  if (tier === 'reject') return 1;
  return 0;
}

function publicJob(job: PipelineJob) {
  return {
    id: job.id,
    command: job.command,
    runId: job.runId,
    runDir: job.runDir,
    status: job.status,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    exitedAt: job.exitedAt,
    exitCode: job.exitCode,
    args: job.args,
    logPath: job.logPath,
    logTail: job.logTail,
  };
}

async function readLog(filePath: string, maxBytes: number): Promise<string> {
  try {
    const stat = await fsp.stat(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const handle = await fsp.open(filePath, 'r');
    const buffer = Buffer.alloc(stat.size - start);
    await handle.read(buffer, 0, buffer.length, start);
    await handle.close();
    return buffer.toString();
  } catch {
    return '';
  }
}

async function assertRunExists(runDir: string): Promise<void> {
  const stat = await fsp.stat(runDir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new HttpError(404, `Run not found: ${path.basename(runDir)}`);
  }
}

async function assertReadableFile(filePath: string): Promise<void> {
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new HttpError(404, `File not found: ${path.basename(filePath)}`);
  }
}

function runDirFor(rawRunId: string): string {
  return safeJoin(outputDir, sanitizeRunId(rawRunId));
}

function sanitizeRunId(value: unknown): string {
  const runId = String(value || '').trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(runId)) {
    throw new HttpError(400, 'Invalid run id. Use letters, numbers, dots, underscores, and dashes only.');
  }
  return runId;
}

function normalizeCommand(value: unknown, allowed: PipelineCommand[]): PipelineCommand {
  const command = String(value || '').trim() as PipelineCommand;
  if (!allowed.includes(command)) {
    throw new HttpError(400, `Invalid command. Allowed: ${allowed.join(', ')}`);
  }
  return command;
}

function addNumberArg(args: string[], flag: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  const number = Number(value);
  if (Number.isFinite(number)) args.push(flag, String(number));
}

function addStringArg(args: string[], flag: string, value: unknown): void {
  if (typeof value === 'string' && value.trim()) args.push(flag, value.trim());
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberQuery(value: unknown, fallback: number): number {
  const text = Array.isArray(value) ? value[0] : value;
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function stringQuery(value: unknown): string {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === 'string' ? text : '';
}

function sendError(res: express.Response, error: unknown): void {
  const status = error instanceof HttpError ? error.status : 500;
  res.status(status).json({ error: formatError(error) });
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// Keep TypeScript from eliding path resolution in bundled/container contexts.
void fileURLToPath(import.meta.url);
