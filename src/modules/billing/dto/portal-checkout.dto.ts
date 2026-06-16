import { IsIn, IsOptional } from 'class-validator';

/**
 * Body for `POST /api/v1/portal/billing/checkout-session`. The
 * organization is derived from the JWT — never trust a client-supplied
 * `organizationId` for billing endpoints.
 *
 * `interval` defaults to 'month' on the server when omitted.
 */
export class PortalCheckoutDto {
  @IsIn(['STARTER', 'PROFESSIONAL', 'ENTERPRISE'])
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';

  @IsOptional()
  @IsIn(['month', 'year'])
  interval?: 'month' | 'year';
}
