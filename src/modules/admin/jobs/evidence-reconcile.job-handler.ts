import { Injectable, Logger } from '@nestjs/common';
import { EvidenceReconciliationService } from '../services/evidence-reconciliation.service';

interface EvidenceReconcileJobData {
  cardId?: string;
  limit?: number;
  aiEnabled?: boolean;
  triggeredBy?: string;
}

@Injectable()
export class EvidenceReconcileJobHandler {
  private readonly logger = new Logger(EvidenceReconcileJobHandler.name);

  constructor(private readonly reconciliation: EvidenceReconciliationService) {}

  async execute(job: {
    id?: string;
    data?: EvidenceReconcileJobData;
  }): Promise<void> {
    const data = job.data || {};
    const result = await this.reconciliation.reconcileDisputedCards({
      cardId: data.cardId,
      limit: data.limit,
      aiEnabled:
        data.aiEnabled ?? process.env.EVIDENCE_RECONCILE_AI_ENABLED === 'true',
    });
    this.logger.log(
      `evidence-reconcile job complete id=${job.id ?? 'unknown'} cards=${result.cardsScanned} packets=${result.packetsCreated} ai=${result.aiRecommendations}`,
    );
  }
}
