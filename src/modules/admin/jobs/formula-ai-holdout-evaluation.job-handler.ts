import { Injectable, Logger } from '@nestjs/common';
import {
  FormulaAiSkillName,
  FormulaAiSkillRegistryService,
} from '../services/formula-ai-skill-registry.service';

interface FormulaAiHoldoutEvaluationJobData {
  skill?: FormulaAiSkillName;
  versionId?: string;
  triggeredBy?: string;
}

@Injectable()
export class FormulaAiHoldoutEvaluationJobHandler {
  private readonly logger = new Logger(FormulaAiHoldoutEvaluationJobHandler.name);

  constructor(private readonly registry: FormulaAiSkillRegistryService) {}

  async execute(job: {
    id?: string;
    data?: FormulaAiHoldoutEvaluationJobData;
  }): Promise<void> {
    const data = job.data || {};
    const skill = data.skill || 'extractor';
    const run = await this.registry.runHoldoutEvaluation({
      skill,
      versionId: data.versionId || null,
      metadata: {
        triggeredBy: data.triggeredBy || 'formula-ai-holdout-job',
        jobId: job.id || null,
      },
    });
    this.logger.log(
      `formula-ai-holdout-evaluation complete id=${job.id ?? 'unknown'} skill=${skill} version=${run.versionId} score=${run.metrics.score}`,
    );
  }
}
