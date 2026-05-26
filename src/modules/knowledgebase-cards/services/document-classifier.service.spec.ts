import { DocumentClassifierService } from './document-classifier.service';

describe('DocumentClassifierService', () => {
  const svc = new DocumentClassifierService();

  it('classifies CSMS document by number', () => {
    const r = svc.classify({
      text: 'GUIDANCE: Section 232 Aluminum. CSMS # 55424218 — Country of Smelt and Cast reporting.',
    });
    expect(r.documentType).toBe('csms');
    expect(r.suggestedCardKey).toBe('cbp.csms.55424218');
    expect(r.jurisdiction).toBe('US');
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it('classifies Federal Register notice', () => {
    const r = svc.classify({
      text: 'See 90 FR 11251 for the implementation of Proclamation 10895.',
    });
    expect(r.documentType).toBe('fr-notice');
    expect(r.suggestedCardKey).toBe('fr.notice.90-11251');
  });

  it('classifies Presidential Proclamation', () => {
    const r = svc.classify({
      text: 'Proclamation 10895 of February 10, 2025 — Adjusting Imports of Aluminum into the United States.',
    });
    expect(r.documentType).toBe('proclamation');
    expect(r.suggestedCardKey).toBe('fr.proclamation.10895');
  });

  it('classifies EU regulation', () => {
    const r = svc.classify({
      text: 'Regulation (EU) 2023/956 of the European Parliament and of the Council...',
    });
    expect(r.documentType).toBe('eu-regulation');
    expect(r.suggestedCardKey).toBe('eu.regulation.2023-956');
    expect(r.jurisdiction).toBe('EU');
  });

  it('respects caller-supplied hint', () => {
    const r = svc.classify({
      text: 'random body',
      hint: { suggestedCardKey: 'custom.key.abc', documentType: 'other', jurisdiction: 'INTL' },
    });
    expect(r.suggestedCardKey).toBe('custom.key.abc');
    expect(r.matchedHeuristic).toBe('caller-hint');
    expect(r.confidence).toBe(1);
  });

  it('extracts effective date phrases', () => {
    const r = svc.classify({
      text: 'CSMS # 12345. This rule becomes effective March 12, 2025.',
    });
    expect(r.effectiveDate?.toISOString().slice(0, 10)).toBe('2025-03-12');
  });

  it('falls back to URL-derived key when nothing else matches', () => {
    const r = svc.classify({
      text: 'unrelated body text',
      url: 'https://example.com/some/path/here',
    });
    expect(r.documentType).toBe('other');
    expect(r.suggestedCardKey).toContain('example-com');
    expect(r.matchedHeuristic).toBeNull();
  });
});
