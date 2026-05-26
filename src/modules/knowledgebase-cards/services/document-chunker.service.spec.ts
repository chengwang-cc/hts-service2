import { DocumentChunkerService } from './document-chunker.service';

describe('DocumentChunkerService', () => {
  const svc = new DocumentChunkerService();

  it('returns empty array for empty input', () => {
    expect(svc.chunk({ text: '' })).toEqual([]);
  });

  it('produces one chunk for short input', () => {
    const text = 'A short document.';
    const chunks = svc.chunk({ text });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
    expect(chunks[0].ordinal).toBe(0);
  });

  it('splits long input into multiple chunks', () => {
    const text = ('Sentence one. '.repeat(500) + '\n\n' + 'Sentence two. '.repeat(500));
    const chunks = svc.chunk({ text, targetTokens: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => expect(c.ordinal).toBe(i));
  });

  it('threads heading path through chunks', () => {
    const text =
      '# Introduction\n\nIntro body.\n\n# Section A\n\nA body. ' + 'lorem '.repeat(200) +
      '\n\n## Subsection A.1\n\nDeeper body.';
    const headings = [
      { level: 1, text: 'Introduction', charOffset: text.indexOf('# Introduction') },
      { level: 1, text: 'Section A', charOffset: text.indexOf('# Section A') },
      { level: 2, text: 'Subsection A.1', charOffset: text.indexOf('## Subsection A.1') },
    ];
    const chunks = svc.chunk({ text, headings, targetTokens: 50 });
    expect(chunks.length).toBeGreaterThan(0);
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.headingPath).toEqual(['Section A', 'Subsection A.1']);
  });
});
