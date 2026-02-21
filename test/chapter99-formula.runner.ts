import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CustomNamingStrategy,
  FormulaGenerationService,
  HtsChapter99FormulaService,
  HtsEntity,
  HtsFormulaUpdateEntity,
  HtsFormulaUpdateService,
  OpenAiService,
} from '@hts/core';
import { RateRetrievalService } from '@hts/calculator';

async function run(): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        username: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_DATABASE || 'hts_test',
        namingStrategy: new CustomNamingStrategy(),
        synchronize: true,
        dropSchema: true,
        autoLoadEntities: true,
        entities: [HtsEntity, HtsFormulaUpdateEntity],
      }),
      TypeOrmModule.forFeature([HtsEntity, HtsFormulaUpdateEntity]),
    ],
    providers: [
      {
        provide: OpenAiService,
        useValue: {
          response: async () => {
            throw new Error('OpenAI is not expected in deterministic runner');
          },
        },
      },
      FormulaGenerationService,
      HtsChapter99FormulaService,
      HtsFormulaUpdateService,
      RateRetrievalService,
    ],
  }).compile();

  const htsRepo = moduleRef.get<Repository<HtsEntity>>(getRepositoryToken(HtsEntity));
  const chapter99Service = moduleRef.get(HtsChapter99FormulaService);
  const rateRetrievalService = moduleRef.get(RateRetrievalService);

  const version = '2026_revision_3';
  await htsRepo.save([
    htsRepo.create({
      htsNumber: '1202.41.80',
      version,
      sourceVersion: version,
      isActive: true,
      indent: 3,
      chapter: '12',
      heading: '1202',
      subheading: '120241',
      description: 'Other peanuts',
      generalRate: '163.8%',
      general: '163.8%',
      rateFormula: 'value * 1.638',
      rateVariables: [{ name: 'value', type: 'number', description: 'Declared value of goods in USD' }],
      otherRate: '192.7%',
      other: '192.7%',
      otherRateFormula: 'value * 1.927',
      otherRateVariables: [{ name: 'value', type: 'number', description: 'Declared value of goods in USD' }],
      footnotes:
        '[{"columns":["desc"],"value":"See 9904.12.01-9904.12.19.","type":"endnote"},{"columns":["general"],"value":"See 9903.88.15.","type":"endnote"}]',
    }),
    htsRepo.create({
      htsNumber: '1202.41.81',
      version,
      sourceVersion: version,
      isActive: true,
      indent: 3,
      chapter: '12',
      heading: '1202',
      subheading: '120241',
      description: 'Other peanuts (test exclusion)',
      generalRate: '10%',
      general: '10%',
      rateFormula: 'value * 0.1',
      rateVariables: [{ name: 'value', type: 'number', description: 'Declared value of goods in USD' }],
      footnotes: '[{"columns":["general"],"value":"See 9903.88.39.","type":"endnote"}]',
    }),
    htsRepo.create({
      htsNumber: '1202.41.82',
      version,
      sourceVersion: version,
      isActive: true,
      indent: 3,
      chapter: '12',
      heading: '1202',
      subheading: '120241',
      description: 'Other peanuts (reciprocal-only link test)',
      generalRate: '20%',
      general: '20%',
      rateFormula: 'value * 0.2',
      rateVariables: [{ name: 'value', type: 'number', description: 'Declared value of goods in USD' }],
      adjustedFormula: 'value * 0.99',
      adjustedFormulaVariables: [{ name: 'value', type: 'number' }],
      isAdjustedFormulaGenerated: true,
      footnotes: '[{"columns":["general"],"value":"See 9903.01.25.","type":"endnote"}]',
    }),
    htsRepo.create({
      htsNumber: '9903.88.15',
      version,
      sourceVersion: version,
      isActive: true,
      indent: 0,
      chapter: '99',
      heading: '9903',
      subheading: '990388',
      description:
        'Except as provided in headings 9903.88.39, 9903.88.42, 9903.88.44, 9903.88.47, 9903.88.49, 9903.88.51, 9903.88.53, 9903.88.55, 9903.88.57, 9903.88.65, 9903.88.66, 9903.88.67, 9903.88.68, or 9903.88.69, articles the product of China, as provided for in U.S. note 20(r) to this subchapter and as provided for in the subheadings enumerated in U.S. note 20(s)',
      generalRate: 'The duty provided in the applicable subheading + 7.5%',
      general: 'The duty provided in the applicable subheading + 7.5%',
    }),
    htsRepo.create({
      htsNumber: '9903.88.39',
      version,
      sourceVersion: version,
      isActive: true,
      indent: 0,
      chapter: '99',
      heading: '9903',
      subheading: '990388',
      description:
        'Except as provided in headings 9903.88.40 and 9903.88.69, products of China for identified subheadings.',
      generalRate: 'The duty provided in the applicable subheading',
      general: 'The duty provided in the applicable subheading',
    }),
    htsRepo.create({
      htsNumber: '9903.01.25',
      version,
      sourceVersion: version,
      isActive: true,
      indent: 0,
      chapter: '99',
      heading: '9903',
      subheading: '990301',
      description: 'Reciprocal tariff baseline heading',
      generalRate: '10%',
      general: '10%',
    }),
  ]);

  const synthesisResult = await chapter99Service.synthesizeAdjustedFormulas({
    sourceVersion: version,
    activeOnly: true,
    batchSize: 100,
  });

  const updated = await htsRepo.findOneOrFail({
    where: { htsNumber: '1202.41.80', sourceVersion: version },
  });
  const exclusionUpdated = await htsRepo.findOneOrFail({
    where: { htsNumber: '1202.41.81', sourceVersion: version },
  });
  const reciprocalOnlyUpdated = await htsRepo.findOneOrFail({
    where: { htsNumber: '1202.41.82', sourceVersion: version },
  });

  const assert = (condition: boolean, message: string) => {
    if (!condition) {
      throw new Error(message);
    }
  };

  assert(synthesisResult.updated > 0, 'synthesis should update at least one row');
  assert(
    updated.adjustedFormula === '(value * 1.638) + (value * 0.075)',
    `unexpected adjusted formula: ${updated.adjustedFormula}`,
  );
  assert(
    (updated.chapter99ApplicableCountries || []).includes('CN'),
    'chapter99 countries should include CN',
  );
  assert(
    (updated.nonNtrApplicableCountries || []).includes('RU'),
    'non-NTR countries should include RU',
  );
  assert(
    exclusionUpdated.adjustedFormula === 'value * 0.1',
    `expected no additional duty for exclusion heading; got ${exclusionUpdated.adjustedFormula}`,
  );
  assert(
    reciprocalOnlyUpdated.adjustedFormula === null,
    `expected reciprocal-only adjusted formula to be cleared; got ${reciprocalOnlyUpdated.adjustedFormula}`,
  );
  assert(
    reciprocalOnlyUpdated.isAdjustedFormulaGenerated === false,
    'expected reciprocal-only entry to disable adjusted formula generated flag',
  );
  assert(
    reciprocalOnlyUpdated.metadata?.chapter99Synthesis?.reciprocalOnly === true,
    'expected reciprocal-only synthesis metadata marker',
  );

  const cnRate = await rateRetrievalService.getRate('1202.41.80', 'CN', version);
  assert(cnRate.formulaType === 'ADJUSTED', `expected ADJUSTED, got ${cnRate.formulaType}`);
  assert(
    cnRate.formula === '(value * 1.638) + (value * 0.075)',
    `unexpected CN formula ${cnRate.formula}`,
  );

  const caRate = await rateRetrievalService.getRate('1202.41.80', 'CA', version);
  assert(caRate.formulaType === 'GENERAL', `expected GENERAL, got ${caRate.formulaType}`);
  assert(caRate.formula === 'value * 1.638', `unexpected CA formula ${caRate.formula}`);

  const ruRate = await rateRetrievalService.getRate('1202.41.80', 'RU', version);
  assert(ruRate.formulaType === 'OTHER', `expected OTHER, got ${ruRate.formulaType}`);
  assert(ruRate.formula === 'value * 1.927', `unexpected RU formula ${ruRate.formula}`);

  const reciprocalOnlyCnRate = await rateRetrievalService.getRate('1202.41.82', 'CN', version);
  assert(
    reciprocalOnlyCnRate.formulaType === 'GENERAL',
    `expected reciprocal-only CN formulaType GENERAL, got ${reciprocalOnlyCnRate.formulaType}`,
  );
  assert(
    reciprocalOnlyCnRate.formula === 'value * 0.2',
    `unexpected reciprocal-only CN formula ${reciprocalOnlyCnRate.formula}`,
  );

  await htsRepo.update(
    { htsNumber: '1202.41.80', sourceVersion: version },
    {
      otherChapter99Detail: {
        formula: '(value * 1.927) + (value * 0.1)',
        variables: [{ name: 'value', type: 'number' }],
        countries: ['RU'],
      },
    },
  );

  const ruOtherChapter99Rate = await rateRetrievalService.getRate('1202.41.80', 'RU', version);
  assert(
    ruOtherChapter99Rate.formulaType === 'OTHER_CHAPTER99',
    `expected OTHER_CHAPTER99, got ${ruOtherChapter99Rate.formulaType}`,
  );
  assert(
    ruOtherChapter99Rate.formula === '(value * 1.927) + (value * 0.1)',
    `unexpected RU chapter99 formula ${ruOtherChapter99Rate.formula}`,
  );

  await moduleRef.close();
  console.log('Chapter99 formula runner: PASS');
}

run().catch((error) => {
  console.error('Chapter99 formula runner: FAIL');
  console.error(error);
  process.exit(1);
});
