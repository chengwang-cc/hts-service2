import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import puppeteer, { type Browser } from 'puppeteer';
import { Repository } from 'typeorm';
import { VisionService } from '@hts/core';
import { QueueService } from '../../queue/queue.service';
import { UrlType } from '../dto/classify-url.dto';
import type { ClassificationResult } from './classification.service';
import { ClassificationService } from './classification.service';
import { UrlClassifierService } from './url-classifier.service';
import { LookupClassificationJobEntity } from '../entities/lookup-classification-job.entity';

export const LOOKUP_CLASSIFICATION_QUEUE = 'lookup-classification-job';

type LookupClassificationJobResult = {
  success: true;
  data: Omit<ClassificationResult, 'source'> & {
    source?: Record<string, unknown> | null;
  };
  timings?: {
    queueMs?: number | null;
    processingMs?: number | null;
    totalMs?: number | null;
    visionMs?: number | null;
    classificationMs?: number | null;
    imageDownloadMs?: number | null;
  };
};

@Injectable()
export class LookupClassificationJobService {
  private readonly logger = new Logger(LookupClassificationJobService.name);
  private readonly browserEnabled =
    (process.env.WEB_SCRAPING_DISABLED ?? 'false') !== 'true' &&
    !process.env.JEST_WORKER_ID &&
    process.env.NODE_ENV !== 'test';

  constructor(
    @InjectRepository(LookupClassificationJobEntity)
    private readonly jobRepository: Repository<LookupClassificationJobEntity>,
    private readonly urlClassifierService: UrlClassifierService,
    private readonly classificationService: ClassificationService,
    private readonly visionService: VisionService,
    private readonly queueService: QueueService,
  ) {}

