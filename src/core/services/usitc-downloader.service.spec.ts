import { UsitcDownloaderService } from './usitc-downloader.service';

describe('UsitcDownloaderService.parseArchiveListing', () => {
  const svc = new UsitcDownloaderService();

  it('picks the largest (year, revision) tuple', () => {
    const html = `
      <ul>
        <li>2024 HTS Revision 3 (Apr 2, 2024)</li>
        <li>2025 HTS Revision 16 (Dec 31, 2025)</li>
        <li>2026 HTS Revision 8 (May 22, 2026)</li>
        <li>2026 HTS Revision 7 (Apr 3, 2026)</li>
      </ul>
    `;
    const latest = svc.parseArchiveListing(html);
    expect(latest).toEqual({
      year: 2026,
      revision: 8,
      releaseDate: 'May 22, 2026',
    });
  });

  it('handles double-digit revisions past 10 (regression for P1.4)', () => {
    const html = `
      <li>2027 HTS Revision 12 (Aug 30, 2027)</li>
      <li>2027 HTS Revision 9 (Jul 1, 2027)</li>
    `;
    const latest = svc.parseArchiveListing(html);
    expect(latest?.year).toBe(2027);
    expect(latest?.revision).toBe(12);
  });

  it('returns null for empty input', () => {
    expect(svc.parseArchiveListing('<html></html>')).toBeNull();
  });
});
