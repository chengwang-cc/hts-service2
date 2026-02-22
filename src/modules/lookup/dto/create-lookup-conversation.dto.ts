import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateLookupConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  organizationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  userProfile?: string;
}
