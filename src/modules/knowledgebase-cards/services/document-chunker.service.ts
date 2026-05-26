import { Injectable } from '@nestjs/common';

/**
 * DocumentChunkerService (Phase 8, P8.T4).
 *
 * Splits an extracted document into ~700-token chunks preserving
 * heading lineage. Token count is approximated as `chars / 4`.
 *
 * Output chunks carry:
 *   - `ordinal`     — 0-indexed position in the source doc
 *   - `text`        — chunk body
 *   - `headingPath` — array of heading texts that contain this chunk
 *                     (highest level first), so retrieval has context
 */
export interface ChunkInput {
  text: string;
  headings?: Array<{ level: number; text: string; charOffset: number }>;
  targetTokens?: number;
}

export interface DocumentChunk {
  ordinal: number;
  text: string;
  headingPath: string[];
  charStart: number;
  charEnd: number;
}

@Injectable()
export class DocumentChunkerService {
  chunk(input: ChunkInput): DocumentChunk[] {
    const target = (input.targetTokens ?? 700) * 4;
    const text = input.text || '';
    if (text.length === 0) return [];

    const headings = (input.headings ?? []).slice().sort((a, b) => a.charOffset - b.charOffset);
    const out: DocumentChunk[] = [];
    let pos = 0;
    let ordinal = 0;

    while (pos < text.length) {
      const end = this.findCutPoint(text, pos, pos + target);
      const slice = text.slice(pos, end).trim();
      if (slice.length > 0) {
        out.push({
          ordinal,
          text: slice,
          headingPath: this.headingPathAt(headings, pos),
          charStart: pos,
          charEnd: end,
        });
        ordinal += 1;
      }
      pos = end;
    }
    return out;
  }

  /**
   * Prefer to cut at the last paragraph break / sentence end within
   * [minPos, maxPos]. Falls back to maxPos when no break is found.
   */
  private findCutPoint(text: string, minPos: number, maxPos: number): number {
    const upper = Math.min(text.length, maxPos);
    if (upper <= minPos) return upper;
    const window = text.slice(minPos, upper);
    // Prefer double newline
    const para = window.lastIndexOf('\n\n');
    if (para > window.length / 2) return minPos + para + 2;
    // Then a sentence boundary
    const dot = window.lastIndexOf('. ');
    if (dot > window.length / 2) return minPos + dot + 2;
    // Else hard cut
    return upper;
  }

  /**
   * Returns the heading lineage active at `pos` — every heading whose
   * charOffset ≤ pos, deduplicated by level (deepest wins per level).
   */
  private headingPathAt(
    headings: Array<{ level: number; text: string; charOffset: number }>,
    pos: number,
  ): string[] {
    const active = new Map<number, string>();
    for (const h of headings) {
      if (h.charOffset > pos) break;
      // When we hit a new heading at level L, clear deeper levels.
      for (const k of active.keys()) {
        if (k >= h.level) active.delete(k);
      }
      active.set(h.level, h.text);
    }
    return Array.from(active.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, t]) => t);
  }
}
