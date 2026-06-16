import { IsString, MinLength, MaxLength } from 'class-validator';

/**
 * Body shape for `PATCH /admin/users/:id/reset-password`.
 *
 * Operator-mode reset: the admin supplies the new plaintext password
 * directly (no email-link token flow yet — see code review note on
 * missing email service). The endpoint hashes with bcrypt cost 10 and
 * the admin is responsible for delivering the new password to the user
 * out-of-band (in the meantime the SPA shows the freshly-set value once
 * in a "copy now" modal, mirroring the register reveal pattern).
 *
 * Min length matches the public `/auth/register` rule (also 8) so we
 * don't allow admins to set passwords weaker than what users can set
 * themselves.
 */
export class ResetPasswordDto {
  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters' })
  @MaxLength(128, { message: 'New password must not exceed 128 characters' })
  newPassword: string;
}
