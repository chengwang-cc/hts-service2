import {
  IsEmail,
  IsString,
  MinLength,
  IsUUID,
  IsOptional,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @MinLength(1)
  firstName: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsUUID()
  @IsOptional()
  organizationId?: string;
}
