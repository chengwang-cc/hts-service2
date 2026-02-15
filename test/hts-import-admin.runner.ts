import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthModule } from '../src/modules/auth/auth.module';
import { HtsImportAdminController } from '../src/modules/admin/controllers/hts-import.admin.controller';
import { HtsImportService } from '../src/modules/admin/services/hts-import.service';
import { AdminGuard } from '../src/modules/admin/guards/admin.guard';
import { AdminPermissionsGuard } from '../src/modules/admin/guards/admin-permissions.guard';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { QueueService } from '../src/modules/queue/queue.service';
import { OrganizationEntity } from '../src/modules/auth/entities/organization.entity';
import { RoleEntity } from '../src/modules/auth/entities/role.entity';
import { UserEntity } from '../src/modules/auth/entities/user.entity';
import {
  HtsImportHistoryEntity,
  HtsStageEntryEntity,
  HtsStageValidationIssueEntity,
  HtsStageDiffEntity,
  HtsSettingEntity,
  HtsEntity,
  HtsExtraTaxEntity,
  HtsChapter99FormulaService,
  FormulaGenerationService,
  OpenAiService,
  UsitcDownloaderService,
  CustomNamingStrategy,
} from '@hts/core';

async function run() {
  const queueServiceMock = {
    sendJob: async () => 'job-test-1',
    registerHandler: async () => undefined,
  };

  const moduleFixture = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      TypeOrmModule.forRoot({
        type: 'postgres',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
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
          HtsImportHistoryEntity,
          HtsStageEntryEntity,
          HtsStageValidationIssueEntity,
          HtsStageDiffEntity,
          HtsSettingEntity,
          HtsEntity,
          HtsExtraTaxEntity,
        ],
      }),
      TypeOrmModule.forFeature([
        UserEntity,
        RoleEntity,
        OrganizationEntity,
        HtsImportHistoryEntity,
        HtsStageEntryEntity,
        HtsStageValidationIssueEntity,
        HtsStageDiffEntity,
        HtsSettingEntity,
        HtsEntity,
        HtsExtraTaxEntity,
      ]),
      AuthModule,
    ],
      controllers: [HtsImportAdminController],
      providers: [
        HtsImportService,
        AdminGuard,
        AdminPermissionsGuard,
        FormulaGenerationService,
        HtsChapter99FormulaService,
        UsitcDownloaderService,
        QueueService,
        {
          provide: OpenAiService,
          useValue: {
            response: async () => {
              throw new Error('OpenAI not expected in admin import runner');
            },
          },
        },
      ],
    })
    .overrideProvider(QueueService)
    .useValue(queueServiceMock)
    .overrideProvider(UsitcDownloaderService)
    .useValue({
      findLatestRevision: async () => null,
      getDownloadUrl: () => '',
    })
    .compile();

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
  const orgRepo = moduleFixture.get<Repository<OrganizationEntity>>(getRepositoryToken(OrganizationEntity));
  const roleRepo = moduleFixture.get<Repository<RoleEntity>>(getRepositoryToken(RoleEntity));
  const userRepo = moduleFixture.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
  const importHistoryRepo = moduleFixture.get<Repository<HtsImportHistoryEntity>>(
    getRepositoryToken(HtsImportHistoryEntity),
  );
  const stageRepo = moduleFixture.get<Repository<HtsStageEntryEntity>>(getRepositoryToken(HtsStageEntryEntity));
  const stageIssueRepo = moduleFixture.get<Repository<HtsStageValidationIssueEntity>>(
    getRepositoryToken(HtsStageValidationIssueEntity),
  );
  const stageDiffRepo = moduleFixture.get<Repository<HtsStageDiffEntity>>(getRepositoryToken(HtsStageDiffEntity));

  const org = await orgRepo.save(orgRepo.create({ name: `e2e-hts-admin-${Date.now()}` }));

  const reviewerRole = await roleRepo.save(
    roleRepo.create({
      name: 'admin',
      permissions: ['hts:import:review', 'hts:import:export', 'hts:import:promote'],
    }),
  );

  const overrideRole = await roleRepo.save(
    roleRepo.create({
      name: `hts-import-overrider-${Date.now()}`,
      permissions: [
        'admin:*',
        'hts:import:review',
        'hts:import:export',
        'hts:import:promote',
        'hts:import:override',
      ],
    }),
  );

  const reviewerEmail = `reviewer-${Date.now()}@example.com`;
  const overrideEmail = `override-${Date.now()}@example.com`;
  const password = 'Passw0rd!';

  const reviewer = await authService.register(reviewerEmail, password, 'Review', 'User', org.id);
  reviewer.roles = [reviewerRole];
  await userRepo.save(reviewer);

  const overrider = await authService.register(overrideEmail, password, 'Override', 'User', org.id);
  overrider.roles = [overrideRole];
  await userRepo.save(overrider);

  const reviewerToken = (await authService.login(reviewer)).tokens.accessToken;
  const overrideToken = (await authService.login(overrider)).tokens.accessToken;

  const importHistory = await importHistoryRepo.save(
    importHistoryRepo.create({
      sourceVersion: '2026_revision_1',
      sourceUrl: 'https://hts.usitc.gov/data.json',
      status: 'REQUIRES_REVIEW',
      startedBy: reviewerEmail,
    }),
  );
  const importId = importHistory.id;

  const formulaGateImport = await importHistoryRepo.save(
    importHistoryRepo.create({
      sourceVersion: '2026_revision_2',
      sourceUrl: 'https://hts.usitc.gov/data.json',
      status: 'STAGED_READY',
      startedBy: reviewerEmail,
      metadata: {
        validationSummary: {
          errorCount: 0,
          warningCount: 1,
          infoCount: 0,
          formulaCoverage: 0.92,
          formulaGatePassed: false,
          validatedAt: new Date().toISOString(),
        },
        formulaValidationSummary: {
          totalRateFields: 10,
          formulaResolvableCount: 9,
          formulaUnresolvedCount: 1,
          noteReferenceCount: 1,
          noteResolvedCount: 0,
          noteUnresolvedCount: 1,
          nonNoteResolvableCount: 9,
          nonNoteUnresolvedCount: 0,
          minCoverage: 0.995,
          currentCoverage: 0.92,
          formulaGatePassed: false,
          noteFormulaPolicy: 'STRICT',
          validatedAt: new Date().toISOString(),
        },
      } as any,
    }),
  );
  const formulaGateImportId = formulaGateImport.id;
  const chapter99PreviewImport = await importHistoryRepo.save(
    importHistoryRepo.create({
      sourceVersion: '2026_revision_3',
      sourceUrl: 'https://hts.usitc.gov/data.json',
      status: 'REQUIRES_REVIEW',
      startedBy: reviewerEmail,
    }),
  );
  const chapter99PreviewImportId = chapter99PreviewImport.id;

  await stageRepo.insert([
    {
      importId,
      sourceVersion: importHistory.sourceVersion,
      htsNumber: '0101.21.0000',
      indent: 0,
      description: 'Live horses',
      unit: 'kg',
      generalRate: '5%',
      special: 'Free (A)',
      other: '35%',
      chapter99: null,
      chapter: '01',
      heading: '0101',
      subheading: '010121',
      statisticalSuffix: '01012100',
      parentHtsNumber: null,
      rowHash: 'hash-1',
      rawItem: {},
      normalized: {},
    },
    {
      importId: formulaGateImportId,
      sourceVersion: formulaGateImport.sourceVersion,
      htsNumber: '0101.30.0000',
      indent: 0,
      description: 'Test formula gate entry',
      unit: 'kg',
      generalRate: '5%',
      special: null,
      other: null,
      chapter99: null,
      chapter: '01',
      heading: '0101',
      subheading: '010130',
      statisticalSuffix: '01013000',
      parentHtsNumber: null,
      rowHash: 'hash-formula-gate',
      rawItem: {},
      normalized: {},
    },
    {
      importId: chapter99PreviewImportId,
      sourceVersion: chapter99PreviewImport.sourceVersion,
      htsNumber: '1202.41.80',
      indent: 3,
      description: 'Other peanuts',
      unit: null,
      generalRate: '163.8%',
      special: null,
      other: null,
      chapter99: null,
      chapter: '12',
      heading: '1202',
      subheading: '120241',
      statisticalSuffix: '12024180',
      parentHtsNumber: null,
      rowHash: 'hash-preview-linked',
      rawItem: {
        footnotes: [
          { columns: ['general'], value: 'See 9903.88.15.', type: 'endnote' },
        ],
      },
      normalized: {},
    },
    {
      importId: chapter99PreviewImportId,
      sourceVersion: chapter99PreviewImport.sourceVersion,
      htsNumber: '9903.88.15',
      indent: 0,
      description:
        'Except as provided in headings 9903.88.39, 9903.88.42, 9903.88.44, 9903.88.47, 9903.88.49, 9903.88.51, 9903.88.53, 9903.88.55, 9903.88.57, 9903.88.65, 9903.88.66, 9903.88.67, 9903.88.68, or 9903.88.69, articles the product of China',
      unit: null,
      generalRate: 'The duty provided in the applicable subheading + 7.5%',
      special: null,
      other: null,
      chapter99: null,
      chapter: '99',
      heading: '9903',
      subheading: '990388',
      statisticalSuffix: '99038815',
      parentHtsNumber: null,
      rowHash: 'hash-preview-ref',
      rawItem: {},
      normalized: {},
    },
    {
      importId: chapter99PreviewImportId,
      sourceVersion: chapter99PreviewImport.sourceVersion,
      htsNumber: '1202.41.81',
      indent: 3,
      description: 'Preview unresolved',
      unit: null,
      generalRate: 'See note 1',
      special: null,
      other: null,
      chapter99: null,
      chapter: '12',
      heading: '1202',
      subheading: '120241',
      statisticalSuffix: '12024181',
      parentHtsNumber: null,
      rowHash: 'hash-preview-unresolved',
      rawItem: {
        footnotes: [
          { columns: ['general'], value: 'See 9903.99.99.', type: 'endnote' },
        ],
      },
      normalized: {},
    },
    {
      importId: chapter99PreviewImportId,
      sourceVersion: chapter99PreviewImport.sourceVersion,
      htsNumber: '1202.41.82',
      indent: 3,
      description: 'Preview no chapter99',
      unit: null,
      generalRate: '5%',
      special: null,
      other: null,
      chapter99: null,
      chapter: '12',
      heading: '1202',
      subheading: '120241',
      statisticalSuffix: '12024182',
      parentHtsNumber: null,
      rowHash: 'hash-preview-none',
      rawItem: {},
      normalized: {},
    },
  ]);

  await stageIssueRepo.insert([
    {
      importId,
      stageEntryId: null,
      htsNumber: '0101.21.0000',
      issueCode: 'MISSING_DESCRIPTION',
      severity: 'ERROR',
      message: 'Description is missing',
    },
  ]);

  await stageDiffRepo.insert([
    {
      importId,
      stageEntryId: null,
      currentHtsId: null,
      htsNumber: '0101.21.0000',
      diffType: 'CHANGED',
      diffSummary: { changes: { description: { current: 'A', staged: 'B' } } } as any,
    },
  ]);

  const server = app.getHttpServer();
  const assert = (condition: boolean, message: string) => {
    if (!condition) {
      throw new Error(message);
    }
  };

  const summary = await request(server)
    .get(`/admin/hts-imports/${importId}/stage/summary`)
    .set('Authorization', `Bearer ${reviewerToken}`);
  assert(summary.status === 200, `summary status ${summary.status}`);
  assert(summary.body.data.stagedCount === 1, 'summary stagedCount');

  const validation = await request(server)
    .get(`/admin/hts-imports/${importId}/stage/validation?severity=ERROR`)
    .set('Authorization', `Bearer ${reviewerToken}`);
  assert(validation.status === 200, `validation status ${validation.status}`);
  assert(validation.body.data.length === 1, 'validation entries');

  const formulaGate = await request(server)
    .get(`/admin/hts-imports/${formulaGateImportId}/stage/formula-gate`)
    .set('Authorization', `Bearer ${reviewerToken}`);
  assert(formulaGate.status === 200, `formula gate status ${formulaGate.status}`);
  assert(formulaGate.body.data.formulaGatePassed === false, 'formula gate should fail');

  const diffs = await request(server)
    .get(`/admin/hts-imports/${importId}/stage/diffs?diffType=CHANGED`)
    .set('Authorization', `Bearer ${reviewerToken}`);
  assert(diffs.status === 200, `diffs status ${diffs.status}`);

  const csv = await request(server)
    .get(`/admin/hts-imports/${importId}/stage/diffs/export?diffType=CHANGED`)
    .set('Authorization', `Bearer ${reviewerToken}`);
  assert(csv.status === 200, `csv status ${csv.status}`);
  assert(csv.text.includes('htsNumber'), 'csv header missing');

  const chapter99Preview = await request(server)
    .get(`/admin/hts-imports/${chapter99PreviewImportId}/stage/chapter99-preview`)
    .set('Authorization', `Bearer ${reviewerToken}`);
  assert(chapter99Preview.status === 200, `chapter99 preview status ${chapter99Preview.status}`);
  assert(chapter99Preview.body.meta.statusCounts.LINKED === 1, 'chapter99 linked count');
  assert(chapter99Preview.body.meta.statusCounts.UNRESOLVED === 1, 'chapter99 unresolved count');
  assert(chapter99Preview.body.meta.statusCounts.NONE === 1, 'chapter99 none count');

  const chapter99LinkedPreview = await request(server)
    .get(`/admin/hts-imports/${chapter99PreviewImportId}/stage/chapter99-preview?status=LINKED`)
    .set('Authorization', `Bearer ${reviewerToken}`);
  assert(chapter99LinkedPreview.status === 200, 'chapter99 linked preview status');
  assert(chapter99LinkedPreview.body.data.length === 1, 'chapter99 linked row count');
  const linkedAdjusted = chapter99LinkedPreview.body.data[0].previewFormula.adjustedFormula || '';
  assert(
    linkedAdjusted.includes('value * 0.075') && linkedAdjusted.includes('value'),
    `chapter99 linked adjusted formula: ${linkedAdjusted}`,
  );

  const promoteBlocked = await request(server)
    .post(`/admin/hts-imports/${importId}/promote`)
    .set('Authorization', `Bearer ${reviewerToken}`);
  assert(promoteBlocked.status === 400, 'promotion should be blocked without override');

  const promoteFormulaBlocked = await request(server)
    .post(`/admin/hts-imports/${formulaGateImportId}/promote`)
    .set('Authorization', `Bearer ${reviewerToken}`);
  assert(
    promoteFormulaBlocked.status === 400,
    'promotion should be blocked without override when formula gate fails',
  );

  const promoteOk = await request(server)
    .post(`/admin/hts-imports/${importId}/promote`)
    .set('Authorization', `Bearer ${overrideToken}`);
  assert(
    promoteOk.status === 200 || promoteOk.status === 201,
    'promotion should succeed with override',
  );

  const promoteFormulaOk = await request(server)
    .post(`/admin/hts-imports/${formulaGateImportId}/promote`)
    .set('Authorization', `Bearer ${overrideToken}`);
  assert(
    promoteFormulaOk.status === 200 || promoteFormulaOk.status === 201,
    'formula gate promotion should succeed with override',
  );

  await app.close();
  console.log('Direct runner: PASS');
}

run().catch((error) => {
  console.error('Direct runner: FAIL');
  console.error(error);
  process.exit(1);
});
