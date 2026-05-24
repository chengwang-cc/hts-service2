/**
 * parity-ai-validate job handler
 *
 * For each ParityComparisonRow whose mismatchReason ≠ NONE and ≠ pre-classified
 * known-bug bucket, ask OpenAI to explain the divergence grounded in the
 * actual database evidence (HtsEntity, HtsExtraTax, formula updates,
 * chapter notes).
 *
 * Output is strict JSON:
 *   {
 *     verdict: 'hts_service_correct'|'ai_service_correct'|'both_wrong'|'ambiguous_source'|'needs_human_review',
 *     confidence: 0..1,
 *     explanation: string,
 *     evidenceUsed: string[],
 *     rateBreakdown: {...}
 *   }
 *
 * Cost guard: env var `PARITY_AI_VALIDATE_DAILY_LIMIT` (default 1000) caps
 * the daily call count; once exceeded the handler skips validation
 * (status='skipped', verdict='cost_cap_reached').
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  HtsEntity,
  HtsExtraTaxEntity,
  HtsFormulaUpdateEntity,
  OpenAiService,
} from '@hts/core';
import { ParityComparisonRowEntity } from '../entities/parity-comparison-row.entity';
import { ParityComparisonRunEntity } from '../entities/parity-comparison-run.entity';

interface AiVerdictPayload {
  verdict?: string;
  confidence?: number;
  explanation?: string;
  evidenceUsed?: string[];
  rateBreakdown?: Record<string, number>;
}

const VALID_VERDICTS = new Set([
  'hts_service_correct',
  'ai_service_correct',
  'both_wrong',
  'ambiguous_source',
  'needs_human_review',
]);

@Injectable()
export class ParityAiValidateJobHandler {
  private readonly logger = new Logger(ParityAiValidateJobHandler.name);
  private dailyCount = 0;
  private dailyCountReset = this.startOfDay();

  constructor(
    @InjectRepository(ParityComparisonRowEntity)
    private readonly rowRepo: Repository<ParityComparisonRowEntity>,
    @InjectRepository(ParityComparisonRunEntity)
    private readonly runRepo: Repository<ParityComparisonRunEntity>,
    @InjectRepository(HtsEntity)
    private readonly htsRepo: Repository<HtsEntity>,
    @InjectRepository(HtsExtraTaxEntity)
    private readonly extraTaxRepo: Repository<HtsExtraTaxEntity>,
    @InjectRepository(HtsFormulaUpdateEntity)
    private readonly formulaUpdateRepo: Repository<HtsFormulaUpdateEntity>,
    private readonly openai: OpenAiService,
  ) {}

  async execute(job: any): Promise<void> {
    const rowId: string = job?.data?.rowId;
    if (!rowId) {
      this.logger.warn('parity-ai-validate: rowId missing');
      return;
    }

    const row = await this.rowRepo.findOne({ where: { id: rowId } });
    if (!row) {
      this.logger.warn(`parity-ai-validate: row ${rowId} not found`);
      return;
    }

    if (row.aiValidationStatus === 'completed' || row.aiValidationStatus === 'skipped') {
      return;
    }

    // Cost cap
    this.maybeResetDailyCount();
    const cap = Number(process.env.PARITY_AI_VALIDATE_DAILY_LIMIT) || 1000;
    if (this.dailyCount >= cap) {
      row.aiValidationStatus = 'skipped';
      row.aiValidationVerdict = 'cost_cap_reached';
      row.aiValidationExplanation = `Daily AI validation cap (${cap}) reached`;
      await this.rowRepo.save(row);
      return;
    }

    row.aiValidationStatus = 'in_progress';
    await this.rowRepo.save(row);

    try {
      const evidence = await this.gatherEvidence(row);
      const verdict = await this.askAgent(row, evidence);
      this.dailyCount++;

      row.aiValidationStatus = 'completed';
      row.aiValidationVerdict = VALID_VERDICTS.has(verdict.verdict ?? '')
        ? (verdict.verdict as string)
        : 'needs_human_review';
      row.aiValidationConfidence =
        typeof verdict.confidence === 'number' && verdict.confidence >= 0 && verdict.confidence <= 1
          ? verdict.confidence
          : null;
      row.aiValidationExplanation = (verdict.explanation || '').slice(0, 1000);
      row.aiValidationEvidence = {
        ...evidence,
        evidenceUsed: Array.isArray(verdict.evidenceUsed) ? verdict.evidenceUsed : [],
        rateBreakdown: verdict.rateBreakdown ?? null,
      };
      await this.rowRepo.save(row);
    } catch (e: any) {
      this.logger.warn(
        `parity-ai-validate row=${rowId} failed: ${e?.message}`,
      );
      row.aiValidationStatus = 'failed';
      row.aiValidationEvidence = {
        ...(row.aiValidationEvidence || {}),
        parseError: String(e?.message || e).slice(0, 1000),
      };
      await this.rowRepo.save(row);
    }
  }

  private async gatherEvidence(row: ParityComparisonRowEntity): Promise<Record<string, any>> {
    const htsRow = await this.htsRepo
      .createQueryBuilder('hts')
      .where('hts.htsNumber = :n', { n: row.htsNumber })
      .andWhere('hts.isActive = true')
      .orderBy('hts.updatedAt', 'DESC')
      .limit(1)
      .getOne();

    const extraTaxRows = await this.extraTaxRepo
      .createQueryBuilder('et')
      .where('et.isActive = true')
      .andWhere(
        '(et.htsNumber = :n OR et.htsNumber = :wild OR et.htsNumber IS NULL OR et.htsChapter = :chapter)',
        {
          n: row.htsNumber,
          wild: '*',
          chapter: row.chapter,
        },
      )
      .andWhere(
        '(et.countryCode = :country OR et.countryCode = :all)',
        { country: row.countryOfOrigin, all: 'ALL' },
      )
      .orderBy('et.priority', 'ASC')
      .limit(20)
      .getMany();

    const formulaUpdateRows = await this.formulaUpdateRepo
      .createQueryBuilder('fu')
      .where('fu.htsNumber = :n', { n: row.htsNumber })
      .andWhere('(fu.countryCode = :country OR fu.countryCode = :all)', {
        country: row.countryOfOrigin,
        all: 'ALL',
      })
      .limit(10)
      .getMany();

    return {
      htsRow: htsRow ? this.compactHtsRow(htsRow) : null,
      extraTaxRows: extraTaxRows.map((e) => this.compactExtraTax(e)),
      formulaUpdateRows: formulaUpdateRows.map((f) => this.compactFormulaUpdate(f)),
      aiBreakdown: row.aiFormulas ?? [],
      localBreakdown: row.localBreakdown ?? [],
    };
  }

  private compactHtsRow(hts: HtsEntity): Record<string, any> {
    return {
      id: hts.id,
      htsNumber: hts.htsNumber,
      description: (hts.description || '').slice(0, 240),
      generalRate: hts.generalRate,
      otherRate: hts.otherRate,
      rateFormula: hts.rateFormula,
      otherRateFormula: hts.otherRateFormula,
      adjustedFormula: hts.adjustedFormula,
      specialRates: hts.specialRates,
      chapter99Links: hts.chapter99Links,
      chapter99ApplicableCountries: hts.chapter99ApplicableCountries,
      nonNtrApplicableCountries: hts.nonNtrApplicableCountries,
    };
  }

  private compactExtraTax(e: HtsExtraTaxEntity): Record<string, any> {
    return {
      id: e.id,
      taxCode: e.taxCode,
      htsNumber: e.htsNumber,
      htsChapter: e.htsChapter,
      countryCode: e.countryCode,
      rateText: e.rateText,
      rateFormula: e.rateFormula,
      extraRateType: e.extraRateType,
      conditions: e.conditions,
      legalReference: e.legalReference,
    };
  }

  private compactFormulaUpdate(f: HtsFormulaUpdateEntity): Record<string, any> {
    return {
      id: f.id,
      htsNumber: f.htsNumber,
      countryCode: f.countryCode,
      formulaType: f.formulaType,
      formula: f.formula,
      carryover: f.carryover,
    };
  }

  private async askAgent(
    row: ParityComparisonRowEntity,
    evidence: Record<string, any>,
  ): Promise<AiVerdictPayload> {
    const system = `You are an expert US HTS tariff auditor reviewing automated calculations.
Two implementations disagree on the total duty for an HTS code:
  - "AI" = legacy ai-service (URL-cited but not necessarily correct)
  - "LOCAL" = new hts-service componentized resolver

Your job:
  1. Read the database evidence below carefully.
  2. Determine which (if either) calculation matches official US HTS rules.
  3. Cite the row IDs (htsRow.id, extraTaxRows[i].id, formulaUpdateRows[i].id) that drive your verdict.

Output STRICT JSON only — no prose outside JSON. Schema:
{
  "verdict": "hts_service_correct" | "ai_service_correct" | "both_wrong" | "ambiguous_source" | "needs_human_review",
  "confidence": <number 0..1>,
  "explanation": "<= 600 chars",
  "evidenceUsed": ["<row id>", ...],
  "rateBreakdown": { "expectedBaseDuty": <num>, "expectedAdditionalTariffs": <num>, "expectedFees": <num>, "expectedTotalDuty": <num> }
}`;

    const user = `HTS: ${row.htsNumber}  (Chapter ${row.chapter})
Country of origin: ${row.countryOfOrigin}
Declared value: ${row.declaredValue} USD
Inputs: ${JSON.stringify(row.inputs)}

— AI SERVICE returned —
totalDuty: ${row.aiTotalDuty}
formulas:
${JSON.stringify(row.aiFormulas ?? [], null, 2)}

— LOCAL hts-service returned —
totalDuty: ${row.localTotalDuty}
breakdown:
${JSON.stringify(row.localBreakdown ?? [], null, 2)}

— DATABASE EVIDENCE (from hts-service) —
${JSON.stringify(evidence, null, 2).slice(0, 8000)}

Apply official US HTS rules. Cite specific row IDs.`;

    const resp = await this.openai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      {
        model: process.env.PARITY_AI_MODEL || 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 800,
        // Strict JSON output — eliminates the parseJsonStrict fallback
        // path that tripped on multi-line embedded strings during the
        // 2026-05-23 live run (1 failure / 219 completed).
        response_format: { type: 'json_object' },
      } as any,
    );

    const text = resp?.choices?.[0]?.message?.content ?? '';
    return this.parseJsonStrict(text);
  }

  private parseJsonStrict(text: string): AiVerdictPayload {
    // Try direct parse, then extract a fenced code block, then bail.
    const tryParse = (s: string): AiVerdictPayload | null => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    };
    const direct = tryParse(text);
    if (direct) return direct;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      const inner = tryParse(fenced[1]);
      if (inner) return inner;
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const slice = text.slice(firstBrace, lastBrace + 1);
      const sliced = tryParse(slice);
      if (sliced) return sliced;
    }
    throw new Error(`AI returned non-JSON: ${text.slice(0, 200)}`);
  }

  private maybeResetDailyCount(): void {
    const today = this.startOfDay();
    if (today !== this.dailyCountReset) {
      this.dailyCount = 0;
      this.dailyCountReset = today;
    }
  }

  private startOfDay(): number {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
}
