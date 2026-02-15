import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Readable } from 'stream';
import * as crypto from 'crypto';
import { AuthModule } from '../src/modules/auth/auth.module';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { OrganizationEntity } from '../src/modules/auth/entities/organization.entity';
import { RoleEntity } from '../src/modules/auth/entities/role.entity';
import { UserEntity } from '../src/modules/auth/entities/user.entity';

jest.mock('../src/modules/queue/queue.service', () => ({
  QueueService: class QueueService {},
}));

import { KnowledgeAdminController } from '../src/modules/admin/controllers/knowledge.admin.controller';
import { KnowledgeAdminService } from '../src/modules/admin/services/knowledge.admin.service';
import { AdminGuard } from '../src/modules/admin/guards/admin.guard';
import { DocumentProcessingJobHandler } from '../src/modules/admin/jobs/document-processing.job-handler';
import { QueueService } from '../src/modules/queue/queue.service';
import { UsitcDownloaderService, S3StorageService, CustomNamingStrategy } from '@hts/core';
import { HtsDocumentEntity, KnowledgeChunkEntity, PdfParserService } from '@hts/knowledgebase';

jest.setTimeout(120000);

type StoredChunk = {
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata: Record<string, any> | null;
};

class InMemoryS3StorageService {
  private readonly bucket = 'test-bucket';
  private readonly files = new Map<string, Buffer>();

  getDefaultBucket(): string {
    return this.bucket;
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    return this.files.has(`${bucket}/${key}`);
  }

  async uploadStream(options: {
    bucket: string;
    key: string;
    stream: Readable;
  }): Promise<{ success: boolean; key: string; bucket: string; etag: string; size: number; sha256: string }> {
    const chunks: Buffer[] = [];
    for await (const chunk of options.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks);
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    this.files.set(`${options.bucket}/${options.key}`, data);

    return {
      success: true,
      key: options.key,
      bucket: options.bucket,
      etag: 'etag',
      size: data.length,
      sha256: hash,
    };
  }

  async downloadStream(bucket: string, key: string): Promise<Readable> {
    const data = this.files.get(`${bucket}/${key}`);
    if (!data) {
      throw new Error(`Missing test object: s3://${bucket}/${key}`);
    }
    return Readable.from(data);
  }
}

