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
  private readonly reststopFileUrl = 'https://hts.usitc.gov/reststop/file';
  private readonly legacyChapterBaseUrl = 'https://www.usitc.gov/publications/docs/tata/hts/baci';

  constructor(
    @InjectRepository(HtsDocumentEntity)
    private readonly documentRepository: Repository<HtsDocumentEntity>,
    private readonly pdfParserService: PdfParserService,
    private readonly noteExtractionService: NoteExtractionService,
  ) {}

  async downloadDocument(year: number, chapter: string): Promise<HtsDocumentEntity> {
    const normalizedChapter = chapter.padStart(2, '0');
    const candidateUrls = this.buildCandidateUrls(year, normalizedChapter);
    this.logger.log(
      `Downloading chapter ${normalizedChapter} (${year}) from ${candidateUrls.length} candidate source(s)`,
    );

    let selectedUrl: string | null = null;
    let pdfData: Buffer | null = null;
    let lastError: Error | null = null;

    for (const url of candidateUrls) {
      try {
        this.logger.log(`Attempting download: ${url}`);
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
        const buffer = Buffer.from(response.data);

        if (!this.isLikelyPdf(buffer, response.headers?.['content-type'])) {
          this.logger.warn(`Source ${url} did not return a valid PDF payload; trying fallback`);
          continue;
        }

        selectedUrl = url;
        pdfData = buffer;
        break;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Download attempt failed for ${url}: ${lastError.message}`);
      }
    }

    if (!selectedUrl || !pdfData) {
      const reason = lastError?.message || 'no candidate URL returned a valid PDF';
      throw new Error(
        `Failed to download HTS chapter ${normalizedChapter} for ${year}: ${reason}`,
      );
    }

    this.logger.log(`Download source selected: ${selectedUrl}`);

    try {
      const fileHash = crypto.createHash('sha256').update(pdfData).digest('hex');

      const document = this.documentRepository.create({
        year,
        chapter: normalizedChapter,
        documentType: normalizedChapter === '00' ? 'GENERAL' : 'CHAPTER',
        sourceVersion: `${year}`,
        sourceUrl: selectedUrl,
        pdfData,
        fileHash,
        fileSize: pdfData.length,
        downloadedAt: new Date(),
        isParsed: false,
        status: 'DOWNLOADED',
      });

      return this.documentRepository.save(document);
    } catch (error) {
      this.logger.error(`Failed to persist downloaded chapter ${normalizedChapter}: ${error.message}`);
      throw error;
    }
  }

  private buildCandidateUrls(year: number, chapter: string): string[] {
    const chapterNumber = parseInt(chapter, 10);
    const urls: string[] = [];

    if (Number.isFinite(chapterNumber) && chapterNumber > 0) {
      const reststopParams = new URLSearchParams({
        release: 'currentRelease',
        filename: `Chapter ${chapterNumber}`,
      });
      urls.push(`${this.reststopFileUrl}?${reststopParams.toString()}`);
    }

    urls.push(`${this.legacyChapterBaseUrl}/hts${year}c${chapter}.pdf`);

    return urls;
  }

  private isLikelyPdf(data: Buffer, contentTypeHeader?: string): boolean {
    const signature = data.subarray(0, 4).toString('utf-8');
    if (signature === '%PDF') {
      return true;
    }

    const contentType = (contentTypeHeader || '').toLowerCase();
    if (contentType.includes('text/html')) {
      return false;
    }

    return contentType.includes('pdf');
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
