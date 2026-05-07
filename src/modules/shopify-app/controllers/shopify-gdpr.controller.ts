import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  Logger,
  HttpException,
  HttpStatus,
  RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { Public } from '../../auth/decorators/public.decorator';
import { ShopifyAuthService } from '../services/shopify-auth.service';

@Public()
@Controller('shopify/gdpr')
export class ShopifyGdprController {
  private readonly logger = new Logger(ShopifyGdprController.name);
  private readonly webhookSecret = process.env.SHOPIFY_API_SECRET ?? '';

  constructor(private readonly shopifyAuthService: ShopifyAuthService) {}

  /**
   * POST /shopify/gdpr/customers/data_request
   * Shopify sends this when a customer requests their data.
   */
  @Post('customers/data_request')
  async customersDataRequest(
    @Body() body: any,
    @Headers('x-shopify-hmac-sha256') hmac: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    this.verifyWebhook(req.rawBody, hmac);

    this.logger.log(
      `GDPR data request: shop=${body.shop_domain}, customer=${body.customer?.id}`,
    );

    // We store minimal customer data (only shipping country/state/postal for duty
    // calculation). No PII is persisted. Acknowledge the request.
    return { received: true };
  }

  /**
   * POST /shopify/gdpr/customers/redact
   * Shopify sends this when a customer requests data deletion.
   */
  @Post('customers/redact')
  async customersRedact(
    @Body() body: any,
    @Headers('x-shopify-hmac-sha256') hmac: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    this.verifyWebhook(req.rawBody, hmac);

    this.logger.log(
      `GDPR customer redact: shop=${body.shop_domain}, customer=${body.customer?.id}`,
    );

    // No customer PII is stored. Acknowledge.
    return { received: true };
  }

  /**
   * POST /shopify/gdpr/shop/redact
   * Shopify sends this 48 hours after app uninstall to request full data deletion.
   */
  @Post('shop/redact')
  async shopRedact(
    @Body() body: any,
    @Headers('x-shopify-hmac-sha256') hmac: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    this.verifyWebhook(req.rawBody, hmac);

    const shopDomain = body.shop_domain;
    this.logger.log(`GDPR shop redact: shop=${shopDomain}`);

    // Delete all data for this shop
    if (shopDomain) {
      await this.shopifyAuthService.deleteShopData(shopDomain);
    }

    return { received: true };
  }

  private verifyWebhook(
    rawBody: Buffer | undefined,
    hmac: string | undefined,
  ): void {
    if (!this.webhookSecret || !rawBody || !hmac) {
      // In development, skip verification if secret is not set
      if (process.env.NODE_ENV === 'production') {
        throw new HttpException('Invalid webhook signature', HttpStatus.UNAUTHORIZED);
      }
      return;
    }

    const computed = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('base64');

    const computedBuf = Buffer.from(computed, 'utf8');
    const providedBuf = Buffer.from(hmac, 'utf8');

    if (computedBuf.length !== providedBuf.length || !timingSafeEqual(computedBuf, providedBuf)) {
      throw new HttpException('Invalid webhook signature', HttpStatus.UNAUTHORIZED);
    }
  }
}