describe('Admin Knowledge PDF Processing (E2E)', () => {
  let app: INestApplication;
  let authService: AuthService;
  let orgRepo: Repository<OrganizationEntity>;
  let roleRepo: Repository<RoleEntity>;
  let userRepo: Repository<UserEntity>;
  let documentRepo: Repository<HtsDocumentEntity>;
  let documentProcessingHandler: DocumentProcessingJobHandler;
  let queueServiceMock: { sendJob: jest.Mock; registerHandler: jest.Mock };
  let chunks: StoredChunk[];
  let adminToken: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-12345';

    chunks = [];
    queueServiceMock = {
      sendJob: jest.fn().mockResolvedValue('job-test-knowledge'),
      registerHandler: jest.fn().mockResolvedValue(undefined),
    };

    const chunkRepoMock = {
      manager: {
        transaction: jest.fn(async (callback: (manager: any) => Promise<void>) => {
          const manager = {
            findOne: async (_entity: any, options: { where: { documentId: string; chunkIndex: number } }) => {
              return (
                chunks.find(
                  (chunk) =>
                    chunk.documentId === options.where.documentId &&
                    chunk.chunkIndex === options.where.chunkIndex,
                ) ?? null
              );
            },
            save: async (_entity: any, data: StoredChunk) => {
              chunks.push(data);
              return data;
            },
          };
          await callback(manager);
        }),
      },
      delete: jest.fn(),
      count: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432', 10),
          username: process.env.DB_USERNAME || 'postgres',
          password: process.env.DB_PASSWORD || 'postgres',
          database: process.env.DB_DATABASE || 'hts_test',
          namingStrategy: new CustomNamingStrategy(),
          dropSchema: true,
          synchronize: true,
          autoLoadEntities: true,
          entities: [OrganizationEntity, RoleEntity, UserEntity, HtsDocumentEntity],
        }),
        TypeOrmModule.forFeature([OrganizationEntity, RoleEntity, UserEntity, HtsDocumentEntity]),
        AuthModule,
      ],
      controllers: [KnowledgeAdminController],
      providers: [
        KnowledgeAdminService,
        AdminGuard,
        DocumentProcessingJobHandler,
        PdfParserService,
        { provide: QueueService, useValue: queueServiceMock },
        { provide: S3StorageService, useClass: InMemoryS3StorageService },
        {
          provide: UsitcDownloaderService,
          useValue: {
            findLatestRevision: jest.fn(),
            getPdfDownloadUrl: jest.fn(),
          },
        },
        { provide: getRepositoryToken(KnowledgeChunkEntity), useValue: chunkRepoMock },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    authService = moduleFixture.get<AuthService>(AuthService);
    orgRepo = moduleFixture.get<Repository<OrganizationEntity>>(getRepositoryToken(OrganizationEntity));
    roleRepo = moduleFixture.get<Repository<RoleEntity>>(getRepositoryToken(RoleEntity));
    userRepo = moduleFixture.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
    documentRepo = moduleFixture.get<Repository<HtsDocumentEntity>>(getRepositoryToken(HtsDocumentEntity));
    documentProcessingHandler = moduleFixture.get<DocumentProcessingJobHandler>(DocumentProcessingJobHandler);

    const org = await orgRepo.save(orgRepo.create({ name: `kb-admin-e2e-org-${Date.now()}` }));
    const adminRole = await roleRepo.save(
      roleRepo.create({
        name: `kb-admin-role-${Date.now()}`,
        permissions: ['admin:*'],
      }),
    );

    const adminUser = await authService.register(
      `kb-admin-${Date.now()}@example.com`,
      'Passw0rd!',
      'KB',
      'Admin',
      org.id,
    );
    adminUser.roles = [adminRole];
    await userRepo.save(adminUser);

    const hydratedAdmin = await userRepo.findOneOrFail({
      where: { id: adminUser.id },
      relations: ['roles'],
    });

    adminToken = (await authService.login(hydratedAdmin)).tokens.accessToken;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('uploads a PDF and extracts text/chunks through document processing job', async () => {
    const pdfBuffer = buildSimplePdf('HTS PDF Extraction Works');

    const uploadResponse = await request(app.getHttpServer())
      .post('/admin/knowledge/documents')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('documentType', 'PDF')
      .field('year', '2026')
      .field('chapter', '00')
      .field('title', 'Test HTS PDF')
      .attach('file', pdfBuffer, {
        filename: 'test-hts.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const documentId = uploadResponse.body?.data?.id as string;
    expect(documentId).toBeDefined();

    await documentProcessingHandler.execute({
      data: { documentId },
    });

    const processed = await documentRepo.findOneOrFail({ where: { id: documentId } });
    const normalizedText = (processed.parsedText || '').replace(/\s+/g, ' ').trim();

    expect(processed.status).toBe('COMPLETED');
    expect(processed.isParsed).toBe(true);
    expect(normalizedText).toContain('HTS PDF Extraction Works');
    expect(chunks.length).toBeGreaterThan(0);

    expect(queueServiceMock.sendJob).toHaveBeenCalledWith(
      'embedding-generation',
      { documentId },
    );
  });
});

function buildSimplePdf(text: string): Buffer {
  const escapedText = text.replace(/[()\\]/g, '\\$&');
  const stream = `BT\n/F1 24 Tf\n72 720 Td\n(${escapedText}) Tj\nET\n`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';

  for (let i = 1; i < offsets.length; i++) {
    pdf += `${offsets[i].toString().padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}
