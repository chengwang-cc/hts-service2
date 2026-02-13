import { IsString, MinLength } from 'class-validator';

export class ClassifyProductDto {
  @IsString()
  @MinLength(3)
  description: string;
}
