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

  // `@IsUUID` (no version arg) accepts any RFC 4122 UUID. The seeded
  // role IDs use a deterministic v1-shape (`20000000-0000-…`) so
  // pinning to v4 here rejected legitimate PATCHes — surfaced by the
  // e2e for the Edit-user modal. Defense-in-depth is unchanged: the
  // service still looks up roles by id and 400s on a miss.
  @IsArray()
  @IsUUID(undefined, { each: true })
  @IsOptional()
  roleIds?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
