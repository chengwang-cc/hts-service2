import { FormulaGenerationService } from '@hts/core';
import { FormulaEvaluationService } from '../../calculator/services/formula-evaluation.service';
import { FormulaSemanticsService } from '../../calculator/services/formula-semantics.service';
import { FormulaMaintenanceService } from './formula-maintenance.service';

class StubOpenAiService {
  response() {
    throw new Error('AI should not be called in deterministic tests');
  }
}

function service(openAiService?: unknown): FormulaMaintenanceService {
  const formulaGeneration = new FormulaGenerationService(
    new StubOpenAiService() as any,
  );
  return new FormulaMaintenanceService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    formulaGeneration,
    new FormulaSemanticsService(),
    new FormulaEvaluationService(formulaGeneration),
    openAiService as any,
  );
}

describe('FormulaMaintenanceService deterministic classifier', () => {
  it('collapses trivial display-only changes', () => {
    const result = (service() as any).deterministicClassifyDiff(
      {
        diffType: 'CHANGED',
        diffSummary: {
          changes: {
            description: { current: 'Old', staged: 'New' },
          },
        },
      },
      {
        generalRate: '5%',
        special: null,
        other: null,
        chapter99: null,
        unit: null,
      },
    );

    expect(result.classification).toBe('trivial');
    expect(result.reviewerStatus).toBe('collapsed');
  });

  it('creates mechanical candidates for deterministically parsed rate changes', () => {
    const result = (service() as any).deterministicClassifyDiff(
      {
        diffType: 'CHANGED',
        diffSummary: {
          changes: {
            generalRate: { current: '4%', staged: '5%' },
          },
        },
      },
      {
        generalRate: '5%',
        special: null,
        other: null,
        chapter99: null,
        unit: null,
      },
    );

    expect(result.classification).toBe('mechanical');
    expect(result.reviewerStatus).toBe('pending_review');
    expect(result.parsedRates).toEqual([
      expect.objectContaining({
        field: 'generalRate',
        formula: 'value * 0.05',
      }),
    ]);
  });

  it('escalates parser gaps instead of publishing ambiguous rates', () => {
    const result = (service() as any).deterministicClassifyDiff(
      {
        diffType: 'CHANGED',
        diffSummary: {
          changes: {
            generalRate: { current: '5%', staged: 'See note 2' },
          },
        },
      },
      {
        generalRate: 'See note 2',
        special: null,
        other: null,
        chapter99: null,
        unit: null,
      },
    );

    expect(result.classification).toBe('structural');
    expect(result.reviewerStatus).toBe('escalated');
    expect(result.parserGaps[0]).toEqual(
      expect.objectContaining({
        field: 'generalRate',
        reason: expect.stringContaining('legal notes'),
      }),
    );
  });

  it('allows AI to request structural escalation without creating evidence', async () => {
    const openAiService = {
      response: jest.fn().mockResolvedValue({
        model: 'test-model',
        output_text: JSON.stringify({
          classification: 'structural',
          confidence: 0.91,
          reason: 'Footnote language implies an unmodeled condition.',
          suggestedAction: 'Escalate for legal review.',
          model: 'test-model',
        }),
      }),
    };

    const result = await (service(openAiService) as any).classifyDiff(
      {
        id: 'diff-1',
        htsNumber: '0101.21.00.00',
        diffType: 'CHANGED',
        diffSummary: {
          changes: {
            description: { current: 'Old', staged: 'New' },
          },
        },
      },
      {
        generalRate: '5%',
        special: null,
        other: null,
        chapter99: null,
        unit: null,
      },
      { aiEnabled: true },
    );

    expect(result.classification).toBe('structural');
    expect(result.reviewerStatus).toBe('escalated');
    expect(result.parsedRates).toEqual([]);
    expect(result.deterministicSignals.aiEscalated).toBe(true);
  });
});
