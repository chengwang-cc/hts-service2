import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomNamingStrategy, EmbeddingService } from '@hts/core';
import {
  HtsDocumentEntity,
  HtsNoteEmbeddingEntity,
  HtsNoteEntity,
  HtsNoteRateEntity,
  HtsNoteReferenceEntity,
} from '@hts/knowledgebase';
import { NoteResolutionService } from '@hts/knowledgebase';

jest.setTimeout(120000);

describe('NoteResolutionService (E2E)', () => {
  let moduleRef: TestingModule;
  let noteResolutionService: NoteResolutionService;
  let documentRepo: Repository<HtsDocumentEntity>;
  let noteRepo: Repository<HtsNoteEntity>;
  let noteRateRepo: Repository<HtsNoteRateEntity>;
  let referenceRepo: Repository<HtsNoteReferenceEntity>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
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
          entities: [
            HtsDocumentEntity,
            HtsNoteEntity,
            HtsNoteRateEntity,
            HtsNoteReferenceEntity,
            HtsNoteEmbeddingEntity,
          ],
        }),
        TypeOrmModule.forFeature([
          HtsDocumentEntity,
          HtsNoteEntity,
          HtsNoteRateEntity,
          HtsNoteReferenceEntity,
          HtsNoteEmbeddingEntity,
        ]),
      ],
      providers: [
        NoteResolutionService,
        {
          provide: EmbeddingService,
          useValue: {
            generateEmbedding: jest.fn().mockResolvedValue(
              Array.from({ length: 1536 }, (_, index) => (index % 9 === 0 ? 0.001 : 0)),
            ),
          },
        },
      ],
    }).compile();

    noteResolutionService = moduleRef.get(NoteResolutionService);
    documentRepo = moduleRef.get(getRepositoryToken(HtsDocumentEntity));
    noteRepo = moduleRef.get(getRepositoryToken(HtsNoteEntity));
    noteRateRepo = moduleRef.get(getRepositoryToken(HtsNoteRateEntity));
    referenceRepo = moduleRef.get(getRepositoryToken(HtsNoteReferenceEntity));
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('prefers the latest chapter note version for exact matches', async () => {
    const oldDocument = await documentRepo.save(
      documentRepo.create({
        year: 2026,
        chapter: '58',
        documentType: 'CHAPTER',
        sourceVersion: '2026_58_v1',
        sourceUrl: 'https://example.com/2026-ch58-v1.pdf',
        status: 'COMPLETED',
        processedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );

    const newDocument = await documentRepo.save(
      documentRepo.create({
        year: 2026,
        chapter: '58',
        documentType: 'CHAPTER',
        sourceVersion: '2026_58_v2',
        sourceUrl: 'https://example.com/2026-ch58-v2.pdf',
        status: 'COMPLETED',
        processedAt: new Date('2026-01-20T00:00:00.000Z'),
      }),
    );

    const oldNote = await noteRepo.save(
      noteRepo.create({
        documentId: oldDocument.id,
        chapter: '58',
        noteType: 'ADDITIONAL_US_NOTE',
        noteNumber: '1',
        content: 'Old chapter 58 note 1',
        year: 2026,
      }),
    );

    const newNote = await noteRepo.save(
      noteRepo.create({
        documentId: newDocument.id,
        chapter: '58',
        noteType: 'ADDITIONAL_US_NOTE',
        noteNumber: '1',
        content: 'New chapter 58 note 1',
        year: 2026,
      }),
    );

    await noteRateRepo.save(
      noteRateRepo.create({
        noteId: oldNote.id,
        rateText: 'The duty provided in the applicable subheading + 5%',
        formula: 'BASE_DUTY + 0.05',
        rateType: 'AD_VALOREM',
      }),
    );

    await noteRateRepo.save(
      noteRateRepo.create({
        noteId: newNote.id,
        rateText: 'The duty provided in the applicable subheading + 7.5%',
        formula: 'BASE_DUTY + 0.075',
        rateType: 'AD_VALOREM',
      }),
    );

    const resolved = await noteResolutionService.resolveNoteReference(
      '5810.91.00',
      'See additional U.S. note 1',
      'general',
      2026,
      { exactOnly: true },
    );

    expect(resolved).toBeDefined();
    expect(resolved.formula).toBe('BASE_DUTY + 0.075');
    expect(resolved.metadata.chapter).toBe('58');
  });

  it('resolves note references that explicitly target a different chapter', async () => {
    const chapter99Doc = await documentRepo.save(
      documentRepo.create({
        year: 2026,
        chapter: '99',
        documentType: 'CHAPTER',
        sourceVersion: '2026_99_v1',
        sourceUrl: 'https://example.com/2026-ch99-v1.pdf',
        status: 'COMPLETED',
        processedAt: new Date('2026-01-25T00:00:00.000Z'),
      }),
    );

    const chapter99Note = await noteRepo.save(
      noteRepo.create({
        documentId: chapter99Doc.id,
        chapter: '99',
        noteType: 'ADDITIONAL_US_NOTE',
        noteNumber: '20(r)',
        content: 'Chapter 99 note 20(r)',
        year: 2026,
      }),
    );

    await noteRateRepo.save(
      noteRateRepo.create({
        noteId: chapter99Note.id,
        rateText: 'The duty provided in the applicable subheading + 7.5%',
        formula: 'BASE_DUTY + 0.075',
        rateType: 'AD_VALOREM',
      }),
    );

    const resolved = await noteResolutionService.resolveNoteReference(
      '1202.41.80',
      'See U.S. note 20(r) to chapter 99',
      'general',
      2026,
      { exactOnly: true },
    );

    expect(resolved).toBeDefined();
    expect(resolved.metadata.chapter).toBe('99');
    expect(resolved.formula).toBe('BASE_DUTY + 0.075');
  });

  it('stores resolution references idempotently for repeated lookups', async () => {
    const referenceText = 'See additional U.S. note 1';

    await noteResolutionService.resolveNoteReference(
      '5810.91.00',
      referenceText,
      'general',
      2026,
      { exactOnly: true },
    );

    await noteResolutionService.resolveNoteReference(
      '5810.91.00',
      referenceText,
      'general',
      2026,
      { exactOnly: true },
    );

    const persisted = await referenceRepo.find({
      where: {
        htsNumber: '5810.91.00',
        sourceColumn: 'general',
        year: 2026,
      },
    });

    expect(persisted.length).toBe(1);
    expect(persisted[0].isResolved).toBe(true);
  });
});
