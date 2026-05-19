import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(ConnectorService.name);

  constructor(
    @InjectRepository(ConnectorEntity)
    private readonly connectorRepo: Repository<ConnectorEntity>,
    @InjectRepository(SyncLogEntity)
    private readonly syncLogRepo: Repository<SyncLogEntity>,
    private readonly shopifyConnector: ShopifyConnector,
    private readonly brokerConnector: BrokerConnector,
  ) {}

  private searchService: any = null;
  private lookupClassificationJobService: {
    recordCompletedJob: (params: {
      organizationId: string;
      source: 'WEB' | 'SHOPIFY' | 'API';
      sourceUrl?: string | null;
      productDescription: string;
      htsCode: string;
      description?: string | null;
      confidence?: number | null;
    }) => Promise<void>;
  } | null = null;

  /**
   * Inject SearchService lazily to avoid circular module dependency.
   * Called by the module after construction.
   */
  setSearchService(searchService: any): void {
    this.searchService = searchService;
  }

  /**
   * Inject LookupClassificationJobService lazily to avoid circular dependency.
   * Called by the module after construction.
   */
  setLookupClassificationJobService(service: any): void {
    this.lookupClassificationJobService = service;
  }

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

    return this.redactConfig(await this.connectorRepo.save(connector));
  }

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

    return this.redactConfig(await this.connectorRepo.save(connector));
  }

  async deleteConnector(
    connectorId: string,
    organizationId: string,
  ): Promise<void> {
    const result = await this.connectorRepo.delete({
      id: connectorId,
      organizationId,
    });

    if (result.affected === 0) {
      throw new HttpException('Connector not found', HttpStatus.NOT_FOUND);
    }
  }

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

    return this.redactConfig(connector);
  }

  async listConnectors(organizationId: string): Promise<ConnectorEntity[]> {
    const connectors = await this.connectorRepo.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });

    return connectors.map((c) => this.redactConfig(c));
  }

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

  async syncConnector(
    connectorId: string,
    organizationId: string,
    dto: SyncConnectorDto,
  ): Promise<SyncLogEntity> {
    const connector = await this.connectorRepo.findOne({
      where: { id: connectorId, organizationId },
    });

    if (!connector) {
      throw new HttpException('Connector not found', HttpStatus.NOT_FOUND);
    }

    if (!connector.isActive) {
      throw new HttpException(
        'Connector is not active',
        HttpStatus.BAD_REQUEST,
      );
    }

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
      if (connector.connectorType === 'shopify') {
        await this.syncShopify(connector, dto, syncLog);
      } else {
        throw new Error('Connector type not implemented');
      }

      syncLog.status = 'completed';
      syncLog.completedAt = new Date();
      syncLog.durationMs =
        syncLog.completedAt.getTime() - syncLog.startedAt.getTime();

      connector.lastSyncAt = new Date();
      connector.status = 'connected';
      connector.lastError = null;
      await this.connectorRepo.save(connector);
    } catch (error: any) {
      syncLog.status = syncLog.itemsSucceeded > 0 ? 'partial' : 'failed';
      syncLog.completedAt = new Date();
      syncLog.durationMs =
        syncLog.completedAt.getTime() - syncLog.startedAt.getTime();
      syncLog.errors = [...(syncLog.errors ?? []), { error: error.message }];

      connector.lastError = error.message;
      connector.status = 'error';
      await this.connectorRepo.save(connector);
    }

    return this.syncLogRepo.save(syncLog);
  }

  /**
   * Sync Shopify connector: import products, classify, write back HS codes
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
        maxPages: 5,
      });

      const errors: Array<{ itemId?: string; error: string }> = [];

      for (const product of products) {
        for (const variant of product.variants) {
          syncLog.itemsProcessed++;

          if (!variant.sku) continue;

          try {
            // Classify the product using search service
            let htsNumber: string | undefined;

            if (this.searchService) {
              const searchQuery = [product.title, product.description]
                .filter(Boolean)
                .join(' ');
              const results = await this.searchService.hybridSearch(
                searchQuery,
                3,
              );
              if (results.length > 0 && results[0].htsNumber) {
                htsNumber = results[0].htsNumber;
              }
            }

            // Fallback to autocomplete if hybrid search found nothing
            if (!htsNumber && this.searchService) {
              try {
                const autoResults = await this.searchService.autocomplete(product.title, 3);
                if (autoResults.length > 0 && autoResults[0].htsNumber) {
                  htsNumber = autoResults[0].htsNumber;
                }
              } catch {
                // autocomplete fallback failed
              }
            }

            if (!htsNumber) {
              this.logger.warn(
                `No HTS classification found for SKU ${variant.sku} (${product.title})`,
              );
              syncLog.itemsFailed++;
              errors.push({
                itemId: variant.sku,
                error: 'No HTS classification found',
              });
              continue;
            }

            // Write back the HS code to Shopify
            await this.shopifyConnector.updateProductHsCode(
              config,
              variant.id,
              htsNumber,
              variant.countryCodeOfOrigin,
            );

            // Record into classification history so it shows up in the user
            // dashboard alongside web/API requests. Best-effort: history
            // logging must never break the sync flow itself.
            try {
              await this.lookupClassificationJobService?.recordCompletedJob({
                organizationId: connector.organizationId,
                source: 'SHOPIFY',
                sourceUrl: config.shopUrl
                  ? `https://${config.shopUrl}/admin/products/${product.id}`
                  : null,
                productDescription: [product.title, product.description]
                  .filter(Boolean)
                  .join(' — ')
                  .slice(0, 512),
                htsCode: htsNumber,
              });
            } catch (historyError: any) {
              this.logger.warn(
                `Failed to record Shopify classification history for SKU ${variant.sku}: ${historyError?.message ?? historyError}`,
              );
            }

            syncLog.itemsSucceeded++;
          } catch (error: any) {
            syncLog.itemsFailed++;
            errors.push({
              itemId: variant.sku,
              error: error.message,
            });
            this.logger.warn(
              `Failed to classify/update SKU ${variant.sku}: ${error.message}`,
            );
          }
        }
      }

      syncLog.errors = errors.length > 0 ? errors : null;
      syncLog.summary = {
        productsImported: products.length,
        variantsTotal: products.reduce(
          (sum, p) => sum + p.variants.length,
          0,
        ),
        classified: syncLog.itemsSucceeded,
        failed: syncLog.itemsFailed,
      };
    }
  }

  /**
   * Sync a single product by ID (used by webhooks for efficiency).
   */
  async syncSingleProduct(
    connectorId: string,
    organizationId: string,
    productId: string,
  ): Promise<void> {
    const connector = await this.connectorRepo.findOne({
      where: { id: connectorId, organizationId },
    });
    if (!connector || connector.connectorType !== 'shopify') return;

    const config = {
      shopUrl: connector.config.shopUrl!,
      accessToken: connector.config.accessToken!,
    };

    try {
      const product = await this.shopifyConnector.getProduct(config, productId);
      for (const variant of product.variants) {
        if (!variant.sku) continue;

        let htsNumber: string | undefined;
        if (this.searchService) {
          const query = [product.title, product.description].filter(Boolean).join(' ');
          try {
            // Try hybrid search first (semantic + lexical)
            const results = await this.searchService.hybridSearch(query, 3);
            if (results.length > 0 && results[0].htsNumber) {
              htsNumber = results[0].htsNumber;
            }
          } catch (searchError: any) {
            this.logger.warn(`Webhook sync: hybrid search failed for SKU ${variant.sku}: ${searchError.message}`);
          }

          // Fallback to autocomplete if hybrid search found nothing
          if (!htsNumber) {
            try {
              const autoResults = await this.searchService.autocomplete(product.title, 3);
              if (autoResults.length > 0 && autoResults[0].htsNumber) {
                htsNumber = autoResults[0].htsNumber;
                this.logger.log(`Webhook sync: fallback autocomplete matched SKU ${variant.sku} → ${htsNumber}`);
              } else {
                this.logger.warn(`Webhook sync: no classification for SKU ${variant.sku} (title: "${product.title.substring(0, 60)}")`);
              }
            } catch {
              this.logger.warn(`Webhook sync: autocomplete also failed for SKU ${variant.sku}`);
            }
          }
        }

        if (htsNumber) {
          await this.shopifyConnector.updateProductHsCode(
            config,
            variant.id,
            htsNumber,
            variant.countryCodeOfOrigin,
          );
          this.logger.log(`Webhook sync: classified SKU ${variant.sku} → ${htsNumber}`);
        }
      }
    } catch (error: any) {
      this.logger.warn(`Single product sync failed for ${productId}: ${error.message}`);
    }
  }

  /**
   * Find a connector by shop domain (for webhook handling)
   */
  async findConnectorByShopDomain(
    shopDomain: string,
  ): Promise<ConnectorEntity | null> {
    const connectors = await this.connectorRepo.find({
      where: { connectorType: 'shopify', isActive: true },
    });

    const normalizedDomain = this.normalizeShopHost(shopDomain);
    if (!normalizedDomain) return null;

    return (
      connectors.find((c) => {
        const configHost = this.normalizeShopHost(c.config.shopUrl ?? '');
        return configHost === normalizedDomain;
      }) ?? null
    );
  }

  async getSyncLogs(
    connectorId: string,
    organizationId: string,
    limit: number = 20,
  ): Promise<SyncLogEntity[]> {
    await this.getConnector(connectorId, organizationId);

    return this.syncLogRepo.find({
      where: { connectorId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

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
      stats.totalItemsProcessed = logs.reduce(
        (sum, l) => sum + l.itemsProcessed,
        0,
      );
    }

    return stats;
  }

  /**
   * Redact sensitive fields from connector config before returning to API consumers
   */
  private redactConfig(connector: ConnectorEntity): ConnectorEntity {
    if (!connector.config) return connector;

    connector.config = { ...connector.config };
    if (connector.config.accessToken) {
      connector.config.accessToken = '***';
    }
    if (connector.config.apiSecret) {
      connector.config.apiSecret = '***';
    }
    if (connector.config.apiKey) {
      connector.config.apiKey = '***';
    }
    return connector;
  }

  private normalizeShopHost(input: string): string {
    const trimmed = (input ?? '').trim().toLowerCase();
    if (!trimmed) return '';
    try {
      const url = trimmed.includes('://') ? new URL(trimmed) : new URL(`https://${trimmed}`);
      return url.host;
    } catch {
      return trimmed;
    }
  }
}
