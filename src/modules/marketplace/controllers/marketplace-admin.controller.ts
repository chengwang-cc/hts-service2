import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminPermissions } from '../../admin/decorators/admin-permissions.decorator';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { AdminPermissionsGuard } from '../../admin/guards/admin-permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { resolveRequestContext } from '../../auth/interfaces/request-context.interface';
import {
  AdminListBrokerProfilesDto,
  VerifyBrokerProfileDto,
} from '../dto/marketplace.dto';
import { MarketplaceService } from '../services/marketplace.service';

@Controller('admin/marketplace/brokers')
@UseGuards(JwtAuthGuard, AdminGuard)
export class MarketplaceAdminController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get()
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:view')
  async list(@Query() query: AdminListBrokerProfilesDto) {
    return {
      success: true,
      data: await this.marketplace.listAdmin(query),
    };
  }

  @Post(':id/review')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:verify')
  async review(
    @Param('id') id: string,
    @Body() dto: VerifyBrokerProfileDto,
    @Req() request: Request,
  ) {
    return {
      success: true,
      data: await this.marketplace.adminReview(
        id,
        dto,
        resolveRequestContext(request),
      ),
    };
  }
}
