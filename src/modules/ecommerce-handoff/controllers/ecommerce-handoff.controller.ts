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
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WrapResponseInterceptor } from '../../observability/wrap-response.interceptor';
import {
  ECOM_HANDOFF_STATES,
  EcommerceHandoffDto,
} from '../dto/ecommerce-handoff.dto';
import {
  EcomHandoffState,
  EcommerceHandoffService,
  HandoffWritebackPayload,
} from '../services/ecommerce-handoff.service';

@ApiTags('ecommerce handoff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseInterceptors(WrapResponseInterceptor)
@Controller('ecommerce-handoff')
export class EcommerceHandoffController {
  constructor(private readonly service: EcommerceHandoffService) {}

  @Post()
  @ApiOperation({
    summary:
      'Upsert an ecommerce order into the broker review pipeline. Idempotent by (platform, externalOrderId).',
  })
  async upsert(@Req() req: any, @Body() body: EcommerceHandoffDto) {
    return this.service.upsert(orgId(req), actor(req), body);
  }

  @Get()
  @ApiOperation({ summary: 'List ecommerce handoffs for this organization.' })
  async list(
    @Req() req: any,
    @Query('platform') platform?: string,
    @Query('state') state?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(orgId(req), {
      platform,
      state,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one handoff record.' })
  async getOne(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getById(orgId(req), id);
  }

  @Post(':id/transition')
  @ApiOperation({ summary: 'Move the handoff to a new state.' })
  async transition(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { state: EcomHandoffState; notes?: string | null },
  ) {
    if (!ECOM_HANDOFF_STATES.includes(body.state as any)) {
      throw new Error(`unknown target state: ${body.state}`);
    }
    return this.service.transition(
      orgId(req),
      actor(req),
      id,
      body.state,
      body.notes ?? null,
    );
  }

  @Post(':id/writeback')
  @ApiOperation({
    summary:
      'Record a broker-reviewed writeback (metafields / order notes / state).',
  })
  async writeback(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HandoffWritebackPayload,
  ) {
    return this.service.recordWriteback(orgId(req), actor(req), id, body);
  }

  @Post(':id/link-marketplace-request')
  @ApiOperation({
    summary:
      'Link a marketplace_request record created from this handoff (for cross-navigation).',
  })
  async link(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { marketplaceRequestId: string },
  ) {
    return this.service.linkMarketplaceRequest(
      orgId(req),
      actor(req),
      id,
      body.marketplaceRequestId,
    );
  }
}

function orgId(req: any): string {
  const id = req?.user?.organizationId;
  if (!id) throw new Error('authentication context required');
  return id;
}

function actor(req: any): string {
  return req?.user?.email ?? req?.user?.id ?? 'system';
}
