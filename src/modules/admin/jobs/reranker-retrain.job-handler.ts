import { Injectable, Logger } from '@nestjs/common';
import { RerankerRetrainService } from '../services/reranker-retrain.service';

interface RerankerRetrainJobData {
  triggeredBy?: string;
}

@Injectable()
export class RerankerRetrainJobHandler {
  private readonly logger = new Logger(RerankerRetrainJobHandler.name);

  constructor(private readonly retrainService: RerankerRetrainService) {}

  async execute(job: { id?: string; data?: RerankerRetrainJobData }): Promise<void> {
    const triggeredBy = job.data?.triggeredBy ?? 'cron';
    this.logger.log(`Reranker retrain job started id=${job.id ?? 'unknown'} triggeredBy=${triggeredBy}`);

    const run = await this.retrainService.runFullRetrain(triggeredBy);

    this.logger.log(
      `Reranker retrain job complete: runId=${run.id} status=${run.status} ` +
      `feedbackPairs=${run.feedbackPairsAdded} totalPairs=${run.totalPairs}`,
    );
  }
}
