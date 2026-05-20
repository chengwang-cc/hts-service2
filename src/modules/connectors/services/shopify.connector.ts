import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';

export interface ShopifyProduct {
  id: string;
  title: string;
  description: string;
  variants: Array<{
    id: string;
    /**
     * Merchant-supplied SKU. May be missing — stores in development or
     * small shops often skip SKUs. Never use as a primary identifier;
     * always key off `id` for our internal records.
     */
    sku: string | null;
    inventoryItemId?: string;
    harmonizedSystemCode?: string;
    countryCodeOfOrigin?: string;
  }>;
}

export interface ShopifyConfig {
  shopUrl: string;
  accessToken: string;
  apiVersion?: string;
}

const DEFAULT_API_VERSION = '2024-10';

@Injectable()
export class ShopifyConnector {
  private readonly logger = new Logger(ShopifyConnector.name);

  async testConnection(config: ShopifyConfig): Promise<boolean> {
    try {
      await this.graphql<{ shop: { name: string } }>(config, '{ shop { name } }');
      return true;
    } catch {
      throw new HttpException(
        'Failed to connect to Shopify store',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async importProducts(
    config: ShopifyConfig,
    options?: { limit?: number; maxPages?: number },
  ): Promise<ShopifyProduct[]> {
    const maxPages = options?.maxPages ?? 20;
    const pageSize = Math.min(options?.limit ?? 100, 250);
    const products: ShopifyProduct[] = [];

    let after: string | null = null;

    for (let page = 0; page < maxPages; page++) {
      const response = await this.graphql<{
        products?: {
          edges?: Array<{
            cursor?: string;
            node?: {
              id?: string;
              title?: string;
              description?: string;
              variants?: {
                edges?: Array<{
                  node?: {
                    id?: string;
                    sku?: string;
                    inventoryItem?: {
                      id?: string;
                      harmonizedSystemCode?: string;
                      countryCodeOfOrigin?: string;
                    } | null;
                  } | null;
                }>;
              };
            } | null;
          }>;
          pageInfo?: {
            hasNextPage?: boolean;
            endCursor?: string | null;
          };
        };
      }>(
        config,
        `query SyncProducts($first: Int!, $after: String) {
          products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
            edges {
              cursor
              node {
                id
                title
                description
                variants(first: 100) {
                  edges {
                    node {
                      id
                      sku
                      inventoryItem {
                        id
                        harmonizedSystemCode
                        countryCodeOfOrigin
                      }
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
        { first: pageSize, after },
      );

      const edges = response.products?.edges ?? [];
      for (const edge of edges) {
        const node = edge.node;
        if (!node?.id) continue;

        const variants = (node.variants?.edges ?? [])
          .map((ve) => ve.node)
          .filter((v): v is NonNullable<typeof v> => !!v?.id)
          .map((v) => ({
            id: v.id!,
            sku: v.sku?.trim() ? v.sku.trim() : null,
            inventoryItemId: v.inventoryItem?.id,
            harmonizedSystemCode: v.inventoryItem?.harmonizedSystemCode,
            countryCodeOfOrigin: v.inventoryItem?.countryCodeOfOrigin,
          }));

        products.push({
          id: node.id,
          title: node.title?.trim() ?? '',
          description: node.description?.trim() ?? '',
          variants,
        });
      }

      if (!response.products?.pageInfo?.hasNextPage) break;
      after = response.products.pageInfo.endCursor ?? null;
      if (!after) break;
    }

    return products;
  }

  async getProduct(
    config: ShopifyConfig,
    productId: string,
  ): Promise<ShopifyProduct> {
    const gid = normalizeProductGid(productId);

    const response = await this.graphql<{
      product?: {
        id?: string;
        title?: string;
        description?: string;
        variants?: {
          edges?: Array<{
            node?: {
              id?: string;
              sku?: string;
              inventoryItem?: {
                id?: string;
                harmonizedSystemCode?: string;
                countryCodeOfOrigin?: string;
              } | null;
            } | null;
          }>;
        };
      } | null;
    }>(
      config,
      `query GetProduct($id: ID!) {
        product(id: $id) {
          id
          title
          description
          variants(first: 100) {
            edges {
              node {
                id
                sku
                inventoryItem {
                  id
                  harmonizedSystemCode
                  countryCodeOfOrigin
                }
              }
            }
          }
        }
      }`,
      { id: gid },
    );

    const product = response.product;
    if (!product?.id) {
      throw new HttpException('Product not found', HttpStatus.NOT_FOUND);
    }

    return {
      id: product.id,
      title: product.title?.trim() ?? '',
      description: product.description?.trim() ?? '',
      variants: (product.variants?.edges ?? [])
        .map((ve) => ve.node)
        .filter((v): v is NonNullable<typeof v> => !!v?.id)
        .map((v) => ({
          id: v.id!,
          sku: v.sku?.trim() ? v.sku.trim() : null,
          inventoryItemId: v.inventoryItem?.id,
          harmonizedSystemCode: v.inventoryItem?.harmonizedSystemCode,
          countryCodeOfOrigin: v.inventoryItem?.countryCodeOfOrigin,
        })),
    };
  }

  async updateProductHsCode(
    config: ShopifyConfig,
    variantId: string,
    hsCode: string,
    countryOfOrigin?: string,
  ): Promise<void> {
    const variantGid = normalizeVariantGid(variantId);

    // First, get the inventory item ID for this variant
    const variantResult = await this.graphql<{
      productVariant?: {
        inventoryItem?: { id?: string } | null;
      } | null;
    }>(
      config,
      `query VariantInventoryItem($id: ID!) {
        productVariant(id: $id) {
          inventoryItem {
            id
          }
        }
      }`,
      { id: variantGid },
    );

    const inventoryItemId =
      variantResult.productVariant?.inventoryItem?.id;
    if (!inventoryItemId) {
      throw new HttpException(
        `Inventory item not found for variant: ${variantId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    // Update the inventory item with HS code
    // API 2024-10: id is a separate argument, not inside input
    const input: Record<string, unknown> = {
      harmonizedSystemCode: hsCode,
    };
    if (countryOfOrigin?.trim()) {
      input.countryCodeOfOrigin = countryOfOrigin.trim().toUpperCase();
    }

    const mutationResult = await this.graphql<{
      inventoryItemUpdate?: {
        userErrors?: Array<{ message?: string }>;
      };
    }>(
      config,
      `mutation UpdateInventoryItem($id: ID!, $input: InventoryItemInput!) {
        inventoryItemUpdate(id: $id, input: $input) {
          userErrors {
            message
          }
        }
      }`,
      { id: inventoryItemId, input },
    );

    const errors = mutationResult.inventoryItemUpdate?.userErrors ?? [];
    if (errors.length > 0) {
      throw new HttpException(
        `Shopify inventoryItemUpdate failed: ${errors.map((e) => e.message).join('; ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Read the harmonized_system_code for a single variant, returning null
   * if Shopify has none. Used by the order-webhook writeback worker —
   * Shopify's orders/create webhook payload carries variant_id but not
   * the inventory-item HS code, so we have to query it back.
   */
  async getVariantHsCode(
    config: ShopifyConfig,
    variantId: string,
  ): Promise<string | null> {
    const variantGid = normalizeVariantGid(variantId);

    const result = await this.graphql<{
      productVariant?: {
        inventoryItem?: {
          harmonizedSystemCode?: string | null;
          countryCodeOfOrigin?: string | null;
        } | null;
      } | null;
    }>(
      config,
      `query VariantHsCode($id: ID!) {
        productVariant(id: $id) {
          inventoryItem {
            harmonizedSystemCode
            countryCodeOfOrigin
          }
        }
      }`,
      { id: variantGid },
    );

    const code = result.productVariant?.inventoryItem?.harmonizedSystemCode;
    return code?.trim() ? code.trim() : null;
  }

  /**
   * Upsert a single metafield on a Shopify order (or any owner resource
   * — we just pass the order's GID as ownerId). Idempotent: Shopify's
   * metafieldsSet mutation overwrites the value when (ownerId, namespace,
   * key) already exists.
   */
  async setOrderMetafield(
    config: ShopifyConfig,
    orderId: string | number,
    namespace: string,
    key: string,
    valueJson: unknown,
    type: string = 'json',
  ): Promise<void> {
    const ownerId = normalizeOrderGid(orderId);
    const value =
      typeof valueJson === 'string' ? valueJson : JSON.stringify(valueJson);

    const result = await this.graphql<{
      metafieldsSet?: {
        userErrors?: Array<{ field?: string[]; message?: string }>;
      };
    }>(
      config,
      `mutation SetOrderMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id namespace key }
          userErrors { field message }
        }
      }`,
      {
        metafields: [
          { ownerId, namespace, key, type, value },
        ],
      },
    );

    const errors = result.metafieldsSet?.userErrors ?? [];
    if (errors.length > 0) {
      throw new HttpException(
        `Shopify metafieldsSet failed: ${errors
          .map((e) => `${(e.field ?? []).join('.')}: ${e.message ?? 'unknown'}`)
          .join('; ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async batchUpdateProducts(
    config: ShopifyConfig,
    updates: Array<{
      variantId: string;
      htsCode: string;
      originCountry?: string;
    }>,
  ): Promise<{
    succeeded: number;
    failed: number;
    errors: Array<{ variantId: string; error: string }>;
  }> {
    const results = {
      succeeded: 0,
      failed: 0,
      errors: [] as Array<{ variantId: string; error: string }>,
    };

    for (const update of updates) {
      try {
        await this.updateProductHsCode(
          config,
          update.variantId,
          update.htsCode,
          update.originCountry,
        );
        results.succeeded++;
      } catch (error: any) {
        results.failed++;
        results.errors.push({
          variantId: update.variantId,
          error: error.message,
        });
      }
    }

    return results;
  }

  async createWebhook(
    config: ShopifyConfig,
    webhookUrl: string,
    topic: string,
  ): Promise<{ id: string }> {
    const shopifyTopic = topic.replace('/', '_').toUpperCase();

    const result = await this.graphql<{
      webhookSubscriptionCreate?: {
        webhookSubscription?: { id?: string } | null;
        userErrors?: Array<{ message?: string }>;
      };
    }>(
      config,
      `mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $url: URL!) {
        webhookSubscriptionCreate(
          topic: $topic
          webhookSubscription: { callbackUrl: $url, format: JSON }
        ) {
          webhookSubscription {
            id
          }
          userErrors {
            message
          }
        }
      }`,
      { topic: shopifyTopic, url: webhookUrl },
    );

    const errors =
      result.webhookSubscriptionCreate?.userErrors ?? [];
    if (errors.length > 0) {
      throw new HttpException(
        `Failed to create webhook: ${errors.map((e) => e.message).join('; ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      id:
        result.webhookSubscriptionCreate?.webhookSubscription?.id ?? '',
    };
  }

  private async graphql<T>(
    config: ShopifyConfig,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const shopDomain = normalizeShopDomain(config.shopUrl);
    const apiVersion = config.apiVersion || DEFAULT_API_VERSION;

    const response = await fetch(
      `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': config.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Shopify GraphQL request failed (${response.status}): ${text}`,
      );
    }

    const parsed = JSON.parse(text) as {
      data?: T;
      errors?: Array<{ message?: string }>;
    };

    if (parsed.errors?.length) {
      throw new Error(
        `Shopify GraphQL errors: ${parsed.errors.map((e) => e.message).join('; ')}`,
      );
    }

    if (!parsed.data) {
      throw new Error('Shopify GraphQL response missing data');
    }

    return parsed.data;
  }
}

function normalizeShopDomain(input: string): string {
  const text = input.trim();
  if (!text) return '';
  try {
    const url = text.includes('://') ? new URL(text) : new URL(`https://${text}`);
    return url.host.toLowerCase();
  } catch {
    return text.toLowerCase();
  }
}

function normalizeProductGid(id: string): string {
  const raw = id.trim();
  if (raw.startsWith('gid://')) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/Product/${raw}`;
  return raw;
}

function normalizeVariantGid(id: string): string {
  const raw = id.trim();
  if (raw.startsWith('gid://')) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/ProductVariant/${raw}`;
  return raw;
}

function normalizeOrderGid(id: string | number): string {
  const raw = String(id).trim();
  if (raw.startsWith('gid://')) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/Order/${raw}`;
  return raw;
}
