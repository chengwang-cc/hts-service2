import { IsString } from 'class-validator';

export class SmartClassifyDto {
  @IsString()
  query: string;
}
