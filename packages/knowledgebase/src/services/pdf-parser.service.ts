import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
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
      this.validateExtractedText(extractedText);

      return extractedText;
    } catch (error) {
      if (this.isCommandMissing(error)) {
        throw new Error(
          'pdftotext is not available in runtime. Install poppler-utils to enable HTS PDF extraction.',
        );
      }

      this.logger.error(`PDF parsing failed: ${error.message}`);
      throw error;
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to cleanup temp PDF directory: ${cleanupError.message}`,
        );
      }
    }
  }

  private async extractWithPdftotext(
    inputPath: string,
    outputPath: string,
  ): Promise<void> {
    await execFileAsync(
      'pdftotext',
      ['-layout', '-nopgbrk', '-enc', 'UTF-8', inputPath, outputPath],
      { timeout: this.PDF_TO_TEXT_TIMEOUT_MS },
    );
  }

  private isCommandMissing(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const commandError = error as { code?: string; message?: string };
    return (
      commandError.code === 'ENOENT' ||
      /not found|enoent/i.test(commandError.message || '')
    );
  }

  private validateExtractedText(extractedText: string): void {
    const normalized = extractedText.trim();
    if (!normalized) {
      throw new Error('pdftotext produced empty output');
    }
    if (normalized.length < 10) {
      throw new Error(
        'pdftotext output is too short to be a valid HTS extraction',
      );
    }
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
    const escapedPatterns = sectionPatterns.map((pattern) =>
      pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    const sectionBoundary = escapedPatterns
      .map((pattern) => `${pattern}(?:\\s*\\(CON\\.\\))?`)
      .join('|');

    for (let index = 0; index < sectionPatterns.length; index++) {
      const pattern = sectionPatterns[index];
      const escapedPattern = escapedPatterns[index];
      const regex = new RegExp(
        `${escapedPattern}(?:\\s*\\(CON\\.\\))?([\\s\\S]*?)(?=${sectionBoundary}|$)`,
        'gi',
      );

      const chunks: string[] = [];
      for (const match of text.matchAll(regex)) {
        const chunk = (match[1] || '').trim();
        if (chunk.length > 0) {
          chunks.push(chunk);
        }
      }

      if (chunks.length > 0) {
        sections[pattern] = chunks.join('\n\n').trim();
      }
    }

    return sections;
  }
}
