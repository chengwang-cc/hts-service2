import {
  parseExtractorOutput,
  sanitizeAssistantJson,
  sha256Hex,
  stableStringify,
} from './formula-ai-validation.util';

describe('formula AI validation utilities', () => {
  it('strips reasoning tags and markdown fences before JSON parsing', () => {
    const raw = `<think>private reasoning</think>
\`\`\`json
{"modelRole":"extractor","verdict":"no_duty","components":[],"confidence":0.9,"reasonCodes":[],"needsJudge":false}
\`\`\``;

    const parsed = parseExtractorOutput(raw);

    expect(parsed.validationErrors).toEqual([]);
    expect(parsed.parsed?.verdict).toBe('no_duty');
    expect(parsed.sanitizedOutput).not.toContain('<think>');
  });

  it('reports schema errors for invalid extractor output', () => {
    const parsed = parseExtractorOutput('{"verdict":"formula_extracted"}');

    expect(parsed.parsed).toBeNull();
    expect(parsed.validationErrors.join('\n')).toContain('modelRole');
  });

  it('stable-stringifies objects independent of key order', () => {
    const left = stableStringify({ b: 1, a: { d: 2, c: 3 } });
    const right = stableStringify({ a: { c: 3, d: 2 }, b: 1 });

    expect(left).toBe(right);
    expect(sha256Hex(left)).toBe(sha256Hex(right));
  });

  it('extracts the first JSON object from surrounding text', () => {
    expect(sanitizeAssistantJson('prefix {"ok":true} suffix')).toBe(
      '{"ok":true}',
    );
  });
});

