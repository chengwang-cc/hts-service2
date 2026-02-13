import { Injectable, Logger } from '@nestjs/common';
import pdfParse from 'pdf-parse';

@Injectable()
export class PdfParserService {
  private readonly logger = new Logger(PdfParserService.name);

  async parsePdf(pdfBuffer: Buffer): Promise<string> {
    try {
      const data = await pdfParse(pdfBuffer);
      return data.text;
    } catch (error) {
      this.logger.error(`PDF parsing failed: ${error.message}`);
      throw error;
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
