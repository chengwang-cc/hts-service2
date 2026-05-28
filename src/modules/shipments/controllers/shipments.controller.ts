import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ShipmentsService, ShipmentsCtx } from '../services/shipments.service';
import {
  CreateShipmentDto,
  ListShipmentsQueryDto,
  RecordSnapshotDto,
  UpdateShipmentDto,
} from '../dto';

/**
 * Saved-shipment workspace endpoints. All routes require a valid JWT and
 * scope to the caller's organization + user. See §11 Phase 5 of the
 * calculator-v2 redesign spec.
 */
@ApiTags('Shipments (workspace)')
@ApiBearerAuth()
@Controller('shipments')
@UseGuards(JwtAuthGuard)
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  private ctx(req: any): ShipmentsCtx {
    const userId = req?.user?.id;
    const organizationId = req?.user?.organizationId;
    if (!userId || !organizationId) {
      throw new ForbiddenException('Authenticated user + organization required');
    }
    return { userId, organizationId };
  }

  @Post()
  @ApiOperation({ summary: 'Create a saved shipment in the caller workspace' })
  async create(@Body() dto: CreateShipmentDto, @Req() req: any) {
    return this.shipments.create(this.ctx(req), dto);
  }

  @Get()
  @ApiOperation({ summary: 'List the caller workspace shipments (paginated + searchable)' })
  async list(@Query() query: ListShipmentsQueryDto, @Req() req: any) {
    return this.shipments.list(this.ctx(req), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one shipment; bumps lastOpenedAt' })
  async findOne(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: any) {
    return this.shipments.findOne(this.ctx(req), id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Patch a shipment. Pass If-Match: <ISO updatedAt> for optimistic concurrency.',
  })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateShipmentDto,
    @Req() req: any,
    @Headers('if-match') ifMatch?: string,
  ) {
    let ifMatchDate: Date | undefined;
    if (ifMatch) {
      const parsed = new Date(ifMatch.replace(/^"|"$/g, ''));
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('If-Match header must be an ISO8601 timestamp');
      }
      ifMatchDate = parsed;
    }
    return this.shipments.update(this.ctx(req), id, dto, ifMatchDate);
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Clone a shipment into a new draft owned by the caller' })
  async duplicate(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: any) {
    return this.shipments.duplicate(this.ctx(req), id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archive a shipment (soft delete; hard-deleted by the daily job after 30 days)' })
  async archive(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: any) {
    return this.shipments.archive(this.ctx(req), id);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Restore an archived shipment to draft' })
  async restore(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: any) {
    return this.shipments.restore(this.ctx(req), id);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'List quote snapshots recorded against this shipment (most recent first)' })
  async history(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Req() req?: any,
  ) {
    return this.shipments.listSnapshots(
      this.ctx(req),
      id,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  @Post(':id/snapshots')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a /v2/quote result against this shipment for audit history' })
  async recordSnapshot(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RecordSnapshotDto,
    @Req() req: any,
  ) {
    return this.shipments.recordSnapshot(this.ctx(req), id, dto);
  }
}
