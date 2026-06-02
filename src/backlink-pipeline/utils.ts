import crypto from 'crypto';
import path from 'path';

export function nowIso(): string {
  return new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sanitizeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'run';
}

export function createRunId(niche: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  return `${stamp}_${sanitizeSlug(niche)}`;
}

export function hashValue(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

export function normalizeUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

    const removableParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'mc_cid',
      'mc_eid',
    ];

    for (const param of removableParams) {
      parsed.searchParams.delete(param);
    }

    if (parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function getDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isLikelySearchOrCacheUrl(url: string): boolean {
  const domain = getDomain(url);
  return [
    'google.com',
    'bing.com',
    'duckduckgo.com',
    'search.yahoo.com',
    'yandex.com',
    'webcache.googleusercontent.com',
  ].some((blockedDomain) => domain === blockedDomain || domain.endsWith(`.${blockedDomain}`));
}

export function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function safeJoin(...parts: string[]): string {
  return path.normalize(path.join(...parts));
}

export async function retry<T>(
  fn: () => Promise<T>,
  retries: number,
  label: string,
  delayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(delayMs * (attempt + 1));
      }
    }
  }
  throw new Error(`${label} failed after ${retries + 1} attempts: ${formatError(lastError)}`);
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    () => runWorker()
  );

  await Promise.all(workers);
  return results;
}

export function scoreByPhrases(text: string, phrases: string[], weight = 1): { score: number; matches: string[] } {
  const normalized = text.toLowerCase();
  const matches = phrases.filter((phrase) => normalized.includes(phrase.toLowerCase()));
  return {
    score: matches.length * weight,
    matches,
  };
}

export function firstNonEmpty(...values: Array<string | undefined | null>): string {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() || '';
}

export function truncateText(value: string, maxLength: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength - 3)}...`;
}

export function csvEscape(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  const text = Array.isArray(value) ? value.join('; ') : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
