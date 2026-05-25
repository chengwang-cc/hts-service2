import { FormulaScopeService } from './formula-scope.service';

describe('FormulaScopeService', () => {
  let service: FormulaScopeService;

  beforeEach(() => {
    service = new FormulaScopeService();
  });

  it('derives HTS-specific volume and weight aliases from quantity units', () => {
    expect(
      service.buildBaseScope({ quantity: 10, quantityUnit: 'bbl' })
        .additionalInputs,
    ).toEqual(expect.objectContaining({ volume_barrel: 10 }));

    expect(
      service.buildBaseScope({ quantity: 4, quantityUnit: 'm3' })
        .additionalInputs,
    ).toEqual(expect.objectContaining({ volume_m3: 4 }));

    expect(
      service.buildBaseScope({ quantity: 2, quantityUnit: 't' })
        .additionalInputs,
    ).toEqual(expect.objectContaining({ weight_ton: 2 }));
  });

  it('derives metric tons from kilogram weight', () => {
    expect(service.buildBaseScope({ weightKg: 2500 }).additionalInputs).toEqual(
      expect.objectContaining({ weight_kg: 2500, weight_ton: 2.5 }),
    );
  });
});
