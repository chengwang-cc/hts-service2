export interface FormulaParserFixture {
  name: string;
  rateText: string;
  unitOfQuantity?: string;
  expected: {
    formula: string;
    variables: string[];
    confidence?: number;
  } | null;
}

export const FORMULA_PARSER_FIXTURES: FormulaParserFixture[] = [
  {
    name: 'free rate',
    rateText: 'Free',
    expected: { formula: '0', variables: [], confidence: 1 },
  },
  {
    name: 'simple percent',
    rateText: '5%',
    expected: { formula: 'value * 0.05', variables: ['value'], confidence: 1 },
  },
  {
    name: 'ad valorem phrase',
    rateText: '12.5% ad valorem',
    expected: {
      formula: 'value * 0.125',
      variables: ['value'],
      confidence: 1,
    },
  },
  {
    name: 'kilogram specific duty',
    rateText: '$2.50/kg',
    expected: {
      formula: 'weight * 2.5',
      variables: ['weight'],
      confidence: 0.9,
    },
  },
  {
    name: 'cents per kilogram',
    rateText: '25 cents/kg',
    expected: {
      formula: 'weight * 0.25',
      variables: ['weight'],
      confidence: 0.9,
    },
  },
  {
    name: 'dozen specific duty',
    rateText: '2.8 cents/doz.',
    expected: {
      formula: 'quantity_dozen * 0.028',
      variables: ['quantity_dozen'],
      confidence: 0.9,
    },
  },
  {
    name: 'pair specific duty',
    rateText: '90 cents/pr.',
    expected: {
      formula: 'quantity_pair * 0.9',
      variables: ['quantity_pair'],
      confidence: 0.9,
    },
  },
  {
    name: 'each style duty',
    rateText: '0.9 cents each',
    expected: {
      formula: 'quantity_each * 0.009',
      variables: ['quantity_each'],
      confidence: 0.9,
    },
  },
  {
    name: 'liter duty',
    rateText: '$1.50/liter',
    expected: {
      formula: 'volume_liter * 1.5',
      variables: ['volume_liter'],
      confidence: 0.9,
    },
  },
  {
    name: 'proof liter duty',
    rateText: '$1.00/proof liter',
    expected: {
      formula: 'proof_liter * 1',
      variables: ['proof_liter'],
      confidence: 0.9,
    },
  },
  {
    name: 'proof liter abbreviation duty',
    rateText: '31.4 cents/pf. liter',
    expected: {
      formula: 'proof_liter * 0.314',
      variables: ['proof_liter'],
      confidence: 0.9,
    },
  },
  {
    name: 'barrel duty',
    rateText: '10.5 cents/bbl',
    expected: {
      formula: 'volume_barrel * 0.105',
      variables: ['volume_barrel'],
      confidence: 0.9,
    },
  },
  {
    name: 'cubic meter duty',
    rateText: '$1.13/m3',
    expected: {
      formula: 'volume_m3 * 1.13',
      variables: ['volume_m3'],
      confidence: 0.9,
    },
  },
  {
    name: 'metric ton duty',
    rateText: '39.7 cents/t',
    expected: {
      formula: 'weight_ton * 0.397',
      variables: ['weight_ton'],
      confidence: 0.9,
    },
  },
  {
    name: 'head duty',
    rateText: '68 cents/head',
    expected: {
      formula: 'quantity_each * 0.68',
      variables: ['quantity_each'],
      confidence: 0.9,
    },
  },
  {
    name: 'area duty',
    rateText: '$0.10/square meter',
    expected: {
      formula: 'area_m2 * 0.1',
      variables: ['area_m2'],
      confidence: 0.9,
    },
  },
  {
    name: 'length duty',
    rateText: '$0.02/m',
    expected: {
      formula: 'length_m * 0.02',
      variables: ['length_m'],
      confidence: 0.9,
    },
  },
  {
    name: 'compound ad valorem and specific',
    rateText: '5% + 25 cents/kg',
    expected: {
      formula: 'value * 0.05 + weight * 0.25',
      variables: ['value', 'weight'],
      confidence: 0.9,
    },
  },
  {
    name: 'range requires manual review',
    rateText: '5% to 10%',
    expected: null,
  },
  {
    name: 'see note requires manual review',
    rateText: 'See note 2',
    expected: null,
  },
  {
    name: 'not less than requires constraints',
    rateText: '5% but not less than $2/kg',
    expected: null,
  },
  {
    name: 'quota rate requires quota condition modeling',
    rateText: 'Free under quota; 12% over quota',
    expected: null,
  },
  {
    name: 'implicit numeric denominator with known source unit',
    rateText: '89.6 cents/1000',
    unitOfQuantity: 'dozen',
    expected: {
      formula: 'quantity_dozen * 0.000896',
      variables: ['quantity_dozen'],
      confidence: 0.9,
    },
  },
  {
    name: 'implicit numeric denominator without source unit is ambiguous',
    rateText: '89.6 cents/1000',
    expected: null,
  },
  {
    name: 'unknown unit is ambiguous',
    rateText: '$1.00/mysteryunit',
    expected: null,
  },
  {
    name: 'component context is too ambiguous',
    rateText: '5% + 10 cents/battery',
    expected: null,
  },
];
