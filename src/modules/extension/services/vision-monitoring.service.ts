import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { VisionAnalysisEntity } from '../entities/vision-analysis.entity';
import { ScrapingMetadataEntity } from '../entities/scraping-metadata.entity';

export interface VisionMetrics {
  totalRequests: number;
  totalTokensUsed: number;
  totalCost: number;
  averageProcessingTime: number;
  cacheHitRate: number;
  successRate: number;
}

export interface ScrapingMetrics {
  totalRequests: number;
  httpRequests: number;
  puppeteerRequests: number;
  averageProcessingTime: number;
  successRate: number;
  visionUsageRate: number;
}

/**
 * Vision Monitoring Service
 * Tracks costs, usage metrics, and performance for vision and scraping endpoints
 */
@Injectable()
export class VisionMonitoringService {
  private readonly logger = new Logger(VisionMonitoringService.name);

  // Pricing per 1M tokens (as of 2026)
  private readonly GPT4O_PRICING = {
    input: 2.5,
    output: 10.0,
  };

  constructor(
    @InjectRepository(VisionAnalysisEntity)
    private readonly visionAnalysisRepository: Repository<VisionAnalysisEntity>,
    @InjectRepository(ScrapingMetadataEntity)
    private readonly scrapingMetadataRepository: Repository<ScrapingMetadataEntity>,
  ) {}

