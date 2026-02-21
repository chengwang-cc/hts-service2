import { FormulaGenerationService, OpenAiService } from '@hts/core';

describe('Formula Generation Confidence Validation (E2E-style)', () => {
  let service: FormulaGenerationService;
  let openAiService: { response: jest.Mock };

  beforeEach(() => {
    openAiService = {
      response: jest.fn(),
    };
    service = new FormulaGenerationService(openAiService as unknown as OpenAiService);
  });

  it('accepts confidence=0 from AI response in generateFormula', async () => {
    openAiService.response.mockResolvedValue({
      output_text: JSON.stringify({
        formula: 'value * 0.05',
        variables: ['value'],
        confidence: 0,
        explanation: 'Low confidence parse',
      }),
    });

    const result = await service.generateFormula('subject to alternate rates');

    expect(result.method).toBe('ai');
    expect(result.formula).toBe('value * 0.05');
    expect(result.variables).toEqual(['value']);
    expect(result.confidence).toBe(0);
  });

  it('accepts confidence=0 from AI response in generateFormulaBatch', async () => {
    openAiService.response.mockResolvedValue({
      output_text: JSON.stringify([
        {
          index: 0,
          formula: 'value * 0.05',
          variables: ['value'],
          confidence: 0,
        },
      ]),
    });

    const results = await service.generateFormulaBatch([
      { rateText: 'subject to alternate rates' },
      { rateText: '5%' },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      formula: 'value * 0.05',
      variables: ['value'],
      confidence: 0,
      method: 'ai',
    });
    expect(results[1]).toEqual({
      formula: 'value * 0.05',
      variables: ['value'],
      confidence: 1,
      method: 'pattern',
    });
  });
});
