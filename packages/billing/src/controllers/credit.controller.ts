import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { CreditPurchaseService } from '../services/credit-purchase.service';
import type { CreateCreditCheckoutSessionDto } from '../services/credit-purchase.service';

/**
 * Credit Controller
 * Handles credit purchase checkout flow
 */
@Controller('billing/credits')
export class CreditController {
  constructor(private readonly creditPurchaseService: CreditPurchaseService) {}

  /**
   * Create Stripe Checkout Session for credit purchase
   * POST /api/v1/billing/credits/checkout
   */
  @Post('checkout')
  async createCheckoutSession(@Body() dto: CreateCreditCheckoutSessionDto) {
    return this.creditPurchaseService.createCheckoutSession(dto);
  }

  /**
   * Handle successful payment
   * GET /api/v1/billing/credits/checkout/success?session_id=xxx
   */
  @Get('checkout/success')
  async handleSuccess(
    @Query('session_id') sessionId: string,
    @Res() res: Response,
  ) {
    if (!sessionId) {
      throw new BadRequestException('Missing session_id');
    }

    const result =
      await this.creditPurchaseService.handleCheckoutSuccess(sessionId);

    // Redirect back to frontend with result
    return res.redirect(result.returnUrl);
  }

  /**
   * Handle cancelled payment
   * GET /api/v1/billing/credits/checkout/cancel?session_id=xxx
   */
  @Get('checkout/cancel')
  async handleCancel(
    @Query('session_id') sessionId: string,
    @Res() res: Response,
  ) {
    if (!sessionId) {
      throw new BadRequestException('Missing session_id');
    }

    const result =
      await this.creditPurchaseService.handleCheckoutCancel(sessionId);

    // Redirect back to frontend
    return res.redirect(result.returnUrl);
  }
}
