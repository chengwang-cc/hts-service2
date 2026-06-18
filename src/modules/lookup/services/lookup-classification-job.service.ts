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
import { SmartClassifyService } from './smart-classify.service';
import { UrlClassifierService } from './url-classifier.service';
import {
  LookupClassificationJobEntity,
  type LookupClassificationJobRequestType,
  type LookupClassificationJobSource,
  type LookupClassificationJobStatus,
} from '../entities/lookup-classification-job.entity';
import { llmUsageTracker } from '../../../core/services/llm-usage-tracker';
import { LlmUsageRecordingService } from '../../partner-attribution/services/llm-usage-recording.service';

export interface ListJobsOptions {
  source?: LookupClassificationJobSource | null;
  status?: LookupClassificationJobStatus | null;
  limit?: number;
  offset?: number;
}

export const LOOKUP_CLASSIFICATION_QUEUE = 'lookup-classification-job';

/** Sentinel org ID used for public (unauthenticated) classification jobs */
export const ANONYMOUS_ORG_ID = '00000000-0000-0000-0000-000000000000';

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
    private readonly smartClassifyService: SmartClassifyService,
    private readonly llmUsageRecording: LlmUsageRecordingService,
  ) {}

  async createUrlJob(
    user: any,
    url: string,
    source: LookupClassificationJobSource = 'WEB',
  ) {
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
        source,
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

  /**
   * Submit a free-text product description for async smart-classify.
   *
   * Mirrors createUrlJob / createImageJob but with requestType='TEXT'.
   * The pg-boss worker drains via the same LOOKUP_CLASSIFICATION_QUEUE
   * — processJob dispatches by requestType.
   *
   * Why async: the synchronous /lookup/smart-classify path runs an
   * OpenAI rerank call inline (5-30 s) inside the request handler.
   * Under concurrent traffic this contributes to RDS connection
   * pressure and was implicated in the recurring pg-boss queue
   * stalls observed on 2026-06-04. Moving the work into pg-boss
   * frees the request thread immediately and isolates the slow AI
   * call from the request path.
   *
   * Anonymous (`@Public()`) callers are allowed: org defaults to the
   * ANONYMOUS_ORG_ID sentinel so the entity insert succeeds, but the
   * `productDescription` content is still preserved.
   */
  async createDescriptionJob(
    user: any,
    description: string,
    source: LookupClassificationJobSource = 'WEB',
  ) {
    const trimmed = (description ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('Product description cannot be blank');
    }
    if (trimmed.length > 512) {
      // entity column is varchar(512); slice rather than 400 so the
      // SPA's existing input UX (no client-side length cap today)
      // doesn't suddenly bounce long descriptions.
    }

    const organizationId: string = user?.organizationId ?? ANONYMOUS_ORG_ID;

    const job = await this.jobRepository.save(
      this.jobRepository.create({
        organizationId,
        createdBy: user?.id ?? null,
        status: 'pending',
        requestType: 'TEXT',
        productDescription: trimmed.slice(0, 512),
        source,
      }),
    );

    const queueJobId = await this.queueService.sendJob(
      LOOKUP_CLASSIFICATION_QUEUE,
      { jobId: job.id },
      {
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 300, // 5 min — smart-classify is faster than vision pipelines
      },
    );

    await this.jobRepository.update(job.id, { queueJobId });
    return this.getJob(job.id, organizationId);
  }

  async createImageJob(
    user: any,
    image: Express.Multer.File,
    source: LookupClassificationJobSource = 'WEB',
  ) {
    if (!image) {
      throw new BadRequestException('Image file is required (field name: "image")');
    }

    const organizationId: string = user?.organizationId ?? ANONYMOUS_ORG_ID;

    const job = await this.jobRepository.save(
      this.jobRepository.create({
        organizationId,
        createdBy: user?.id ?? null,
        status: 'pending',
        requestType: 'IMAGE_UPLOAD',
        imageOriginalFilename: image.originalname,
        imageMimeType: image.mimetype,
        imageSizeBytes: image.size,
        imageData: image.buffer,
        source,
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
    return this.getJob(job.id, organizationId);
  }

  async getJob(jobId: string, organizationId: string) {
    if (!organizationId) {
      throw new NotFoundException(`Classification job ${jobId} not found`);
    }
    const job = await this.jobRepository.findOne({
      where: { id: jobId, organizationId },
    });

    if (!job) {
      throw new NotFoundException(`Classification job ${jobId} not found`);
    }

    return {
      id: job.id,
      status: job.status,
      source: job.source,
      requestType: job.requestType,
      sourceUrl: job.sourceUrl,
      imageOriginalFilename: job.imageOriginalFilename,
      productDescription: job.productDescription,
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

  /**
   * Record a pre-classified job (e.g. from an external connector like Shopify
   * sync) directly into history without queueing async work.
   */
  async recordCompletedJob(params: {
    organizationId: string;
    source: LookupClassificationJobSource;
    createdBy?: string | null;
    requestType?: LookupClassificationJobRequestType;
    sourceUrl?: string | null;
    productDescription: string;
    htsCode: string;
    description?: string | null;
    confidence?: number | null;
  }): Promise<void> {
    const now = new Date();
    const trimmedDescription = params.productDescription
      ? params.productDescription.slice(0, 512)
      : null;
    const data = {
      htsCode: params.htsCode,
      description: params.description ?? null,
      confidence:
        typeof params.confidence === 'number' && Number.isFinite(params.confidence)
          ? params.confidence
          : 1,
      reasoning: '',
      chapter: null,
      candidates: [],
      source: {
        inputMethod: 'TEXT',
        sourceUrl: params.sourceUrl ?? null,
        productDescription: params.productDescription,
      },
    } as unknown as Record<string, unknown>;

    await this.jobRepository.save(
      this.jobRepository.create({
        organizationId: params.organizationId,
        createdBy: params.createdBy ?? null,
        status: 'completed',
        requestType: params.requestType ?? 'URL',
        source: params.source,
        sourceUrl: params.sourceUrl ?? null,
        productDescription: trimmedDescription,
        startedAt: now,
        completedAt: now,
        resultJson: { success: true, data } as any,
      }),
    );
  }

  async listJobs(organizationId: string, options: ListJobsOptions = {}) {
    if (!organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    const qb = this.jobRepository
      .createQueryBuilder('job')
      .where('job.organizationId = :organizationId', { organizationId });

    if (options.source) {
      qb.andWhere('job.source = :source', { source: options.source });
    }
    if (options.status) {
      qb.andWhere('job.status = :status', { status: options.status });
    }

    const [rows, total] = await qb
      .orderBy('job.createdAt', 'DESC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();

    return {
      total,
      limit,
      offset,
      items: rows.map((job) => ({
        id: job.id,
        status: job.status,
        source: job.source,
        requestType: job.requestType,
        sourceUrl: job.sourceUrl,
        imageOriginalFilename: job.imageOriginalFilename,
        productDescription:
          job.productDescription ??
          this.extractProductDescription(job.resultJson) ??
          null,
        htsCode: this.extractHtsCode(job.resultJson),
        confidence: this.extractConfidence(job.resultJson),
        errorMessage: job.errorMessage,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString() ?? null,
      })),
    };
  }

  private extractProductDescription(resultJson: unknown): string | null {
    const data = (resultJson as LookupClassificationJobResult | null)?.data;
    if (!data) return null;
    const source = data.source as Record<string, unknown> | null | undefined;
    const candidate = source?.productDescription;
    return typeof candidate === 'string' && candidate.trim() ? candidate : null;
  }

  private extractHtsCode(resultJson: unknown): string | null {
    const data = (resultJson as LookupClassificationJobResult | null)?.data;
    const code = data?.htsCode;
    return typeof code === 'string' && code.trim() ? code : null;
  }

  private extractConfidence(resultJson: unknown): number | null {
    const data = (resultJson as LookupClassificationJobResult | null)?.data;
    const value = data?.confidence;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

    // Pipeline-stage tag picked up by LlmUsageRecordingService — drives
    // dashboard slicing so the AI-cost row is distinguishable from the
    // synchronous 202 row written by the controller when the job was
    // enqueued.
    const pipelineStage =
      job.requestType === 'URL'
        ? 'classify-job.url'
        : job.requestType === 'TEXT'
          ? 'classify-job.text'
          : 'classify-job.image';

    try {
      // Open an LlmUsageTracker scope around the dispatch so every
      // OpenAI / Anthropic call made by the downstream services
      // (SmartClassify, UrlClassifier, Vision) lands in the same
      // aggregate. The result is read post-dispatch and written to
      // api_usage_metrics as a separate row via LlmUsageRecordingService.
      const { result, usage } = await llmUsageTracker.withTracking(async () => {
        // Dispatch by requestType. TEXT was added 2026-06-04 to move the
        // synchronous smart-classify path onto pg-boss; URL and IMAGE were
        // already async via different downstream services.
        if (job.requestType === 'URL') {
          return this.classifyFromUrl(job.organizationId, job.sourceUrl!);
        } else if (job.requestType === 'TEXT') {
          return this.classifyFromText(job.organizationId, job.productDescription!);
        } else {
          return this.classifyFromImage(job.organizationId, job);
        }
      });

      // Fire-and-forget: never blocks the job completion. If recording
      // fails the user still gets their classification result; we just
      // lose one usage row.
      void this.llmUsageRecording.recordAsyncLlmCost(
        {
          partnerId: job.organizationId,
          partnerUserId: null,
          apiKeyId: null,
          organizationId: job.organizationId,
          attributionSource: 'jwt',
          origin: null,
          endpoint: `/api/v1/lookup/${pipelineStage.replace('classify-job.', 'classify-async-')}`,
          method: 'POST',
          statusCode: 200,
          responseTimeMs: Date.now() - startedAt.getTime(),
          pipelineStage,
        },
        usage,
      );

      const completedAt = new Date();
      const productDescription =
        this.extractProductDescription({
          data: result.data,
        } as unknown) ?? null;
      await this.jobRepository.update(job.id, {
        status: 'completed',
        completedAt,
        productDescription: productDescription
          ? productDescription.slice(0, 512)
          : null,
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

  /**
   * Run a TEXT job through SmartClassifyService and adapt its
   * `HtsCode[]` output into the shared LookupClassificationJobResult
   * shape so the polling endpoint surfaces the same fields as the
   * URL / image flows. Why adapt rather than return as-is: keeping the
   * `getJob` response uniform across requestTypes means the SPA's
   * existing `pollJobUntilComplete()` reads the same `result` object
   * regardless of how the job was submitted.
   *
   * The full SmartClassifyService output (including normalizedQuery)
   * is preserved under `data.source.smartClassify` for callers that
   * want the rich result, but the primary classification fields
   * (htsCode, description, confidence, candidates) are mapped from
   * the ranked results array.
   */
  private async classifyFromText(
    organizationId: string,
    productDescription: string,
  ): Promise<LookupClassificationJobResult> {
    const startedAt = Date.now();
    const smart = await this.smartClassifyService.classify(productDescription);
    const classificationMs = Date.now() - startedAt;

    const ranked = smart.results ?? [];

    // RerankCandidate.fullDescription is `string[] | null` (the HTS
    // breadcrumb hierarchy), not a flat string. Join with " > " when
    // present so the SPA breadcrumb renders without extra adaptation.
    const flatDescription = (
      r: { description: string; fullDescription?: string[] | null },
    ): string => {
      if (Array.isArray(r.fullDescription) && r.fullDescription.length) {
        return r.fullDescription.join(' > ');
      }
      return r.description ?? '';
    };

    if (ranked.length === 0) {
      // Empty results aren't a backend failure — surface as a completed
      // job with no candidates so the SPA can show "no codes found".
      return {
        success: true,
        data: {
          htsCode: '',
          description: '',
          confidence: 0,
          candidates: [],
          reasoning: '',
          chapter: null,
          source: {
            inputMethod: 'TEXT',
            productDescription,
            sourceUrl: null,
            smartClassify: { query: smart.query, results: [] },
          } as Record<string, unknown>,
        },
        timings: { classificationMs },
      };
    }

    const top = ranked[0];
    const candidates = ranked.slice(1).map((r) => ({
      htsCode: r.htsNumber,
      description: flatDescription(r),
      score: r.score ?? r.similarity ?? 0,
    }));

    void organizationId; // partner attribution happens at the request layer

    return {
      success: true,
      data: {
        htsCode: top.htsNumber,
        description: flatDescription(top),
        confidence: top.score ?? top.similarity ?? 0,
        candidates,
        reasoning: '',
        chapter: null,
        source: {
          inputMethod: 'TEXT',
          productDescription,
          sourceUrl: null,
          smartClassify: {
            query: smart.query,
            results: ranked,
          },
        } as Record<string, unknown>,
      },
      timings: { classificationMs },
    };
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
        ? await this.rasterizeImageBufferToJpeg(
            downloadedImage.buffer,
            downloadedImage.contentType,
          )
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

  private async rasterizeImageBufferToJpeg(
    imageBuffer: Buffer,
    contentType: string,
  ): Promise<Buffer> {
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
      const dataUrl = `data:${contentType || 'image/avif'};base64,${imageBuffer.toString('base64')}`;
      await page.setContent(
        `<html><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#fff;"><img id="source-image" src="${dataUrl}" style="max-width:100%;max-height:100%;object-fit:contain;" /></body></html>`,
        { waitUntil: 'load' },
      );
      const imageElement = await page.waitForSelector('img', { timeout: 5_000 }).catch(
        () => null,
      );
      const screenshot = imageElement
        ? await imageElement.screenshot({ type: 'jpeg', quality: 85 })
        : await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
      await page.close().catch(() => undefined);
      return Buffer.from(screenshot);
    } catch (error) {
      this.logger.warn(`Image rasterization failed for content-type ${contentType}: ${error.message}`);
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
