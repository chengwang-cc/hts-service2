import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  ExtractedFieldSeed,
  ExtractionContext,
  FieldExtractorAdapter,
  FIELD_EXTRACTOR_ADAPTER,
  FIELD_REASONER_ADAPTER,
} from './extractors/field-extractor.adapter';
import { StubFieldExtractorAdapter } from './extractors/stub-field-extractor.adapter';

export type { ExtractedFieldSeed } from './extractors/field-extractor.adapter';

/**
 * Routes extraction calls to the configured adapter (R1-E-01) and, when
 * configured, runs a second-pass "reasoner" adapter (R1-E-04) on fields
 * whose first-pass confidence is below `BROKER_EXTRACTOR_REASONER_FLOOR`.
 *
 * On any adapter exception we fall through to the stub seed so packet
 * processing can never hard-fail on extractor errors.
 */
@Injectable()
export class FieldExtractorService {
  private readonly logger = new Logger(FieldExtractorService.name);
  private readonly reasonerFloor: number;

  constructor(
    @Optional()
    @Inject(FIELD_EXTRACTOR_ADAPTER)
    private readonly primary: FieldExtractorAdapter | null,
    @Optional()
    @Inject(FIELD_REASONER_ADAPTER)
    private readonly reasoner: FieldExtractorAdapter | null,
    private readonly stub: StubFieldExtractorAdapter,
  ) {
    this.reasonerFloor = clamp01(
      Number(process.env.BROKER_EXTRACTOR_REASONER_FLOOR || 0.4),
    );
    const primaryKey = primary?.providerKey ?? stub.providerKey;
    const reasonerKey = reasoner?.providerKey ?? 'none';
    this.logger.log(
      `Field extractor: primary=${primaryKey} reasoner=${reasonerKey} reasoner_floor=${this.reasonerFloor}`,
    );
  }

  async extract(ctx: ExtractionContext): Promise<ExtractedFieldSeed[]> {
    const primary = this.primary ?? this.stub;
    let fields: ExtractedFieldSeed[] = [];
    try {
      fields = await primary.extract(ctx);
    } catch (err) {
      this.logger.warn(
        `Primary extractor ${primary.providerKey} threw: ${(err as Error).message}`,
      );
    }
    if (!fields.length) {
      // Fall through to the stub so the workbench has skeleton rows to
      // render even if the real extractor returned nothing.
      fields = await this.stub.extract(ctx);
    }
    if (this.reasoner) {
      fields = await this.runReasonerPass(fields, ctx);
    }
    return fields;
  }

  private async runReasonerPass(
    initial: ExtractedFieldSeed[],
    ctx: ExtractionContext,
  ): Promise<ExtractedFieldSeed[]> {
    if (!this.reasoner) return initial;
    const weakIndices = initial
      .map((f, idx) => ({ f, idx }))
      .filter((p) => p.f.confidence < this.reasonerFloor);
    if (!weakIndices.length) return initial;
    try {
      const reasonerFields = await this.reasoner.extract(ctx);
      const byPath = new Map(reasonerFields.map((f) => [f.fieldPath, f]));
      const merged = initial.slice();
      for (const { f, idx } of weakIndices) {
        const better = byPath.get(f.fieldPath);
        if (
          better &&
          better.confidence > f.confidence &&
          better.rawValue !== ''
        ) {
          merged[idx] = {
            ...better,
            sourceModel: `${better.sourceModel}+reasoner`,
          };
        }
      }
      return merged;
    } catch (err) {
      this.logger.warn(
        `Reasoner pass failed for ${ctx.document.id}: ${(err as Error).message}`,
      );
      return initial;
    }
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
