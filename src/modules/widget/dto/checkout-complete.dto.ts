import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CheckoutCompleteDto {
  @IsString()
  @IsNotEmpty()
  calculationId: string;

  @IsString()
  @IsNotEmpty()
  platformOrderId: string;

  @IsString()
  @IsNotEmpty()
  platform: string;

  @IsOptional()
  @IsString()
  storeConnectionId?: string;
}
