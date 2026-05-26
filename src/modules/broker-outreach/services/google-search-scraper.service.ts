import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Browser } from 'puppeteer';

/**
 * Google Search POC scraper. Replaces the Google Places API path so the
 * outreach module does not require a paid API key. Puppeteer drives a
 * headless Chromium against the public Google Search results page and
 * extracts organic result titles / URLs / snippets.
 *
 * This is a POC: respect Google's terms of service before enabling in
 * production. Gated by BROKER_OUTREACH_GOOGLE_SCRAPER_ENABLED=true so
 * test/dev runs do not silently start a browser.
 */
export interface GoogleSearchScrapeOptions {
  query: string;
  limit?: number;
  languageCode?: string;
  countryCode?: string;
  /** Inject a pre-built browser (tests). */
  browser?: Browser;
}

export interface GoogleSearchResult {
  title: string;
  url: string;
  snippet: string | null;
  displayedHost: string | null;
}

@Injectable()
export class GoogleSearchScraperService {
  private readonly logger = new Logger(GoogleSearchScraperService.name);

  /**
   * Run a Google Search and return parsed organic results. Throws
   * BadRequestException when the scraper feature flag is off so callers
   * see a clear error instead of a runtime crash trying to launch a
   * browser.
   */
  async search(
    options: GoogleSearchScrapeOptions,
  ): Promise<GoogleSearchResult[]> {
    const enabled =
      process.env.BROKER_OUTREACH_GOOGLE_SCRAPER_ENABLED === 'true';
    if (!enabled && !options.browser) {
      throw new BadRequestException(
        'Google Search scraper disabled. Set BROKER_OUTREACH_GOOGLE_SCRAPER_ENABLED=true to enable.',
      );
    }
    const limit = Math.max(1, Math.min(20, options.limit ?? 10));
    const url = this.buildSearchUrl(options);

    const externalBrowser = !!options.browser;
    let browser = options.browser;
    try {
      if (!browser) {
        const puppeteer = await import('puppeteer');
        browser = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
          ],
        });
      }
      const page = await browser.newPage();
      try {
        await page.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        );
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
        const results = (await page.evaluate(() => {
          const items: Array<{
            title: string;
            url: string;
            snippet: string | null;
            displayedHost: string | null;
          }> = [];
          const blocks = Array.from(
            document.querySelectorAll('div.g, div[data-hveid]'),
          );
          for (const block of blocks) {
            const anchor = block.querySelector('a[href^="http"]');
            const titleEl = block.querySelector('h3');
            if (!anchor || !titleEl) continue;
            const href = (anchor as HTMLAnchorElement).href;
            if (!href || href.startsWith('https://www.google.')) continue;
            const snippetEl = block.querySelector(
              'div[data-sncf="1"], span.aCOpRe, div.VwiC3b',
            );
            const hostEl = block.querySelector('cite');
            items.push({
              title: titleEl.textContent?.trim() ?? '',
              url: href,
              snippet: snippetEl?.textContent?.trim() ?? null,
              displayedHost: hostEl?.textContent?.trim() ?? null,
            });
          }
          return items;
        })) as GoogleSearchResult[];
        const deduped = dedupeByUrl(results).slice(0, limit);
        this.logger.log(
          `google-search.scraped query="${options.query}" results=${deduped.length}`,
        );
        return deduped;
      } finally {
        await page.close();
      }
    } catch (e: any) {
      this.logger.warn(`google-search.failed: ${e?.message ?? e}`);
      throw new BadRequestException(
        `Google Search scrape failed: ${e?.message ?? e}`,
      );
    } finally {
      if (!externalBrowser && browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  private buildSearchUrl(options: GoogleSearchScrapeOptions): string {
    const params = new URLSearchParams({
      q: options.query,
      num: String(Math.max(1, Math.min(20, options.limit ?? 10))),
    });
    if (options.languageCode) params.set('hl', options.languageCode);
    if (options.countryCode) params.set('gl', options.countryCode);
    return `https://www.google.com/search?${params.toString()}`;
  }
}

function dedupeByUrl(results: GoogleSearchResult[]): GoogleSearchResult[] {
  const seen = new Set<string>();
  const out: GoogleSearchResult[] = [];
  for (const r of results) {
    if (!r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}
