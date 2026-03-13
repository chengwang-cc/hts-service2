import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { load, type CheerioAPI } from 'cheerio';
import puppeteer, { type Page } from 'puppeteer';
import { OpenAiService } from '@hts/core';
import type {
  ResponseInput,
  ResponseInputImage,
  ResponseInputText,
} from 'openai/resources/responses/responses';
import {
  ClassifyUrlResponseDto,
  UrlType,
  UrlMetadata,
  UrlProductCandidate,
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

interface StructuredProductData {
  name?: string;
  description?: string;
  image?: string;
  price?: string;
  currency?: string;
}

interface ProductCandidate extends StructuredProductData {
  source: 'structured-data' | 'dom';
}

interface PageFetchResult {
  html: string;
  method: 'http' | 'puppeteer';
  renderedTitle?: string;
  renderedText?: string;
  screenshot?: Buffer | null;
  primaryImageUrl?: string | null;
}

interface ExtractedProductDetails {
  productName?: string;
  description?: string;
  extractionMethod: string;
  usedVision: boolean;
}

interface AiProductExtraction {
  productName: string | null;
  description: string | null;
  isProductPage: boolean;
  confidence: number;
}

@Injectable()
export class UrlClassifierService {
  private readonly logger = new Logger(UrlClassifierService.name);

  private readonly BLOCKED_HOSTS = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^::1$/,
    /^fe80:/,
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

  private readonly PRODUCT_SELECTORS = [
    '[itemtype*="Product"]',
    '[data-product-id]',
    '.product',
    '.product-detail',
    '.product-info',
    '.product-description',
    '#productDescription',
    '#feature-bullets',
    '[itemprop="name"]',
    '[itemprop="description"]',
    '[itemprop="price"]',
  ];

  private readonly MAX_HTML_SIZE = 5 * 1024 * 1024;
  private readonly REQUEST_TIMEOUT = 8000;
  private readonly browserEnabled: boolean;

  constructor(
    private readonly httpService: HttpService,
    private readonly openAiService: OpenAiService,
  ) {
    this.browserEnabled =
      (process.env.WEB_SCRAPING_DISABLED ?? 'false') !== 'true' &&
      !process.env.JEST_WORKER_ID &&
      process.env.NODE_ENV !== 'test';
  }

  async classifyUrl(url: string): Promise<ClassifyUrlResponseDto> {
    try {
      if (!this.isAllowedUrl(url)) {
        return {
          type: UrlType.INVALID,
          error: 'URL not allowed (internal/private addresses blocked)',
        };
      }

      if (this.isImageExtension(url)) {
        this.logger.log(`Direct image URL detected by pathname: ${url}`);
        return {
          type: UrlType.IMAGE,
          imageUrl: url,
        };
      }

      const contentType = await this.getContentType(url);
      if (contentType?.startsWith('image/')) {
        this.logger.log(`Image URL detected by Content-Type: ${url}`);
        return {
          type: UrlType.IMAGE,
          imageUrl: url,
        };
      }

      let page = await this.fetchHtmlOverHttp(url);
      let ogData = this.extractOpenGraph(page.html, url);
      let structuredCandidates = this.extractStructuredProductCandidates(
        page.html,
        url,
      );
      let structuredData = structuredCandidates[0] ?? null;

      if (
        page.method === 'http' &&
        this.shouldUseBrowserFallback(page.html, ogData, structuredData)
      ) {
        const renderedPage = await this.fetchHtmlWithPuppeteer(url);
        if (renderedPage) {
          page = renderedPage;
          ogData = this.extractOpenGraph(page.html, url);
          structuredCandidates = this.extractStructuredProductCandidates(
            page.html,
            url,
          );
          structuredData = structuredCandidates[0] ?? null;
        }
      }

      const productCandidates = this.extractProductCandidates(
        page.html,
        url,
        structuredCandidates,
      );

      const isProductPage = this.detectProductPage(
        page.html,
        ogData,
        structuredData ?? undefined,
      );
      const extracted = await this.extractProductDetails(
        page.html,
        ogData,
        structuredData,
        page,
      );

      const isMultiProductPage = productCandidates.length > 1;

      const metadata: UrlMetadata = {
        title: structuredData?.name || ogData.title || page.renderedTitle,
        description:
          structuredData?.description ||
          extracted.description ||
          ogData.description,
        siteName: ogData.siteName,
        productName:
          extracted.productName ||
          structuredData?.name ||
          ogData.title ||
          page.renderedTitle,
        price: structuredData?.price || ogData.price,
        currency: structuredData?.currency || ogData.currency,
        extractionMethod: extracted.extractionMethod,
        usedBrowser: page.method === 'puppeteer',
        usedVision: extracted.usedVision,
        renderedImageUrl: page.primaryImageUrl ?? undefined,
        isMultiProductPage,
        productCount: productCandidates.length || undefined,
        productCandidates:
          isMultiProductPage
            ? productCandidates.map((candidate) => ({
                productName: candidate.name,
                description: candidate.description,
                imageUrl: candidate.image,
                price: candidate.price,
                currency: candidate.currency,
                source: candidate.source,
              }))
            : undefined,
      };

      const imageUrl =
        isMultiProductPage
          ? undefined
          : structuredData?.image || ogData.image || page.primaryImageUrl || undefined;
      const responseType = isMultiProductPage
        ? UrlType.WEBPAGE
        : isProductPage
          ? UrlType.PRODUCT
          : UrlType.WEBPAGE;

      if (imageUrl) {
        return {
          type: responseType,
          imageUrl,
          metadata,
        };
      }

      if (this.isUsefulDescription(metadata.description)) {
        return {
          type: responseType,
          metadata,
        };
      }

      if (!isProductPage) {
        return {
          type: UrlType.INVALID,
          error:
            'This does not appear to be a product page. Please use a direct product URL.',
        };
      }

      return {
        type: UrlType.INVALID,
        error: 'No image or product description found on this webpage',
      };
    } catch (error) {
      this.logger.error(
        `URL classification failed: ${error.message}`,
        error.stack,
      );

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
      if (error.response?.status === 429) {
        return { type: UrlType.INVALID, error: 'Access rate limited by source website' };
      }

      return {
        type: UrlType.INVALID,
        error: 'Failed to analyze URL. Please try again.',
      };
    }
  }

  private isImageExtension(url: string): boolean {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      return this.IMAGE_EXTENSIONS.some((ext) => pathname.endsWith(ext));
    } catch {
      return false;
    }
  }

  private isAllowedUrl(url: string): boolean {
    try {
      const parsed = new URL(url);

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }

      if (process.env.ALLOW_LOCALHOST_URLS === 'true') {
        this.logger.debug(`Allowing localhost URL for testing: ${url}`);
        return true;
      }

      const hostname = parsed.hostname;
      return !this.BLOCKED_HOSTS.some((pattern) => {
        if (typeof pattern === 'string') {
          return hostname === pattern;
        }
        return pattern.test(hostname);
      });
    } catch {
      return false;
    }
  }

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
    } catch (headError) {
      this.logger.debug(`HEAD request failed for ${url}: ${headError.message}`);
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          timeout: 5000,
          maxRedirects: 5,
          validateStatus: (status) => status < 400,
          responseType: 'stream',
        }),
      );

      const contentType = response.headers['content-type']?.split(';')[0] || null;
      response.data?.destroy?.();
      return contentType;
    } catch (error) {
      this.logger.debug(`GET probe failed for ${url}: ${error.message}`);
      return null;
    }
  }

  private async fetchHtmlOverHttp(url: string): Promise<PageFetchResult> {
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
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            DNT: '1',
            Connection: 'keep-alive',
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
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      return {
        html: response.data,
        method: 'http',
      };
    } catch (error) {
      if (this.shouldRetryInBrowser(error)) {
        const rendered = await this.fetchHtmlWithPuppeteer(url);
        if (rendered) {
          return rendered;
        }
      }

      this.logger.error(`Failed to fetch HTML from ${url}: ${error.message}`);
      throw error;
    }
  }

  private shouldRetryInBrowser(error: any): boolean {
    if (!this.browserEnabled) {
      return false;
    }

    const status = error?.response?.status;
    return (
      status === 403 ||
      status === 429 ||
      status === 503 ||
      error?.code === 'ECONNABORTED' ||
      error?.message?.includes('Unsupported content type')
    );
  }

  private async fetchHtmlWithPuppeteer(
    url: string,
  ): Promise<PageFetchResult | null> {
    if (!this.browserEnabled) {
      this.logger.warn(
        `Puppeteer fallback requested for ${url} but browser mode is disabled`,
      );
      return null;
    }

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
      await page.setViewport({ width: 1440, height: 1600 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      );
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: Math.max(this.REQUEST_TIMEOUT, 12_000),
      });

      await this.dismissCookieBanners(page);
      await this.waitForProductSignals(page);
      await this.autoScroll(page);
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 4000 }).catch(
        () => undefined,
      );

      const html = await page.content();
      const renderedTitle = await page.title();
      const renderedText = await page.evaluate(() =>
        (document.body?.innerText || '').replace(/\s+/g, ' ').trim(),
      );
      const primaryImageUrl = await page.evaluate(() => {
        const images = Array.from(document.images)
          .map((img) => {
            const rect = img.getBoundingClientRect();
            return {
              src: img.currentSrc || img.src || '',
              area: Math.max(rect.width, img.naturalWidth || 0) *
                Math.max(rect.height, img.naturalHeight || 0),
            };
          })
          .filter((img) => img.src && img.area > 40_000)
          .sort((a, b) => b.area - a.area);

        return images[0]?.src || null;
      });
      const screenshot = Buffer.from(
        await page.screenshot({
          type: 'jpeg',
          quality: 65,
          fullPage: false,
        }),
      );

      await page.close();

      this.logger.log(
        `Fetched rendered page with Puppeteer (${html.length} bytes)`,
      );

      return {
        html,
        method: 'puppeteer',
        renderedTitle,
        renderedText,
        screenshot,
        primaryImageUrl,
      };
    } catch (error) {
      this.logger.error(
        `Puppeteer failed to fetch ${url}: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  private async dismissCookieBanners(page: Page): Promise<void> {
    await page
      .evaluate(() => {
        const patterns = [
          'accept',
          'accept all',
          'agree',
          'allow all',
          'got it',
          'continue',
        ];
        const isVisible = (element: Element) => {
          const rect = (element as HTMLElement).getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const candidates = Array.from(
          document.querySelectorAll('button, [role="button"], a'),
        );
        for (const candidate of candidates) {
          const text = candidate.textContent?.trim().toLowerCase() || '';
          if (text && patterns.some((pattern) => text === pattern || text.includes(pattern))) {
            if (isVisible(candidate)) {
              (candidate as HTMLElement).click();
            }
          }
        }
      })
      .catch(() => undefined);
  }

  private async waitForProductSignals(page: Page): Promise<void> {
    const selector = this.PRODUCT_SELECTORS.join(', ');
    await page.waitForSelector(selector, { timeout: 4000 }).catch(() => undefined);
  }

  private async autoScroll(page: Page): Promise<void> {
    await page
      .evaluate(async () => {
        for (let index = 0; index < 4; index += 1) {
          window.scrollTo({
            top: Math.min(
              document.body.scrollHeight,
              Math.round(window.innerHeight * (index + 1) * 0.8),
            ),
            behavior: 'auto',
          });
          await new Promise((resolve) => setTimeout(resolve, 450));
        }
        window.scrollTo({ top: 0, behavior: 'auto' });
      })
      .catch(() => undefined);
  }

  private extractOpenGraph(html: string, sourceUrl: string): OpenGraphData {
    const $ = load(html);
    const ogData: OpenGraphData = {};

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

    ogData.image = this.normalizeResolvedUrl(
      $('meta[property="og:image"]').attr('content') ||
        $('meta[property="og:image:url"]').attr('content') ||
        $('meta[name="twitter:image"]').attr('content') ||
        undefined,
      sourceUrl,
    );

    ogData.siteName =
      $('meta[property="og:site_name"]').attr('content') || undefined;

    ogData.type = $('meta[property="og:type"]').attr('content') || undefined;

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

  private detectProductPage(
    html: string,
    ogData: OpenGraphData,
    structuredData?: StructuredProductData,
  ): boolean {
    if (ogData.type === 'product') {
      return true;
    }

    if (
      structuredData?.name ||
      structuredData?.description ||
      structuredData?.price ||
      structuredData?.currency
    ) {
      return true;
    }

    if (ogData.price || ogData.currency) {
      return true;
    }

    const $ = load(html);
    $('script, style, noscript, template').remove();
    const sanitizedHtml = $.html();

    const productIndicators = [
      /<meta property="product:/i,
      /<script type="application\/ld\+json">.*"@type":\s*"Product"/is,
      /id="dp-container"/i,
      /data-product-id/i,
      /class="[^"]*product[^"]*"/i,
      /<button[^>]*add[^>]*cart/i,
      /<button[^>]*buy[^>]*now/i,
      /class="[^"]*price[^"]*"/i,
      /itemprop="price"/i,
    ];

    return productIndicators.some((pattern) => pattern.test(sanitizedHtml));
  }

  private shouldUseBrowserFallback(
    html: string,
    ogData: OpenGraphData,
    structuredData: StructuredProductData | null,
  ): boolean {
    if (!this.browserEnabled) {
      return false;
    }

    const $ = load(html);
    const scriptCount = $('script').length;
    $('script, style, noscript, template').remove();
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    const hasShellMarkers =
      /id="__next"|id="root"|data-reactroot|__NUXT__|window\.__INITIAL_STATE__|<noscript>/i.test(
        html,
      );
    const lacksSignals =
      !ogData.title &&
      !ogData.description &&
      !ogData.image &&
      !structuredData?.name &&
      !structuredData?.description;

    return (
      bodyText.length < 180 ||
      (lacksSignals && scriptCount > 8) ||
      (lacksSignals && hasShellMarkers)
    );
  }

  private async extractProductDetails(
    html: string,
    ogData: OpenGraphData,
    structuredData: StructuredProductData | null,
    page: PageFetchResult,
  ): Promise<ExtractedProductDetails> {
    if (this.isUsefulDescription(structuredData?.description)) {
      return {
        productName: structuredData?.name || ogData.title,
        description: structuredData?.description,
        extractionMethod: 'structured-data',
        usedVision: false,
      };
    }

    if (this.isUsefulDescription(ogData.description) && ogData.type === 'product') {
      return {
        productName: structuredData?.name || ogData.title,
        description: ogData.description,
        extractionMethod: 'open-graph',
        usedVision: false,
      };
    }

    const $ = load(html);
    const combinedText = this.extractFocusedProductText(
      $,
      ogData,
      structuredData,
      page.renderedText,
    );

    if (!combinedText) {
      return {
        productName: structuredData?.name || ogData.title || page.renderedTitle,
        extractionMethod: 'none',
        usedVision: false,
      };
    }

    const aiExtraction = await this.extractProductDetailsWithAi(
      combinedText,
      page.screenshot ?? null,
      {
        pageTitle: page.renderedTitle || ogData.title,
        siteName: ogData.siteName,
      },
    );

    if (this.isUsefulDescription(aiExtraction?.description ?? undefined)) {
      return {
        productName:
          aiExtraction?.productName ||
          structuredData?.name ||
          ogData.title ||
          page.renderedTitle,
        description: aiExtraction?.description || undefined,
        extractionMethod: page.screenshot ? 'rendered-page-ai' : 'html-ai',
        usedVision: Boolean(page.screenshot),
      };
    }

    return {
      productName: structuredData?.name || ogData.title || page.renderedTitle,
      extractionMethod: 'selector-text',
      usedVision: false,
    };
  }

  private extractProductCandidates(
    html: string,
    sourceUrl: string,
    structuredCandidates: StructuredProductData[],
  ): ProductCandidate[] {
    const deduped = new Map<string, ProductCandidate>();
    const addCandidate = (candidate: ProductCandidate) => {
      const normalizedName = candidate.name?.replace(/\s+/g, ' ').trim();
      const normalizedDescription = candidate.description
        ?.replace(/\s+/g, ' ')
        .trim();

      if (!normalizedName || !this.looksLikeProductName(normalizedName)) {
        return;
      }

      if (
        !normalizedDescription ||
        !this.isUsefulDescription(normalizedDescription)
      ) {
        return;
      }

      const key = normalizedName.toLowerCase();
      if (deduped.has(key)) {
        return;
      }

      deduped.set(key, {
        name: normalizedName,
        description: normalizedDescription,
        image: this.normalizeResolvedUrl(candidate.image, sourceUrl),
        price: candidate.price,
        currency: candidate.currency,
        source: candidate.source,
      });
    };

    for (const candidate of structuredCandidates) {
      addCandidate({
        ...candidate,
        source: 'structured-data',
      });
    }

    if (deduped.size < 2) {
      const $ = load(html);
      const cardSelectors = [
        '[itemtype*="Product"]',
        '[data-product-id]',
        '.product-card',
        '.product',
        'article.product',
        'li.product',
      ];

      for (const selector of cardSelectors) {
        $(selector).each((_, element) => {
          const card = $(element);
          const name =
            card.find('[itemprop="name"], h1, h2, h3, .product-name, .product-title')
              .first()
              .text()
              .replace(/\s+/g, ' ')
              .trim() || undefined;
          const description =
            card
              .find(
                '[itemprop="description"], .product-description, .description, p',
              )
              .first()
              .text()
              .replace(/\s+/g, ' ')
              .trim() || undefined;
          const image = this.normalizeResolvedUrl(
            card.find('img').first().attr('src') || undefined,
            sourceUrl,
          );
          const price =
            card
              .find('[itemprop="price"], .price, [data-price]')
              .first()
              .text()
              .replace(/\s+/g, ' ')
              .trim() || undefined;
          const currency =
            card.find('[itemprop="priceCurrency"]').attr('content') ||
            undefined;

          addCandidate({
            name,
            description,
            image,
            price,
            currency,
            source: 'dom',
          });
        });

        if (deduped.size > 1) {
          break;
        }
      }
    }

    return Array.from(deduped.values()).slice(0, 20);
  }

  private extractFocusedProductText(
    $: CheerioAPI,
    ogData: OpenGraphData,
    structuredData: StructuredProductData | null,
    renderedText?: string,
  ): string {
    const productTexts: string[] = [];

    if (structuredData?.name) {
      productTexts.push(`Product name: ${structuredData.name}`);
    }
    if (ogData.title) {
      productTexts.push(`Title: ${ogData.title}`);
    }
    if (structuredData?.description) {
      productTexts.push(`Structured description: ${structuredData.description}`);
    }

    for (const selector of this.PRODUCT_SELECTORS.concat(['h1'])) {
      const element = $(selector).first();
      if (element.length === 0) {
        continue;
      }

      const text = element.text().replace(/\s+/g, ' ').trim();
      if (text.length > 20 && text.length < 2500) {
        productTexts.push(text);
      }

      if (productTexts.join(' ').length > 1800) {
        break;
      }
    }

    if (renderedText) {
      productTexts.push(renderedText.substring(0, 2000));
    }

    const combinedText = productTexts
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 3500);

    return combinedText.length >= 50 ? combinedText : '';
  }

  private async extractProductDetailsWithAi(
    combinedText: string,
    screenshot: Buffer | null,
    context: { pageTitle?: string; siteName?: string },
  ): Promise<AiProductExtraction | null> {
    try {
      const promptText = [
        'Extract product information from this rendered product page.',
        'Focus on the actual product being sold or described.',
        'Ignore cookie banners, navigation, shipping notices, upsells, and unrelated recommendations.',
        context.pageTitle ? `Page title: ${context.pageTitle}` : '',
        context.siteName ? `Site name: ${context.siteName}` : '',
        '',
        'Relevant page text:',
        combinedText,
      ]
        .filter(Boolean)
        .join('\n');

      const inputParts: Array<ResponseInputText | ResponseInputImage> = [
        {
          type: 'input_text',
          text: promptText,
        },
      ];

      if (screenshot) {
        inputParts.push({
          type: 'input_image',
          image_url: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
          detail: 'auto',
        });
      }

      const input: ResponseInput = [
        {
          type: 'message',
          role: 'user',
          content: inputParts,
        },
      ];

      const response = await this.openAiService.response(input, {
        model: screenshot ? 'gpt-4o' : 'gpt-5-mini',
        instructions:
          'You extract product names and customs-ready descriptions from ecommerce pages. Be precise, terse, and ignore page chrome.',
        store: false,
        text: {
          format: {
            type: 'json_schema',
            name: 'url_product_extraction',
            schema: {
              type: 'object',
              properties: {
                productName: { type: ['string', 'null'] },
                description: { type: ['string', 'null'] },
                isProductPage: { type: 'boolean' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: [
                'productName',
                'description',
                'isProductPage',
                'confidence',
              ],
              additionalProperties: false,
            },
            strict: true,
          },
        },
      });

      const outputText = (response as any).output_text?.trim();
      if (!outputText) {
        return null;
      }

      return JSON.parse(outputText) as AiProductExtraction;
    } catch (error) {
      this.logger.error(
        `Failed to extract description with AI: ${error.message}`,
      );
      return null;
    }
  }

  private extractStructuredProductCandidates(
    html: string,
    sourceUrl: string,
  ): StructuredProductData[] {
    const $ = load(html);
    const scripts = $('script[type="application/ld+json"]');
    const candidates: StructuredProductData[] = [];
    const seen = new Set<string>();

    for (let index = 0; index < scripts.length; index += 1) {
      try {
        const jsonText = $(scripts[index]).html();
        if (!jsonText) {
          continue;
        }

        const parsed = JSON.parse(jsonText);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const queue = [...items];

        while (queue.length > 0) {
          const item = queue.shift();
          if (!item || typeof item !== 'object') {
            continue;
          }

          if (Array.isArray(item['@graph'])) {
            queue.push(...item['@graph']);
          }

          const itemType = Array.isArray(item['@type'])
            ? item['@type'].join(' ')
            : item['@type'];

          if (
            typeof itemType === 'string' &&
            itemType.toLowerCase().includes('product')
          ) {
            const offers = Array.isArray(item.offers)
              ? item.offers[0]
              : item.offers || {};
            const imageValue = Array.isArray(item.image)
              ? item.image[0]
              : item.image;
            const candidate = {
              name: this.asTrimmedString(item.name),
              description: this.asTrimmedString(item.description),
              image: this.normalizeResolvedUrl(
                this.asTrimmedString(imageValue),
                sourceUrl,
              ),
              price: this.asTrimmedString(
                item.price || offers?.price || item.lowPrice,
              ),
              currency: this.asTrimmedString(
                item.priceCurrency || offers?.priceCurrency,
              ),
            };
            const key = candidate.name?.toLowerCase();
            if (key && !seen.has(key)) {
              seen.add(key);
              candidates.push(candidate);
            }
          }
        }
      } catch {
        continue;
      }
    }

    return candidates;
  }

  private asTrimmedString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : undefined;
  }

  private normalizeResolvedUrl(
    value: string | undefined,
    sourceUrl: string,
  ): string | undefined {
    if (!value) {
      return undefined;
    }

    try {
      return new URL(value, sourceUrl).toString();
    } catch {
      return undefined;
    }
  }

  private isUsefulDescription(value: string | undefined): boolean {
    if (!value) {
      return false;
    }

    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length < 30) {
      return false;
    }

    const genericPatterns = [
      /^shop now/i,
      /^buy now/i,
      /^learn more/i,
      /^click here/i,
    ];

    return !genericPatterns.some((pattern) => pattern.test(normalized));
  }

  private looksLikeProductName(value: string): boolean {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length < 4 || normalized.length > 160) {
      return false;
    }

    const rejectPatterns = [
      /^shop\b/i,
      /^home\b/i,
      /^products?\b/i,
      /^collections?\b/i,
      /^featured\b/i,
      /^all products\b/i,
      /^view all\b/i,
    ];

    return !rejectPatterns.some((pattern) => pattern.test(normalized));
  }
}
