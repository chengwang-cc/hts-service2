import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PartnerOriginEntity } from '../entities/partner-origin.entity';

/**
 * In-memory cache of compiled origin patterns. Loaded once on boot,
 * refreshed every 5 minutes (origin patterns rarely change — partner
 * onboarding triggers a refresh manually via `refresh()`).
 *
 * Specificity ordering: patterns with longer literal prefixes (no globs in
 * the first N chars) win, so `merchant.proto.com` is preferred over
 * `*.proto.com` when both match a given Origin.
 */
interface CompiledPattern {
  organizationId: string;
  pattern: string;
  regex: RegExp;
  /** Length of the literal prefix used for specificity scoring. */
  specificity: number;
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class PartnerOriginCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PartnerOriginCacheService.name);
  private compiled: CompiledPattern[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private warnedEmpty = false;

  constructor(
    @InjectRepository(PartnerOriginEntity)
    private readonly originRepo: Repository<PartnerOriginEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err) =>
        this.logger.error(`Origin cache refresh failed: ${err?.message ?? err}`),
      );
    }, REFRESH_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  async refresh(): Promise<void> {
    const rows = await this.originRepo.find({ where: { isActive: true } });
    const compiled = rows
      .map((row) => this.compile(row))
      .filter((c): c is CompiledPattern => c !== null)
      .sort((a, b) => b.specificity - a.specificity);
    this.compiled = compiled;
    if (compiled.length === 0 && !this.warnedEmpty) {
      this.logger.warn(
        'Partner origin cache is empty — no active partner_origins rows. All anonymous traffic will fall back to the unknown partner.',
      );
      this.warnedEmpty = true;
    } else if (compiled.length > 0) {
      this.warnedEmpty = false;
    }
    this.logger.log(`Origin cache loaded: ${compiled.length} active pattern(s)`);
  }

  /**
   * Resolve an Origin header to an organization. Returns null when nothing matches.
   * Pure function over the compiled cache; safe to call at request frequency.
   */
  resolve(origin: string | undefined | null): { organizationId: string; pattern: string } | null {
    if (!origin) return null;
    const normalized = this.normalize(origin);
    if (!normalized) return null;
    for (const c of this.compiled) {
      if (c.regex.test(normalized)) {
        return { organizationId: c.organizationId, pattern: c.pattern };
      }
    }
    return null;
  }

  /** Test helper / debug — returns a snapshot of the loaded patterns. */
  snapshot(): ReadonlyArray<{ organizationId: string; pattern: string; specificity: number }> {
    return this.compiled.map((c) => ({
      organizationId: c.organizationId,
      pattern: c.pattern,
      specificity: c.specificity,
    }));
  }

  private compile(row: PartnerOriginEntity): CompiledPattern | null {
    try {
      const regex = this.globToRegex(row.originPattern);
      return {
        organizationId: row.organizationId,
        pattern: row.originPattern,
        regex,
        specificity: this.specificityOf(row.originPattern),
      };
    } catch (err) {
      this.logger.warn(
        `Skipping invalid origin pattern "${row.originPattern}" for org ${row.organizationId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Compile a glob like `*.chitchats.com` to a RegExp matching origin strings
   * like `https://www.chitchats.com` or `https://merchant.chitchats.com:443`.
   *
   * Supported forms:
   *   - 'https://www.example.com'  → exact origin match
   *   - 'www.example.com'          → matches https:// + www.example.com (any port)
   *   - '*.example.com'            → matches any subdomain
   */
  private globToRegex(pattern: string): RegExp {
    // Strip protocol — we accept patterns with or without one
    const hasProtocol = /^https?:\/\//i.test(pattern);
    const host = hasProtocol ? pattern.replace(/^https?:\/\//i, '') : pattern;
    // Escape regex special chars except '*' which becomes a non-dot wildcard
    const escaped = host.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+');
    return new RegExp(`^https?:\\/\\/${escaped}(?::\\d+)?$`, 'i');
  }

  /**
   * Length of the literal (non-glob) suffix. Longer literal = more specific.
   * `merchant.proto.com` → 18, `*.proto.com` → 10.
   */
  private specificityOf(pattern: string): number {
    const star = pattern.lastIndexOf('*');
    return star === -1 ? pattern.length : pattern.length - star - 1;
  }

  /** Strip trailing slash from origins; '' / null short-circuit. */
  private normalize(origin: string): string | null {
    const trimmed = origin.trim();
    if (!trimmed) return null;
    return trimmed.replace(/\/+$/, '');
  }
}
