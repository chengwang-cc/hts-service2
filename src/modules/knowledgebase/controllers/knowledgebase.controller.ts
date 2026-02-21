import { Controller, Post, Get, Body, Query, Param } from '@nestjs/common';
import {
  DocumentService,
  PdfParserService,
  NoteExtractionService,
  NoteResolutionService,
} from '../services';
import {
  KnowledgebaseUploadDocumentDto,
  SearchNotesDto,
  ResolveNoteDto,
} from '../dto';

@Controller('knowledgebase')
export class KnowledgebaseController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly pdfParserService: PdfParserService,
    private readonly noteExtractionService: NoteExtractionService,
    private readonly noteResolutionService: NoteResolutionService,
  ) {}

  @Post('documents/download')
  async downloadDocument(@Body() uploadDto: KnowledgebaseUploadDocumentDto) {
    const document = await this.documentService.downloadDocument(
      uploadDto.year,
      uploadDto.chapter,
    );

    return {
      id: document.id,
      year: document.year,
      chapter: document.chapter,
      documentType: document.documentType,
      status: document.status,
      fileSize: document.fileSize,
      downloadedAt: document.downloadedAt,
    };
  }

  @Post('documents/:year/download-all')
  async downloadAllDocuments(@Param('year') year: string) {
    await this.documentService.downloadAllDocuments(parseInt(year, 10));
    return {
      message: `Download initiated for year ${year}`,
    };
  }

  @Get('documents/:chapter')
  async getDocument(@Param('chapter') chapter: string) {
    const document = await this.documentService.findByChapter(chapter);
    if (!document) {
      return {
        statusCode: 404,
        message: 'Document not found',
      };
    }

    return {
      id: document.id,
      year: document.year,
      chapter: document.chapter,
      documentType: document.documentType,
      status: document.status,
      fileSize: document.fileSize,
      downloadedAt: document.downloadedAt,
      isParsed: document.isParsed,
    };
  }

  @Post('documents/:id/process')
  async processDocument(@Param('id') documentId: string) {
    const result = await this.documentService.parseAndExtractNotes(documentId);
    return {
      success: true,
      ...result,
    };
  }

  @Post('notes/search')
  async searchNotes(@Body() searchDto: SearchNotesDto) {
    // Simple search by resolving the query text
    const result = await this.noteResolutionService.resolveNoteReference(
      searchDto.chapter || '',
      searchDto.query,
    );

    return {
      query: searchDto.query,
      result,
    };
  }

  @Post('notes/resolve')
  async resolveNote(@Body() resolveDto: ResolveNoteDto) {
    const result = await this.noteResolutionService.resolveNoteReference(
      resolveDto.htsNumber,
      resolveDto.noteReference,
    );

    return result;
  }

  @Get('health')
  health() {
    return { status: 'ok', service: 'knowledgebase' };
  }
}
