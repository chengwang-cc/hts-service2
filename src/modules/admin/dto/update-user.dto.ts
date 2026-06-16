/**
 * Update User DTO
 */

import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  IsArray,
  IsBoolean,
} from 'class-validator';

export class UpdateUserDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @MinLength(8)
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsUUID()
  @IsOptional()
  organizationId?: string;

  // String validation, not UUID — the seeded role IDs use a
  // deterministic non-RFC-4122 shape (e.g. `20000000-0000-0000-0000-000000000004`)
  // whose variant digit (`0` instead of 8/9/a/b) fails class-validator's
  // RFC 4122 check. The previous `@IsUUID('4', { each: true })` rejected
  // every PATCH that touched roleIds.
  //
  // Defense-in-depth is unchanged: the service still does
  // `roleRepository.find({ where: { id: In(roleIds) } })` and 400s with
  // "One or more role IDs are invalid" on a miss. TypeORM parameterizes
  // the IN clause so there's no SQL-injection surface.
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  roleIds?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
