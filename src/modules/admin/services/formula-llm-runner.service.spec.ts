import {
  FormulaExtractorPromptService,
  QwenFormulaExtractorService,
} from './formula-llm-runner.service';
import type { FormulaSourcePack } from './formula-ai-validation.schemas';

const sourcePack: FormulaSourcePack = {
  sourcePackId: 'source-pack',
  htsNumber: '0101.21.00.00',
  sourceVersion: '2026 Revision 8',
  effectiveDate: '2026-05-22',
  destinationCountry: 'US',
  originCountry: 'ALL',
  articleDescription: 'Horses',
  unit: 'No.',
  rateText: 'Free',
  specialRateText: null,
  otherRateText: null,
  chapter99Text: null,
  chapterNotes: [],
  sectionNotes: [],
  generalNotes: [],
  chapter99Candidates: [],
  currentFormulaArtifact: {},
  knownParserOutput: {},
  knownBrokerCases: [],
  knownProviderQuotes: [],
  knownEvidence: [],
  knownCards: [],
  requiredOutputSchemaVersion: 'formula-artifact-v1',
  metadata: {},
};

describe('QwenFormulaExtractorService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('calls the Qwen OpenAI-compatible endpoint and parses JSON output', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        model: 'Qwen/Qwen3.5-35B-A3B-FP8',
        choices: [
          {
            message: {
              content:
                '<think>hidden</think>{"modelRole":"extractor","verdict":"no_duty","components":[],"confidence":0.9,"reasonCodes":[],"needsJudge":false}',
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    } as unknown as Response);

    const service = new QwenFormulaExtractorService(
      new FormulaExtractorPromptService(),
    );
    const result = await service.extract(sourcePack);

    expect(result.status).toBe('parsed');
    expect(result.parsedArtifact?.verdict).toBe('no_duty');
    expect(result.rawOutput).not.toContain('<think>');
    expect(result.metadata.rawOutputRedacted).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.1.10:6080/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('retries once with a repair prompt after invalid JSON', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          choices: [{ message: { content: '{"bad":true}' } }],
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content:
                  '{"modelRole":"extractor","verdict":"needs_human_review","components":[],"confidence":0.2,"reasonCodes":["repaired"],"needsJudge":true}',
              },
            },
          ],
        }),
      } as unknown as Response);

    const service = new QwenFormulaExtractorService(
      new FormulaExtractorPromptService(),
    );
    const result = await service.extract(sourcePack);

    expect(result.status).toBe('parsed');
    expect(result.metadata.repairAttempt).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('FormulaExtractorPromptService', () => {
  it('requires broad Chapter 99 program handling in extractor prompts', () => {
    const prompt = new FormulaExtractorPromptService().buildExtractorPrompt(
      {
        ...sourcePack,
        chapter99Text: 'The duty provided in the applicable subheading + 7.5%',
        chapter99Candidates: [
          {
            htsNumber: '9903.88.15',
            isChapter99: true,
            chapter99Heading: '9903.88.15',
            programFamily: 'section_301',
            programAuthority: 'Section 301',
            programBasis: ['heading:9903.88.15', 'section_301_heading_pattern'],
          },
          {
            htsNumber: '9903.85.01',
            isChapter99: true,
            chapter99Heading: '9903.85.01',
            programFamily: 'section_232',
            programAuthority: 'Section 232',
            programBasis: ['heading:9903.85.01', 'section_232_heading_pattern'],
          },
        ],
      },
      'Codex',
    );

    expect(prompt).toContain('Always inspect chapter99Text');
    expect(prompt).toContain('Section 301');
    expect(prompt).toContain('Section 232');
    expect(prompt).toContain('Section 201');
    expect(prompt).toContain('Section 421');
    expect(prompt).toContain('temporary duty suspension');
    expect(prompt).toContain('9903.88');
    expect(prompt).toContain('section_301');
    expect(prompt).toContain('section_232');
  });
});
