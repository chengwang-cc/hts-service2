import { Injectable, Logger } from '@nestjs/common';
import { OpenAiService } from '../../../core/services/openai.service';

const INSTRUCTIONS = [
  'You rewrite messy e-commerce product search queries into a short, plain',
  'English product description for customs/HTS tariff classification.',
  '',
  'Output ONLY the rewritten description — no quotes, no explanation, no tariff code.',
  '',
  'Rules:',
  '- Keep the core product, its material, and key physical attributes.',
  '- Remove noise that does not change what the product physically IS:',
  '  grading/condition (PSA 9, BGS 9.5, CGC, graded, mint, brand new, used),',
  '  sizes, quantities, SKUs/model numbers, seller/marketing fluff, prices.',
  '- Normalize word order to natural English',
  '  (e.g. "runners leather" -> "leather running shoes").',
  '- Expand a brand to the generic product only when it clarifies the item',
  '  (e.g. "Nike runners" -> "athletic running shoes"). Never invent a material',
  '  or attribute that is not stated or clearly implied.',
  '- Fix obvious typos. Keep it under ~12 words.',
  '- If it is already a clean product description, return it unchanged.',
  '',
  'Examples:',
  '"Pokemon Trading Card PSA 9" -> "pokemon collectible trading card game card"',
  '"Nike Runners Leather" -> "leather athletic running shoes"',
  '"Carhartt Vest Jacket Womens Size 12-14 Reversible Sherpa Lined" -> "women\'s reversible sherpa-lined work vest"',
  '"hockey card baseball card lot graded" -> "sports trading cards"',
].join('\n');

export interface CanonicalizeResult {
  canonical: string;
  changed: boolean;
}

/**
 * LLM-based query canonicalizer. Rewrites arbitrary, noisy free-text product
 * queries into a clean, classification-ready description BEFORE the hybrid
 * search runs — so word order, grading/size noise, brand names, and typos
 * stop destabilizing retrieval and the rerank.
 *
 * Fail-safe + additive: gated behind QUERY_CANONICALIZER (default off), times
 * out fast, and on any error/empty/suspicious output returns the raw query
 * unchanged — i.e. it can only help, never break, the existing pipeline.
 *
 * The LLM proposes a cleaner QUERY, never a code — every answer is still
 * grounded by the downstream search against real HTS entries.
 */
@Injectable()
export class QueryCanonicalizerService {
  private readonly logger = new Logger(QueryCanonicalizerService.name);
  private readonly enabled =
    (process.env.QUERY_CANONICALIZER ?? 'false').toLowerCase() === 'true';
  private readonly model = process.env.QUERY_CANONICALIZER_MODEL ?? 'gpt-5.4-nano';
  private readonly timeoutMs = Number(process.env.QUERY_CANONICALIZER_TIMEOUT_MS ?? 4000);

  constructor(private readonly openai: OpenAiService) {}

  async canonicalize(query: string): Promise<CanonicalizeResult> {
    const raw = (query ?? '').trim();
    // Skip when disabled, too short to be noisy, or an HTS-code lookup.
    if (!this.enabled || raw.length < 4 || /^[\d.\s]+$/.test(raw)) {
      return { canonical: raw, changed: false };
    }
    try {
      const res = await this.withTimeout(
        this.openai.response(raw, {
          model: this.model,
          temperature: 0,
          max_output_tokens: 120,
          instructions: INSTRUCTIONS,
        }),
        this.timeoutMs,
      );
      const out = ((res as { output_text?: string })?.output_text ?? '')
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/\s+/g, ' ');

      // Guardrails: reject empty, suspiciously long, or non-product output —
      // anything odd degrades to the raw query.
      if (!out || out.length < 2 || out.length > raw.length * 4 + 60) {
        return { canonical: raw, changed: false };
      }
      const changed = out.toLowerCase() !== raw.toLowerCase();
      if (changed) this.logger.log(`[canon] "${raw}" -> "${out}"`);
      return { canonical: out, changed };
    } catch (err) {
      this.logger.debug(`[canon] failed, using raw: ${(err as Error)?.message ?? err}`);
      return { canonical: raw, changed: false };
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`canonicalizer timeout ${ms}ms`)), ms),
      ),
    ]);
  }
}
