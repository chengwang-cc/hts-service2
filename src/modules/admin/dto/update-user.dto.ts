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

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  roleIds?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
