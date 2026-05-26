import {
  Body,
  Controller,
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
import { TenantRateLimitGuard } from '../guards/tenant-rate-limit.guard';
import {
  ClientPortalUploadDto,
  CreatePacketDto,
  DraftEntryFromPacketDto,
  ListPacketsDto,
  ReviewFieldDto,
} from '../dto/broker-packets.dto';
import { BrokerPacketsService } from '../services/broker-packets.service';

@Controller('broker')
@UseGuards(OrgPermissionsGuard)
export class BrokerPacketsController {
  constructor(private readonly packets: BrokerPacketsService) {}

  @Get('packets')
  @OrgPermissions('broker:packets:view', 'broker:packets:write')
  async list(@Req() req: Request, @Query() query: ListPacketsDto) {
    return {
      success: true,
      data: await this.packets.list(resolveRequestContext(req), query),
    };
  }

  @Post('packets')
  @UseGuards(TenantRateLimitGuard)
  @OrgPermissions('broker:packets:write')
  async create(@Req() req: Request, @Body() dto: CreatePacketDto) {
    return {
      success: true,
      data: await this.packets.create(resolveRequestContext(req), dto),
    };
  }

  @Get('packets/:id')
  @OrgPermissions('broker:packets:view', 'broker:packets:write')
  async detail(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return {
      success: true,
      data: await this.packets.getDetail(resolveRequestContext(req), id),
    };
  }

  /**
   * Plan-aligned alias returning only the extracted-field rows for the packet.
   * The packet detail endpoint embeds the same data, but the dedicated route
   * lets the workbench paginate fields independently.
   */
  @Get('packets/:id/extractions')
  @OrgPermissions('broker:packets:view', 'broker:packets:write')
  async extractions(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const detail = await this.packets.getDetail(resolveRequestContext(req), id);
    return {
      success: true,
      data: {
        packetId: id,
        documents: detail.documents,
        fields: detail.fields,
        reconciliation: detail.reconciliation,
      },
    };
  }

  @Post('packets/:id/process')
  @OrgPermissions('broker:packets:write')
  async reprocess(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    await this.packets.processForContext(resolveRequestContext(req), id);
    return { success: true };
  }

  @Patch('packets/:id/fields/:fieldId')
  @OrgPermissions('broker:packets:write')
  async reviewField(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Body() dto: ReviewFieldDto,
  ) {
    return {
      success: true,
      data: await this.packets.reviewField(
        resolveRequestContext(req),
        id,
        fieldId,
        dto,
      ),
    };
  }

  @Post('entries/draft-from-packet')
  @OrgPermissions('broker:entries:write', 'broker:packets:write')
  async draftEntry(@Req() req: Request, @Body() dto: DraftEntryFromPacketDto) {
    return {
      success: true,
      data: await this.packets.draftEntryFromPacket(
        resolveRequestContext(req),
        dto,
      ),
    };
  }
}

@Controller('broker-portal')
export class BrokerPortalUploadsController {
  constructor(private readonly packets: BrokerPacketsService) {}

  @Post('packets')
  @UseGuards(TenantRateLimitGuard)
  async upload(@Req() req: Request, @Body() dto: ClientPortalUploadDto) {
    return {
      success: true,
      data: await this.packets.createFromPortal(
        resolveRequestContext(req),
        dto,
      ),
    };
  }
}
