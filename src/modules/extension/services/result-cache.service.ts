import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, IsNull } from 'typeorm';
import { VisionAnalysisEntity } from '../entities/vision-analysis.entity';
import { ScrapingMetadataEntity } from '../entities/scraping-metadata.entity';
import { DetectedProduct } from '@hts/core/src/services/vision.service';

export interface CachedVisionResult {
  products: DetectedProduct[];
  confidence: number;
  model: string;
  processingTime: number;
  cached: true;
}

export interface CachedScrapingResult {
  products: DetectedProduct[];
  method: 'http' | 'puppeteer';
  confidence: number;
  cached: true;
}

/**
 * Result Cache Service
 * Implements aggressive caching strategies to reduce API costs
 */
@Injectable()
export class ResultCacheService {
  private readonly logger = new Logger(ResultCacheService.name);

  // Cache TTLs
  private readonly VISION_CACHE_TTL = 60 * 60 * 1000; // 1 hour
  private readonly SCRAPING_CACHE_TTL = 60 * 60 * 1000; // 1 hour
  private readonly EXTENDED_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours for static content

  constructor(
    @InjectRepository(VisionAnalysisEntity)
    private readonly visionRepository: Repository<VisionAnalysisEntity>,
    @InjectRepository(ScrapingMetadataEntity)
    private readonly scrapingRepository: Repository<ScrapingMetadataEntity>,
  ) {}

  /**
   * Get cached vision result by image hash
   */
  async getCachedVisionResult(
    imageHash: string,
    organizationId: string,
  ): Promise<CachedVisionResult | null> {
    try {
      const cacheExpiry = new Date(Date.now() - this.VISION_CACHE_TTL);

      const cached = await this.visionRepository.findOne({
        where: {
          imageHash,
          organizationId,
          createdAt: MoreThan(cacheExpiry),
        },
        order: { createdAt: 'DESC' },
      });

      if (cached) {
        this.logger.log(
          `Vision cache HIT for image ${imageHash.substring(0, 8)}... (org: ${organizationId})`,
        );

        return {
          products: cached.analysisResult.products,
          confidence: cached.analysisResult.overallConfidence,
          model: cached.modelUsed,
          processingTime: 0, // Cached = instant
          cached: true,
        };
      }

      this.logger.debug(
        `Vision cache MISS for image ${imageHash.substring(0, 8)}...`,
      );
      return null;
    } catch (error) {
      this.logger.error('Failed to get cached vision result', error.stack);
      return null; // Fail open - allow request to proceed
    }
  }

  /**
   * Get cached scraping result by URL hash
   */
  async getCachedScrapingResult(
    urlHash: string,
    organizationId: string,
  ): Promise<CachedScrapingResult | null> {
    try {
      const cacheExpiry = new Date(Date.now() - this.SCRAPING_CACHE_TTL);

      const cached = await this.scrapingRepository.findOne({
        where: {
          urlHash,
          organizationId,
          createdAt: MoreThan(cacheExpiry),
          errorMessage: IsNull(), // Only cache successful results
        },
        order: { createdAt: 'DESC' },
      });

      if (cached && cached.scrapedData) {
        this.logger.log(
          `Scraping cache HIT for URL ${urlHash.substring(0, 8)}... (org: ${organizationId})`,
        );

        // Note: For full caching, we'd store products in scrapedData
        // This is a simplified version that just indicates cache availability
        return null; // Simplified: not storing full products in scraping metadata
      }

      this.logger.debug(
        `Scraping cache MISS for URL ${urlHash.substring(0, 8)}...`,
      );
      return null;
    } catch (error) {
      this.logger.error('Failed to get cached scraping result', error.stack);
      return null;
    }
  }

  /**
   * Check if image was recently analyzed (deduplication)
   */
  async isImageRecentlyAnalyzed(
    imageHash: string,
    organizationId: string,
    ttlMs?: number,
  ): Promise<boolean> {
    const ttl = ttlMs || this.VISION_CACHE_TTL;
    const cacheExpiry = new Date(Date.now() - ttl);

    try {
      const count = await this.visionRepository.count({
        where: {
          imageHash,
          organizationId,
          createdAt: MoreThan(cacheExpiry),
        },
      });

      return count > 0;
    } catch (error) {
      this.logger.error('Failed to check image duplication', error.stack);
      return false;
    }
  }

