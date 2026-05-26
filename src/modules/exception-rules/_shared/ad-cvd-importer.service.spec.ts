import { FindOperator } from 'typeorm';
import { AdCvdImporterService, parseCsv } from './ad-cvd-importer.service';
import type { AdCvdOrderEntity } from './ad-cvd-orders.entity';

/** In-memory repo for the importer tests. */
class FakeRepo {
  rows: AdCvdOrderEntity[] = [];
  private seq = 0;

  create(partial: Partial<AdCvdOrderEntity>): AdCvdOrderEntity {
    return { ...(partial as AdCvdOrderEntity) };
  }

  async findOne(opts: { where: Record<string, unknown> }) {
    return this.rows.find((r) =>
      Object.entries(opts.where).every(([k, v]) => {
        const actual = (r as any)[k];
        if (v instanceof FindOperator && (v as any)._type === 'isNull') {
          return actual === null || actual === undefined;
        }
        return actual === v;
      }),
    );
  }

  async save(row: AdCvdOrderEntity) {
    if (!row.id) {
      row.id = `o-${++this.seq}`;
      row.createdAt = new Date();
      row.updatedAt = new Date();
      this.rows.push(row);
    } else {
      const i = this.rows.findIndex((r) => r.id === row.id);
      if (i >= 0) this.rows[i] = row;
      else this.rows.push(row);
    }
    return row;
  }
}

const SAMPLE_CSV = `destinationCountry,htsCode,originCountry,exporterName,orderCaseNumber,orderType,cashDepositRate,effectiveFrom,effectiveTo,source,description
US,7222.30.0000,CN,,A-570-080,AD,0.2456,2017-04-03,,usdoc.adcvd.A-570-080,Stainless Steel Bar from China — all others
US,7222.30.0000,CN,Baowu,A-570-080,AD,0.0987,2017-04-03,,usdoc.adcvd.A-570-080,Stainless Steel Bar — Baowu rate
EU,7301.10.0000,RU,,R-2024-007,AD,0.18,2024-07-15,,eu.commission.r-2024-007,Welded Tubes from Russia`;

describe('parseCsv', () => {
  it('parses headers + rows, skips comments and blanks', () => {
    const csv = '# top comment\nhtsCode,rate\n8471.30,0.25\n\n7208.10,0.18\n';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ htsCode: '8471.30', rate: '0.25' });
  });
});

describe('AdCvdImporterService', () => {
  let repo: FakeRepo;
  let svc: AdCvdImporterService;

  beforeEach(() => {
    repo = new FakeRepo();
    svc = new AdCvdImporterService(repo as any);
  });

  it('imports valid CSV rows + writes to repo', async () => {
    const summary = await svc.loadCsv(Buffer.from(SAMPLE_CSV));
    expect(summary.parsed).toBe(3);
    expect(summary.inserted).toBe(3);
    expect(summary.updated).toBe(0);
    expect(summary.errors).toEqual([]);
    expect(repo.rows).toHaveLength(3);
  });

  it('upserts: re-importing same rows yields skipped (no change)', async () => {
    await svc.loadCsv(Buffer.from(SAMPLE_CSV));
    const summary2 = await svc.loadCsv(Buffer.from(SAMPLE_CSV));
    expect(summary2.inserted).toBe(0);
    expect(summary2.updated).toBe(0);
    expect(summary2.skipped).toBe(3);
  });

  it('updates when row fields change', async () => {
    await svc.loadCsv(Buffer.from(SAMPLE_CSV));
    const updated = SAMPLE_CSV.replace('0.2456', '0.3000');
    const summary = await svc.loadCsv(Buffer.from(updated));
    expect(summary.updated).toBe(1);
    expect(summary.skipped).toBe(2);
    const row = repo.rows.find((r) => r.exporterName === null && r.htsCode === '7222300000');
    expect(Number(row?.cashDepositRate)).toBeCloseTo(0.3, 4);
  });

  it('rejects malformed rows with row-numbered errors', async () => {
    const bad = `destinationCountry,htsCode,originCountry,exporterName,orderCaseNumber,orderType,cashDepositRate,effectiveFrom,effectiveTo,source,description
US,7222.30.0000,CN,,,AD,0.25,2017-04-03,,usdoc,desc`; // missing case number
    const summary = await svc.loadCsv(Buffer.from(bad));
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].error).toContain('orderCaseNumber');
    expect(summary.inserted).toBe(0);
  });

  it('rejects invalid orderType', async () => {
    // W0.5.T4 (2026-05-26): SAFEGUARD + COUNTERMEASURE are now valid;
    // use a genuinely unsupported value for the negative test.
    const bad = `destinationCountry,htsCode,originCountry,exporterName,orderCaseNumber,orderType,cashDepositRate,effectiveFrom,effectiveTo,source,description
US,7222.30.0000,CN,,A-1,NOT_A_TYPE,0.25,2017-04-03,,usdoc,desc`;
    const summary = await svc.loadCsv(Buffer.from(bad));
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].error).toContain('orderType');
  });

  it('accepts new SAFEGUARD orderType per W0.5.T4 extension', async () => {
    const csv = `destinationCountry,htsCode,originCountry,exporterName,orderCaseNumber,orderType,cashDepositRate,effectiveFrom,effectiveTo,source,description
GB,7301.10.0000,RU,,SG-001,SAFEGUARD,0.25,2024-01-01,,gb.tra,UK steel safeguard`;
    const summary = await svc.loadCsv(Buffer.from(csv));
    expect(summary.errors).toEqual([]);
    expect(summary.inserted).toBe(1);
  });

  it('accepts new COUNTERMEASURE orderType per W0.5.T4 extension', async () => {
    const csv = `destinationCountry,htsCode,originCountry,exporterName,orderCaseNumber,orderType,cashDepositRate,effectiveFrom,effectiveTo,source,description
CA,7222.30.0000,US,,CM-001,COUNTERMEASURE,0.25,2018-07-01,,ca.surtax,CA US-232 countermeasure`;
    const summary = await svc.loadCsv(Buffer.from(csv));
    expect(summary.errors).toEqual([]);
    expect(summary.inserted).toBe(1);
  });

  it('dry-run validates without writing', async () => {
    const summary = await svc.dryRun(Buffer.from(SAMPLE_CSV));
    expect(summary.parsed).toBe(3);
    expect(summary.errors).toEqual([]);
    expect(repo.rows).toHaveLength(0); // critical — no writes
  });

  it('loadSeedFile imports the committed sample CSV', async () => {
    const summary = await svc.loadSeedFile();
    expect(summary.parsed).toBeGreaterThan(0);
    expect(summary.inserted).toBeGreaterThan(0);
    expect(repo.rows.length).toBeGreaterThan(15);
    // Spot-check: there's a US order from CN
    expect(repo.rows.some((r) => r.destinationCountry === 'US' && r.originCountry === 'CN')).toBe(true);
  });
});
