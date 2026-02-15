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
import { FormulaGenerationService } from '@hts/core';

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
    FormulaGenerationService,
    NoteExtractionService,
    NoteResolutionService,
    NoteEmbeddingGenerationService,
  ],
  exports: [
    DocumentService,
    PdfParserService,
    FormulaGenerationService,
    NoteExtractionService,
    NoteResolutionService,
    NoteEmbeddingGenerationService,
  ],
})
export class KnowledgebaseModule {}
