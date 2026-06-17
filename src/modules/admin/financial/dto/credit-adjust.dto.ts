import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, NotEquals } from 'class-validator';
import {
  MANUAL_ADJUSTMENT_REASON_CODES,
  ManualAdjustmentReasonCode,
} from '../types/reason-code';

/**
 * Body for POST /api/v1/admin/financial/organizations/:id/credits/adjust.
 *
 * `delta` is signed:
 *   - positive = grant credits (MANUAL_TOPUP ledger kind)
 *   - negative = debit credits (MANUAL_DEBIT ledger kind)
 *
 * The +/- 1,000,000 cap is a sanity guard; for adjustments above the
 * approval threshold (FINANCIAL_ADMIN_APPROVAL_THRESHOLD_USD), see the
 * two-person rule wiring in §15.3 of the design doc (deferred).
 *
 * `reasonCode` is required and validated against the managed lookup.
 * `internalNote` is free-form admin text, surfaced in the SPA ledger
 * preview alongside the actor's email.
 */
export class CreditAdjustDto {
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  @NotEquals(0)
  delta: number;

  @IsIn(MANUAL_ADJUSTMENT_REASON_CODES as unknown as string[])
  reasonCode: ManualAdjustmentReasonCode;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  internalNote?: string;
}
