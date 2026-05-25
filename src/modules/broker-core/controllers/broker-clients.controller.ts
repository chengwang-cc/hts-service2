import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { resolveRequestContext } from '../../auth/interfaces/request-context.interface';
import {
  CreateBrokerClientDto,
  ListBrokerClientsDto,
  UpdateBrokerClientDto,
  UpdateRelationshipChecklistDto,
  UpsertPoaDto,
} from '../dto/broker-core.dto';
import { BrokerClientsService } from '../services/broker-clients.service';
import { BrokerRelationshipsService } from '../services/broker-relationships.service';

@Controller('broker')
export class BrokerClientsController {
  constructor(
    private readonly clients: BrokerClientsService,
    private readonly relationships: BrokerRelationshipsService,
  ) {}

  @Get('clients')
  async list(@Req() req: Request, @Query() query: ListBrokerClientsDto) {
    return {
      success: true,
      data: await this.clients.list(resolveRequestContext(req), query),
    };
  }

  @Post('clients')
  async create(@Req() req: Request, @Body() dto: CreateBrokerClientDto) {
    return {
      success: true,
      data: await this.clients.create(resolveRequestContext(req), dto),
    };
  }

  @Get('clients/:id')
  async detail(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return {
      success: true,
      data: await this.clients.get(resolveRequestContext(req), id),
    };
  }

  @Patch('clients/:id')
  async update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrokerClientDto,
  ) {
    return {
      success: true,
      data: await this.clients.update(resolveRequestContext(req), id, dto),
    };
  }

  @Put('clients/:id/poa')
  async upsertPoa(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertPoaDto,
  ) {
    return {
      success: true,
      data: await this.clients.upsertPoa(resolveRequestContext(req), id, dto),
    };
  }

  @Get('relationships')
  async listRelationships(@Req() req: Request) {
    return {
      success: true,
      data: await this.relationships.listForBroker(resolveRequestContext(req)),
    };
  }

  @Patch('relationships/:id/checklist')
  async updateChecklist(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRelationshipChecklistDto,
  ) {
    return {
      success: true,
      data: await this.relationships.updateChecklist(
        resolveRequestContext(req),
        id,
        dto,
      ),
    };
  }
}

@Controller('broker-marketplace')
export class BusinessRelationshipsController {
  constructor(private readonly relationships: BrokerRelationshipsService) {}

  @Get('relationships')
  async listMyRelationships(@Req() req: Request) {
    return {
      success: true,
      data: await this.relationships.listForBusiness(
        resolveRequestContext(req),
      ),
    };
  }
}
