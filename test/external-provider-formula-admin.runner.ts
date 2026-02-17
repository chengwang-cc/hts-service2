import 'reflect-metadata';
import request from 'supertest';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../src/modules/auth/auth.module';
import { ExternalProviderFormulaAdminController } from '../src/modules/admin/controllers/external-provider-formula.admin.controller';
import { ExternalProviderFormulaAdminService } from '../src/modules/admin/services/external-provider-formula.admin.service';
import { AdminGuard } from '../src/modules/admin/guards/admin.guard';
import { AdminPermissionsGuard } from '../src/modules/admin/guards/admin-permissions.guard';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { OrganizationEntity } from '../src/modules/auth/entities/organization.entity';
import { RoleEntity } from '../src/modules/auth/entities/role.entity';
import { UserEntity } from '../src/modules/auth/entities/user.entity';
import {
  CustomNamingStrategy,
  ExternalProviderFormulaEntity,
  HtsFormulaUpdateEntity,
  HtsFormulaUpdateService,
  HtsEntity,
} from '@hts/core';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  const moduleFixture = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      TypeOrmModule.forRoot({
        type: 'postgres',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        username: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_DATABASE || 'hts_test',
        synchronize: true,
        dropSchema: true,
        namingStrategy: new CustomNamingStrategy(),
        autoLoadEntities: true,
        entities: [
          UserEntity,
          RoleEntity,
          OrganizationEntity,
          HtsEntity,
          HtsFormulaUpdateEntity,
          ExternalProviderFormulaEntity,
        ],
      }),
      TypeOrmModule.forFeature([
        UserEntity,
        RoleEntity,
        OrganizationEntity,
        HtsEntity,
        HtsFormulaUpdateEntity,
        ExternalProviderFormulaEntity,
      ]),
      AuthModule,
    ],
    controllers: [ExternalProviderFormulaAdminController],
    providers: [
      ExternalProviderFormulaAdminService,
      HtsFormulaUpdateService,
      AdminGuard,
      AdminPermissionsGuard,
    ],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();

  const authService = moduleFixture.get<AuthService>(AuthService);
  const externalProviderService = moduleFixture.get<ExternalProviderFormulaAdminService>(
    ExternalProviderFormulaAdminService,
  );
  const orgRepo = moduleFixture.get<Repository<OrganizationEntity>>(getRepositoryToken(OrganizationEntity));
  const roleRepo = moduleFixture.get<Repository<RoleEntity>>(getRepositoryToken(RoleEntity));
  const userRepo = moduleFixture.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
  const htsRepo = moduleFixture.get<Repository<HtsEntity>>(getRepositoryToken(HtsEntity));
  const formulaUpdateRepo = moduleFixture.get<Repository<HtsFormulaUpdateEntity>>(
    getRepositoryToken(HtsFormulaUpdateEntity),
  );

  const org = await orgRepo.save(orgRepo.create({ name: `e2e-ext-provider-${Date.now()}` }));
  const role = await roleRepo.save(
    roleRepo.create({
      name: 'admin',
      permissions: ['formula:view', 'formula:override'],
    }),
  );

  const email = `provider-admin-${Date.now()}@example.com`;
  const password = 'Passw0rd!';
  const user = await authService.register(email, password, 'Provider', 'Admin', org.id);
  user.roles = [role];
  await userRepo.save(user);
  const token = (await authService.login(user)).tokens.accessToken;

  const formulaFromDom = (externalProviderService as any).findFormulaFromDomText(
    'The duty provided in the applicable subheading + 7.5%',
  );
  assert(
    formulaFromDom === 'THE DUTY PROVIDED IN THE APPLICABLE SUBHEADING + 7.5%',
    'dom parser should normalize additive duty text',
  );

  await htsRepo.save(
    htsRepo.create({
      htsNumber: '4820.10.20.10',
      version: '2026_revision_1',
      indent: 0,
      description: 'Diaries and address books',
      unitOfQuantity: null,
      unit: null,
      generalRate: '5%',
      general: '5%',
      rateFormula: 'VALUE * 0.05',
      rateVariables: null,
      isFormulaGenerated: true,
      otherRate: null,
      other: null,
      otherRateFormula: null,
      otherRateVariables: null,
      isOtherFormulaGenerated: false,
      specialRates: null,
      special: null,
      chapter99: null,
      chapter99Links: null,
      chapter99ApplicableCountries: null,
      nonNtrApplicableCountries: null,
      adjustedFormula: null,
      adjustedFormulaVariables: null,
      isAdjustedFormulaGenerated: false,
      otherChapter99: null,
      otherChapter99Detail: null,
      footnotes: null,
      additionalDuties: null,
      quota: null,
      quota2: null,
      chapter: '48',
      heading: '4820',
      subheading: '482010',
      statisticalSuffix: '4820102010',
      parentHtsNumber: null,
      parentHtses: null,
      fullDescription: null,
      isHeading: false,
      isSubheading: true,
      hasChildren: false,
      sourceVersion: '2026_revision_1',
      importDate: new Date(),
      isActive: true,
      confirmed: false,
      updateFormulaComment: null,
      requiredReview: false,
      metadata: null,
    }),
  );

  const upsertResponse = await request(app.getHttpServer())
    .post('/admin/external-provider-formulas')
    .set('Authorization', `Bearer ${token}`)
    .send({
      provider: 'FLEXPORT',
      htsNumber: '4820.10.20.10',
      countryCode: 'US',
      entryDate: '2026-02-16',
      modeOfTransport: 'OCEAN',
      inputContext: {
        value: 10000,
      },
      formulaRaw: 'VALUE * 0.05',
      formulaNormalized: 'VALUE*0.05',
      extractionMethod: 'MANUAL',
      sourceUrl: 'https://tariffs.flexport.com/?htsCode=4820.10.20.10',
      upsertLatest: true,
    });

  assert(upsertResponse.status === 201, 'upsert should return 201');
  assert(upsertResponse.body?.success === true, 'upsert should be successful');
  assert(upsertResponse.body?.meta?.action === 'CREATED', 'upsert should create initial snapshot');

  const listResponse = await request(app.getHttpServer())
    .get('/admin/external-provider-formulas')
    .set('Authorization', `Bearer ${token}`)
    .query({
      provider: 'FLEXPORT',
      htsNumber: '4820.10.20.10',
      countryCode: 'US',
      entryDate: '2026-02-16',
      isLatest: true,
    });

  assert(listResponse.status === 200, 'list should return 200');
  assert(Array.isArray(listResponse.body?.data), 'list data should be an array');
  assert(listResponse.body?.data?.length === 1, 'list should return one latest snapshot');

  const compareResponse = await request(app.getHttpServer())
    .get('/admin/external-provider-formulas/compare/live')
    .set('Authorization', `Bearer ${token}`)
    .query({
      provider: 'FLEXPORT',
      htsNumber: '4820.10.20.10',
      countryCode: 'US',
      entryDate: '2026-02-16',
      modeOfTransport: 'OCEAN',
    });

  assert(compareResponse.status === 200, 'compare should return 200');
  assert(compareResponse.body?.success === true, 'compare should be successful');
  assert(compareResponse.body?.data?.comparison?.isMatch === true, 'compare should match live formula');
  assert(compareResponse.body?.data?.comparison?.mismatchReason === 'MATCH', 'compare mismatch reason should be MATCH');

  const validateResponse = await request(app.getHttpServer())
    .post('/admin/external-provider-formulas/validate')
    .set('Authorization', `Bearer ${token}`)
    .send({
      provider: 'FLEXPORT',
      htsNumber: '4820.10.20.10',
      countryCode: 'CN',
      entryDate: '2026-02-16',
      modeOfTransport: 'OCEAN',
      value: 10000,
      useMock: true,
      requireFormulaExtraction: true,
      useAiExtraction: true,
      autoAnalyzeOnMismatch: true,
      inputContext: {
        chapter99Selections: {
          '9903.88.15': true,
        },
      },
    });

  assert(validateResponse.status === 201, 'validate should return 201');
  assert(validateResponse.body?.success === true, 'validate should be successful');
  assert(
    validateResponse.body?.data?.providerFetch?.formulaExtracted === true,
    'validate should report extracted provider formula',
  );
  assert(
    validateResponse.body?.data?.comparison?.comparison?.isMatch === false,
    'validate should produce mismatch for CN mock context',
  );
  assert(
    validateResponse.body?.data?.comparison?.comparison?.mismatchReason === 'FORMULA_MISMATCH',
    'validate mismatch reason should be FORMULA_MISMATCH',
  );
  assert(
    typeof validateResponse.body?.data?.analysis?.summary === 'string' &&
      validateResponse.body.data.analysis.summary.length > 0,
    'validate should include mismatch analysis when autoAnalyzeOnMismatch is enabled',
  );

  const analysisResponse = await request(app.getHttpServer())
    .post('/admin/external-provider-formulas/compare/analyze')
    .set('Authorization', `Bearer ${token}`)
    .send({
      provider: 'FLEXPORT',
      htsNumber: '4820.10.20.10',
      countryCode: 'CN',
      entryDate: '2026-02-16',
      modeOfTransport: 'OCEAN',
    });

  assert(analysisResponse.status === 201 || analysisResponse.status === 200, 'analyze should return 200');
  assert(analysisResponse.body?.success === true, 'analyze should be successful');
  assert(
    typeof analysisResponse.body?.data?.analysis?.summary === 'string' &&
      analysisResponse.body.data.analysis.summary.length > 0,
    'analysis should include a summary',
  );
  assert(
    Array.isArray(analysisResponse.body?.data?.analysis?.recommendedActions) &&
      analysisResponse.body.data.analysis.recommendedActions.length > 0,
    'analysis should include recommended actions',
  );

  const manualReviewResponse = await request(app.getHttpServer())
    .post('/admin/external-provider-formulas/manual-review')
    .set('Authorization', `Bearer ${token}`)
    .send({
      provider: 'FLEXPORT',
      htsNumber: '4820.10.20.10',
      countryCode: 'CN',
      entryDate: '2026-02-16',
      modeOfTransport: 'OCEAN',
      inputContext: { value: 10000 },
      manualFormulaRaw: 'The duty provided in the applicable subheading + 7.5%',
      sourceUrl: 'https://tariffs.flexport.com/?htsCode=4820.10.20.10&country=CN',
      autoAnalyze: true,
      evidence: {
        copiedText: 'The duty provided in the applicable subheading + 7.5%',
        reviewerNotes: 'Manually copied from provider detail panel',
      },
    });

  assert(manualReviewResponse.status === 201, 'manual review should return 201');
  assert(
    manualReviewResponse.body?.data?.snapshot?.extractionMethod === 'MANUAL',
    'manual review snapshot should use MANUAL extraction method',
  );
  assert(
    manualReviewResponse.body?.data?.snapshot?.reviewStatus === 'PENDING',
    'manual review snapshot should start as PENDING',
  );

  const manualSnapshotId = manualReviewResponse.body?.data?.snapshot?.id;
  assert(typeof manualSnapshotId === 'string', 'manual snapshot id should exist');

  const reviewResponse = await request(app.getHttpServer())
    .post(`/admin/external-provider-formulas/${manualSnapshotId}/review`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      decision: 'APPROVED',
      comment: 'Reviewed and approved for publish',
    });

  assert(reviewResponse.status === 200, 'review endpoint should return 200');
  assert(
    reviewResponse.body?.data?.reviewStatus === 'APPROVED',
    'review status should be APPROVED',
  );

  const publishResponse = await request(app.getHttpServer())
    .post(`/admin/external-provider-formulas/${manualSnapshotId}/publish-override`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      formulaType: 'ADJUSTED',
      carryover: true,
      overrideExtraTax: false,
      comment: 'Publish manual external formula as chapter99 override',
    });

  assert(publishResponse.status === 200, 'publish override endpoint should return 200');
  assert(
    publishResponse.body?.data?.snapshot?.reviewStatus === 'PUBLISHED',
    'snapshot review status should be PUBLISHED after publish',
  );
  assert(
    typeof publishResponse.body?.data?.formulaUpdate?.id === 'string',
    'publish should create formula update record',
  );

  const updates = await formulaUpdateRepo.find({
    where: {
      htsNumber: '4820.10.20.10',
      countryCode: 'CN',
      formulaType: 'ADJUSTED',
      active: true,
    },
  });
  assert(updates.length > 0, 'formula update should be persisted');

  await app.close();
}

run()
  .then(() => {
    // eslint-disable-next-line no-console
    console.log('External provider formula runner: PASS');
    process.exit(0);
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('External provider formula runner: FAIL');
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