  async createUrlJob(user: any, url: string) {
    if (!user?.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const job = await this.jobRepository.save(
      this.jobRepository.create({
        organizationId: user.organizationId,
        createdBy: user.id ?? null,
        status: 'pending',
        requestType: 'URL',
        sourceUrl: url,
      }),
    );

    const queueJobId = await this.queueService.sendJob(
      LOOKUP_CLASSIFICATION_QUEUE,
      { jobId: job.id },
      {
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 900,
      },
    );

    await this.jobRepository.update(job.id, { queueJobId });
    return this.getJob(job.id, user.organizationId);
  }

  async createImageJob(user: any, image: Express.Multer.File) {
    if (!user?.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!image) {
      throw new BadRequestException('Image file is required (field name: "image")');
    }

    const job = await this.jobRepository.save(
      this.jobRepository.create({
        organizationId: user.organizationId,
        createdBy: user.id ?? null,
        status: 'pending',
        requestType: 'IMAGE_UPLOAD',
        imageOriginalFilename: image.originalname,
        imageMimeType: image.mimetype,
        imageSizeBytes: image.size,
        imageData: image.buffer,
      }),
    );

    const queueJobId = await this.queueService.sendJob(
      LOOKUP_CLASSIFICATION_QUEUE,
      { jobId: job.id },
      {
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 900,
      },
    );

    await this.jobRepository.update(job.id, { queueJobId });
    return this.getJob(job.id, user.organizationId);
  }

  async getJob(jobId: string, organizationId: string) {
    const job = await this.jobRepository.findOne({
      where: { id: jobId, organizationId },
    });

    if (!job) {
      throw new NotFoundException(`Classification job ${jobId} not found`);
    }

    return {
      id: job.id,
      status: job.status,
      requestType: job.requestType,
      sourceUrl: job.sourceUrl,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      result: (job.resultJson as LookupClassificationJobResult | null)?.data ?? null,
      timings:
        (job.resultJson as LookupClassificationJobResult | null)?.timings ?? {
          queueMs:
            job.startedAt != null
              ? this.safeDurationMs(job.startedAt, job.createdAt, 60 * 60 * 1000)
              : null,
          processingMs:
            job.startedAt != null && job.completedAt != null
              ? this.safeDurationMs(job.completedAt, job.startedAt)
              : null,
          totalMs:
            job.completedAt != null
              ? this.safeDurationMs(job.completedAt, job.createdAt, 60 * 60 * 1000)
              : null,
          visionMs: null,
          classificationMs: null,
          imageDownloadMs: null,
        },
    };
  }

  async processJob(jobId: string): Promise<void> {
    const job = await this.jobRepository.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Classification job ${jobId} not found`);
    }
    if (job.status === 'completed') {
      return;
    }

    const startedAt = job.startedAt ?? new Date();
    await this.jobRepository.update(job.id, {
      status: 'processing',
      startedAt,
      errorMessage: null,
    });

    try {
      const result =
        job.requestType === 'URL'
          ? await this.classifyFromUrl(job.organizationId, job.sourceUrl!)
          : await this.classifyFromImage(job.organizationId, job);

      const completedAt = new Date();
      await this.jobRepository.update(job.id, {
        status: 'completed',
        completedAt,
        resultJson: {
          ...result,
          timings: {
            ...result.timings,
            queueMs: this.safeDurationMs(startedAt, job.createdAt, 60 * 60 * 1000),
            processingMs: this.safeDurationMs(completedAt, startedAt),
            totalMs: this.safeDurationMs(completedAt, job.createdAt, 60 * 60 * 1000),
          },
        } as any,
        errorMessage: null,
        imageData: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Classification job ${jobId} failed: ${message}`);

      await this.jobRepository.update(job.id, {
        status: 'failed',
        errorMessage: message,
      });

      throw error;
    }
  }

  private async classifyFromUrl(
    organizationId: string,
    url: string,
  ): Promise<LookupClassificationJobResult> {
    const startedAt = Date.now();
    const urlResult = await this.urlClassifierService.classifyUrl(url);

    if (urlResult.type === UrlType.INVALID) {
      throw new BadRequestException(
        urlResult.error ?? 'Invalid or inaccessible URL',
      );
    }

    let productDescription: string;
    let visionUsed = false;
    let detectedProduct: Record<string, unknown> | null = null;
    let visionMs: number | null = null;
    let imageDownloadMs: number | null = null;
    const metadataProductDescription = [
      urlResult.metadata?.productName,
      urlResult.metadata?.description,
    ]
      .filter(Boolean)
      .join(' — ');
    const preferMetadataDescription =
      urlResult.type !== UrlType.IMAGE &&
      Boolean(urlResult.metadata?.description) &&
      (urlResult.metadata?.usedBrowser ||
        urlResult.metadata?.extractionMethod === 'rendered-page-ai');

    if (urlResult.type === UrlType.IMAGE) {
      const analysisResult = await this.analyzeProductImageWithFallback(url, {
        url,
        title: urlResult.metadata?.title,
      });
      const analysis = analysisResult.analysis;
      if (!analysis.products.length) {
        throw new BadRequestException('No product detected in the image');
      }
      visionMs = analysis.processingTime ?? analysisResult.elapsedMs;
      imageDownloadMs = analysisResult.imageDownloadMs;
      const product = analysis.products[0];
      productDescription = [
        product.name,
        product.description,
        ...(product.materials ?? []),
      ]
        .filter(Boolean)
        .join(', ');
      visionUsed = true;
      detectedProduct = {
        name: product.name,
        description: product.description,
        materials: product.materials,
        brand: product.brand,
        confidence: product.confidence,
      };
    } else if (preferMetadataDescription) {
      productDescription = metadataProductDescription;
      visionUsed = Boolean(urlResult.metadata?.usedVision);
      detectedProduct = {
        name: urlResult.metadata?.productName ?? null,
        description: urlResult.metadata?.description ?? null,
        source: urlResult.metadata?.extractionMethod ?? null,
      };
    } else if (urlResult.imageUrl || urlResult.metadata?.previewImageUrl) {
      const previewImageUrl =
        urlResult.imageUrl ?? urlResult.metadata?.previewImageUrl;
      const analysisResult = await this.analyzeProductImageWithFallback(
        previewImageUrl!,
        {
          url,
          title: urlResult.metadata?.title,
        },
      );
      const analysis = analysisResult.analysis;
      visionMs = analysis.processingTime ?? analysisResult.elapsedMs;
      imageDownloadMs = analysisResult.imageDownloadMs;
      const visionDescription = analysis.products[0]
        ? [
            analysis.products[0].name,
            analysis.products[0].description,
            ...(analysis.products[0].materials ?? []),
          ]
            .filter(Boolean)
            .join(', ')
        : '';
      const ogDescription = metadataProductDescription;
      productDescription = visionDescription || ogDescription;
      visionUsed = Boolean(visionDescription);
      detectedProduct = analysis.products[0]
        ? {
            name: analysis.products[0].name,
            description: analysis.products[0].description,
            materials: analysis.products[0].materials,
            brand: analysis.products[0].brand,
            confidence: analysis.products[0].confidence,
          }
        : null;
    } else {
      productDescription = [
        urlResult.metadata?.productName,
        urlResult.metadata?.description,
      ]
        .filter(Boolean)
        .join(' — ');
    }

    if (!productDescription?.trim()) {
      throw new BadRequestException(
        'Unable to extract product description from URL',
      );
    }

    const classification = await this.classificationService.classifyProduct(
      productDescription,
      organizationId,
      {
        inputMethod:
          urlResult.type === UrlType.IMAGE
            ? 'IMAGE_URL'
            : urlResult.type === UrlType.PRODUCT
              ? 'PRODUCT_URL'
              : 'WEBPAGE_URL',
        sourceUrl: url,
        sourceImageUrl:
          urlResult.type === UrlType.IMAGE
            ? url
            : urlResult.metadata?.previewImageUrl ?? urlResult.imageUrl ?? null,
        sourceEvidence: {
          urlType: urlResult.type,
          metadata: urlResult.metadata ?? null,
          visionUsed,
          detectedProduct,
        },
      },
    );
    const classificationMs = Math.max(
      0,
      Date.now() - startedAt - (visionMs ?? 0),
    );

    const { source: persistedSource, ...classificationData } = classification;

    return {
      success: true,
      data: {
        ...classificationData,
        source: {
          ...(persistedSource ?? {}),
          url,
          urlType: urlResult.type,
          visionUsed,
          productDescription,
        } as Record<string, unknown>,
      },
      timings: {
        visionMs,
        classificationMs,
        imageDownloadMs,
      },
    };
  }

  private async classifyFromImage(
    organizationId: string,
    job: LookupClassificationJobEntity,
  ): Promise<LookupClassificationJobResult> {
    const startedAt = Date.now();
    if (!job.imageData?.length) {
      throw new BadRequestException('Classification image payload is missing');
    }

    const analysis = await this.visionService.analyzeProductImage(job.imageData, {
      title: job.imageOriginalFilename ?? 'uploaded-image',
    });

    if (!analysis.products.length) {
      throw new BadRequestException('No product detected in the uploaded image');
    }

    const product = analysis.products[0];
    const productDescription = [
      product.name,
      product.description,
      ...(product.materials ?? []),
    ]
      .filter(Boolean)
      .join(', ');
    const imageHash = createHash('sha256').update(job.imageData).digest('hex');

    const classification = await this.classificationService.classifyProduct(
      productDescription,
      organizationId,
      {
        inputMethod: 'IMAGE_UPLOAD',
        sourceImageHash: imageHash,
        sourceEvidence: {
          originalFilename: job.imageOriginalFilename,
          mimeType: job.imageMimeType,
          sizeBytes: job.imageSizeBytes,
          visionUsed: true,
          detectedProduct: {
            name: product.name,
            description: product.description,
            materials: product.materials,
            brand: product.brand,
            confidence: product.confidence,
          },
        },
      },
    );
    const classificationMs = Math.max(
      0,
      Date.now() - startedAt - (analysis.processingTime ?? 0),
    );

    const { source: persistedSource, ...classificationData } = classification;

    return {
      success: true,
      data: {
        ...classificationData,
        source: {
          ...(persistedSource ?? {}),
          visionUsed: true,
          productDescription,
          detectedProduct: {
            name: product.name,
            description: product.description,
            materials: product.materials,
            brand: product.brand,
            confidence: product.confidence,
          },
        } as Record<string, unknown>,
      },
      timings: {
        visionMs: analysis.processingTime ?? null,
        classificationMs,
        imageDownloadMs: null,
      },
    };
  }

  private async analyzeProductImageWithFallback(
    imageUrl: string,
    context?: { url?: string; title?: string },
  ): Promise<{
    analysis: Awaited<ReturnType<VisionService['analyzeProductImage']>>;
    elapsedMs: number;
    imageDownloadMs: number | null;
  }> {
    const startedAt = Date.now();
    let imageDownloadMs: number | null = null;
    try {
      const analysis = await this.visionService.analyzeProductImage(
        imageUrl,
        context,
      );
      return {
        analysis,
        elapsedMs: Date.now() - startedAt,
        imageDownloadMs,
      };
    } catch (error) {
      if (!this.shouldRetryVisionWithDownloadedBuffer(imageUrl, error)) {
        throw error;
      }

      const downloadStartedAt = Date.now();
      const downloadedImage = await this.downloadImageBuffer(imageUrl);
      imageDownloadMs = Date.now() - downloadStartedAt;
      const imageBuffer = this.requiresBrowserRasterization(
        downloadedImage.buffer,
        downloadedImage.contentType,
      )
        ? await this.rasterizeImageUrlToJpeg(imageUrl)
        : downloadedImage.buffer;
      const analysis = await this.visionService.analyzeProductImage(
        imageBuffer,
        context,
      );
      return {
        analysis,
        elapsedMs: Date.now() - startedAt,
        imageDownloadMs,
      };
    }
  }

  private shouldRetryVisionWithDownloadedBuffer(
    imageUrl: string,
    error: unknown,
  ): boolean {
    const message =
      error instanceof Error ? error.message : String(error ?? '');

    return (
      /^https?:\/\//i.test(imageUrl) &&
      !/not an image|too large/i.test(message) &&
      (
        imageUrl.startsWith('http://127.0.0.1') ||
        imageUrl.startsWith('http://localhost') ||
        /does not represent a valid image/i.test(message) ||
        /supported image formats/i.test(message) ||
        /error while downloading/i.test(message) ||
        /status code:\s*(403|404|407|408|409|410|429|5\d\d)/i.test(message) ||
        /hotlink|forbidden|proxy|cdn|timeout|timed out|network|fetch failed|connection/i.test(
          message,
        )
      )
    );
  }

  private async downloadImageBuffer(imageUrl: string): Promise<{
    buffer: Buffer;
    contentType: string;
  }> {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(6_000),
    });

    if (!response.ok) {
      throw new BadRequestException(
        `Unable to download product image (${response.status})`,
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      throw new BadRequestException('Extracted product asset is not an image');
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 10 * 1024 * 1024) {
      throw new BadRequestException('Extracted product image is too large');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('Extracted product image is too large');
    }

    return { buffer, contentType };
  }

  private requiresBrowserRasterization(
    buffer: Buffer,
    contentType: string,
  ): boolean {
    if (!this.browserEnabled) {
      return false;
    }

    return (
      /image\/avif/i.test(contentType) ||
      this.looksLikeAvifBuffer(buffer)
    );
  }

  private looksLikeAvifBuffer(buffer: Buffer): boolean {
    return (
      buffer.length >= 12 &&
      buffer.subarray(4, 12).toString('ascii').includes('ftyp') &&
      buffer.subarray(8, 12).toString('ascii') === 'avif'
    );
  }

  private async rasterizeImageUrlToJpeg(imageUrl: string): Promise<Buffer> {
    let browser: Browser | null = null;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
      await page.goto(imageUrl, {
        waitUntil: 'networkidle2',
        timeout: 20_000,
      });
      const imageElement = await page.waitForSelector('img', { timeout: 5_000 }).catch(
        () => null,
      );
      const screenshot = imageElement
        ? await imageElement.screenshot({ type: 'jpeg', quality: 85 })
        : await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
      await page.close().catch(() => undefined);
      return Buffer.from(screenshot);
    } catch (error) {
      this.logger.warn(`Image rasterization failed for ${imageUrl}: ${error.message}`);
      throw error;
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  private safeDurationMs(
    end: Date,
    start: Date,
    maxAllowedMs: number = 15 * 60 * 1000,
  ): number | null {
    const diff = end.getTime() - start.getTime();
    if (!Number.isFinite(diff) || diff < 0 || diff > maxAllowedMs) {
      return null;
    }
    return diff;
  }
}
