import { WebScrapingService } from '../../services/web-scraping.service';

export interface ScreenshotParams {
  url: string;
  fullPage?: boolean;
  viewport?: {
    width: number;
    height: number;
  };
}

/**
 * MCP Tool: Capture Screenshot
 * Take screenshot of webpage for vision analysis
 */
export function createScreenshotTool(webScrapingService: WebScrapingService) {
  return {
    name: 'capture_screenshot',
    description:
      'Capture a screenshot of the webpage for visual analysis. Useful when products are primarily identified through images rather than text.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to capture',
        },
        fullPage: {
          type: 'boolean',
          description: 'Capture full page or just viewport (default: false)',
          default: false,
        },
        viewport: {
          type: 'object',
          description: 'Viewport dimensions',
          properties: {
            width: { type: 'number', default: 1920 },
            height: { type: 'number', default: 1080 },
          },
        },
      },
      required: ['url'],
    },
    handler: async (params: ScreenshotParams) => {
      try {
        const screenshot = await webScrapingService.captureScreenshot(
          params.url,
          params.viewport,
        );

        // Convert buffer to base64 for transmission
        const base64Screenshot = screenshot.toString('base64');

        return {
          success: true,
          url: params.url,
          screenshot: base64Screenshot,
          screenshotSize: screenshot.length,
          format: 'jpeg',
          suggestion:
            'Screenshot captured. You can now use this with vision analysis to identify products.',
        };
      } catch (error) {
        return {
          success: false,
          url: params.url,
          error: error.message,
          suggestion: 'Screenshot capture failed. The site may be inaccessible or timing out.',
        };
      }
    },
  };
}
