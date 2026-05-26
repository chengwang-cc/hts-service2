import { Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

/**
 * RssFeedReaderService.
 *
 * Parses RSS 2.0 and Atom 1.0 feeds via `fast-xml-parser`, which handles
 * CDATA, namespaces, and character entities that the prior regex-based
 * implementation silently dropped (M6 follow-up from the 2026-05-27
 * deep code review).
 *
 * Returns at most `limit` items. Tolerates malformed feeds — returns an
 * empty array rather than throwing — but emits a WARN so an operator
 * can alert on the `feed.parsed-empty` signal.
 */
export interface FeedItem {
  url: string;
  title?: string;
  publishedAt?: Date;
}

@Injectable()
export class RssFeedReaderService {
  private readonly logger = new Logger(RssFeedReaderService.name);
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    cdataPropName: '__cdata',
    parseAttributeValue: false,
    trimValues: true,
    // Force <item> and <entry> into arrays so single-item feeds parse
    // consistently with multi-item feeds.
    isArray: (name) => name === 'item' || name === 'entry',
    // Strip XML namespace prefixes so `<dc:date>` becomes `date`,
    // `<atom:link>` becomes `link`, etc. — keeps the downstream
    // accessors simple.
    removeNSPrefix: true,
  });

  /**
   * Fetch a feed URL and parse to `FeedItem[]`. Empty array on any
   * fetch / parse failure (logged + returned).
   */
  async fetchFeed(url: string, limit = 50): Promise<FeedItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        this.logger.warn(`feed ${url} returned HTTP ${res.status}`);
        return [];
      }
      const body = await res.text();
      const items = this.parseFeed(body, limit);
      // M6 (2026-05-26): a non-trivial body that parses to 0 items is the
      // silent-failure mode the review flagged. Emit a WARN so an
      // operator can alert on `feed.parsed-empty`.
      if (items.length === 0 && body.trim().length > 200) {
        this.logger.warn(
          `feed.parsed-empty url=${url} bytes=${body.length} — fetched OK but yielded 0 items`,
        );
      }
      return items;
    } catch (e: any) {
      this.logger.warn(`feed ${url} fetch failed: ${e?.message ?? e}`);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Parse a feed body string. Exported separately so tests can pin input. */
  parseFeed(body: string, limit = 50): FeedItem[] {
    let parsed: any;
    try {
      parsed = this.parser.parse(body);
    } catch (e: any) {
      this.logger.warn(`parseFeed: XML error: ${e?.message ?? e}`);
      return [];
    }

    // RSS 2.0: <rss><channel><item>…</item></channel></rss>
    // Some feeds drop the <rss> wrapper and put <channel> at the root.
    const channel = parsed?.rss?.channel ?? parsed?.channel;
    if (channel?.item?.length) {
      return this.toItems(channel.item, 'rss').slice(0, limit);
    }

    // Atom 1.0: <feed><entry>…</entry></feed>
    const feed = parsed?.feed;
    if (feed?.entry?.length) {
      return this.toItems(feed.entry, 'atom').slice(0, limit);
    }

    return [];
  }

  private toItems(rawItems: any[], kind: 'rss' | 'atom'): FeedItem[] {
    const out: FeedItem[] = [];
    for (const raw of rawItems) {
      const url = this.extractLink(raw, kind);
      if (!url) continue;
      const title = unwrapText(raw.title);
      const pubStr =
        kind === 'rss'
          ? (raw.pubDate ?? raw.date)
          : (raw.updated ?? raw.published);
      const publishedAt = pubStr ? parseDate(String(pubStr).trim()) : undefined;
      out.push({ url, title, publishedAt });
    }
    return out;
  }

  private extractLink(raw: any, kind: 'rss' | 'atom'): string | undefined {
    if (kind === 'rss') {
      // RSS link is element text: `<link>https://…</link>`.
      const link = raw.link;
      if (typeof link === 'string') return link.trim();
      if (link && typeof link === 'object' && '#text' in link) {
        return String((link as any)['#text']).trim();
      }
      return undefined;
    }
    // Atom: `<link href="…"/>` (attribute). May be a single object or an
    // array if multiple rel types are present — pick the `alternate` or
    // the first one without rel.
    const link = raw.link;
    if (Array.isArray(link)) {
      const alt = link.find(
        (l: any) => !l['@_rel'] || l['@_rel'] === 'alternate',
      );
      return alt?.['@_href']?.trim() ?? link[0]?.['@_href']?.trim();
    }
    if (link && typeof link === 'object') {
      return link['@_href']?.trim();
    }
    if (typeof link === 'string') return link.trim();
    return undefined;
  }
}

function unwrapText(s: unknown): string | undefined {
  if (s === undefined || s === null) return undefined;
  if (typeof s === 'string') return s.trim() || undefined;
  if (typeof s === 'object') {
    // CDATA wrapper from fast-xml-parser when cdataPropName is set.
    const obj = s as Record<string, unknown>;
    const cdata = obj['__cdata'];
    if (typeof cdata === 'string') return cdata.trim() || undefined;
    const text = obj['#text'];
    if (typeof text === 'string') return text.trim() || undefined;
  }
  return undefined;
}

function parseDate(s: string): Date | undefined {
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : undefined;
}
