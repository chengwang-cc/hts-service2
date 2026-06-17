import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Body for POST /api/v1/admin/financial/organizations/:id/refunds.
 *
 * Required: paymentIntentId + reason.
 * Optional: amountMinorUnits (default = full purchase amount),
 *           internalNote (admin context for audit).
 *
 * `reason` accepts ONLY the three Stripe-spec values. Free-form
 * admin reason is NOT allowed — Stripe enforces these on its side.
 *
 * Money is in minor units (cents) — never decimal dollars. Phase 7's
 * multi-currency expansion adds the `currency` field; for now USD is
 * the only allowed value (it's not in the DTO; the service defaults).
 */
export class CreateRefundDto {
  @IsString()
  @MaxLength(255)
  paymentIntentId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  amountMinorUnits?: number;

  @IsIn(['duplicate', 'fraudulent', 'requested_by_customer'])
  reason: 'duplicate' | 'fraudulent' | 'requested_by_customer';

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  internalNote?: string;
}
