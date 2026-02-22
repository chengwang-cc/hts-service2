import { IsBoolean, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class LookupConversationFeedbackDto {
  @IsBoolean()
  isCorrect: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(36)
  messageId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}(\.\d{2}){0,3}$/, {
    message: 'chosenHts must be a valid HTS-style code',
  })
  chosenHts?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
