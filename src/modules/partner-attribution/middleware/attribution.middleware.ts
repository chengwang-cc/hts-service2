import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request, Response, NextFunction } from 'express';
import { ApiKeyService } from '../../api-keys/services/api-key.service';
import { PartnerOriginCacheService } from '../services/partner-origin-cache.service';
import { PartnerResolverService } from '../services/partner-resolver.service';
import { PartnerUserEntity } from '../entities/partner-user.entity';
import type { RequestAttribution } from '../types';

/**
 * Resolves (partner, end-user) for every request and stamps the result on
 * `req.attribution`. Runs after CORS, before route handlers.
 *
 * Resolution precedence (first match wins):
 *   1. X-Partner-Key  →  partner = key.organization, source='partner_key'
 *   2. X-API-Key      →  partner = key.organization, source='api_key'
 *   3. Origin match   →  partner = partner_origins.organization, source='origin'
 *   4. Fallback       →  partner = 'unknown' sentinel,           source='unknown'
 *
 * End-user (independent of partner resolution):
 *   1. X-Partner-User-Token (JWT) — verified in P2; falls through in P1
 *   2. X-Partner-User-Id          — partner-asserted, untrusted
 *   3. None                       — partnerUserId = null
 *
 * Never throws on invalid headers — bad input degrades to the next precedence
 * level. The middleware is a side-channel observer, not an auth gate. Routes
 * that require auth still rely on ApiKeyGuard / JwtAuthGuard.
 */
@Injectable()
export class AttributionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AttributionMiddleware.name);
  /** Small LRU to avoid hammering partner_users with duplicate upserts. */
  private readonly recentlySeen = new Map<string, string>(); // key=`${partnerId}:${externalId}` → partnerUserId
  private static readonly LRU_MAX = 5000;

  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly originCache: PartnerOriginCacheService,
    private readonly partnerResolver: PartnerResolverService,
    @InjectRepository(PartnerUserEntity)
    private readonly partnerUsers: Repository<PartnerUserEntity>,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const origin = this.headerValue(req, 'origin');
    const attribution = await this.resolve(req, origin);
    req.attribution = attribution;
    next();
  }

  private async resolve(req: Request, origin: string | null): Promise<RequestAttribution> {
    // ── partner resolution ──────────────────────────────────────────────────
    const partnerKey = this.headerValue(req, 'x-partner-key');
    const apiKey = this.headerValue(req, 'x-api-key');
    const rawKey = partnerKey ?? apiKey;
    let partnerId: string | null = null;
    let attributionSource: RequestAttribution['attributionSource'] = 'unknown';
    let apiKeyId: string | null = null;

    if (rawKey) {
      try {
        const validated = await this.apiKeys.validateApiKey(rawKey);
        partnerId = validated.organizationId;
        apiKeyId = validated.id;
        attributionSource = partnerKey ? 'partner_key' : 'api_key';
      } catch {
        // Invalid key — fall through to origin matching. ApiKeyGuard handles 401 on protected routes.
      }
    }

    if (!partnerId && origin) {
      const match = this.originCache.resolve(origin);
      if (match) {
        partnerId = match.organizationId;
        attributionSource = 'origin';
      }
    }

    if (!partnerId) {
      partnerId = this.partnerResolver.unknownPartnerId();
      attributionSource = 'unknown';
    }

    // If even the unknown sentinel isn't seeded, log loudly but don't break the request.
    if (!partnerId) {
      this.logger.warn(
        "AttributionMiddleware: no partnerId resolved AND 'unknown' sentinel is not seeded — usage row will have null partner.",
      );
    }

    // ── end-user resolution ─────────────────────────────────────────────────
    const externalUserId = this.resolveExternalUserId(req);
    const partnerUserId =
      externalUserId && partnerId ? await this.upsertPartnerUser(partnerId, externalUserId) : null;

    return {
      partnerId: partnerId ?? '',
      apiKeyId,
      organizationId: partnerId ?? '',
      attributionSource,
      origin,
      externalUserId,
      partnerUserId,
      extras: {},
    };
  }

  /**
   * Currently only the asserted form (X-Partner-User-Id). JWT verification
   * is P2 — when X-Partner-User-Token is present in P1 we just ignore it.
   */
  private resolveExternalUserId(req: Request): string | null {
    const asserted = this.headerValue(req, 'x-partner-user-id');
    if (asserted) {
      const trimmed = asserted.trim().slice(0, 255);
      return trimmed || null;
    }
    return null;
  }

  /**
   * LRU-cached upsert. Returns the partner_users.id without round-tripping
   * to the DB when the (partner, externalId) pair was seen recently.
   */
  private async upsertPartnerUser(partnerId: string, externalUserId: string): Promise<string | null> {
    const cacheKey = `${partnerId}:${externalUserId}`;
    const cached = this.recentlySeen.get(cacheKey);
    if (cached) {
      // Touch ordering: re-set to move to the end
      this.recentlySeen.delete(cacheKey);
      this.recentlySeen.set(cacheKey, cached);
      return cached;
    }
    try {
      // Upsert by unique (organizationId, externalUserId)
      const existing = await this.partnerUsers.findOne({
        where: { organizationId: partnerId, externalUserId },
        select: ['id'],
      });
      if (existing) {
        // Touch last_seen_at + request_count asynchronously
        void this.partnerUsers
          .createQueryBuilder()
          .update(PartnerUserEntity)
          .set({ lastSeenAt: new Date(), requestCount: () => 'request_count + 1' })
          .where('id = :id', { id: existing.id })
          .execute()
          .catch((err) =>
            this.logger.debug(`partner_users touch failed for ${existing.id}: ${err?.message}`),
          );
        this.rememberInLru(cacheKey, existing.id);
        return existing.id;
      }
      const created = await this.partnerUsers.save({
        organizationId: partnerId,
        externalUserId,
        requestCount: '1',
      });
      this.rememberInLru(cacheKey, created.id);
      return created.id;
    } catch (err) {
      this.logger.debug(`partner_users upsert failed for (${partnerId}, ${externalUserId}): ${(err as Error)?.message}`);
      return null;
    }
  }

  private rememberInLru(key: string, value: string): void {
    if (this.recentlySeen.size >= AttributionMiddleware.LRU_MAX) {
      // Evict oldest (Maps preserve insertion order)
      const firstKey = this.recentlySeen.keys().next().value;
      if (firstKey !== undefined) this.recentlySeen.delete(firstKey);
    }
    this.recentlySeen.set(key, value);
  }

  private headerValue(req: Request, name: string): string | null {
    const v = req.headers[name];
    if (Array.isArray(v)) return v[0] ?? null;
    return v ?? null;
  }
}
