import { Injectable, Logger } from '@nestjs/common';
import { CbpCrossRulingService } from '../services/cbp-cross-ruling.service';

interface CbpCrossIngestJobData {
  terms?: string[];
  limit?: number;
  pageSize?: number;
  generateEmbeddings?: boolean;
  embedPendingOnly?: boolean;
  triggeredBy?: string;
}

@Injectable()
export class CbpCrossIngestJobHandler {
  private readonly logger = new Logger(CbpCrossIngestJobHandler.name);

  constructor(private readonly crossRulings: CbpCrossRulingService) {}

  async execute(job: {
    id?: string;
    data?: CbpCrossIngestJobData;
  }): Promise<void> {
    const data = job.data || {};
    if (data.embedPendingOnly) {
      const generated = await this.crossRulings.generatePendingEmbeddings(
        data.limit ?? 100,
      );
      this.logger.log(
        `cbp-cross-embed job complete id=${job.id ?? 'unknown'} generated=${generated}`,
      );
      return;
    }

    const result = await this.crossRulings.ingestRulings({
      terms: data.terms,
      limit: data.limit,
      pageSize: data.pageSize,
      generateEmbeddings: data.generateEmbeddings,
    });
    this.logger.log(
      `cbp-cross-ingest job complete id=${job.id ?? 'unknown'} terms=${result.searchedTerms} fetched=${result.fetched} upserted=${result.upserted} embeddings=${result.embeddingsGenerated}`,
    );
  }
}
