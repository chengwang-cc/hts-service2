import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Body for PUT /api/v1/portal/billing/auto-topup.
 *
 * `rechargeAmount` is constrained to the same tier set used by manual
 * credit purchases — keeps pricing model simple and lets the auto-topup
 * UI reuse the tier picker.
 */
export class UpsertAutoTopupDto {
  @IsBoolean()
  enabled: boolean;

  @IsInt()
  @Min(0)
  @Max(10_000)
  triggerThreshold: number;

  @IsIn([10, 20, 50, 100, 200])
  rechargeAmount: 10 | 20 | 50 | 100 | 200;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000)
  monthlySpendingCap?: number | null;

  @IsOptional()
  @IsString()
  stripePaymentMethodId?: string | null;
}
