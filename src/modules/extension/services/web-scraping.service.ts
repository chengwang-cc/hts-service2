import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser, Page, Viewport } from 'puppeteer';
import axios, { AxiosInstance } from 'axios';

export interface ScrapeOptions {
  waitForSelector?: string;
  timeout?: number;
  executeJs?: boolean;
}

export interface ScrapedContent {
  html: string;
  text: string;
  title: string;
  productsFound?: number;
  imagesFound?: number;
  statusCode: number;
  method: 'http' | 'puppeteer';
  metadata?: Record<string, any>;
}

/**
 * Web Scraping Service
 * Manages Puppeteer browser pool and page scraping operations
 * Provides fallback from HTTP fetch to Puppeteer for JS-heavy sites
 */
@Injectable()
export class WebScrapingService implements OnModuleDestroy {
  private readonly logger = new Logger(WebScrapingService.name);
  private browserPool: Browser[] = [];
  private readonly POOL_SIZE = 2; // Number of browser instances
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private initializationPromise: Promise<void> | null = null;
  private isShuttingDown = false;
  private readonly axios: AxiosInstance;

  constructor() {
    // Initialize axios for HTTP requests
    this.axios = axios.create({
      timeout: 10000, // 10 second timeout for HTTP
      maxContentLength: 10 * 1024 * 1024, // 10MB
      maxBodyLength: 10 * 1024 * 1024,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    // Initialize browser pool on service creation
    this.initializationPromise = this.initializeBrowserPool();
  }

  /**
   * Initialize browser pool
   */
  private async initializeBrowserPool(): Promise<void> {
    try {
      this.logger.log(`Initializing browser pool (${this.POOL_SIZE} instances)`);

      for (let i = 0; i < this.POOL_SIZE; i++) {
        const browser = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-extensions',
          ],
        });

        this.browserPool.push(browser);
        this.logger.log(`Browser ${i + 1}/${this.POOL_SIZE} initialized`);
      }

      this.logger.log('Browser pool ready');
    } catch (error) {
      this.logger.error('Failed to initialize browser pool', error.stack);
      throw new Error('Failed to initialize web scraping service');
    }
  }

  /**
   * Get an available browser from the pool
   */
  private async getBrowser(): Promise<Browser> {
    // Wait for initialization if still in progress
    if (this.initializationPromise) {
      await this.initializationPromise;
    }

    if (this.browserPool.length === 0) {
      throw new Error('No browsers available in pool');
    }

    // Round-robin selection (simple strategy)
    return this.browserPool[Math.floor(Math.random() * this.browserPool.length)];
  }

  /**
   * Fetch page content via HTTP (fast, no JS execution)
   */
  async fetchPage(url: string): Promise<ScrapedContent> {
    this.logger.log(`Fetching page via HTTP: ${url}`);

    try {
      const response = await this.axios.get(url, {
        validateStatus: (status) => status < 500, // Accept all status codes < 500
      });

      const html = response.data;
      const text = this.extractTextFromHtml(html);
      const title = this.extractTitleFromHtml(html);

      return {
        html,
        text,
        title,
        statusCode: response.status,
        method: 'http',
        metadata: {
          contentType: response.headers['content-type'],
          contentLength: response.headers['content-length'],
        },
      };
    } catch (error) {
      this.logger.warn(`HTTP fetch failed for ${url}: ${error.message}`);
      throw new Error(`Failed to fetch page via HTTP: ${error.message}`);
    }
  }

  /**
   * Scrape page using Puppeteer (handles JS-heavy sites)
   */
  async scrapePage(url: string, options?: ScrapeOptions): Promise<ScrapedContent> {
    this.logger.log(`Scraping page via Puppeteer: ${url}`);

    const timeout = options?.timeout || this.DEFAULT_TIMEOUT;
    let page: Page | null = null;

    try {
      const browser = await this.getBrowser();
      page = await browser.newPage();

      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 });

      // Set timeout
      page.setDefaultTimeout(timeout);

      // Navigate to page
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout,
      });

      // Wait for specific selector if provided
      if (options?.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: 5000 }).catch(() => {
          this.logger.warn(`Selector ${options.waitForSelector} not found, continuing anyway`);
        });
      }

      // Extract content
      const html = await page.content();
      const title = await page.title();
      const text = await page.evaluate(() => document.body.innerText || '');

      // Count images and potential product elements
      const imagesFound = await page.$$eval('img', (imgs) => imgs.length);
      const productsFound = await page.$$eval(
        '[data-product], .product, [itemtype*="Product"]',
        (elements) => elements.length,
      );

      await page.close();

      return {
        html,
        text,
        title,
        productsFound,
        imagesFound,
        statusCode: 200,
        method: 'puppeteer',
      };
    } catch (error) {
      if (page) {
        await page.close().catch(() => {});
      }

      this.logger.error(`Puppeteer scraping failed for ${url}`, error.stack);
      throw new Error(`Failed to scrape page: ${error.message}`);
    }
  }

  /**
   * Capture screenshot of page
   */
  async captureScreenshot(
    url: string,
    viewport?: Viewport,
  ): Promise<Buffer> {
    this.logger.log(`Capturing screenshot: ${url}`);

    let page: Page | null = null;

    try {
      const browser = await this.getBrowser();
      page = await browser.newPage();

      // Set viewport
      await page.setViewport(viewport || { width: 1920, height: 1080 });

      // Navigate to page
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.DEFAULT_TIMEOUT,
      });

      // Capture screenshot
      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 85,
        fullPage: false, // Only visible viewport
      });

      await page.close();

      this.logger.log(`Screenshot captured: ${screenshot.length} bytes`);
      return screenshot as Buffer;
    } catch (error) {
      if (page) {
        await page.close().catch(() => {});
      }

      this.logger.error(`Screenshot capture failed for ${url}`, error.stack);
      throw new Error(`Failed to capture screenshot: ${error.message}`);
    }
  }

  /**
   * Determine if page is JavaScript-heavy based on HTML content
   * Used to decide between HTTP fetch and Puppeteer
   */
  detectJsHeavyPage(html: string): boolean {
    // Check for SPA frameworks
    const spaIndicators = [
      'react',
      'vue',
      'angular',
      'ng-app',
      'data-reactroot',
      '__NEXT_DATA__',
      '__nuxt',
    ];

    const lowerHtml = html.toLowerCase();
    const hasSpaPatterner = spaIndicators.some((indicator) =>
      lowerHtml.includes(indicator.toLowerCase()),
    );

    // Check if HTML is minimal (likely client-side rendered)
    const bodyContent = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || '';
    const bodyText = this.extractTextFromHtml(bodyContent).trim();
    const isMinimalContent = bodyText.length < 200;

    // Check for heavy script usage
    const scriptTags = (html.match(/<script/gi) || []).length;
    const isScriptHeavy = scriptTags > 5;

    return hasSpaPatterner || (isMinimalContent && isScriptHeavy);
  }

  /**
   * Extract plain text from HTML
   */
  private extractTextFromHtml(html: string): string {
    // Remove scripts and styles
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');

    // Normalize whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  /**
   * Extract title from HTML
   */
  private extractTitleFromHtml(html: string): string {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return titleMatch ? titleMatch[1].trim() : '';
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy() {
    this.logger.log('Shutting down web scraping service...');
    this.isShuttingDown = true;

    for (const browser of this.browserPool) {
      try {
        await browser.close();
      } catch (error) {
        this.logger.error('Error closing browser', error);
      }
    }

    this.browserPool = [];
    this.logger.log('Web scraping service shut down');
  }
}
