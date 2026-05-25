import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { Public } from '../../auth/decorators/public.decorator';
import { resolveRequestContext } from '../../auth/interfaces/request-context.interface';
import {
  ConsumeCreditsDto,
  CreateReviewDto,
  GrantCreditsDto,
  ListReviewsDto,
  ModerateReviewDto,
} from '../dto/marketplace-reviews.dto';
import { BrokerCreditsService } from '../services/broker-credits.service';
import { BrokerPerformanceService } from '../services/broker-performance.service';
import { MarketplaceReviewsService } from '../services/marketplace-reviews.service';

@Controller('marketplace')
export class MarketplaceReviewsController {
  constructor(
    private readonly reviews: MarketplaceReviewsService,
    private readonly performance: BrokerPerformanceService,
    private readonly credits: BrokerCreditsService,
  ) {}

  @Post('reviews')
  async create(@Req() req: Request, @Body() dto: CreateReviewDto) {
    return {
      success: true,
      data: await this.reviews.createReview(resolveRequestContext(req), dto),
    };
  }

  @Public()
  @Get('brokers/:brokerProfileId/reviews')
  async listForBroker(
    @Param('brokerProfileId', ParseUUIDPipe) brokerProfileId: string,
    @Query() query: ListReviewsDto,
  ) {
    return {
      success: true,
      data: await this.reviews.listForBroker(brokerProfileId, query),
    };
  }

  @Get('broker/credits')
  async myCredits(@Req() req: Request) {
    const ctx = resolveRequestContext(req);
    return {
      success: true,
      data: await this.credits.getBalance(ctx.organizationId),
    };
  }

  @Post('broker/credits/consume')
  async consumeCredits(@Req() req: Request, @Body() dto: ConsumeCreditsDto) {
    return {
      success: true,
      data: await this.credits.consume(resolveRequestContext(req), dto),
    };
  }

  @Get('broker/analytics')
  async myAnalytics(@Req() req: Request, @Query('profileId') profileId?: string) {
    const ctx = resolveRequestContext(req);
    if (!profileId) {
      return { success: true, data: null };
    }
    const snapshot = await this.performance.latestForBroker(profileId);
    const history = await this.performance.historyForBroker(profileId, 30);
    const balance = await this.credits.getBalance(ctx.organizationId);
    return {
      success: true,
      data: { snapshot, history, credits: balance },
    };
  }
}

@Controller('admin/marketplace')
@UseGuards(JwtAuthGuard, AdminGuard)
export class MarketplaceReviewsAdminController {
  constructor(
    private readonly reviews: MarketplaceReviewsService,
    private readonly performance: BrokerPerformanceService,
    private readonly credits: BrokerCreditsService,
  ) {}

  @Get('reviews')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:view')
  async list(@Query() query: ListReviewsDto) {
    return {
      success: true,
      data: await this.reviews.listForModeration(query),
    };
  }

  @Post('reviews/:id/moderate')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:moderate')
  async moderate(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return {
      success: true,
      data: await this.reviews.moderate(
        resolveRequestContext(req),
        id,
        dto,
      ),
    };
  }

  @Post('performance/snapshot')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:moderate')
  async snapshot(@Body('brokerProfileId') brokerProfileId?: string) {
    if (brokerProfileId) {
      return {
        success: true,
        data: await this.performance.snapshotForBroker(brokerProfileId),
      };
    }
    const count = await this.performance.snapshotAll();
    return { success: true, data: { snapshotted: count } };
  }

  @Post('credits/grant')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:moderate')
  async grant(@Req() req: Request, @Body() dto: GrantCreditsDto) {
    return {
      success: true,
      data: await this.credits.grant(resolveRequestContext(req), dto),
    };
  }

  @Get('credits/:organizationId/ledger')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:view')
  async ledger(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return {
      success: true,
      data: await this.credits.ledgerFor(organizationId),
    };
  }
}
