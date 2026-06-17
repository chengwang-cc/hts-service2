import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for POST /admin/financial/disputes/:id/respond.
 *
 * Mirrors Stripe's evidence bag with the most common fields that ops
 * typically fill in for a credit-purchase chargeback. Additional
 * fields can be added incrementally — the controller forwards
 * whatever it receives to Stripe via the `evidence` object.
 *
 * Stripe's evidence object accepts ~30 fields; we constrain to a
 * sensible default set here. All fields are optional — Stripe
 * accepts a partial bag.
 */
export class SubmitEvidenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  customerCommunication?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  accessActivityLog?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  productDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  refundPolicy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  refundPolicyDisclosure?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  serviceDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  serviceDocumentation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  uncategorizedText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerEmailAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerPurchaseIp?: string;

  /**
   * If true, finalize on Stripe's side (one-shot submission). We only
   * support `true` today — drafts live in our DB, not Stripe.
   */
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}
