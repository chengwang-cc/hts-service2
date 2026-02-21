import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { load } from 'cheerio';
import puppeteer from 'puppeteer';
import { OpenAiService } from '@hts/core';
import {
  ClassifyUrlResponseDto,
  UrlType,
  UrlMetadata,
} from '../dto/classify-url.dto';

interface OpenGraphData {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
  price?: string;
  currency?: string;
}

@Injectable()
export class UrlClassifierService {
  private readonly logger = new Logger(UrlClassifierService.name);

  // List of internal/private IPs to block (SSRF prevention)
  private readonly BLOCKED_HOSTS = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^169\.254\./, // Link-local
    /^::1$/, // IPv6 localhost
    /^fe80:/, // IPv6 link-local
  ];

  private readonly IMAGE_EXTENSIONS = [
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
    '.bmp',
    '.svg',
  ];

  private readonly ALLOWED_CONTENT_TYPES = [
    'text/html',
    'application/xhtml+xml',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/svg+xml',
  ];

  private readonly MAX_HTML_SIZE = 5 * 1024 * 1024; // 5MB
  private readonly REQUEST_TIMEOUT = 8000; // 8 seconds

  constructor(
    private readonly httpService: HttpService,
    private readonly openAiService: OpenAiService,
  ) {}

  /**
   * Main method to classify a URL and determine its type
   */
  async classifyUrl(url: string): Promise<ClassifyUrlResponseDto> {
    try {
      // Step 1: Validate URL is not internal/private (SSRF prevention)
      if (!this.isAllowedUrl(url)) {
        return {
          type: UrlType.INVALID,
          error: 'URL not allowed (internal/private addresses blocked)',
        };
      }

      // Step 2: Check if it's a direct image URL by extension
      if (this.isImageExtension(url)) {
        this.logger.log(`Direct image URL detected: ${url}`);
        return {
          type: UrlType.IMAGE,
          imageUrl: url,
        };
      }

      // Step 3: Try HEAD request to check Content-Type
      const contentType = await this.getContentType(url);

      if (contentType?.startsWith('image/')) {
        this.logger.log(`Image URL detected by Content-Type: ${url}`);
        return {
          type: UrlType.IMAGE,
          imageUrl: url,
        };
      }

      // Step 4: Fetch HTML content and parse
      const html = await this.fetchHtml(url);

      if (!html) {
        return {
          type: UrlType.INVALID,
          error: 'Unable to fetch webpage content',
        };
      }

      // Step 5: Extract OpenGraph and metadata
      const ogData = this.extractOpenGraph(html);

      // Step 6: Detect if it's a product page
      const isProduct = this.detectProductPage(html, ogData);

      if (isProduct && ogData.image) {
        this.logger.log(`Product page detected: ${url}`);
        return {
          type: UrlType.PRODUCT,
          imageUrl: ogData.image,
          metadata: {
            title: ogData.title,
            description: ogData.description,
            siteName: ogData.siteName,
            productName: ogData.title,
            price: ogData.price,
            currency: ogData.currency,
          },
        };
      }

      if (ogData.image) {
        this.logger.log(`Webpage with OG image detected: ${url}`);
        return {
          type: UrlType.WEBPAGE,
          imageUrl: ogData.image,
          metadata: {
            title: ogData.title,
            description: ogData.description,
            siteName: ogData.siteName,
          },
        };
      }

      // No image found - extract product description for text-based classification
      this.logger.log(`No image found, extracting product description from ${url}`);

      // Check if this is actually a product page
      const isLikelyProductPage = this.detectProductPage(html, ogData);

      const productDescription = await this.extractProductDescription(html, ogData);

      if (productDescription) {
        return {
          type: UrlType.WEBPAGE,
          metadata: {
            title: ogData.title,
            description: productDescription,
            siteName: ogData.siteName,
          },
        };
      }

      // No image and no usable description found
      if (!isLikelyProductPage) {
        return {
          type: UrlType.INVALID,
          error: 'This does not appear to be a product page. Please use a direct product URL.',
        };
      }

      return {
        type: UrlType.INVALID,
        error: 'No image or product description found on this webpage',
      };
    } catch (error) {
      this.logger.error(`URL classification failed: ${error.message}`, error.stack);

      // Return user-friendly error messages
      if (error.code === 'ENOTFOUND') {
        return { type: UrlType.INVALID, error: 'URL not found' };
      }
      if (error.code === 'ECONNABORTED') {
        return { type: UrlType.INVALID, error: 'Request timeout' };
      }
      if (error.response?.status === 404) {
        return { type: UrlType.INVALID, error: 'Page not found (404)' };
      }
      if (error.response?.status === 403) {
        return { type: UrlType.INVALID, error: 'Access denied (403)' };
      }

      return {
        type: UrlType.INVALID,
        error: 'Failed to analyze URL. Please try again.',
      };
    }
  }

  /**
   * Check if URL has image extension
   */
  private isImageExtension(url: string): boolean {
    const urlLower = url.toLowerCase();
    return this.IMAGE_EXTENSIONS.some((ext) => urlLower.endsWith(ext));
  }

  /**
   * Validate URL is not internal/private (SSRF prevention)
   */
  private isAllowedUrl(url: string): boolean {
    try {
      const parsed = new URL(url);

      // Only allow HTTP/HTTPS
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }

      // Allow localhost in test/development mode for E2E testing
      if (process.env.ALLOW_LOCALHOST_URLS === 'true') {
        this.logger.debug(`Allowing localhost URL for testing: ${url}`);
        return true;
      }

      // Check against blocked hosts
      const hostname = parsed.hostname;
      return !this.BLOCKED_HOSTS.some((pattern) => {
        if (typeof pattern === 'string') {
          return hostname === pattern;
        }
        return pattern.test(hostname);
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * Get Content-Type via HEAD request
   */
  private async getContentType(url: string): Promise<string | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.head(url, {
          timeout: 3000,
          maxRedirects: 5,
          validateStatus: (status) => status < 400,
        }),
      );

      return response.headers['content-type']?.split(';')[0] || null;
    } catch (error) {
      this.logger.debug(`HEAD request failed for ${url}: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch HTML content from URL
   * Falls back to Puppeteer if axios fails with 403 (common for e-commerce sites)
   */
  private async fetchHtml(url: string): Promise<string | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          timeout: this.REQUEST_TIMEOUT,
          maxRedirects: 5,
          validateStatus: (status) => status < 400,
          responseType: 'text',
          maxContentLength: this.MAX_HTML_SIZE,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept':
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
          },
        }),
      );

      const contentType = response.headers['content-type'];
      if (
        !contentType ||
        !this.ALLOWED_CONTENT_TYPES.some((allowed) =>
          contentType.includes(allowed),
        )
      ) {
        this.logger.warn(`Unsupported content type: ${contentType}`);
        return null;
      }

      return response.data;
    } catch (error) {
      // If we get a 403 (Forbidden), try with Puppeteer
      if (error.response?.status === 403) {
        this.logger.log(
          `Axios blocked with 403, falling back to Puppeteer for ${url}`,
        );
        return this.fetchHtmlWithPuppeteer(url);
      }

      this.logger.error(`Failed to fetch HTML from ${url}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch HTML using Puppeteer (for sites that block simple HTTP requests)
   */
  private async fetchHtmlWithPuppeteer(url: string): Promise<string | null> {
    let browser;
    try {
      this.logger.log(`Launching Puppeteer for ${url}`);

      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      });

      const page = await browser.newPage();

      // Set a realistic viewport and user agent
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      );

      // Navigate with timeout
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.REQUEST_TIMEOUT,
      });

      // Wait additional 2 seconds for dynamic content to load
      this.logger.log('Waiting 2 seconds for dynamic content...');
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get the HTML content
      const html = await page.content();

      this.logger.log(
        `Successfully fetched HTML with Puppeteer (${html.length} bytes)`,
      );

      return html;
    } catch (error) {
      this.logger.error(
        `Puppeteer failed to fetch ${url}: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Extract OpenGraph metadata from HTML
   */
  private extractOpenGraph(html: string): OpenGraphData {
    const $ = load(html);
    const ogData: OpenGraphData = {};

    // Extract OpenGraph tags
    ogData.title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text() ||
      undefined;

    ogData.description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      undefined;

    ogData.image =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[property="og:image:url"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      undefined;

    ogData.siteName =
      $('meta[property="og:site_name"]').attr('content') || undefined;

    ogData.type = $('meta[property="og:type"]').attr('content') || undefined;

    // Extract product-specific metadata
    ogData.price =
      $('meta[property="product:price:amount"]').attr('content') ||
      $('meta[property="og:price:amount"]').attr('content') ||
      undefined;

    ogData.currency =
      $('meta[property="product:price:currency"]').attr('content') ||
      $('meta[property="og:price:currency"]').attr('content') ||
      undefined;

    return ogData;
  }

  /**
   * Detect if the page is a product page
   */
  private detectProductPage(html: string, ogData: OpenGraphData): boolean {
    // Check OpenGraph type
    if (ogData.type === 'product') {
      return true;
    }

    // Check for product-specific metadata
    if (ogData.price || ogData.currency) {
      return true;
    }

    // Check for common product page patterns
    const productIndicators = [
      // Product metadata
      /<meta property="product:/i,
      /<script type="application\/ld\+json">.*"@type":\s*"Product"/is,

      // Common e-commerce platforms
      /id="dp-container"/i, // Amazon
      /data-product-id/i,
      /class="[^"]*product[^"]*"/i,

      // Product actions
      /<button[^>]*add[^>]*cart/i,
      /<button[^>]*buy[^>]*now/i,

      // Price indicators
      /class="[^"]*price[^"]*"/i,
      /itemprop="price"/i,
    ];

    return productIndicators.some((pattern) => pattern.test(html));
  }

  /**
   * Extract product description from HTML using OpenAI
   * Intelligently extracts only relevant product text to minimize AI costs
   */
  private async extractProductDescription(
    html: string,
    ogData: OpenGraphData,
  ): Promise<string | null> {
    this.logger.log('Extracting product info using AI...');

    try {
      const $ = load(html);

      // Priority 1: Extract focused product content
      const productTexts: string[] = [];

      // Add title if available
      if (ogData.title) {
        productTexts.push(`Title: ${ogData.title}`);
      }

      // Extract from product-specific selectors (most relevant first)
      const productSelectors = [
        'h1', // Product title
        '[itemprop="name"]', // Schema.org product name
        '[itemprop="description"]', // Schema.org description
        '.product-description',
        '#productDescription',
        '#feature-bullets',
        '.product-details',
        '[class*="product-info"]',
        '[class*="description"]',
      ];

      for (const selector of productSelectors) {
        const element = $(selector).first();
        if (element.length > 0) {
          const text = element.text().trim();
          if (text && text.length > 20 && text.length < 2000) {
            productTexts.push(text);
            // Stop after getting ~1500 chars of relevant text
            if (productTexts.join(' ').length > 1500) break;
          }
        }
      }

      // Combine and clean the text
      const combinedText = productTexts
        .join(' ')
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/\n+/g, ' ') // Remove newlines
        .trim()
        .substring(0, 2500); // Limit to 2500 chars (much less than before)

      if (!combinedText || combinedText.length < 50) {
        this.logger.warn('Not enough relevant product text to analyze');
        return null;
      }

      this.logger.log(`Extracted ${combinedText.length} chars of focused product text, sending to OpenAI...`);

      // Use OpenAI to extract product information
      const prompt = `Extract product information from this webpage text. Return a concise product description (2-3 sentences) suitable for customs classification.

Webpage text:
${combinedText}

Respond with ONLY the product description, nothing else.`;

      const response = await this.openAiService.response(prompt, {
        model: 'gpt-5-nano', // Ultra-fast and cheap model optimized for extraction
        instructions: 'You are a product information extractor. Extract only the key product details in 2-3 sentences.',
        store: false,
        // Note: temperature not set - gpt-5-nano uses default value only
      });

      const description = (response as any).output_text?.trim();

      if (description && description.length > 30) {
        this.logger.log(`AI extracted description: ${description.substring(0, 100)}...`);
        return description;
      }

      this.logger.warn('AI did not return a valid description');
      return null;
    } catch (error) {
      this.logger.error(`Failed to extract description with AI: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract product description from JSON-LD structured data
   */
  private extractJsonLdDescription($: any): string | null {
    const scripts = $('script[type="application/ld+json"]');

    for (let i = 0; i < scripts.length; i++) {
      try {
        const jsonText = $(scripts[i]).html();
        if (!jsonText) continue;

        const data = JSON.parse(jsonText);

        // Handle both single objects and arrays
        const items = Array.isArray(data) ? data : [data];

        for (const item of items) {
          // Look for Product type
          if (item['@type'] === 'Product' && item.description) {
            return item.description;
          }

          // Some sites nest the product data
          if (item['@graph']) {
            const product = item['@graph'].find(
              (node: any) => node['@type'] === 'Product',
            );
            if (product?.description) {
              return product.description;
            }
          }
        }
      } catch (error) {
        // Invalid JSON, skip
        continue;
      }
    }

    return null;
  }
}
