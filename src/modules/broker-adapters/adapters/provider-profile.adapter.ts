import { Injectable } from '@nestjs/common';
import {
  AdapterArtifact,
  AdapterContext,
  BrokerExportAdapter,
} from './adapter.contract';

/**
 * Provider-specific profile adapter. Reuses the generic JSON shape but applies
 * a per-org field mapping so that integration teams can rename or reshape
 * fields for Magaya ACELYNK, Descartes, CargoWise etc. WITHOUT shipping code.
 *
 * A real provider integration would still need a delivery transport (SFTP,
 * vendor-specific HTTPS endpoint, EDI gateway). For now this adapter
 * generates the shaped artifact and returns it as a download.
 */
@Injectable()
export class ProviderProfileAdapter implements BrokerExportAdapter {
  readonly key = 'magaya_acelynk' as const; // sample; same class is reused for descartes/cargowise via registry

  async build(ctx: AdapterContext): Promise<AdapterArtifact> {
    const mapping = ctx.adapter.fieldMappingProfile ?? {};
    const lineMapping = Object.fromEntries(
      Object.entries(mapping).filter(([k]) => k.startsWith('line.')),
    );
    const entryMapping = Object.fromEntries(
      Object.entries(mapping).filter(([k]) => k.startsWith('entry.')),
    );

    const entryPayload = this.applyMapping(entryMapping, 'entry.', {
      id: ctx.entry.id,
      entryNumber: ctx.entry.entryNumber,
      entryType: ctx.entry.entryType,
      currency: ctx.entry.currency,
      totalValue: ctx.entry.totalValue,
    });

    const linePayload = ctx.lines.map((line) =>
      this.applyMapping(lineMapping, 'line.', {
        lineNumber: line.lineNumber,
        sku: line.sku,
        description: line.description,
        htsNumber: line.htsNumber,
        countryOfOrigin: line.countryOfOrigin,
        quantity: line.quantity,
        unitOfMeasure: line.unitOfMeasure,
        unitValue: line.unitValue,
        totalValue: line.totalValue,
      }),
    );

    const payload = {
      adapter: ctx.adapter.adapterType,
      profile: ctx.adapter.label,
      entry: entryPayload,
      lines: linePayload,
      generatedAt: new Date().toISOString(),
    };
    return {
      contentType: 'application/json',
      fileName: `${ctx.adapter.adapterType}-${ctx.entry.entryNumber || ctx.entry.id}.json`,
      body: Buffer.from(JSON.stringify(payload, null, 2), 'utf-8'),
    };
  }

  requiredFields(): string[] {
    return ['entry.entryNumber', 'line.htsNumber', 'line.countryOfOrigin'];
  }

  private applyMapping(
    mapping: Record<string, string>,
    prefix: string,
    source: Record<string, unknown>,
  ): Record<string, unknown> {
    if (Object.keys(mapping).length === 0) return source;
    const out: Record<string, unknown> = {};
    for (const [from, to] of Object.entries(mapping)) {
      const sourceKey = from.startsWith(prefix)
        ? from.slice(prefix.length)
        : from;
      if (sourceKey in source) {
        out[to] = source[sourceKey];
      }
    }
    return out;
  }
}