  /**
   * Log vision request with detailed metrics
   */
  logVisionRequest(params: {
    organizationId: string;
    imageSize: number;
    processingTime: number;
    tokensUsed?: number;
    productsFound: number;
    cached: boolean;
  }): void {
    const cost = params.tokensUsed
      ? this.calculateVisionCost(params.tokensUsed)
      : 0;

    this.logger.log({
      event: 'vision_request',
      organizationId: params.organizationId,
      imageSize: params.imageSize,
      processingTime: params.processingTime,
      tokensUsed: params.tokensUsed || 0,
      estimatedCost: cost.toFixed(4),
      productsFound: params.productsFound,
      cached: params.cached,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Log scraping request with detailed metrics
   */
  logScrapingRequest(params: {
    organizationId: string;
    url: string;
    method: 'http' | 'puppeteer';
    processingTime: number;
    productsFound: number;
    visionUsed: boolean;
    success: boolean;
    toolsUsed?: string[];
  }): void {
    this.logger.log({
      event: 'scraping_request',
      organizationId: params.organizationId,
      url: params.url,
      method: params.method,
      processingTime: params.processingTime,
      productsFound: params.productsFound,
      visionUsed: params.visionUsed,
      success: params.success,
      toolsUsed: params.toolsUsed || [],
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get vision metrics for organization
   */
  async getVisionMetrics(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<VisionMetrics> {
    try {
      const analyses = await this.visionAnalysisRepository.find({
        where: {
          organizationId,
          createdAt: Between(startDate, endDate),
        },
      });

      const totalRequests = analyses.length;
      const totalTokensUsed = analyses.reduce(
        (sum, a) => sum + (a.tokensUsed || 0),
        0,
      );
      const totalCost = this.calculateVisionCost(totalTokensUsed);
      const averageProcessingTime =
        totalRequests > 0
          ? analyses.reduce((sum, a) => sum + a.processingTimeMs, 0) /
            totalRequests
          : 0;

      // Cache hit rate: count how many are duplicates by hash
      const uniqueHashes = new Set(analyses.map((a) => a.imageHash));
      const cacheHitRate =
        totalRequests > 0
          ? ((totalRequests - uniqueHashes.size) / totalRequests) * 100
          : 0;

      // Success rate: assume all stored analyses are successful
      const successRate = 100;

      return {
        totalRequests,
        totalTokensUsed,
        totalCost,
        averageProcessingTime: Math.round(averageProcessingTime),
        cacheHitRate: Math.round(cacheHitRate * 100) / 100,
        successRate,
      };
    } catch (error) {
      this.logger.error('Failed to get vision metrics', error.stack);
      throw error;
    }
  }

  /**
   * Get scraping metrics for organization
   */
  async getScrapingMetrics(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<ScrapingMetrics> {
    try {
      const scrapings = await this.scrapingMetadataRepository.find({
        where: {
          organizationId,
          createdAt: Between(startDate, endDate),
        },
      });

      const totalRequests = scrapings.length;
      const httpRequests = scrapings.filter((s) => s.method === 'http').length;
      const puppeteerRequests = scrapings.filter(
        (s) => s.method === 'puppeteer',
      ).length;

      const averageProcessingTime =
        totalRequests > 0
          ? scrapings.reduce((sum, s) => sum + s.processingTimeMs, 0) /
            totalRequests
          : 0;

      const successfulRequests = scrapings.filter(
        (s) => s.errorMessage === null,
      ).length;
      const successRate =
        totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;

      const visionUsed = scrapings.filter((s) => s.visionUsed).length;
      const visionUsageRate =
        totalRequests > 0 ? (visionUsed / totalRequests) * 100 : 0;

      return {
        totalRequests,
        httpRequests,
        puppeteerRequests,
        averageProcessingTime: Math.round(averageProcessingTime),
        successRate: Math.round(successRate * 100) / 100,
        visionUsageRate: Math.round(visionUsageRate * 100) / 100,
      };
    } catch (error) {
      this.logger.error('Failed to get scraping metrics', error.stack);
      throw error;
    }
  }

  /**
   * Get cost summary for organization
   */
  async getCostSummary(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    visionCost: number;
    totalTokens: number;
    requestCount: number;
    averageCostPerRequest: number;
  }> {
    try {
      const analyses = await this.visionAnalysisRepository.find({
        where: {
          organizationId,
          createdAt: Between(startDate, endDate),
        },
      });

      const totalTokens = analyses.reduce(
        (sum, a) => sum + (a.tokensUsed || 0),
        0,
      );
      const visionCost = this.calculateVisionCost(totalTokens);
      const requestCount = analyses.length;
      const averageCostPerRequest =
        requestCount > 0 ? visionCost / requestCount : 0;

      this.logger.log({
        event: 'cost_summary',
        organizationId,
        period: `${startDate.toISOString()} to ${endDate.toISOString()}`,
        visionCost: visionCost.toFixed(4),
        totalTokens,
        requestCount,
        averageCostPerRequest: averageCostPerRequest.toFixed(4),
      });

      return {
        visionCost: Math.round(visionCost * 10000) / 10000,
        totalTokens,
        requestCount,
        averageCostPerRequest:
          Math.round(averageCostPerRequest * 10000) / 10000,
      };
    } catch (error) {
      this.logger.error('Failed to get cost summary', error.stack);
      throw error;
    }
  }

  /**
   * Calculate vision cost based on tokens used
   * Assumes average 50/50 split between input and output tokens
   */
  private calculateVisionCost(totalTokens: number): number {
    // Rough estimate: 70% input, 30% output
    const inputTokens = totalTokens * 0.7;
    const outputTokens = totalTokens * 0.3;

    const inputCost = (inputTokens / 1_000_000) * this.GPT4O_PRICING.input;
    const outputCost = (outputTokens / 1_000_000) * this.GPT4O_PRICING.output;

    return inputCost + outputCost;
  }

  /**
   * Log alert if costs exceed threshold
   */
  async checkCostThreshold(
    organizationId: string,
    threshold: number,
  ): Promise<void> {
    const endDate = new Date();
    const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours

    const costSummary = await this.getCostSummary(
      organizationId,
      startDate,
      endDate,
    );

    if (costSummary.visionCost > threshold) {
      this.logger.warn({
        event: 'cost_threshold_exceeded',
        organizationId,
        currentCost: costSummary.visionCost,
        threshold,
        period: '24 hours',
        requestCount: costSummary.requestCount,
      });
    }
  }
}
