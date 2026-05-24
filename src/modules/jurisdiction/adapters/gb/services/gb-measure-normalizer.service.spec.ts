import { GbMeasureNormalizerService } from './gb-measure-normalizer.service';
import { GbCommodityResponse } from './gb-trade-tariff-ingestion.service';

describe('GbMeasureNormalizerService', () => {
  const svc = new GbMeasureNormalizerService();

  function commodity(measures: GbCommodityResponse['importMeasures']): GbCommodityResponse {
    return {
      id: '1',
      code: '6109100010',
      description: 'cotton T-shirts',
      importMeasures: measures,
    };
  }

  it('parses ad-valorem third-country duty (measure type 103)', () => {
    const out = svc.normalize(
      commodity([
        {
          measureTypeId: '103',
          measureTypeDescription: 'Third country duty',
          dutyExpressionFormattedBase: '12.00 %',
          geographicalAreaId: 'ERGA OMNES',
        },
      ]),
      'CN',
    );
    expect(out.components).toHaveLength(1);
    expect(out.components[0].componentType).toBe('base');
    expect(out.components[0].formula).toBe('value * 0.12');
    expect(out.warnings).toHaveLength(0);
  });

  it('parses tariff preference as `special` and bounds origin', () => {
    const out = svc.normalize(
      commodity([
        {
          measureTypeId: '142',
          measureTypeDescription: 'Tariff preference',
          dutyExpressionFormattedBase: 'Free',
          geographicalAreaId: 'KR',
        },
      ]),
      'KR',
    );
    expect(out.components).toHaveLength(1);
    expect(out.components[0].componentType).toBe('special');
    expect(out.components[0].formula).toBe('0');
    expect(out.components[0].appliesWhen).toEqual({
      kind: 'country_in',
      countries: ['KR'],
    });
  });

  it('skips measures targeted at a different origin', () => {
    const out = svc.normalize(
      commodity([
        {
          measureTypeId: '142',
          measureTypeDescription: 'Tariff preference',
          dutyExpressionFormattedBase: 'Free',
          geographicalAreaId: 'KR',
        },
      ]),
      'CN',
    );
    expect(out.components).toHaveLength(0);
  });

  it('parses specific duty in GBP/100 kg', () => {
    const out = svc.normalize(
      commodity([
        {
          measureTypeId: '103',
          measureTypeDescription: 'Third country duty',
          dutyExpressionFormattedBase: '32.50 GBP / 100 kg',
          geographicalAreaId: 'ERGA OMNES',
        },
      ]),
      'CN',
    );
    expect(out.components[0].formula).toBe('weight * 0.325');
  });

  it('parses compound duty (ad-valorem + specific)', () => {
    const out = svc.normalize(
      commodity([
        {
          measureTypeId: '103',
          measureTypeDescription: 'Third country duty',
          dutyExpressionFormattedBase: '12.00 % + 32.50 GBP / 100 kg',
          geographicalAreaId: 'ERGA OMNES',
        },
      ]),
      'CN',
    );
    expect(out.components[0].formula).toBe('value * 0.12 + weight * 0.325');
  });

  it('emits a warning for unparseable duty text and skips the row', () => {
    const out = svc.normalize(
      commodity([
        {
          measureTypeId: '103',
          measureTypeDescription: 'Third country duty',
          dutyExpressionFormattedBase: 'see note 5(a)',
          geographicalAreaId: 'ERGA OMNES',
        },
      ]),
      'CN',
    );
    expect(out.components).toHaveLength(0);
    expect(out.warnings[0]).toMatch(/Unparseable GB measure/);
  });
});
