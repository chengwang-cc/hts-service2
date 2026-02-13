import { WebScrapingService } from '../../services/web-scraping.service';

export interface FetchPageParams {
  url: string;
  timeout?: number;
}

/**
 * MCP Tool: Fetch Page
 * Fast HTTP fetch without JavaScript execution
 */
export function createFetchPageTool(webScrapingService: WebScrapingService) {
  return {
    name: 'fetch_page',
    description:
      'Fetch webpage content via HTTP. Fast but may fail for JavaScript-heavy sites or SPAs. Use this first before trying Puppeteer.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 10000)',
          default: 10000,
        },
      },
      required: ['url'],
    },
    handler: async (params: FetchPageParams) => {
      try {
        const result = await webScrapingService.fetchPage(params.url);

        // Detect if page is JS-heavy
        const isJsHeavy = webScrapingService.detectJsHeavyPage(result.html);

        return {
          success: true,
          url: params.url,
          title: result.title,
          statusCode: result.statusCode,
          textLength: result.text.length,
          htmlLength: result.html.length,
          isJsHeavy,
          method: 'http',
          content: result.text.substring(0, 5000), // Limit content to 5000 chars
          suggestion: isJsHeavy
            ? 'This page appears to be JavaScript-heavy. Consider using scrape_with_puppeteer for better results.'
            : 'Content retrieved successfully via HTTP.',
        };
      } catch (error) {
        return {
          success: false,
          url: params.url,
          error: error.message,
          suggestion:
            'HTTP fetch failed. Try using scrape_with_puppeteer instead.',
        };
      }
    },
  };
}
