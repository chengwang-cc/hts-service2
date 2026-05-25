import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { resolveRequestContext } from '../../auth/interfaces/request-context.interface';
import {
  CreateBrokerCredentialDto,
  SearchMarketplaceBrokersDto,
  UpsertBrokerProfileDto,
} from '../dto/marketplace.dto';
import { MarketplaceService } from '../services/marketplace.service';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Public()
  @Get('brokers')
  async search(@Query() query: SearchMarketplaceBrokersDto) {
    return {
      success: true,
      data: await this.marketplace.searchPublic(query),
    };
  }

  @Public()
  @Get('brokers/:slug')
  async getProfile(@Param('slug') slug: string) {
    return {
      success: true,
      data: await this.marketplace.getPublicProfile(slug),
    };
  }

  @Get('broker/profile')
  async myProfile(@Req() request: Request) {
    return {
      success: true,
      data: await this.marketplace.getMyProfile(resolveRequestContext(request)),
    };
  }

  @Patch('broker/profile')
  async upsertProfile(
    @Req() request: Request,
    @Body() dto: UpsertBrokerProfileDto,
  ) {
    return {
      success: true,
      data: await this.marketplace.upsertMyProfile(
        resolveRequestContext(request),
        dto,
      ),
    };
  }

  @Post('broker/profile/submit-verification')
  async submitForVerification(@Req() request: Request) {
    return {
      success: true,
      data: await this.marketplace.submitForVerification(
        resolveRequestContext(request),
      ),
    };
  }

  @Post('broker/credentials')
  async addCredential(
    @Req() request: Request,
    @Body() dto: CreateBrokerCredentialDto,
  ) {
    return {
      success: true,
      data: await this.marketplace.addCredential(
        resolveRequestContext(request),
        dto,
      ),
    };
  }
}
