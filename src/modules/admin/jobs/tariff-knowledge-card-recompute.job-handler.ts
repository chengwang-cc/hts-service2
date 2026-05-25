import { Injectable, Logger } from '@nestjs/common';
import { TariffKnowledgeCardService } from '@hts/calculator';
import { QueueService } from '../../queue/queue.service';

interface TariffKnowledgeCardRecomputeJobData {
  htsNumber?: string;
  countryCode?: string;
  destinationCode?: string;
  rateClass?: string;
  componentType?: string;
  limit?: number;
  dryRun?: boolean;
  triggeredBy?: string;
}

@Injectable()
export class TariffKnowledgeCardRecomputeJobHandler {
  private readonly logger = new Logger(
    TariffKnowledgeCardRecomputeJobHandler.name,
  );

  constructor(
    private readonly cardService: TariffKnowledgeCardService,
    private readonly queueService: QueueService,
  ) {}

  async execute(job: {
    id?: string;
    data?: TariffKnowledgeCardRecomputeJobData;
  }): Promise<void> {
    const data = job.data || {};
    this.logger.log(
      `tariff-card-recompute job started id=${job.id ?? 'unknown'} triggeredBy=${data.triggeredBy ?? 'system'}`,
    );

    const result = await this.cardService.recomputeCards({
      htsNumber: data.htsNumber,
      countryCode: data.countryCode,
      destinationCode: data.destinationCode,
      rateClass: data.rateClass,
      componentType: data.componentType,
      limit: data.limit,
      dryRun: data.dryRun,
    });

    this.logger.log(
      `tariff-card-recompute job complete: scopes=${result.scopesScanned} cards=${result.cardsUpserted} disputed=${result.disputedCards} dryRun=${result.dryRun}`,
    );

    if (result.disputedCards > 0 && !result.dryRun) {
      await this.queueService.sendJob('evidence-reconcile', {
        limit: Math.min(result.disputedCards, 100),
        triggeredBy: 'tariff-card-recompute',
      });
    }
  }
}
