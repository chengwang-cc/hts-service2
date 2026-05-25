import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { OrgPermissions } from '../../auth/decorators/org-permissions.decorator';
import { OrgPermissionsGuard } from '../../auth/guards/org-permissions.guard';
import { resolveRequestContext } from '../../auth/interfaces/request-context.interface';
import {
  CreateEntryDto,
  CreateShipmentDto,
  ListEntriesDto,
  UpdateEntryDto,
  UpsertEntryLineDto,
} from '../dto/broker-entries.dto';
import { BrokerDutyEstimatorService } from '../services/broker-duty-estimator.service';
import { BrokerEntriesService } from '../services/broker-entries.service';
import { BrokerShipmentsService } from '../services/broker-shipments.service';

@Controller('broker')
@UseGuards(OrgPermissionsGuard)
export class BrokerEntriesController {
  constructor(
    private readonly entries: BrokerEntriesService,
    private readonly shipments: BrokerShipmentsService,
    private readonly dutyEstimator: BrokerDutyEstimatorService,
  ) {}

  /**
   * R2-A-01 — kick a duty estimate for every line on the entry. The result
   * is persisted onto each line (estimatedDuty + metadata.dutyEstimate).
   */
  @Post('entries/:id/estimate-duty')
  @OrgPermissions('broker:entries:write')
  async estimateDuty(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const ctx = resolveRequestContext(req);
    const entry = await this.entries.getDetail(ctx, id);
    return {
      success: true,
      data: await this.dutyEstimator.estimateForEntry(entry as any),
    };
  }

  @Get('shipments')
  @OrgPermissions('broker:entries:view', 'broker:entries:write')
  async listShipments(
    @Req() req: Request,
    @Query('clientId') clientId?: string,
  ) {
    return {
      success: true,
      data: await this.shipments.list(resolveRequestContext(req), clientId),
    };
  }

  @Post('shipments')
  @OrgPermissions('broker:entries:write')
  async createShipment(@Req() req: Request, @Body() dto: CreateShipmentDto) {
    return {
      success: true,
      data: await this.shipments.create(resolveRequestContext(req), dto),
    };
  }

  @Get('entries')
  @OrgPermissions('broker:entries:view', 'broker:entries:write')
  async list(@Req() req: Request, @Query() query: ListEntriesDto) {
    return {
      success: true,
      data: await this.entries.list(resolveRequestContext(req), query),
    };
  }

  @Post('entries')
  @OrgPermissions('broker:entries:write')
  async create(@Req() req: Request, @Body() dto: CreateEntryDto) {
    return {
      success: true,
      data: await this.entries.create(resolveRequestContext(req), dto),
    };
  }

  @Get('entries/:id')
  @OrgPermissions('broker:entries:view', 'broker:entries:write')
  async detail(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return {
      success: true,
      data: await this.entries.getDetail(resolveRequestContext(req), id),
    };
  }

  @Patch('entries/:id')
  @OrgPermissions('broker:entries:write')
  async update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEntryDto,
  ) {
    return {
      success: true,
      data: await this.entries.update(resolveRequestContext(req), id, dto),
    };
  }

  @Post('entries/:id/approve')
  @OrgPermissions('broker:entries:write')
  async approve(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.entries.update(resolveRequestContext(req), id, {
        status: 'approved',
      }),
    };
  }

  @Post('entries/:id/lines')
  @OrgPermissions('broker:entries:write')
  async addLine(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertEntryLineDto,
  ) {
    return {
      success: true,
      data: await this.entries.upsertLine(
        resolveRequestContext(req),
        id,
        null,
        dto,
      ),
    };
  }

  @Patch('entries/:id/lines/:lineId')
  @OrgPermissions('broker:entries:write')
  async updateLine(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpsertEntryLineDto,
  ) {
    return {
      success: true,
      data: await this.entries.upsertLine(
        resolveRequestContext(req),
        id,
        lineId,
        dto,
      ),
    };
  }

  @Delete('entries/:id/lines/:lineId')
  @OrgPermissions('broker:entries:write')
  async deleteLine(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    await this.entries.deleteLine(resolveRequestContext(req), id, lineId);
    return { success: true };
  }
}
