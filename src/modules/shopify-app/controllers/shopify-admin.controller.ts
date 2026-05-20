import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SkipJwtAuth } from '../../api-keys/decorators/skip-jwt-auth.decorator';
import { ShopifySessionGuard } from '../guards/shopify-session.guard';
import { ShopifySessionEntity } from '../entities/shopify-session.entity';
import { ConnectorService } from '../../connectors/services/connector.service';
import { ShopifyConnector } from '../../connectors/services/shopify.connector';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { ApiKeyService } from '../../api-keys/services/api-key.service';
import { ShopifyOrderTransactionsService } from '../services/shopify-order-transactions.service';
import { CreditPurchaseService } from '../../billing/services/credit-purchase.service';
import { BillingChargeService } from '../../billing/services/billing-charge.service';
import { AuthService } from '../../auth/services/auth.service';

const VALID_DUTY_MODES = ['ddu', 'ddp', 'disabled'] as const;
type DutyDisplayMode = (typeof VALID_DUTY_MODES)[number];

interface ShopifySettingsPayload {
  calculateDuty: boolean;
  displayAtCheckout: boolean;
  /**
   * @deprecated Kept in responses for one release to keep older checkout
   * extension builds compatible during rollout. Derived from the booleans.
   */
  dutyDisplayMode: DutyDisplayMode;
}

function serializeSettings(session: ShopifySessionEntity): ShopifySettingsPayload {
  // Defensive coalesce: rows that pre-date the bool-flags migration may
  // briefly have undefined values during a rollback window.
  const calculateDuty = session.calculateDuty ?? true;
  const displayAtCheckout = (session.displayAtCheckout ?? true) && calculateDuty;
  const dutyDisplayMode: DutyDisplayMode = !calculateDuty
    ? 'disabled'
    : ((session.dutyDisplayMode as DutyDisplayMode) || 'ddu');
  return { calculateDuty, displayAtCheckout, dutyDisplayMode };
}

@SkipJwtAuth()
@Controller('shopify/api')
@UseGuards(ShopifySessionGuard)
export class ShopifyAdminController {
  private readonly logger = new Logger(ShopifyAdminController.name);

  constructor(
    private readonly connectorService: ConnectorService,
    private readonly shopifyConnector: ShopifyConnector,
    private readonly apiKeyService: ApiKeyService,
    private readonly transactionsService: ShopifyOrderTransactionsService,
    private readonly creditPurchaseService: CreditPurchaseService,
    private readonly billingChargeService: BillingChargeService,
    private readonly authService: AuthService,
    @InjectRepository(ShopifySessionEntity)
    private readonly sessionRepository: Repository<ShopifySessionEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly organizationRepository: Repository<OrganizationEntity>,
  ) {}

