import { Injectable, Logger } from '@nestjs/common';
import { FormulaMaintenanceService } from '../services/formula-maintenance.service';

interface FormulaMaintenanceJobData {
  importId?: string;
  limit?: number;
  dryRun?: boolean;
  aiEnabled?: boolean;
  includeParserGaps?: boolean;
  triggeredBy?: string;
}

@Injectable()
export class FormulaMaintenanceJobHandler {
  private readonly logger = new Logger(FormulaMaintenanceJobHandler.name);

  constructor(private readonly formulaMaintenance: FormulaMaintenanceService) {}

  async execute(job: {
    id?: string;
    data?: FormulaMaintenanceJobData;
  }): Promise<void> {
    const data = job.data || {};
    const result = await this.formulaMaintenance.runContinuousMaintenance({
      importId: data.importId,
      limit: data.limit,
      dryRun: data.dryRun,
      aiEnabled: data.aiEnabled,
      includeParserGaps: data.includeParserGaps,
    });
    this.logger.log(
      `formula-maintenance job complete id=${job.id ?? 'unknown'} scanned=${result.scanned} trivial=${result.trivial} mechanical=${result.mechanical} structural=${result.structural} parserGaps=${result.parserGaps} evidence=${result.pendingEvidenceCreated} dryRun=${result.dryRun}`,
    );
  }
}
