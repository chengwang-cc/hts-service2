import { WebScrapingService } from '../../services/web-scraping.service';

export interface ScrapePageParams {
  url: string;
  waitForSelector?: string;
  timeout?: number;
  executeJs?: boolean;
}

/**
 * MCP Tool: Scrape with Puppeteer
 * Full browser automation for JavaScript-heavy sites
 */
export function createScrapePageTool(webScrapingService: WebScrapingService) {
  return {
    name: 'scrape_with_puppeteer',
    description:
      'Scrape webpage using Puppeteer browser automation. Handles JavaScript execution, SPAs, and dynamic content. Slower but more reliable for modern websites.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to scrape',
        },
        waitForSelector: {
          type: 'string',
          description:
            'Optional CSS selector to wait for before considering page loaded',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
          default: 30000,
        },
        executeJs: {
          type: 'boolean',
          description: 'Whether to execute JavaScript (default: true)',
          default: true,
        },
      },
      required: ['url'],
    },
    handler: async (params: ScrapePageParams) => {
      try {
        const result = await webScrapingService.scrapePage(params.url, {
          waitForSelector: params.waitForSelector,
          timeout: params.timeout,
          executeJs: params.executeJs !== false,
        });

        return {
          success: true,
          url: params.url,
          title: result.title,
          statusCode: result.statusCode,
          textLength: result.text.length,
          productsFound: result.productsFound || 0,
          imagesFound: result.imagesFound || 0,
          method: 'puppeteer',
          content: result.text.substring(0, 5000), // Limit content to 5000 chars
          suggestion:
            result.productsFound && result.productsFound > 0
              ? `Found ${result.productsFound} potential product elements on the page.`
              : 'No obvious product elements found, but content was extracted successfully.',
        };
      } catch (error) {
        return {
          success: false,
          url: params.url,
          error: error.message,
          suggestion:
            'Puppeteer scraping failed. The site may be blocking automation or timing out.',
        };
      }
    },
  };
}
