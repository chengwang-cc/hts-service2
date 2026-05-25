import { Injectable, Logger } from '@nestjs/common';
import { ExternalProviderQuoteService } from '../services/external-provider-quote.service';

interface ExternalProviderOracleJobData {
  limit?: number;
  declaredValue?: number;
  currency?: string;
  countries?: string[];
  entryDate?: string;
  dryRun?: boolean;
  triggeredBy?: string;
}

@Injectable()
export class ExternalProviderOracleJobHandler {
  private readonly logger = new Logger(ExternalProviderOracleJobHandler.name);

  constructor(private readonly providerQuotes: ExternalProviderQuoteService) {}

  async execute(job: {
    id?: string;
    data?: ExternalProviderOracleJobData;
  }): Promise<void> {
    const data = job.data || {};
    const result = await this.providerQuotes.runOracleComparison({
      limit: data.limit,
      declaredValue: data.declaredValue,
      currency: data.currency,
      countries: data.countries,
      entryDate: data.entryDate,
      dryRun: data.dryRun,
    });
    this.logger.log(
      `external-provider-oracle job complete id=${job.id ?? 'unknown'} sampled=${result.sampledCards} requests=${result.providerRequests} recorded=${result.quotesRecorded} skipped=${result.skippedProviders.join(',')}`,
    );
  }
}
