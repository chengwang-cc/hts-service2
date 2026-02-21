import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ConnectorService,
  CreateConnectorDto,
  UpdateConnectorDto,
  SyncConnectorDto,
  TestConnectionDto,
} from '@hts/connectors';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('connectors')
@UseGuards(JwtAuthGuard)
export class ConnectorsController {
  constructor(private readonly connectorService: ConnectorService) {}

  /**
   * Create new connector
   */
  @Post()
  async createConnector(
    @CurrentUser() user: any,
    @Body() dto: CreateConnectorDto,
  ) {
    return this.connectorService.createConnector(user.organizationId, dto);
  }

  /**
   * List connectors
   */
  @Get()
  async listConnectors(@CurrentUser() user: any) {
    return this.connectorService.listConnectors(user.organizationId);
  }

  /**
   * Get connector
   */
  @Get(':connectorId')
  async getConnector(
    @CurrentUser() user: any,
    @Param('connectorId') connectorId: string,
  ) {
    return this.connectorService.getConnector(connectorId, user.organizationId);
  }

  /**
   * Update connector
   */
  @Patch(':connectorId')
  async updateConnector(
    @CurrentUser() user: any,
    @Param('connectorId') connectorId: string,
    @Body() dto: UpdateConnectorDto,
  ) {
    return this.connectorService.updateConnector(
      connectorId,
      user.organizationId,
      dto,
    );
  }

  /**
   * Delete connector
   */
  @Delete(':connectorId')
  async deleteConnector(
    @CurrentUser() user: any,
    @Param('connectorId') connectorId: string,
  ) {
    await this.connectorService.deleteConnector(
      connectorId,
      user.organizationId,
    );
    return { success: true };
  }

  /**
   * Test connection
   */
  @Post('test')
  async testConnection(@Body() dto: TestConnectionDto) {
    return this.connectorService.testConnection(
      dto.config.shopUrl ? 'shopify' : 'unknown',
      dto.config,
    );
  }

  /**
   * Sync connector
   */
  @Post(':connectorId/sync')
  async syncConnector(
    @CurrentUser() user: any,
    @Param('connectorId') connectorId: string,
    @Body() dto: SyncConnectorDto,
  ) {
    return this.connectorService.syncConnector(
      connectorId,
      user.organizationId,
      dto,
    );
  }

  /**
   * Get sync logs
   */
  @Get(':connectorId/logs')
  async getSyncLogs(
    @CurrentUser() user: any,
    @Param('connectorId') connectorId: string,
    @Query('limit') limit?: string,
  ) {
    return this.connectorService.getSyncLogs(
      connectorId,
      user.organizationId,
      limit ? parseInt(limit) : 20,
    );
  }

  /**
   * Get connector statistics
   */
  @Get(':connectorId/stats')
  async getConnectorStats(
    @CurrentUser() user: any,
    @Param('connectorId') connectorId: string,
  ) {
    return this.connectorService.getConnectorStats(
      connectorId,
      user.organizationId,
    );
  }
}
