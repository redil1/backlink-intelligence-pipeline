import axios, { AxiosError } from 'axios';
import type { ScrapeRecord, SearchResult } from './types.js';
import { formatError, nowIso } from './utils.js';

export class SearxngSearchClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async search(options: {
    query: string;
    pageno: number;
    language: string;
    engines?: string;
    safesearch: 0 | 1 | 2;
  }): Promise<{ results: SearchResult[]; unresponsiveEngines: string[] }> {
    const response = await axios.get(`${this.baseUrl}/search`, {
      params: {
        q: options.query,
        format: 'json',
        pageno: options.pageno,
        language: options.language,
        engines: options.engines,
        safesearch: options.safesearch,
      },
      timeout: 15000,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'BacklinkOpportunityPipeline/1.0',
      },
    });

    return {
      results: response.data.results || [],
      unresponsiveEngines: response.data.unresponsive_engines || [],
    };
  }
}

export class Crawl4AIHttpClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async scrape(options: {
    candidateId: string;
    url: string;
    domain: string;
    formats: string[];
    timeoutMs: number;
  }): Promise<ScrapeRecord> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/scrape`,
        {
          url: options.url,
          formats: options.formats,
          timeout: options.timeoutMs,
        },
        {
          timeout: options.timeoutMs + 8000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const data = response.data;
      return {
        candidateId: options.candidateId,
        url: options.url,
        domain: options.domain,
        success: Boolean(data.success),
        scrapedAt: nowIso(),
        markdown: data.data?.markdown,
        html: data.data?.html,
        links: data.data?.links || [],
        metadata: {
          title: data.data?.metadata?.title,
          description: data.data?.metadata?.description,
          language: data.data?.metadata?.language,
          wordCount: data.data?.metadata?.word_count,
          finalUrl: data.url,
        },
        error: data.success ? undefined : data.error || 'Crawl4AI returned success=false',
      };
    } catch (error) {
      return {
        candidateId: options.candidateId,
        url: options.url,
        domain: options.domain,
        success: false,
        scrapedAt: nowIso(),
        links: [],
        metadata: {},
        error: formatHttpError(error),
      };
    }
  }
}

function formatHttpError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    const message = axiosError.message;
    return status ? `${status}: ${message}` : message;
  }
  return formatError(error);
}
