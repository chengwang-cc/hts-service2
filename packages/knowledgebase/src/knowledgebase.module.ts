import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '@hts/core';
import {
  HtsDocumentEntity,
  HtsNoteEntity,
  HtsNoteEmbeddingEntity,
  HtsNoteRateEntity,
  HtsNoteReferenceEntity,
} from './entities';
import {
  DocumentService,
  PdfParserService,
  NoteExtractionService,
  NoteResolutionService,
  NoteEmbeddingGenerationService,
} from './services';
import { KnowledgebaseController } from './controllers/knowledgebase.controller';

@Module({})
export class KnowledgebaseModule {
  static forRoot(): DynamicModule {
    return {
      module: KnowledgebaseModule,
      imports: [
        CoreModule.forFeature(),
        TypeOrmModule.forFeature([
          HtsDocumentEntity,
          HtsNoteEntity,
          HtsNoteEmbeddingEntity,
          HtsNoteRateEntity,
          HtsNoteReferenceEntity,
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
    };
  }
}
