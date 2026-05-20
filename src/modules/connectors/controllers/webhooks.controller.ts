import {
  Controller,
  Post,
  Headers,
  Req,
  HttpException,
  HttpStatus,
  Logger,
  RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { Public } from '../../auth/decorators/public.decorator';
import { ConnectorService } from '../services/connector.service';
import { ShopifyConnector } from '../services/shopify.connector';
import { QueueService } from '../../queue/queue.service';

/**
 * pg-boss queue + payload shape for the Shopify orders/create handler.
 * Duplicated here to avoid a cross-module import on the shopify-app
 * package (which already depends on connectors). The single source of
 * truth lives in `shopify-app/services/shopify-order-writeback.service.ts`.
 */
const SHOPIFY_ORDER_WRITEBACK_QUEUE = 'shopify-order-writeback';

@Public()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly connectorService: ConnectorService,
    private readonly shopifyConnector: ShopifyConnector,
    private readonly queueService: QueueService,
  ) {}

  @Post('shopify')
  async handleShopifyWebhook(
    @Headers('x-shopify-hmac-sha256') hmac: string,
    @Headers('x-shopify-topic') topic: string,
    @Headers('x-shopify-shop-domain') shopDomain: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    // Verify HMAC signature
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new HttpException(
        'Missing raw body for signature verification',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Try both secrets: API secret (GraphQL webhooks) and webhook secret (REST webhooks)
    const secrets = [
      process.env.SHOPIFY_API_SECRET,
      process.env.SHOPIFY_WEBHOOK_SECRET,
    ].filter(Boolean) as string[];

    if (secrets.length > 0 && hmac) {
      const verified = secrets.some((secret) => this.verifySignature(rawBody, hmac, secret));
      if (!verified) {
        throw new HttpException(
          'Invalid Shopify webhook signature',
          HttpStatus.UNAUTHORIZED,
        );
      }
    } else if (secrets.length > 0 && !hmac) {
      throw new HttpException(
        'Missing Shopify webhook signature',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!shopDomain) {
      throw new HttpException(
        'Missing x-shopify-shop-domain header',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Find the connector for this shop
    const connector =
      await this.connectorService.findConnectorByShopDomain(shopDomain);
    if (!connector) {
      this.logger.warn(
        `No connector found for Shopify shop domain: ${shopDomain}`,
      );
      return { success: false, message: 'Store not registered' };
    }

    this.logger.log(
      `Received Shopify webhook: topic=${topic}, shop=${shopDomain}, connector=${connector.id}`,
    );

    const normalizedTopic = (topic ?? '').toLowerCase();

    // Handle product events — sync only the changed product
    if (
      normalizedTopic.includes('products/create') ||
      normalizedTopic.includes('products/update')
    ) {
      const body = req.body as Record<string, unknown>;
      const productId = body?.id ? String(body.id) : null;

      if (productId) {
        // Sync single product for efficiency
        try {
          await this.connectorService.syncSingleProduct(
            connector.id,
            connector.organizationId,
            productId,
          );
        } catch (error: any) {
          this.logger.error(
            `Webhook single product sync failed for ${productId}: ${error.message}`,
          );
        }
      } else {
        // Fallback to full sync if no product ID in payload
        try {
          await this.connectorService.syncConnector(
            connector.id,
            connector.organizationId,
            { syncType: 'import' },
          );
        } catch (error: any) {
          this.logger.error(
            `Webhook sync failed for connector ${connector.id}: ${error.message}`,
          );
        }
      }
    }

    // Handle orders/create — enqueue duty/tax write-back. The worker
    // (ShopifyOrderWritebackService) does the actual classification +
    // metafield write; we return 200 immediately so Shopify doesn't retry
    // on slow calc paths.
    if (normalizedTopic.includes('orders/create')) {
      try {
        await this.queueService.sendJob(
          SHOPIFY_ORDER_WRITEBACK_QUEUE,
          {
            shopDomain,
            organizationId: connector.organizationId,
            connectorId: connector.id,
            order: req.body,
          },
          {
            retryLimit: 3,
            retryDelay: 60,
            retryBackoff: true,
            expireInSeconds: 3600,
          },
        );
      } catch (err: any) {
        // Failing to enqueue should NOT 5xx the webhook (Shopify retries).
        // Log and continue — the order is lost for now, but we'd rather
        // miss one calc than thrash on retries.
        this.logger.error(
          `Failed to enqueue orders/create job for ${shopDomain}: ${err?.message ?? err}`,
        );
      }
    }

    // Handle app/uninstalled — deactivate the connector
    if (normalizedTopic.includes('app/uninstalled')) {
      try {
        await this.connectorService.updateConnector(
          connector.id,
          connector.organizationId,
          { isActive: false },
        );
        this.logger.log(
          `Deactivated connector ${connector.id} after app uninstall`,
        );
      } catch (error: any) {
        this.logger.error(
          `Failed to deactivate connector ${connector.id}: ${error.message}`,
        );
      }
    }

    return { success: true, topic };
  }

  private verifySignature(
    rawBody: Buffer,
    signatureBase64: string,
    secret: string,
  ): boolean {
    const expected = createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(signatureBase64, 'utf8');

    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, providedBuf);
  }
}
