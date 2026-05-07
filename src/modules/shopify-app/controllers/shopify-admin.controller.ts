import {
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { SkipJwtAuth } from '../../api-keys/decorators/skip-jwt-auth.decorator';
import { ShopifySessionGuard } from '../guards/shopify-session.guard';
import { ShopifySessionEntity } from '../entities/shopify-session.entity';
import { ConnectorService } from '../../connectors/services/connector.service';
import { ShopifyConnector } from '../../connectors/services/shopify.connector';

@SkipJwtAuth()
@Controller('shopify/api')
@UseGuards(ShopifySessionGuard)
export class ShopifyAdminController {
  private readonly logger = new Logger(ShopifyAdminController.name);

  constructor(
    private readonly connectorService: ConnectorService,
    private readonly shopifyConnector: ShopifyConnector,
  ) {}

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
