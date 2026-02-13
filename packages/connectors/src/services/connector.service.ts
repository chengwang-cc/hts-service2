import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConnectorEntity } from '../entities/connector.entity';
import { SyncLogEntity } from '../entities/sync-log.entity';
import { ShopifyConnector } from './shopify.connector';
import { BrokerConnector } from './broker.connector';
import {
  CreateConnectorDto,
  UpdateConnectorDto,
  SyncConnectorDto,
  TestConnectionDto,
} from '../dto/connector.dto';

@Injectable()
export class ConnectorService {
  constructor(
    @InjectRepository(ConnectorEntity)
    private readonly connectorRepo: Repository<ConnectorEntity>,
    @InjectRepository(SyncLogEntity)
    private readonly syncLogRepo: Repository<SyncLogEntity>,
    private readonly shopifyConnector: ShopifyConnector,
    private readonly brokerConnector: BrokerConnector,
  ) {}

  /**
   * Create new connector
   */
  async createConnector(
    organizationId: string,
    dto: CreateConnectorDto,
  ): Promise<ConnectorEntity> {
    const connector = this.connectorRepo.create({
      organizationId,
      connectorType: dto.connectorType,
      name: dto.name,
      description: dto.description,
      config: dto.config,
      status: 'pending',
    });

    return this.connectorRepo.save(connector);
  }

  /**
   * Update connector
   */
  async updateConnector(
    connectorId: string,
    organizationId: string,
    dto: UpdateConnectorDto,
  ): Promise<ConnectorEntity> {
    const connector = await this.connectorRepo.findOne({
      where: { id: connectorId, organizationId },
    });

    if (!connector) {
      throw new HttpException('Connector not found', HttpStatus.NOT_FOUND);
    }

    if (dto.name) connector.name = dto.name;
    if (dto.description !== undefined) connector.description = dto.description;
    if (dto.config) connector.config = { ...connector.config, ...dto.config };
    if (dto.isActive !== undefined) connector.isActive = dto.isActive;

    return this.connectorRepo.save(connector);
  }

  /**
   * Delete connector
   */
  async deleteConnector(connectorId: string, organizationId: string): Promise<void> {
    const result = await this.connectorRepo.delete({
      id: connectorId,
      organizationId,
    });

    if (result.affected === 0) {
      throw new HttpException('Connector not found', HttpStatus.NOT_FOUND);
    }
  }

  /**
   * Get connector
   */
  async getConnector(
    connectorId: string,
    organizationId: string,
  ): Promise<ConnectorEntity> {
    const connector = await this.connectorRepo.findOne({
      where: { id: connectorId, organizationId },
    });

    if (!connector) {
      throw new HttpException('Connector not found', HttpStatus.NOT_FOUND);
    }

    return connector;
  }

  /**
   * List connectors
   */
  async listConnectors(organizationId: string): Promise<ConnectorEntity[]> {
    return this.connectorRepo.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Test connection
   */
  async testConnection(
    connectorType: string,
    config: any,
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (connectorType === 'shopify') {
        const success = await this.shopifyConnector.testConnection(config);
        return {
          success,
          message: success ? 'Connection successful' : 'Connection failed',
        };
      }

      return {
        success: false,
        message: 'Connector type not supported',
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Sync connector
   */
  async syncConnector(
    connectorId: string,
    organizationId: string,
    dto: SyncConnectorDto,
  ): Promise<SyncLogEntity> {
    const connector = await this.getConnector(connectorId, organizationId);

    if (!connector.isActive) {
      throw new HttpException('Connector is not active', HttpStatus.BAD_REQUEST);
    }

    // Create sync log
    const syncLog = this.syncLogRepo.create({
      connectorId,
      syncType: dto.syncType,
      status: 'started',
      startedAt: new Date(),
      itemsProcessed: 0,
      itemsSucceeded: 0,
      itemsFailed: 0,
    });

    await this.syncLogRepo.save(syncLog);

    try {
      // Perform sync based on connector type
      if (connector.connectorType === 'shopify') {
        await this.syncShopify(connector, dto, syncLog);
      } else {
        throw new Error('Connector type not implemented');
      }

      // Update sync log
      syncLog.status = 'completed';
      syncLog.completedAt = new Date();
      syncLog.durationMs = syncLog.completedAt.getTime() - syncLog.startedAt.getTime();

      // Update connector
      connector.lastSyncAt = new Date();
      connector.status = 'connected';
      await this.connectorRepo.save(connector);
    } catch (error: any) {
      syncLog.status = 'failed';
      syncLog.completedAt = new Date();
      syncLog.durationMs = syncLog.completedAt.getTime() - syncLog.startedAt.getTime();
      syncLog.errors = [{ error: error.message }];

      connector.lastError = error.message;
      connector.status = 'error';
      await this.connectorRepo.save(connector);
    }

    return this.syncLogRepo.save(syncLog);
  }

  /**
   * Sync Shopify connector
   */
  private async syncShopify(
    connector: ConnectorEntity,
    dto: SyncConnectorDto,
    syncLog: SyncLogEntity,
  ): Promise<void> {
    const config = {
      shopUrl: connector.config.shopUrl!,
      accessToken: connector.config.accessToken!,
    };

    if (dto.syncType === 'import' || dto.syncType === 'full-sync') {
      const products = await this.shopifyConnector.importProducts(config, {
        limit: dto.options?.limit || 50,
      });

      syncLog.itemsProcessed = products.length;
      syncLog.itemsSucceeded = products.length;
      syncLog.summary = {
        productsImported: products.length,
        variantsTotal: products.reduce((sum, p) => sum + p.variants.length, 0),
      };
    }
  }

  /**
   * Get sync logs
   */
  async getSyncLogs(
    connectorId: string,
    organizationId: string,
    limit: number = 20,
  ): Promise<SyncLogEntity[]> {
    // Verify connector belongs to org
    await this.getConnector(connectorId, organizationId);

    return this.syncLogRepo.find({
      where: { connectorId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Get connector statistics
   */
  async getConnectorStats(
    connectorId: string,
    organizationId: string,
  ): Promise<{
    totalSyncs: number;
    successfulSyncs: number;
    failedSyncs: number;
    lastSyncAt: Date | null;
    averageDuration: number;
    totalItemsProcessed: number;
  }> {
    await this.getConnector(connectorId, organizationId);

    const logs = await this.syncLogRepo.find({ where: { connectorId } });

    const stats = {
      totalSyncs: logs.length,
      successfulSyncs: logs.filter((l) => l.status === 'completed').length,
      failedSyncs: logs.filter((l) => l.status === 'failed').length,
      lastSyncAt: logs.length > 0 ? logs[0].createdAt : null,
      averageDuration: 0,
      totalItemsProcessed: 0,
    };

    if (logs.length > 0) {
      const completedLogs = logs.filter((l) => l.durationMs !== null);
      if (completedLogs.length > 0) {
        stats.averageDuration =
          completedLogs.reduce((sum, l) => sum + (l.durationMs || 0), 0) /
          completedLogs.length;
      }
      stats.totalItemsProcessed = logs.reduce((sum, l) => sum + l.itemsProcessed, 0);
    }

    return stats;
  }
}
