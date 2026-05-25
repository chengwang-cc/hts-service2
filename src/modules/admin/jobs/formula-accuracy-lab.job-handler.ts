import { Injectable, Logger } from '@nestjs/common';
import { FormulaAccuracyLabService } from '../services/formula-accuracy-lab.service';

interface FormulaAccuracyLabJobData {
  reportDate?: string;
  windowDays?: number;
  dryRun?: boolean;
  triggeredBy?: string;
}

@Injectable()
export class FormulaAccuracyLabJobHandler {
  private readonly logger = new Logger(FormulaAccuracyLabJobHandler.name);

  constructor(private readonly formulaAccuracyLab: FormulaAccuracyLabService) {}

  async execute(job: {
    id?: string;
    data?: FormulaAccuracyLabJobData;
  }): Promise<void> {
    const data = job.data || {};
    const report = await this.formulaAccuracyLab.generateReport({
      reportDate: data.reportDate,
      windowDays: data.windowDays,
      dryRun: data.dryRun,
      metadata: {
        triggeredBy: data.triggeredBy || 'formula-accuracy-lab-job',
        jobId: job.id || null,
      },
    });
    this.logger.log(
      `formula-accuracy-lab job complete id=${job.id ?? 'unknown'} reportDate=${report.reportDate} score=${report.summary?.operationalAccuracyScore ?? 'n/a'} dryRun=${!!data.dryRun}`,
    );
  }
}
