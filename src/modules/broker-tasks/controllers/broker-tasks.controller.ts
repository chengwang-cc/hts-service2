import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { resolveRequestContext } from '../../auth/interfaces/request-context.interface';
import {
  AnswerTaskDto,
  CreateMissingInfoTaskDto,
} from '../dto/broker-tasks.dto';
import { BrokerStatusService } from '../services/broker-status.service';
import { BrokerTasksService } from '../services/broker-tasks.service';
import { MissingInfoAgentService } from '../services/missing-info-agent.service';

@Controller('broker')
export class BrokerTasksController {
  constructor(
    private readonly tasks: BrokerTasksService,
    private readonly status: BrokerStatusService,
    private readonly missingInfoAgent: MissingInfoAgentService,
  ) {}

  /**
   * R2-B-04 — auto-draft missing-info tasks from this entry's blockers.
   * Returns the draft task ids; the broker still sends each one through
   * the existing /broker/missing-info endpoint after review.
   */
  @Post('entries/:id/missing-info/draft')
  async draftMissingInfo(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.missingInfoAgent.draftFromEntry(
        resolveRequestContext(req),
        id,
      ),
    };
  }

  @Post('missing-info')
  async create(
    @Req() req: Request,
    @Body() dto: CreateMissingInfoTaskDto,
  ) {
    return {
      success: true,
      data: await this.tasks.createForBroker(resolveRequestContext(req), dto),
    };
  }

  @Get('tasks')
  async list(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('relationshipId') relationshipId?: string,
  ) {
    // Default to open tasks (waiting on the client); pass status=all to override.
    const effectiveStatus =
      status === 'all' ? undefined : status ?? 'pending_client';
    return {
      success: true,
      data: await this.tasks.listForBroker(resolveRequestContext(req), {
        status: effectiveStatus,
        relationshipId,
      }),
    };
  }

  @Post('tasks/:id/cancel')
  async cancel(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.tasks.cancel(resolveRequestContext(req), id),
    };
  }

  @Get('entries/:entryId/status-events')
  async listEntryEvents(
    @Req() req: Request,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    return {
      success: true,
      data: await this.status.listForEntry(resolveRequestContext(req), entryId),
    };
  }

  @Get('relationships/:relationshipId/status-events')
  async listRelationshipEvents(
    @Req() req: Request,
    @Param('relationshipId', ParseUUIDPipe) relationshipId: string,
  ) {
    return {
      success: true,
      data: await this.status.listForRelationship(
        resolveRequestContext(req),
        relationshipId,
      ),
    };
  }
}

@Controller('broker-portal')
export class BrokerPortalTasksController {
  constructor(
    private readonly tasks: BrokerTasksService,
    private readonly status: BrokerStatusService,
  ) {}

  @Get('tasks')
  async list(@Req() req: Request) {
    return {
      success: true,
      data: await this.tasks.listForClient(resolveRequestContext(req)),
    };
  }

  @Post('tasks/:id/answer')
  async answer(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnswerTaskDto,
  ) {
    return {
      success: true,
      data: await this.tasks.answer(resolveRequestContext(req), id, dto),
    };
  }

  @Get('relationships/:relationshipId/status-events')
  async listEvents(
    @Req() req: Request,
    @Param('relationshipId', ParseUUIDPipe) relationshipId: string,
  ) {
    return {
      success: true,
      data: await this.status.listForRelationship(
        resolveRequestContext(req),
        relationshipId,
      ),
    };
  }

  /**
   * Plan endpoint: GET /broker-portal/shipments — business sees shipments
   * tied to its accepted broker engagements. Delegates lookup to the shared
   * service so tenant isolation is enforced uniformly.
   */
  @Get('shipments')
  async shipments(@Req() req: Request) {
    return {
      success: true,
      data: await this.tasks.listClientShipments(resolveRequestContext(req)),
    };
  }
}
