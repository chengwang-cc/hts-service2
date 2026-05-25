import { Injectable } from '@nestjs/common';
import {
  AdapterArtifact,
  AdapterContext,
  BrokerExportAdapter,
} from './adapter.contract';

@Injectable()
export class GenericCsvAdapter implements BrokerExportAdapter {
  readonly key = 'generic_csv' as const;

  async build(ctx: AdapterContext): Promise<AdapterArtifact> {
    const header = [
      'entryNumber',
      'lineNumber',
      'sku',
      'description',
      'htsNumber',
      'countryOfOrigin',
      'quantity',
      'unitOfMeasure',
      'unitValue',
      'totalValue',
      'currency',
    ];
    const rows: string[] = [header.join(',')];
    for (const line of ctx.lines) {
      const cells = [
        ctx.entry.entryNumber ?? '',
        line.lineNumber,
        line.sku ?? '',
        line.description ?? '',
        line.htsNumber ?? '',
        line.countryOfOrigin ?? '',
        line.quantity ?? '',
        line.unitOfMeasure ?? '',
        line.unitValue ?? '',
        line.totalValue ?? '',
        line.currency ?? ctx.entry.currency ?? '',
      ].map((value) => this.escape(String(value)));
      rows.push(cells.join(','));
    }
    return {
      contentType: 'text/csv; charset=utf-8',
      fileName: `entry-${ctx.entry.entryNumber || ctx.entry.id}.csv`,
      body: Buffer.from(rows.join('\n'), 'utf-8'),
    };
  }

  requiredFields(): string[] {
    return [
      'entry.entryNumber',
      'line.lineNumber',
      'line.htsNumber',
      'line.countryOfOrigin',
      'line.totalValue',
    ];
  }

  private escape(value: string): string {
    if (/[",\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
