import { Injectable, Logger } from '@nestjs/common';
import { PdfParserService } from '../../knowledgebase/services/pdf-parser.service';

/**
 * DocumentExtractorService (Phase 8, P8.T3).
 *
 * Converts a raw document buffer or URL response body into plain text
 * + structural heading lineage, dispatching on MIME type:
 *
 *   - application/pdf            → PdfParserService (pdftotext)
 *   - text/html, application/xhtml → minimal HTML strip (no external deps)
 *   - text/plain                  → as-is
 *   - text/markdown               → as-is (newline-preserving)
 *
 * DOCX support is a follow-up — requires `mammoth` which is not yet
 * installed. Returns a clear error in the meantime.
 */
export interface ExtractInput {
  buffer: Buffer;
  contentType: string;
  /** Optional source URL for log context. */
  sourceUrl?: string | null;
}

export interface ExtractedDocument {
  text: string;
  headings: Array<{ level: number; text: string; charOffset: number }>;
  pageCount?: number;
}

@Injectable()
export class DocumentExtractorService {
  private readonly logger = new Logger(DocumentExtractorService.name);

  constructor(private readonly pdf: PdfParserService) {}

  async extract(input: ExtractInput): Promise<ExtractedDocument> {
    const ct = (input.contentType || '').toLowerCase();
    if (ct.includes('pdf')) return this.extractPdf(input);
    if (ct.includes('html') || ct.includes('xhtml')) return this.extractHtml(input);
    if (ct.includes('plain') || ct.includes('markdown') || ct.includes('text/')) {
      return this.extractText(input);
    }
    if (ct.includes('officedocument.wordprocessingml')) {
      throw new Error(
        'DOCX extraction not yet wired (requires `mammoth` dependency). Convert to PDF or HTML for now.',
      );
    }
    // Last-resort: try as text. Many CSMS / FR pages serve text/html
    // but with text/octet-stream from some CDNs; this keeps the
    // pipeline running for unknown CTs.
    this.logger.debug(`unknown contentType "${ct}" — extracting as text`);
    return this.extractText(input);
  }

  private async extractPdf(input: ExtractInput): Promise<ExtractedDocument> {
    const text = await this.pdf.parsePdf(input.buffer);
    return {
      text: text.trim(),
      headings: extractHeadings(text),
    };
  }

  private async extractHtml(input: ExtractInput): Promise<ExtractedDocument> {
    const raw = input.buffer.toString('utf8');
    // Strip script + style blocks entirely.
    const noScript = raw.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
    // Capture h1..h6 BEFORE stripping tags.
    const headings: Array<{ level: number; text: string; charOffset: number }> = [];
    const headingRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let stripped = noScript.replace(headingRe, (_full, lvl: string, body: string, offset: number) => {
      const cleaned = body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (cleaned) {
        headings.push({ level: Number(lvl), text: cleaned, charOffset: offset });
      }
      return `\n\n## ${cleaned}\n\n`;
    });
    // Strip remaining tags + decode common entities.
    stripped = stripped
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, ' ')
      .trim();
    return { text: stripped, headings };
  }

  private async extractText(input: ExtractInput): Promise<ExtractedDocument> {
    const text = input.buffer.toString('utf8').trim();
    return { text, headings: extractHeadings(text) };
  }
}

/**
 * Best-effort heading extraction from plain text: lines that look like
 * markdown headings (#, ##) or short all-caps lines are treated as
 * headings. Tolerant: returns [] if nothing matches.
 */
function extractHeadings(
  text: string,
): Array<{ level: number; text: string; charOffset: number }> {
  const out: Array<{ level: number; text: string; charOffset: number }> = [];
  const re = /^(#{1,6})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ level: m[1].length, text: m[2].trim(), charOffset: m.index });
  }
  return out;
}
