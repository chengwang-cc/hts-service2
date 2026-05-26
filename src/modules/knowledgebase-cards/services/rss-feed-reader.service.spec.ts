import { RssFeedReaderService } from './rss-feed-reader.service';

/**
 * M6 long-term (deep-review 2026-05-27): exercises the fast-xml-parser
 * migration. The prior regex-based implementation silently returned []
 * on feeds with namespaces or CDATA — these tests prove the new parser
 * handles them.
 */
describe('RssFeedReaderService.parseFeed', () => {
  const svc = new RssFeedReaderService();

  it('parses a vanilla RSS 2.0 feed', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Federal Register</title>
          <item>
            <title>Proc 10895</title>
            <link>https://example.gov/p10895</link>
            <pubDate>Wed, 12 Mar 2025 12:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Proc 10896</title>
            <link>https://example.gov/p10896</link>
            <pubDate>Wed, 12 Mar 2025 13:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`;
    const items = svc.parseFeed(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      url: 'https://example.gov/p10895',
      title: 'Proc 10895',
    });
    expect(items[0].publishedAt?.getUTCFullYear()).toBe(2025);
  });

  it('parses an Atom feed with link[@href]', () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>CBP CSMS</title>
        <entry>
          <title>CSMS 65340246</title>
          <link href="https://csms.example.gov/65340246"/>
          <updated>2025-06-28T00:00:00Z</updated>
        </entry>
      </feed>`;
    const items = svc.parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://csms.example.gov/65340246');
  });

  it('handles CDATA-wrapped titles (the regex parser silently dropped these)', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <item>
          <title><![CDATA[Russia 200% derivative & sanctions]]></title>
          <link>https://example.gov/csms-65340246</link>
        </item>
      </channel></rss>`;
    const items = svc.parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Russia 200% derivative & sanctions');
  });

  it('handles namespaced elements via removeNSPrefix', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <channel>
          <atom:link href="https://example.gov/self" rel="self"/>
          <item>
            <title>Item with namespaced date</title>
            <link>https://example.gov/x</link>
            <dc:date>2025-12-01T00:00:00Z</dc:date>
          </item>
        </channel>
      </rss>`;
    const items = svc.parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://example.gov/x');
    expect(items[0].publishedAt?.getUTCFullYear()).toBe(2025);
  });

  it('returns [] on garbage input without throwing', () => {
    expect(svc.parseFeed('not xml at all')).toEqual([]);
    expect(svc.parseFeed('')).toEqual([]);
  });

  it('respects the limit argument', () => {
    const item = (i: number) =>
      `<item><title>T${i}</title><link>https://example.gov/${i}</link></item>`;
    const xml = `<rss><channel>${Array.from({ length: 10 }, (_, i) => item(i)).join('')}</channel></rss>`;
    expect(svc.parseFeed(xml, 3)).toHaveLength(3);
  });

  it('prefers alternate link when multiple atom links are present', () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>Multi-link entry</title>
          <link href="https://example.gov/self" rel="self"/>
          <link href="https://example.gov/alt" rel="alternate"/>
        </entry>
      </feed>`;
    const items = svc.parseFeed(xml);
    expect(items[0].url).toBe('https://example.gov/alt');
  });
});
