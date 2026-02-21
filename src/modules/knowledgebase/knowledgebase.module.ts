import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
