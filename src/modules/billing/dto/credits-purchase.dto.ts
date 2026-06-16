import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Body for POST /api/v1/portal/billing/credits/purchase. Credit amount
 * is restricted to the 5 named tiers — see
 * CreditPurchaseService.VALID_TIERS.
 *
 * Passing a `paymentMethodId` skips the SPA-side card-collection UX
 * and confirms the intent server-side using the saved payment method
 * (used by auto top-up and the "use saved card" flow on the SPA).
 */
export class CreditsPurchaseDto {
  @IsIn([10, 20, 50, 100, 200], { message: 'credits must be 10, 20, 50, 100, or 200' })
  credits: 10 | 20 | 50 | 100 | 200;

  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @IsOptional()
  @IsBoolean()
  savePaymentMethod?: boolean;
}
