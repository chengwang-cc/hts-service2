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
} from '@hts/core';
import { UsitcDownloaderService } from '@hts/core';

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
      ],
    })
      .overrideProvider(QueueService)
      .useValue(queueServiceMock)
      .overrideProvider(UsitcDownloaderService)
      .useValue({
        findLatestRevision: jest.fn(),
        getDownloadUrl: jest.fn(),
      })
      .compile();

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
        name: `hts-import-reviewer-${Date.now()}`,
        permissions: ['admin:*', 'hts:import:review', 'hts:import:export', 'hts:import:promote'],
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

    reviewerToken = (await authService.login(reviewer)).accessToken;
    overrideToken = (await authService.login(overrider)).accessToken;

    const importHistory = await importHistoryRepo.save(
      importHistoryRepo.create({
        sourceVersion: '2026_revision_1',
        sourceUrl: 'https://hts.usitc.gov/data.json',
        status: 'REQUIRES_REVIEW',
        startedBy: reviewerEmail,
      }),
    );
    importId = importHistory.id;

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

  it('should block promotion without override permission when errors exist', async () => {
    await request(app.getHttpServer())
      .post(`/admin/hts-imports/${importId}/promote`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(400);
  });

  it('should allow promotion with override permission', async () => {
    const response = await request(app.getHttpServer())
      .post(`/admin/hts-imports/${importId}/promote`)
      .set('Authorization', `Bearer ${overrideToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(queueServiceMock.sendJob).toHaveBeenCalled();
  });
});
