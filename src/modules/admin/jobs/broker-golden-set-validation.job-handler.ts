import { Injectable, Logger } from '@nestjs/common';
import { BrokerGoldenSetService } from '../services/broker-golden-set.service';

interface BrokerGoldenSetValidationJobData {
  limit?: number;
  tolerance?: number;
  brokerName?: string;
  dryRun?: boolean;
  triggeredBy?: string;
}

@Injectable()
export class BrokerGoldenSetValidationJobHandler {
  private readonly logger = new Logger(
    BrokerGoldenSetValidationJobHandler.name,
  );

  constructor(private readonly brokerGoldenSet: BrokerGoldenSetService) {}

  async execute(job: {
    id?: string;
    data?: BrokerGoldenSetValidationJobData;
  }): Promise<void> {
    const data = job.data || {};
    this.logger.log(
      `broker-golden-set-validation job started id=${job.id ?? 'unknown'} triggeredBy=${data.triggeredBy ?? 'system'}`,
    );

    const result = await this.brokerGoldenSet.validateActiveCases({
      limit: data.limit,
      tolerance: data.tolerance,
      brokerName: data.brokerName,
      dryRun: data.dryRun,
    });

    this.logger.log(
      `broker-golden-set-validation job complete: scanned=${result.scanned} matched=${result.matched} mismatched=${result.mismatched} failed=${result.failed} dryRun=${result.dryRun}`,
    );
  }
}
