import fs from 'fs/promises';
import type { AuthorityConfig, AuthorityMetrics, CandidateRecord } from './types.js';
import { clamp } from './utils.js';

interface CsvAuthorityRow {
  domain: string;
  authorityScore: number;
  referringDomains?: number;
  organicTraffic?: number;
}

export class AuthorityProvider {
  private readonly csvRows = new Map<string, CsvAuthorityRow>();

  private constructor(private readonly config: AuthorityConfig) {}

  static async create(config: AuthorityConfig): Promise<AuthorityProvider> {
    const provider = new AuthorityProvider(config);
    if (config.provider === 'csv' && config.csvPath) {
      await provider.loadCsv(config.csvPath);
    }
    return provider;
  }

  getAuthority(candidate: CandidateRecord, domainOccurrences: number): AuthorityMetrics {
    const csvRow = this.csvRows.get(candidate.domain);
    if (csvRow) {
      return {
        domain: candidate.domain,
        authorityScore: clamp(csvRow.authorityScore, 0, 100),
        referringDomains: csvRow.referringDomains,
        organicTraffic: csvRow.organicTraffic,
        source: 'csv',
      };
    }

    const discoveryStrength = clamp(candidate.discoveryScore * 12, 0, 35);
    const repeatedDiscovery = clamp(Math.log10(Math.max(1, domainOccurrences)) * 18, 0, 25);
    const domainQuality = scoreDomainShape(candidate.domain);
    const authorityScore = clamp(20 + discoveryStrength + repeatedDiscovery + domainQuality, 0, 70);

    return {
      domain: candidate.domain,
      authorityScore,
      source: 'fallback',
      notes: ['Fallback authority is a proxy. Use Ahrefs/Moz/Semrush/Majestic CSV for production authority metrics.'],
    };
  }

  private async loadCsv(csvPath: string): Promise<void> {
    const text = await fs.readFile(csvPath, 'utf8');
    const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
    const headers = parseCsvLine(headerLine).map((value) => value.trim().toLowerCase());
    const domainIndex = headers.indexOf('domain');
    const authorityIndex = findHeader(headers, ['authority_score', 'authority', 'domain_authority', 'dr', 'da']);
    const referringIndex = findHeader(headers, ['referring_domains', 'ref_domains', 'rd']);
    const trafficIndex = findHeader(headers, ['organic_traffic', 'traffic']);

    if (domainIndex === -1 || authorityIndex === -1) {
      throw new Error(`Authority CSV must contain domain and authority_score columns: ${csvPath}`);
    }

    for (const line of lines) {
      const cells = parseCsvLine(line);
      const domain = (cells[domainIndex] || '').toLowerCase().replace(/^www\./, '').trim();
      if (!domain) {
        continue;
      }

      this.csvRows.set(domain, {
        domain,
        authorityScore: Number(cells[authorityIndex]) || 0,
        referringDomains: referringIndex >= 0 ? Number(cells[referringIndex]) || undefined : undefined,
        organicTraffic: trafficIndex >= 0 ? Number(cells[trafficIndex]) || undefined : undefined,
      });
    }
  }
}

function scoreDomainShape(domain: string): number {
  let score = 0;
  if (domain.endsWith('.edu') || domain.endsWith('.gov')) {
    score += 25;
  }
  if (domain.endsWith('.org')) {
    score += 10;
  }
  if (domain.split('.').length <= 3) {
    score += 8;
  }
  if (!/\d{3,}|-|free|seo|links|directory/i.test(domain)) {
    score += 7;
  }
  return score;
}

function findHeader(headers: string[], names: string[]): number {
  return names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}
