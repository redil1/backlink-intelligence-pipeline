import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

const server = new Server(
  {
    name: 'searxng-crawl4ai',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const searxngUrl = (process.env.SEARXNG_URL || 'http://localhost:8081').replace(/\/$/, '');
const crawl4aiUrl = (process.env.CRAWL4AI_URL || 'http://localhost:8001').replace(/\/$/, '');

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_web',
      description: 'Search the web using SearXNG - fast self-hosted search',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return',
            default: 10,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'crawl4ai_scrape',
      description: 'Scrape webpage content using Crawl4AI',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to scrape' },
          formats: {
            type: 'array',
            items: { type: 'string' },
            description: 'Output formats (markdown, html, links, media)',
            default: ['markdown'],
          },
          wait_for: {
            type: 'number',
            description: 'Wait time in milliseconds before extraction',
            default: 0,
          },
          timeout: {
            type: 'number',
            description: 'Request timeout in milliseconds',
            default: 30000,
          },
        },
        required: ['url'],
      },
    },
    {
      name: 'search_and_scrape',
      description: 'Search and scrape top results in one operation',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: {
            type: 'number',
            description: 'Number of top results to scrape',
            default: 3,
          },
        },
        required: ['query'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    if (name === 'search_web') {
      const response = await axios.get(`${searxngUrl}/search`, {
        params: {
          q: args.query,
          format: 'json',
          safesearch: 0,
        },
        timeout: 10000,
      });

      const results = response.data.results || [];
      const limitedResults = results.slice(0, args.maxResults || 10);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                query: args.query,
                resultCount: limitedResults.length,
                results: limitedResults,
                unresponsive_engines: response.data.unresponsive_engines || [],
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === 'crawl4ai_scrape') {
      const response = await axios.post(
        `${crawl4aiUrl}/scrape`,
        {
          url: args.url,
          formats: args.formats || ['markdown'],
          wait_for: args.wait_for || 0,
          timeout: args.timeout || 30000,
        },
        { timeout: (args.timeout || 30000) + 5000 }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    if (name === 'search_and_scrape') {
      const searchResponse = await axios.get(`${searxngUrl}/search`, {
        params: {
          q: args.query,
          format: 'json',
          safesearch: 0,
        },
        timeout: 10000,
      });

      const results = searchResponse.data.results || [];
      const topResults = results.slice(0, Math.min(args.maxResults || 3, 5));

      const scrapeResults = await Promise.all(
        topResults.map(async (result) => {
          try {
            const response = await axios.post(
              `${crawl4aiUrl}/scrape`,
              {
                url: result.url,
                formats: ['markdown'],
                timeout: 15000,
              },
              { timeout: 20000 }
            );

            return {
              title: result.title,
              url: result.url,
              snippet: result.content,
              success: true,
              data: response.data.data,
            };
          } catch (error) {
            return {
              title: result.title,
              url: result.url,
              snippet: result.content,
              success: false,
              error: error.message,
            };
          }
        })
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                query: args.query,
                searchResults: results.length,
                scrapeResults,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: error.message,
              tool: name,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  setInterval(() => undefined, 2147483647);
  process.stdin.resume();

  if (!process.env.MCP_MODE) {
    console.error('SearXNG + Crawl4AI MCP Server started');
  }
}

main().catch((error) => {
  if (!process.env.MCP_MODE) {
    console.error('MCP server error:', error);
  }
  process.exit(1);
});
