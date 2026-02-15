import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigModule } from '@nestjs/config';
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
  CustomNamingStrategy,
} from '@hts/core';
import { UsitcDownloaderService } from '@hts/core';

jest.mock('../src/modules/queue/queue.service', () => ({
  QueueService: class QueueService {},
}));

jest.setTimeout(120000);

describe('Admin HTS Import (E2E)', () => {
  let app: INestApplication;
  let authService: AuthService;
  let orgRepo: Repository<OrganizationEntity>;
  let roleRepo: Repository<RoleEntity>;
  let userRepo: Repository<UserEntity>;
  let importHistoryRepo: Repository<HtsImportHistoryEntity>;
  let stageRepo: Repository<HtsStageEntryEntity>;
  let stageIssueRepo: Repository<HtsStageValidationIssueEntity>;
  let stageDiffRepo: Repository<HtsStageDiffEntity>;
  let queueServiceMock: { sendJob: jest.Mock; registerHandler: jest.Mock };

  let reviewerToken: string;
  let overrideToken: string;
  let importId: string;
  let formulaGateImportId: string;
  let chapter99PreviewImportId: string;

  beforeAll(async () => {
    queueServiceMock = {
      sendJob: jest.fn().mockResolvedValue('job-test-1'),
      registerHandler: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432'),
          username: process.env.DB_USERNAME || 'postgres',
          password: process.env.DB_PASSWORD || 'postgres',
          database: process.env.DB_DATABASE || 'hts_test',
          namingStrategy: new CustomNamingStrategy(),
          dropSchema: true,
          synchronize: true,
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
        { provide: QueueService, useValue: queueServiceMock },
        {
          provide: OpenAiService,
          useValue: {
            response: jest.fn().mockRejectedValue(new Error('OpenAI not expected in this e2e')),
          },
        },
        {
          provide: UsitcDownloaderService,
          useValue: {
            findLatestRevision: jest.fn(),
            getDownloadUrl: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );
    await app.init();

    authService = moduleFixture.get<AuthService>(AuthService);
    orgRepo = moduleFixture.get<Repository<OrganizationEntity>>(
      getRepositoryToken(OrganizationEntity),
    );
    roleRepo = moduleFixture.get<Repository<RoleEntity>>(getRepositoryToken(RoleEntity));
    userRepo = moduleFixture.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
    importHistoryRepo = moduleFixture.get<Repository<HtsImportHistoryEntity>>(
      getRepositoryToken(HtsImportHistoryEntity),
    );
    stageRepo = moduleFixture.get<Repository<HtsStageEntryEntity>>(
      getRepositoryToken(HtsStageEntryEntity),
    );
    stageIssueRepo = moduleFixture.get<Repository<HtsStageValidationIssueEntity>>(
      getRepositoryToken(HtsStageValidationIssueEntity),
    );
    stageDiffRepo = moduleFixture.get<Repository<HtsStageDiffEntity>>(
      getRepositoryToken(HtsStageDiffEntity),
    );

    const org = await orgRepo.save(
      orgRepo.create({ name: `e2e-hts-admin-${Date.now()}` }),
    );

    const reviewerRole = await roleRepo.save(
      roleRepo.create({
        name: 'admin',
        permissions: ['hts:import:review', 'hts:import:export', 'hts:import:promote'],
      }),
    );

    const overrideRole = await roleRepo.save(
      roleRepo.create({
        name: 'superadmin',
        permissions: [
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

    const reviewer = await authService.register(
      reviewerEmail,
      password,
      'Review',
      'User',
      org.id,
    );
    reviewer.roles = [reviewerRole];
    await userRepo.save(reviewer);

    const overrider = await authService.register(
      overrideEmail,
      password,
      'Override',
      'User',
      org.id,
    );
    overrider.roles = [overrideRole];
    await userRepo.save(overrider);

    const reviewerHydrated = await userRepo.findOneOrFail({
      where: { id: reviewer.id },
      relations: ['roles'],
    });
    const overriderHydrated = await userRepo.findOneOrFail({
      where: { id: overrider.id },
      relations: ['roles'],
    });

    reviewerToken = (await authService.login(reviewerHydrated)).tokens.accessToken;
    overrideToken = (await authService.login(overriderHydrated)).tokens.accessToken;

    const importHistory = await importHistoryRepo.save(
      importHistoryRepo.create({
        sourceVersion: '2026_revision_1',
        sourceUrl: 'https://hts.usitc.gov/data.json',
        status: 'REQUIRES_REVIEW',
        startedBy: reviewerEmail,
      }),
    );
    importId = importHistory.id;

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
        },
      }),
    );
    formulaGateImportId = formulaGateImport.id;

    const chapter99PreviewImport = await importHistoryRepo.save(
      importHistoryRepo.create({
        sourceVersion: '2026_revision_3',
        sourceUrl: 'https://hts.usitc.gov/data.json',
        status: 'REQUIRES_REVIEW',
        startedBy: reviewerEmail,
      }),
    );
    chapter99PreviewImportId = chapter99PreviewImport.id;

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
        importId,
        sourceVersion: importHistory.sourceVersion,
        htsNumber: '0101.29.0000',
        indent: 0,
        description: 'Other live horses',
        unit: 'kg',
        generalRate: 'Free',
        special: 'Free (A*)',
        other: '35%',
        chapter99: null,
        chapter: '01',
        heading: '0101',
        subheading: '010129',
        statisticalSuffix: '01012900',
        parentHtsNumber: null,
        rowHash: 'hash-2',
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
        diffSummary: { changes: { description: { current: 'A', staged: 'B' } } },
      },
    ]);

    await stageRepo.insert([
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
        rowHash: 'preview-hash-1',
        rawItem: {
          footnotes: [{ columns: ['general'], value: 'See 9903.88.15.', type: 'endnote' }],
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
        rowHash: 'preview-hash-2',
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
        rowHash: 'preview-hash-3',
        rawItem: {
          footnotes: [{ columns: ['general'], value: 'See 9903.99.99.', type: 'endnote' }],
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
        rowHash: 'preview-hash-4',
        rawItem: {},
        normalized: {},
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return stage summary', async () => {
    const response = await request(app.getHttpServer())
      .get(`/admin/hts-imports/${importId}/stage/summary`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.stagedCount).toBe(2);
    expect(response.body.data.validationCounts.ERROR).toBe(1);
    expect(response.body.data.diffCounts.CHANGED).toBe(1);
  });

  it('should return formula gate summary', async () => {
    const response = await request(app.getHttpServer())
      .get(`/admin/hts-imports/${formulaGateImportId}/stage/formula-gate`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.formulaGatePassed).toBe(false);
    expect(response.body.data.formulaCoverage).toBeCloseTo(0.92, 6);
    expect(response.body.data.minCoverage).toBeCloseTo(0.995, 6);
    expect(response.body.data.noteUnresolvedCount).toBe(1);
  });

  it('should return validation issues filtered by severity', async () => {
    const response = await request(app.getHttpServer())
      .get(`/admin/hts-imports/${importId}/stage/validation?severity=ERROR`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.length).toBe(1);
    expect(response.body.data[0].severity).toBe('ERROR');
  });

  it('should return diff entries', async () => {
    const response = await request(app.getHttpServer())
      .get(`/admin/hts-imports/${importId}/stage/diffs?diffType=CHANGED`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.length).toBe(1);
    expect(response.body.data[0].diffType).toBe('CHANGED');
  });

  it('should export diffs as CSV', async () => {
    const response = await request(app.getHttpServer())
      .get(`/admin/hts-imports/${importId}/stage/diffs/export?diffType=CHANGED`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('htsNumber');
    expect(response.text).toContain('0101.21.0000');
  });

  it('should return chapter99 synthesis preview', async () => {
    const response = await request(app.getHttpServer())
      .get(`/admin/hts-imports/${chapter99PreviewImportId}/stage/chapter99-preview`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.meta.statusCounts.LINKED).toBe(1);
    expect(response.body.meta.statusCounts.UNRESOLVED).toBe(1);
    expect(response.body.meta.statusCounts.NONE).toBe(1);
  });

  it('should filter chapter99 synthesis preview by status', async () => {
    const response = await request(app.getHttpServer())
      .get(`/admin/hts-imports/${chapter99PreviewImportId}/stage/chapter99-preview?status=LINKED`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.length).toBe(1);
    expect(response.body.data[0].htsNumber).toBe('1202.41.80');
    expect(response.body.data[0].previewFormula.adjustedFormula).toContain('value * 0.075');
  });

  it('should block promotion without override permission when errors exist', async () => {
    await request(app.getHttpServer())
      .post(`/admin/hts-imports/${importId}/promote`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(400);
  });

  it('should block promotion without override permission when formula gate fails', async () => {
    const response = await request(app.getHttpServer())
      .post(`/admin/hts-imports/${formulaGateImportId}/promote`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(400);

    expect(response.body.message).toContain('formula gate failed');
  });

  it('should allow promotion with override permission', async () => {
    const response = await request(app.getHttpServer())
      .post(`/admin/hts-imports/${importId}/promote`)
      .set('Authorization', `Bearer ${overrideToken}`)
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(queueServiceMock.sendJob).toHaveBeenCalled();
  });

  it('should allow formula-gate override promotion with override permission', async () => {
    const response = await request(app.getHttpServer())
      .post(`/admin/hts-imports/${formulaGateImportId}/promote`)
      .set('Authorization', `Bearer ${overrideToken}`)
      .expect(201);

    expect(response.body.success).toBe(true);
  });
});
