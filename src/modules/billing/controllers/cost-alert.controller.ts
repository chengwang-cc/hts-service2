import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CostAlertService } from '../services/cost-alert.service';
import { UpsertCostAlertDto } from '../dto/cost-alert.dto';
import { UserEntity } from '../../auth/entities/user.entity';

/**
 * Portal-side cost alert config. Partner + business admins use this to
 * set a monthly spend threshold and (optionally) a webhook URL. The
 * org-scoping is taken from the JWT, NOT a path param — every endpoint
 * resolves to "the calling user's organization" so cross-org access is
 * structurally impossible.
 *
 * Admin oversight lives on `cost-alert.admin.controller.ts` and is
 * read-only.
 */
@Controller('portal/cost-alert')
@UseGuards(JwtAuthGuard)
export class CostAlertController {
  constructor(private readonly service: CostAlertService) {}

  @Get()
  async get(@CurrentUser() user: UserEntity) {
    return this.service.getForOrganization(user.organizationId);
  }

  @Put()
  async upsert(
    @CurrentUser() user: UserEntity,
    @Body() dto: UpsertCostAlertDto,
  ) {
    return this.service.upsert(user.organizationId, dto);
  }

  @Delete()
  @HttpCode(204)
  async disable(@CurrentUser() user: UserEntity): Promise<void> {
    await this.service.disable(user.organizationId);
  }

  @Post('events/:id/ack')
  @HttpCode(204)
  async ack(
    @CurrentUser() user: UserEntity,
    @Param('id') eventId: string,
  ): Promise<void> {
    await this.service.acknowledgeEvent(user.organizationId, eventId);
  }
}
