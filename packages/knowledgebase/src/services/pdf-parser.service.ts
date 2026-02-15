import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import pdfParse from 'pdf-parse';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

@Injectable()
export class PdfParserService {
  private readonly logger = new Logger(PdfParserService.name);
  private readonly PDF_TO_TEXT_TIMEOUT_MS = 120000;

  async parsePdf(pdfBuffer: Buffer): Promise<string> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hts-pdf-'));
    const inputPath = path.join(tempDir, 'input.pdf');
    const outputPath = path.join(tempDir, 'output.txt');

    try {
      await fs.writeFile(inputPath, pdfBuffer);
      await this.extractWithPdftotext(inputPath, outputPath);

      const extractedText = await fs.readFile(outputPath, 'utf-8');
      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error('pdftotext produced empty output');
      }

      return extractedText;
    } catch (error) {
      if (this.isCommandMissing(error)) {
        this.logger.warn(
          'pdftotext is not available in runtime; falling back to pdf-parse. Install poppler-utils for production.'
        );
        return this.extractWithPdfParse(pdfBuffer);
      }

      this.logger.error(`PDF parsing failed: ${error.message}`);
      throw error;
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        this.logger.warn(`Failed to cleanup temp PDF directory: ${cleanupError.message}`);
      }
    }
  }

  private async extractWithPdftotext(inputPath: string, outputPath: string): Promise<void> {
    await execFileAsync(
      'pdftotext',
      ['-layout', '-nopgbrk', '-enc', 'UTF-8', inputPath, outputPath],
      { timeout: this.PDF_TO_TEXT_TIMEOUT_MS },
    );
  }

  private async extractWithPdfParse(pdfBuffer: Buffer): Promise<string> {
    const data = await pdfParse(pdfBuffer);
    if (!data.text || data.text.trim().length === 0) {
      throw new Error('pdf-parse produced empty output');
    }
    return data.text;
  }

  private isCommandMissing(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const commandError = error as { code?: string; message?: string };
    return commandError.code === 'ENOENT' || /not found|enoent/i.test(commandError.message || '');
  }

  extractSections(text: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const sectionPatterns = [
      'GENERAL NOTES',
      'ADDITIONAL U.S. NOTES',
      'STATISTICAL NOTES',
      'SECTION NOTES',
      'CHAPTER NOTES',
    ];

    for (const pattern of sectionPatterns) {
      const regex = new RegExp(`${pattern}([\\s\\S]*?)(?=${sectionPatterns.join('|')}|$)`, 'i');
      const match = text.match(regex);
      if (match) {
        sections[pattern] = match[1].trim();
      }
    }

    return sections;
  }
}
