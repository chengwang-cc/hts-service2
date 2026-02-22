import { IsString, MaxLength, MinLength } from 'class-validator';

export class LookupConversationMessageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(4000)
  message: string;
}
