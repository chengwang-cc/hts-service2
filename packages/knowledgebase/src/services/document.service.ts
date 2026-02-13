import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import * as crypto from 'crypto';
import { HtsDocumentEntity } from '../entities';
import { PdfParserService } from './pdf-parser.service';
import { NoteExtractionService } from './note-extraction.service';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private readonly baseUrl = 'https://www.usitc.gov/publications/docs/tata/hts/baci';

  constructor(
    @InjectRepository(HtsDocumentEntity)
    private readonly documentRepository: Repository<HtsDocumentEntity>,
    private readonly pdfParserService: PdfParserService,
    private readonly noteExtractionService: NoteExtractionService,
  ) {}

  async downloadDocument(year: number, chapter: string): Promise<HtsDocumentEntity> {
    const url = `${this.baseUrl}/hts${year}c${chapter.padStart(2, '0')}.pdf`;
    this.logger.log(`Downloading ${url}`);

    try {
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
      const pdfData = Buffer.from(response.data);
      const fileHash = crypto.createHash('sha256').update(pdfData).digest('hex');

      const document = this.documentRepository.create({
        year,
        chapter,
        documentType: chapter === '00' ? 'GENERAL' : 'CHAPTER',
        sourceVersion: `${year}`,
        sourceUrl: url,
        pdfData,
        fileHash,
        fileSize: pdfData.length,
        downloadedAt: new Date(),
        isParsed: false,
        status: 'DOWNLOADED',
      });

      return this.documentRepository.save(document);
    } catch (error) {
      this.logger.error(`Failed to download ${url}: ${error.message}`);
      throw error;
    }
  }

  async downloadAllDocuments(year: number): Promise<void> {
    this.logger.log(`Downloading all documents for year ${year}`);
    const chapters = ['00', ...Array.from({ length: 99 }, (_, i) => (i + 1).toString())];

    for (const chapter of chapters) {
      try {
        await this.downloadDocument(year, chapter);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit
      } catch (error) {
        this.logger.error(`Failed to download chapter ${chapter}`);
      }
    }
  }

  async findByChapter(chapter: string): Promise<HtsDocumentEntity | null> {
    return this.documentRepository.findOne({ where: { chapter } });
  }

  async parseAndExtractNotes(documentId: string): Promise<{
    documentId: string;
    notesExtracted: number;
  }> {
    const document = await this.documentRepository.findOne({
      where: { id: documentId },
    });

    if (!document) {
      throw new Error('Document not found');
    }

    if (!document.pdfData) {
      throw new Error('Document has no PDF data');
    }

    try {
      const parsedText = await this.pdfParserService.parsePdf(document.pdfData);

      document.parsedText = parsedText;
      document.parsedAt = new Date();
      document.isParsed = true;
      document.status = 'PARSED';

      await this.documentRepository.save(document);

      const notes = await this.noteExtractionService.extractNotes(
        document.id,
        document.chapter,
        parsedText,
        document.year ?? parseInt(document.sourceVersion, 10),
      );

      document.status = 'PROCESSED';
      document.processedAt = new Date();
      await this.documentRepository.save(document);

      return {
        documentId: document.id,
        notesExtracted: notes.length,
      };
    } catch (error) {
      document.status = 'FAILED';
      document.errorMessage = error.message;
      await this.documentRepository.save(document);
      throw error;
    }
  }
}