  /**
   * POST /shopify/api/connect
   * Link Shopify session to an HTS account via account number + credential token.
   * Body: { accountNumber: string (orgId), credentialToken: string (API key) }
   */
  @Post('connect')
  async connectAccount(
    @Req() req: any,
    @Body() body: { accountNumber?: string; credentialToken?: string },
  ) {
    const session: ShopifySessionEntity = req.shopifySession;
    const accountNumber = (body.accountNumber || '').trim();
    const credentialToken = (body.credentialToken || '').trim();

    if (!accountNumber || !credentialToken) {
      throw new HttpException(
        'Both accountNumber and credentialToken are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 1. Validate accountNumber → organization exists and is active
    const org = await this.organizationRepository.findOne({
      where: { id: accountNumber, isActive: true },
    });
    if (!org) {
      throw new HttpException(
        'Invalid account number. Please check your HTS Dashboard.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // 2. Validate credential token belongs to that organization
    let apiKey;
    try {
      apiKey = await this.apiKeyService.validateApiKey(credentialToken);
    } catch {
      throw new HttpException(
        'Invalid credential token. Please check your HTS Dashboard.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (apiKey.organizationId !== accountNumber) {
      throw new HttpException(
        'Credential token does not belong to the specified account.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // 3. Create or reuse connector for this shop (idempotent — handles double-click and re-link)
    let connectorId: string;
    const existingConnector = await this.connectorService.findConnectorByShopDomain(session.shop);
    if (existingConnector) {
      if (existingConnector.organizationId !== accountNumber) {
        // Shop was previously linked to a different organization. Refuse to silently re-link.
        throw new HttpException(
          'This Shopify store is already linked to another HTS account. Please contact support to transfer it.',
          HttpStatus.CONFLICT,
        );
      }
      // Same org: reactivate + refresh access token (handles re-install, double-click, etc.)
      await this.connectorService.updateConnector(
        existingConnector.id,
        accountNumber,
        {
          isActive: true,
          config: { shopUrl: session.shop, accessToken: session.accessToken },
        },
      );
      connectorId = existingConnector.id;
      this.logger.log(`Reactivated connector ${connectorId} for ${session.shop}`);
    } else {
      const connector = await this.connectorService.createConnector(accountNumber, {
        connectorType: 'shopify',
        name: `Shopify: ${session.shop}`,
        config: { shopUrl: session.shop, accessToken: session.accessToken },
      });
      connectorId = connector.id;
      this.logger.log(`Created connector ${connectorId} for ${session.shop}`);
    }

    // 4. Link session
    session.organizationId = accountNumber;
    session.connectorId = connectorId;
    await this.sessionRepository.save(session);

    // 5. Register product/order webhooks now that the shop is linked
    const webhookUrl = `${process.env.API_BASE_URL ?? 'https://api.usahts.com'}/api/v1/webhooks/shopify`;
    const config = { shopUrl: session.shop, accessToken: session.accessToken };
    const topics = ['products/create', 'products/update', 'orders/create', 'app/uninstalled'];
    for (const topic of topics) {
      try {
        await this.shopifyConnector.createWebhook(config, webhookUrl, topic);
      } catch (e: any) {
        if (!e.message?.includes('already exists') && !e.message?.includes('has already been taken')) {
          this.logger.warn(`Webhook ${topic} registration failed for ${session.shop}: ${e.message}`);
        }
      }
    }

    return {
      success: true,
      connectorId,
      organizationName: org.name,
    };
  }

  /**
   * POST /shopify/api/provision
   *
   * Phase 5: one-call auto-onboard for an installing merchant. Looks at
   * the current Shopify session and:
   *   1. If a connector already exists for this shop (re-install case),
   *      reuses its organization and relinks the session.
   *   2. Otherwise, auto-creates a brand-new organization + user from
   *      the Shopify shop info (queried via GraphQL with the session's
   *      access token), issues an API key, grants the Phase 4 signup
   *      bonus, creates a fresh connector, and links the session.
   *
   * Idempotent: safe to call multiple times. Returns the same shape as
   * /connect so the embedded admin can treat them interchangeably.
   *
   * No body required — everything comes from the Shopify session.
   */
  @Post('provision')
  async provisionFromShopify(@Req() req: any) {
    const session: ShopifySessionEntity = req.shopifySession;

    // Fast path: session already linked. Just return the current state so
    // the embedded admin can move on to the Overview tab.
    if (session.organizationId && session.connectorId) {
      const org = await this.organizationRepository.findOne({
        where: { id: session.organizationId },
      });
      return {
        success: true,
        mode: 'already_linked',
        connectorId: session.connectorId,
        organizationId: session.organizationId,
        organizationName: org?.name ?? null,
      };
    }

    let organizationId: string;
    let organizationName: string | null = null;
    let mode: 'reinstall' | 'signin' | 'created';
    let createdUserSyntheticEmail = false;

    // 1. Reinstall: an active connector already exists for this shop.
    //    The session was reset by the OAuth callback but the org is intact.
    const existingConnector =
      await this.connectorService.findConnectorByShopDomain(session.shop);

    if (existingConnector) {
      organizationId = existingConnector.organizationId;
      mode = 'reinstall';
      const org = await this.organizationRepository.findOne({
        where: { id: organizationId },
      });
      organizationName = org?.name ?? null;

      // Refresh the connector's access token in case Shopify reissued it
      // after the reinstall.
      await this.connectorService.updateConnector(
        existingConnector.id,
        organizationId,
        {
          isActive: true,
          config: { shopUrl: session.shop, accessToken: session.accessToken },
        },
      );

      session.organizationId = organizationId;
      session.connectorId = existingConnector.id;
      await this.sessionRepository.save(session);
    } else {
      // 2. Brand-new merchant — auto-create org + user via Shopify info.
      const shopInfo = await this.shopifyConnector.getShopInfo({
        shopUrl: session.shop,
        accessToken: session.accessToken,
      });

      const provision = await this.authService.createUserFromShopify({
        shopDomain: session.shop,
        shopEmail: shopInfo.contactEmail || shopInfo.email,
        shopName: shopInfo.name,
        country: shopInfo.country,
      });
      organizationId = provision.organization.id;
      organizationName = provision.organization.name;
      createdUserSyntheticEmail = provision.usedSyntheticEmail;
      mode = 'created';

      // Generate a default API key so the merchant has one in the dashboard
      // — matches what the email/Google register flow does.
      try {
        await this.apiKeyService.generateApiKey({
          organizationId,
          name: 'Shopify integration',
          description: `Auto-issued on Shopify install for ${session.shop}`,
          environment: 'live',
          permissions: ['hts:lookup', 'hts:calculate', 'kb:query'],
          createdBy: provision.user.id,
        });
      } catch (err: any) {
        this.logger.warn(
          `Auto-issue API key failed for new org ${organizationId}: ${err?.message ?? err}`,
        );
      }

      // Bind the connector to the brand-new org.
      const connector = await this.connectorService.createConnector(
        organizationId,
        {
          connectorType: 'shopify',
          name: `Shopify: ${session.shop}`,
          config: { shopUrl: session.shop, accessToken: session.accessToken },
        },
      );

      session.organizationId = organizationId;
      session.connectorId = connector.id;
      await this.sessionRepository.save(session);

      this.logger.log(
        `Auto-provisioned org ${organizationId} (${organizationName}) + user ${provision.user.id} for ${session.shop}`,
      );
    }

    // Register webhooks regardless of mode (idempotent on Shopify's side).
    const webhookUrl = `${process.env.API_BASE_URL ?? 'https://api.usahts.com'}/api/v1/webhooks/shopify`;
    const config = { shopUrl: session.shop, accessToken: session.accessToken };
    const topics = [
      'products/create',
      'products/update',
      'orders/create',
      'app/uninstalled',
    ];
    for (const topic of topics) {
      try {
        await this.shopifyConnector.createWebhook(config, webhookUrl, topic);
      } catch (e: any) {
        if (
          !e.message?.includes('already exists') &&
          !e.message?.includes('has already been taken')
        ) {
          this.logger.warn(
            `Webhook ${topic} registration failed for ${session.shop}: ${e.message}`,
          );
        }
      }
    }

    return {
      success: true,
      mode,
      connectorId: session.connectorId,
      organizationId,
      organizationName,
      usedSyntheticEmail: createdUserSyntheticEmail,
    };
  }

  /**
   * POST /shopify/api/dashboard-link
   *
   * Issues a one-shot signed handoff URL the embedded admin can open in a
   * new tab to land the merchant signed into the HTS website dashboard
   * (where they can top up credits, view transactions, edit their
   * profile, etc.). The merchant doesn't need to remember a password —
   * the embedded Shopify session is the trust anchor.
   *
   * The handoff token is just a normal access JWT generated via
   * AuthService.login(); the website's /auth/shopify-handoff route reads
   * it from the query string, stores it as the access token, and bounces
   * to the dashboard.
   */
  @Post('dashboard-link')
  async dashboardLink(@Req() req: any) {
    const session: ShopifySessionEntity = req.shopifySession;
    if (!session.organizationId) {
      throw new HttpException(
        'This Shopify store is not linked to an HTS account yet. Click "Connect this store" first.',
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }

    // Resolve a representative user for the org. Pick the most recent
    // non-deactivated user — usually the one auto-provisioned at install
    // (or the org admin for legacy-linked accounts).
    const session_user = await this.sessionRepository.manager
      .createQueryBuilder()
      .select('u.id', 'id')
      .from('users', 'u')
      .where('u.organization_id = :orgId', { orgId: session.organizationId })
      .andWhere('u.is_active = true')
      .orderBy('u.created_at', 'DESC')
      .limit(1)
      .getRawOne<{ id: string }>();

    if (!session_user?.id) {
      throw new HttpException(
        'No active user found for this organization. Contact support.',
        HttpStatus.NOT_FOUND,
      );
    }

    const auth = await this.authService.login({ id: session_user.id });
    const websiteBase =
      process.env.WEBSITE_BASE_URL?.replace(/\/$/, '') ||
      'https://www.usahts.com';
    const target = req.query?.target === 'transactions'
      ? '/dashboard'
      : (typeof req.query?.target === 'string' ? '/dashboard' : '/dashboard');
    const url =
      `${websiteBase}/auth/shopify-handoff` +
      `?accessToken=${encodeURIComponent(auth.tokens.accessToken)}` +
      `&refreshToken=${encodeURIComponent(auth.tokens.refreshToken)}` +
      `&returnTo=${encodeURIComponent(target)}`;

    return { url };
  }

  /**
   * GET /shopify/api/settings
   * Returns the two boolean flags plus a `dutyDisplayMode` compatibility
   * field derived from them (will be removed once the checkout extension
   * fully migrates).
   */
  @Get('settings')
  async getSettings(@Req() req: any): Promise<ShopifySettingsPayload> {
    const session: ShopifySessionEntity = req.shopifySession;
    return serializeSettings(session);
  }

  /**
   * Update merchant settings for this shop.
   * PATCH is the canonical method; POST is kept as an alias for one
   * release so older embedded-app builds keep working.
   *
   * Accepted fields:
   *   - calculateDuty: boolean
   *   - displayAtCheckout: boolean (forced to false if calculateDuty is false)
   *   - dutyDisplayMode: string (DEPRECATED — accepted for one release;
   *     internally mapped to the new booleans)
   */
  @Patch('settings')
  @Post('settings')
  async updateSettings(
    @Req() req: any,
    @Body()
    body: {
      calculateDuty?: boolean;
      displayAtCheckout?: boolean;
      dutyDisplayMode?: string;
    },
  ): Promise<ShopifySettingsPayload> {
    const session: ShopifySessionEntity = req.shopifySession;

    // Legacy path: translate dutyDisplayMode → booleans for old clients.
    if (body.dutyDisplayMode !== undefined) {
      if (!VALID_DUTY_MODES.includes(body.dutyDisplayMode as DutyDisplayMode)) {
        throw new HttpException(
          `Invalid dutyDisplayMode. Must be one of: ${VALID_DUTY_MODES.join(', ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      const mode = body.dutyDisplayMode as DutyDisplayMode;
      session.dutyDisplayMode = mode;
      session.calculateDuty = mode !== 'disabled';
      session.displayAtCheckout = mode !== 'disabled';
    }

    if (typeof body.calculateDuty === 'boolean') {
      session.calculateDuty = body.calculateDuty;
    }
    if (typeof body.displayAtCheckout === 'boolean') {
      session.displayAtCheckout = body.displayAtCheckout;
    }

    // Invariant: cannot display what we haven't calculated.
    if (!session.calculateDuty) {
      session.displayAtCheckout = false;
    }

    // Keep the deprecated column in sync so a rollback window stays safe.
    session.dutyDisplayMode = !session.calculateDuty ? 'disabled' : 'ddu';

    await this.sessionRepository.save(session);
    this.logger.log(
      `Settings updated for ${session.shop}: calculateDuty=${session.calculateDuty} displayAtCheckout=${session.displayAtCheckout}`,
    );

    return serializeSettings(session);
  }

  /**
   * GET /shopify/api/status
   * Returns the current connection and sync status for the embedded app.
   */
  @Get('status')
  async getStatus(@Req() req: any) {
    const session: ShopifySessionEntity = req.shopifySession;

    let connectorInfo: {
      id: string;
      status: string;
      lastSyncAt: Date | null;
      lastError: string | null;
    } | null = null;
    let stats: any = null;
    let recentLogs: any = null;

    if (session.connectorId && session.organizationId) {
      try {
        const connector = await this.connectorService.getConnector(
          session.connectorId,
          session.organizationId,
        );
        connectorInfo = {
          id: connector.id,
          status: connector.status,
          lastSyncAt: connector.lastSyncAt,
          lastError: connector.lastError,
        };
        stats = await this.connectorService.getConnectorStats(
          session.connectorId,
          session.organizationId,
        );
        recentLogs = await this.connectorService.getSyncLogs(
          session.connectorId,
          session.organizationId,
          5,
        );
      } catch {
        // Connector may have been deleted
      }
    }

    return {
      shop: session.shop,
      isActive: session.isActive,
      installedAt: session.installedAt,
      scopes: session.scopes,
      requiresSetup: !session.organizationId || !session.connectorId,
      connector: connectorInfo,
      stats,
      recentLogs,
    };
  }

  /**
   * POST /shopify/api/sync
   * Trigger a manual product sync from the embedded app.
   */
  @Post('sync')
  async triggerSync(@Req() req: any) {
    const session: ShopifySessionEntity = req.shopifySession;

    if (!session.connectorId || !session.organizationId) {
      return { success: false, message: 'No connector configured for this shop' };
    }

    const syncLog = await this.connectorService.syncConnector(
      session.connectorId,
      session.organizationId,
      { syncType: 'import' },
    );

    return {
      success: true,
      syncLog: {
        id: syncLog.id,
        status: syncLog.status,
        itemsProcessed: syncLog.itemsProcessed,
        itemsSucceeded: syncLog.itemsSucceeded,
        itemsFailed: syncLog.itemsFailed,
      },
    };
  }

  /**
   * GET /shopify/api/products
   * List products from the Shopify store with their current HS codes.
   */
  @Get('products')
  async getProducts(@Req() req: any) {
    const session: ShopifySessionEntity = req.shopifySession;

    const config = {
      shopUrl: session.shop,
      accessToken: session.accessToken,
    };

    const products = await this.shopifyConnector.importProducts(config, {
      limit: 50,
      maxPages: 1,
    });

    return {
      products: products.map((p) => ({
        id: p.id,
        title: p.title,
        variants: p.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          hsCode: v.harmonizedSystemCode || null,
          countryOfOrigin: v.countryCodeOfOrigin || null,
        })),
      })),
      total: products.length,
    };
  }

  /**
   * GET /shopify/api/transactions
   * Per-order duty/tax calculations for the embedded admin's Transactions
   * tab. Org-scoped via the Shopify session, paginated, optionally
   * date-filtered (`since` / `until` are ISO 8601 strings).
   */
  @Get('transactions')
  async listTransactions(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    const session: ShopifySessionEntity = req.shopifySession;
    if (!session.organizationId) {
      // Embedded app was opened before the merchant completed the
      // accountNumber + credentialToken connect flow. Nothing to list.
      return { total: 0, limit: 25, offset: 0, items: [] };
    }

    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const parsedOffset = offset ? Number.parseInt(offset, 10) : undefined;
    const sinceDate = parseDateOrNull(since);
    const untilDate = parseDateOrNull(until);

    return this.transactionsService.list(session.organizationId, {
      limit: Number.isFinite(parsedLimit) ? (parsedLimit as number) : undefined,
      offset: Number.isFinite(parsedOffset)
        ? (parsedOffset as number)
        : undefined,
      since: sinceDate,
      until: untilDate,
    });
  }

  /**
   * GET /shopify/api/credits
   * Credit balance + pricing for the embedded admin Overview tab.
   * Mirrors the website's /billing/credits but scoped via Shopify session.
   */
  @Get('credits')
  async getCredits(@Req() req: any) {
    const session: ShopifySessionEntity = req.shopifySession;
    if (!session.organizationId) {
      return {
        balance: 0,
        lifetimePurchased: 0,
        lifetimeUsed: 0,
        lastUsedAt: null,
        lastPurchaseAt: null,
        pricing: {
          perCallCredits: this.billingChargeService.perCallCredits(),
          perCreditCents: this.billingChargeService.perCreditCents(),
        },
        billingEnabled: this.billingChargeService.isBillingEnabled(),
        requiresSetup: true,
      };
    }
    const row = await this.creditPurchaseService.getBalanceRow(
      session.organizationId,
    );
    return {
      balance: row?.balance ?? 0,
      lifetimePurchased: row?.lifetimePurchased ?? 0,
      lifetimeUsed: row?.lifetimeUsed ?? 0,
      lastUsedAt: row?.lastUsedAt ?? null,
      lastPurchaseAt: row?.lastPurchaseAt ?? null,
      pricing: {
        perCallCredits: this.billingChargeService.perCallCredits(),
        perCreditCents: this.billingChargeService.perCreditCents(),
      },
      billingEnabled: this.billingChargeService.isBillingEnabled(),
      requiresSetup: false,
    };
  }
}

function parseDateOrNull(raw?: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
