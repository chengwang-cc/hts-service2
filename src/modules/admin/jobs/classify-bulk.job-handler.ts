/**
 * P2.4 — Classify Bulk Job Handler
 *
 * Streams a CSV from `inputCsvUrl` and classifies each row via the
 * ClassifyService. Persists candidates as ClassificationCandidateEntity
 * rows (when productId is supplied) and emits per-row results.
 *
 * Job data:
 *   organizationId: string
 *   inputCsvUrl: string
 *   destinationCountry: string
 *   callbackUrl?: string  — optional webhook POST'd at completion
 *
 * CSV columns expected (header row):
 *   productId,sku,name,description,category,imageUrl,countryOfOrigin
 */

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { parse } from 'csv-parse';
import { ClassifyService } from '../../classification/services/classify.service';

const REVIEW_CONFIDENCE_THRESHOLD = 0.62;

@Injectable()
export class ClassifyBulkJobHandler {
  private readonly logger = new Logger(ClassifyBulkJobHandler.name);

  constructor(private readonly classifyService: ClassifyService) {}

  async execute(job: any): Promise<void> {
    const {
      organizationId,
      inputCsvUrl,
      destinationCountry = 'US',
      callbackUrl,
    } = job?.data || {};

    if (!organizationId || !inputCsvUrl) {
      throw new Error(
        'classify-bulk: organizationId and inputCsvUrl are required',
      );
    }

    this.logger.log(
      `classify-bulk: org=${organizationId} src=${inputCsvUrl} dest=${destinationCountry}`,
    );

    const response = await axios.get(inputCsvUrl, {
      responseType: 'stream',
      timeout: 300000,
    });

    const httpStream = response.data;
    const parser = httpStream.pipe(
      parse({ columns: true, trim: true, skip_empty_lines: true }),
    );

    const stats = {
      attempted: 0,
      classified: 0,
      pendingReview: 0,
      failed: 0,
    };

    // AUDIT FIX C3 — ensure both the HTTP socket and the csv-parse
    // transform are destroyed if the loop aborts (classify throws,
    // pg-boss cancels the job, process shuts down). Without this an
    // uncaught error inside the loop leaks the open response socket
    // and ties up file descriptors.
    try {
      for await (const row of parser as any) {
        stats.attempted++;
        try {
          const result = await this.classifyService.classify(organizationId, {
            productId: row.productId || undefined,
            description: row.description || row.name || '',
            name: row.name || undefined,
            category: row.category || undefined,
            imageUrl: row.imageUrl || undefined,
            countryOfOrigin: row.countryOfOrigin || undefined,
            destinationCountry,
          });
          stats.classified++;
          if (
            result.reviewRequired ||
            result.recommended.confidence < REVIEW_CONFIDENCE_THRESHOLD
          ) {
            stats.pendingReview++;
          }
        } catch (e: any) {
          stats.failed++;
          this.logger.warn(
            `classify-bulk row failed (sku=${row?.sku ?? '?'}): ${e?.message}`,
          );
        }
      }
    } finally {
      try {
        parser.destroy();
      } catch {
        /* swallow */
      }
      try {
        httpStream.destroy();
      } catch {
        /* swallow */
      }
    }

    this.logger.log(
      `classify-bulk done: attempted=${stats.attempted} classified=${stats.classified} pendingReview=${stats.pendingReview} failed=${stats.failed}`,
    );

    if (callbackUrl) {
      try {
        await axios.post(callbackUrl, { stats }, { timeout: 30000 });
      } catch (e: any) {
        this.logger.warn(
          `classify-bulk callback failed (${callbackUrl}): ${e?.message}`,
        );
      }
    }
  }
}
