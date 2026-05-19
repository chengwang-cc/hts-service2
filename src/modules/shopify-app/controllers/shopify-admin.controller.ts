import {
  Controller,
  Get,
  Post,
  Body,
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

const VALID_DUTY_MODES = ['ddu', 'ddp', 'disabled'] as const;
type DutyDisplayMode = (typeof VALID_DUTY_MODES)[number];

@SkipJwtAuth()
@Controller('shopify/api')
@UseGuards(ShopifySessionGuard)
export class ShopifyAdminController {
  private readonly logger = new Logger(ShopifyAdminController.name);

  constructor(
    private readonly connectorService: ConnectorService,
    private readonly shopifyConnector: ShopifyConnector,
    private readonly apiKeyService: ApiKeyService,
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
   * GET /shopify/api/settings
   * Get merchant settings for this shop.
   */
  @Get('settings')
  async getSettings(@Req() req: any) {
    const session: ShopifySessionEntity = req.shopifySession;
    return {
      dutyDisplayMode: session.dutyDisplayMode || 'ddu',
    };
  }

  /**
   * POST /shopify/api/settings
   * Update merchant settings for this shop.
   */
  @Post('settings')
  async updateSettings(
    @Req() req: any,
    @Body() body: { dutyDisplayMode?: string },
  ) {
    const session: ShopifySessionEntity = req.shopifySession;

    if (body.dutyDisplayMode && !VALID_DUTY_MODES.includes(body.dutyDisplayMode as DutyDisplayMode)) {
      throw new HttpException(
        `Invalid dutyDisplayMode. Must be one of: ${VALID_DUTY_MODES.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (body.dutyDisplayMode) {
      session.dutyDisplayMode = body.dutyDisplayMode;
      await this.sessionRepository.save(session);
      this.logger.log(`Settings updated for ${session.shop}: dutyDisplayMode=${body.dutyDisplayMode}`);
    }

    return {
      dutyDisplayMode: session.dutyDisplayMode,
    };
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
}
