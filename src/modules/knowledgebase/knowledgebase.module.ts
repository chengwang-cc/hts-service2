import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgebaseModule as KnowledgebasePackageModule } from '@hts/knowledgebase';
import {
  HtsDocumentEntity,
  HtsNoteEntity,
  HtsNoteEmbeddingEntity,
  HtsNoteRateEntity,
  HtsNoteReferenceEntity,
  KnowledgeChunkEntity,
  DocumentService,
  PdfParserService,
  NoteExtractionService,
  NoteResolutionService,
  NoteEmbeddingGenerationService,
  KnowledgebaseController,
} from '@hts/knowledgebase';

@Module({
  imports: [
    KnowledgebasePackageModule.forRoot(),
    TypeOrmModule.forFeature([
      HtsDocumentEntity,
      HtsNoteEntity,
      HtsNoteEmbeddingEntity,
      HtsNoteRateEntity,
      HtsNoteReferenceEntity,
      KnowledgeChunkEntity,
    ]),
  ],
  controllers: [KnowledgebaseController],
  providers: [
    DocumentService,
    PdfParserService,
    NoteExtractionService,
    NoteResolutionService,
    NoteEmbeddingGenerationService,
  ],
  exports: [
    DocumentService,
    PdfParserService,
    NoteExtractionService,
    NoteResolutionService,
    NoteEmbeddingGenerationService,
  ],
})
export class KnowledgebaseModule {}
