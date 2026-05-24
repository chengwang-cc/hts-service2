import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Or, Repository } from 'typeorm';
import { ProductEntity } from '../entities/product.entity';
import { ProductVariantEntity } from '../entities/product-variant.entity';
import { ClassificationEntity } from '../entities/classification.entity';

/**
 * CatalogService
 *
 * Convenience reads over the catalog. Used by widget/calculator paths
 * that want to fall back to a stored, confirmed classification before
 * running fresh AI classification.
 */
@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    @InjectRepository(ProductVariantEntity)
    private readonly variantRepo: Repository<ProductVariantEntity>,
    @InjectRepository(ClassificationEntity)
    private readonly classificationRepo: Repository<ClassificationEntity>,
  ) {}

  /**
   * Look up a SKU within an organization. Returns the matching variant +
   * product, or null.
   */
  async findVariantBySku(
    organizationId: string,
    sku: string,
  ): Promise<{ variant: ProductVariantEntity; product: ProductEntity } | null> {
    if (!organizationId || !sku) return null;

    const variant = await this.variantRepo
      .createQueryBuilder('v')
      .innerJoinAndMapOne(
        'v.product',
        ProductEntity,
        'p',
        'p.id = v.productId AND p.organizationId = :organizationId',
        { organizationId },
      )
      .where('v.sku = :sku', { sku })
      .limit(1)
      .getOne();

    if (!variant) return null;
    const product = (variant as any).product as ProductEntity | undefined;
    if (!product) return null;
    return { variant, product };
  }

  /**
   * Return a confirmed-and-fresh classification for a product against the
   * destination jurisdiction, or null.
   */
  async findFreshClassification(
    productId: string,
    destinationJurisdictionCode: string,
  ): Promise<ClassificationEntity | null> {
    if (!productId || !destinationJurisdictionCode) return null;
    const now = new Date();
    const row = await this.classificationRepo.findOne({
      where: {
        productId,
        destinationJurisdictionCode: destinationJurisdictionCode.toUpperCase(),
        status: 'confirmed',
      },
    });
    if (!row) return null;
    if (row.expiresAt && row.expiresAt < now) return null;
    return row;
  }

  /**
   * Expire classifications past their expiresAt (called by a scheduled job).
   */
  async expireStaleClassifications(): Promise<number> {
    const now = new Date();
    const res = await this.classificationRepo.update(
      {
        status: 'confirmed',
        expiresAt: Or(LessThan(now)),
      } as any,
      { status: 'expired' },
    );
    return res.affected ?? 0;
  }
}
