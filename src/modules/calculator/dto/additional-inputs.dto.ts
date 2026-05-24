import { IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * AdditionalInputsDto
 *
 * Typed shape for `additionalInputs`. Known formula variables are surfaced
 * as explicit numeric fields so client SDKs and OpenAPI consumers can
 * discover them. Free-form jurisdiction-specific keys are allowed in
 * `extra` (numbers only) and validated against the resolved formula's
 * required variables at evaluation time.
 *
 * Non-numeric metadata (modeOfTransport, chapter99Headings, entryDate)
 * is kept as siblings of `extra` because the calculator currently reads
 * them by name during rate selection.
 */
export class AdditionalInputsDto {
  // Common metal / commodity inputs surfaced by section 232 etc.
  @IsOptional() @IsNumber() steel_value?: number;
  @IsOptional() @IsNumber() aluminum_value?: number;
  @IsOptional() @IsNumber() copper_value?: number;
  @IsOptional() @IsNumber() alcohol_strength?: number;
  @IsOptional() @IsNumber() volume_liters?: number;
  @IsOptional() @IsNumber() proof_liters?: number;

  // Non-numeric metadata used by the resolver / selectors.
  @IsOptional()
  chapter99Headings?: string[];

  @IsOptional()
  selectedChapter99Headings?: string[];

  @IsOptional() @IsString() chapter99Heading?: string;
  @IsOptional() @IsString() chapter99Code?: string;
  @IsOptional() @IsString() chapter99Hts?: string;

  @IsOptional() @IsString() modeOfTransport?: string;
  @IsOptional() @IsString() entryDate?: string;
  @IsOptional() @IsString() entryDateOverride?: string;
  @IsOptional() @IsString() FIELD_DATE_OF_LOADING?: string;
  @IsOptional() @IsString() dateOfLoading?: string;

  @IsOptional() chapter99Selections?: Record<string, boolean | number | string>;
  @IsOptional() FIELD_CHOSEN_HTS_CODES?: Record<string, boolean | number | string>;

  // Flag-style conditional gates.
  @IsOptional() annexEligibilityConfirmed?: boolean | number | string;
  @IsOptional() allowFrameworkRate?: boolean | number | string;

  /**
   * Open extension point for jurisdiction-specific numeric inputs.
   * Only numeric values are accepted; the resolver allowlists by name.
   */
  @IsOptional()
  @IsObject()
  extra?: Record<string, number>;
}