  /**
   * Check if URL was recently scraped
   */
  async isUrlRecentlyScraped(
    urlHash: string,
    organizationId: string,
    ttlMs?: number,
  ): Promise<boolean> {
    const ttl = ttlMs || this.SCRAPING_CACHE_TTL;
    const cacheExpiry = new Date(Date.now() - ttl);

    try {
      const count = await this.scrapingRepository.count({
        where: {
          urlHash,
          organizationId,
          createdAt: MoreThan(cacheExpiry),
          errorMessage: null,
        },
      });

      return count > 0;
    } catch (error) {
      this.logger.error('Failed to check URL duplication', error.stack);
      return false;
    }
  }

  /**
   * Get cache statistics for organization
   */
  async getCacheStats(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    visionCacheHitRate: number;
    scrapingCacheHitRate: number;
    costSavings: number;
  }> {
    try {
      // Vision cache stats
      const visionAnalyses = await this.visionRepository.find({
        where: { organizationId },
        order: { createdAt: 'ASC' },
      });

      const uniqueImageHashes = new Set<string>();
      let visionDuplicates = 0;

      for (const analysis of visionAnalyses) {
        if (uniqueImageHashes.has(analysis.imageHash)) {
          visionDuplicates++;
        } else {
          uniqueImageHashes.add(analysis.imageHash);
        }
      }

      const visionCacheHitRate =
        visionAnalyses.length > 0
          ? (visionDuplicates / visionAnalyses.length) * 100
          : 0;

      // Scraping cache stats
      const scrapings = await this.scrapingRepository.find({
        where: { organizationId, errorMessage: null },
        order: { createdAt: 'ASC' },
      });

      const uniqueUrlHashes = new Set<string>();
      let scrapingDuplicates = 0;

      for (const scraping of scrapings) {
        if (uniqueUrlHashes.has(scraping.urlHash)) {
          scrapingDuplicates++;
        } else {
          uniqueUrlHashes.add(scraping.urlHash);
        }
      }

      const scrapingCacheHitRate =
        scrapings.length > 0
          ? (scrapingDuplicates / scrapings.length) * 100
          : 0;

      // Estimate cost savings (assuming $0.03 per vision request saved)
      const costSavings = visionDuplicates * 0.03;

      return {
        visionCacheHitRate: Math.round(visionCacheHitRate * 100) / 100,
        scrapingCacheHitRate: Math.round(scrapingCacheHitRate * 100) / 100,
        costSavings: Math.round(costSavings * 100) / 100,
      };
    } catch (error) {
      this.logger.error('Failed to get cache stats', error.stack);
      throw error;
    }
  }

  /**
   * Clean up old cache entries (run periodically)
   */
  async cleanupOldCache(): Promise<{
    visionDeleted: number;
    scrapingDeleted: number;
  }> {
    try {
      const expiryDate = new Date(Date.now() - this.EXTENDED_CACHE_TTL);

      // Delete old vision analyses
      const visionResult = await this.visionRepository
        .createQueryBuilder()
        .delete()
        .where('createdAt < :expiryDate', { expiryDate })
        .execute();

      // Delete old scraping metadata
      const scrapingResult = await this.scrapingRepository
        .createQueryBuilder()
        .delete()
        .where('createdAt < :expiryDate', { expiryDate })
        .execute();

      const visionDeleted = visionResult.affected || 0;
      const scrapingDeleted = scrapingResult.affected || 0;

      this.logger.log(
        `Cache cleanup: Deleted ${visionDeleted} vision entries, ${scrapingDeleted} scraping entries`,
      );

      return {
        visionDeleted,
        scrapingDeleted,
      };
    } catch (error) {
      this.logger.error('Failed to cleanup old cache', error.stack);
      throw error;
    }
  }
}
