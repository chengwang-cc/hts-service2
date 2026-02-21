import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface ShopifyProduct {
  id: number;
  title: string;
  vendor: string;
  product_type: string;
  variants: Array<{
    id: number;
    sku: string;
    price: string;
    weight: number;
    weight_unit: string;
    harmonized_system_code?: string;
    country_code_of_origin?: string;
  }>;
  images: Array<{
    id: number;
    src: string;
  }>;
}

export interface ShopifyConfig {
  shopUrl: string;
  accessToken: string;
  apiVersion?: string;
}

@Injectable()
export class ShopifyConnector {
  constructor(private readonly httpService: HttpService) {}

  /**
   * Test connection to Shopify store
   */
  async testConnection(config: ShopifyConfig): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `https://${config.shopUrl}/admin/api/2024-01/shop.json`,
          {
            headers: {
              'X-Shopify-Access-Token': config.accessToken,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      return response.status === 200;
    } catch (error) {
      throw new HttpException(
        'Failed to connect to Shopify store',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Import products from Shopify
   */
  async importProducts(
    config: ShopifyConfig,
    options?: {
      sinceId?: number;
      limit?: number;
      productIds?: number[];
    },
  ): Promise<ShopifyProduct[]> {
    const apiVersion = config.apiVersion || '2024-01';
    const limit = options?.limit || 50;

    let url = `https://${config.shopUrl}/admin/api/${apiVersion}/products.json?limit=${limit}`;

    if (options?.sinceId) {
      url += `&since_id=${options.sinceId}`;
    }

    if (options?.productIds && options.productIds.length > 0) {
      url += `&ids=${options.productIds.join(',')}`;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            'X-Shopify-Access-Token': config.accessToken,
            'Content-Type': 'application/json',
          },
        }),
      );

      return response.data.products || [];
    } catch (error: any) {
      throw new HttpException(
        `Failed to import products: ${error.message}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Export/update product in Shopify
   */
  async updateProduct(
    config: ShopifyConfig,
    productId: number,
    updates: {
      harmonizedSystemCode?: string;
      countryCodeOfOrigin?: string;
      variantUpdates?: Record<
        number,
        {
          harmonized_system_code?: string;
          country_code_of_origin?: string;
        }
      >;
    },
  ): Promise<boolean> {
    const apiVersion = config.apiVersion || '2024-01';

    // Update variants if provided
    if (updates.variantUpdates) {
      for (const [variantId, variantData] of Object.entries(
        updates.variantUpdates,
      )) {
        try {
          await firstValueFrom(
            this.httpService.put(
              `https://${config.shopUrl}/admin/api/${apiVersion}/variants/${variantId}.json`,
              {
                variant: {
                  id: Number(variantId),
                  ...variantData,
                },
              },
              {
                headers: {
                  'X-Shopify-Access-Token': config.accessToken,
                  'Content-Type': 'application/json',
                },
              },
            ),
          );
        } catch (error: any) {
          console.error(
            `Failed to update variant ${variantId}:`,
            error.message,
          );
        }
      }
    }

    return true;
  }

  /**
   * Batch update products
   */
  async batchUpdateProducts(
    config: ShopifyConfig,
    updates: Array<{
      productId: number;
      variantId?: number;
      htsCode?: string;
      originCountry?: string;
    }>,
  ): Promise<{
    succeeded: number;
    failed: number;
    errors: Array<{ productId: number; error: string }>;
  }> {
    const results = {
      succeeded: 0,
      failed: 0,
      errors: [] as Array<{ productId: number; error: string }>,
    };

    for (const update of updates) {
      try {
        if (update.variantId) {
          await this.updateProduct(config, update.productId, {
            variantUpdates: {
              [update.variantId]: {
                harmonized_system_code: update.htsCode,
                country_code_of_origin: update.originCountry,
              },
            },
          });
          results.succeeded++;
        }
      } catch (error: any) {
        results.failed++;
        results.errors.push({
          productId: update.productId,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Get product by ID
   */
  async getProduct(
    config: ShopifyConfig,
    productId: number,
  ): Promise<ShopifyProduct> {
    const apiVersion = config.apiVersion || '2024-01';

    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `https://${config.shopUrl}/admin/api/${apiVersion}/products/${productId}.json`,
          {
            headers: {
              'X-Shopify-Access-Token': config.accessToken,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      return response.data.product;
    } catch (error: any) {
      throw new HttpException(
        `Failed to get product: ${error.message}`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /**
   * Create webhook for product updates
   */
  async createWebhook(
    config: ShopifyConfig,
    webhookUrl: string,
    topic: 'products/create' | 'products/update' | 'products/delete',
  ): Promise<any> {
    const apiVersion = config.apiVersion || '2024-01';

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `https://${config.shopUrl}/admin/api/${apiVersion}/webhooks.json`,
          {
            webhook: {
              topic,
              address: webhookUrl,
              format: 'json',
            },
          },
          {
            headers: {
              'X-Shopify-Access-Token': config.accessToken,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      return response.data.webhook;
    } catch (error: any) {
      throw new HttpException(
        `Failed to create webhook: ${error.message}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
