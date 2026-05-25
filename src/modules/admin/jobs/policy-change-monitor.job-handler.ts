import { Injectable, Logger } from '@nestjs/common';
import { PolicyChangeMonitorService } from '../services/policy-change-monitor.service';

type JsonObject = Record<string, unknown>;

interface PolicyChangeMonitorJobData {
  documents?: unknown[];
  sources?: Array<'federal_register' | 'usitc_archive' | 'ustr' | 'cbp_csms'>;
  sinceDays?: number;
  limitPerSource?: number;
  aiExtraction?: boolean;
}

@Injectable()
export class PolicyChangeMonitorJobHandler {
  private readonly logger = new Logger(PolicyChangeMonitorJobHandler.name);

  constructor(private readonly policyMonitor: PolicyChangeMonitorService) {}

  async execute(job: {
    id?: string;
    data?: PolicyChangeMonitorJobData;
  }): Promise<void> {
    if (!Array.isArray(job.data?.documents)) {
      const result = await this.policyMonitor.runConfiguredMonitors({
        sources: Array.isArray(job.data?.sources)
          ? job.data.sources
          : undefined,
        sinceDays: this.optionalNumber(job.data?.sinceDays) ?? undefined,
        limitPerSource:
          this.optionalNumber(job.data?.limitPerSource) ?? undefined,
        aiExtraction:
          typeof job.data?.aiExtraction === 'boolean'
            ? job.data.aiExtraction
            : undefined,
      });
      this.logger.log(
        `policy-change-monitor: scanned=${result.sourcesScanned} fetched=${result.fetchedDocuments} documents=${result.recordedDocuments} proposals=${result.proposalsRecorded}`,
      );
      return;
    }

    const documents = Array.isArray(job.data?.documents)
      ? job.data.documents
      : [];
    let recordedDocuments = 0;
    let recordedProposals = 0;

    for (const raw of documents) {
      if (!this.isRecord(raw)) {
        continue;
      }
      const document = await this.policyMonitor.recordDocument({
        sourceId: this.optionalString(raw.sourceId),
        sourceName: this.optionalString(raw.sourceName) || 'unknown',
        externalId:
          this.optionalString(raw.externalId) ||
          this.optionalString(raw.documentUrl) ||
          this.optionalString(raw.title) ||
          'unknown-policy-document',
        title:
          this.optionalString(raw.title) ||
          this.optionalString(raw.externalId) ||
          'Untitled policy document',
        documentUrl: this.optionalString(raw.documentUrl),
        snapshotUri: this.optionalString(raw.snapshotUri),
        documentText: this.optionalString(raw.documentText),
        publishedAt: this.optionalDateLike(raw.publishedAt),
        metadata: this.optionalRecord(raw.metadata),
      });
      recordedDocuments++;

      const proposals = Array.isArray(raw.proposals) ? raw.proposals : [];
      for (const proposal of proposals) {
        if (!this.isRecord(proposal)) {
          continue;
        }
        const rateClass = this.optionalString(proposal.rateClass);
        if (!rateClass) {
          continue;
        }
        await this.policyMonitor.recordProposal({
          documentId: document.id,
          htsNumber: this.optionalString(proposal.htsNumber),
          countryCode: this.optionalString(proposal.countryCode) || undefined,
          destinationCode:
            this.optionalString(proposal.destinationCode) || undefined,
          rateClass,
          componentType: this.optionalString(proposal.componentType),
          effectiveFrom: this.optionalString(proposal.effectiveFrom),
          effectiveTo: this.optionalString(proposal.effectiveTo),
          oldRateText: this.optionalString(proposal.oldRateText),
          newRateText: this.optionalString(proposal.newRateText),
          proposedFormula: this.optionalString(proposal.proposedFormula),
          proposedConditionAst: this.optionalRecord(
            proposal.proposedConditionAst,
          ),
          citationQuote: this.optionalString(proposal.citationQuote),
          parserConfidence: this.optionalNumber(proposal.parserConfidence),
          parserName:
            this.optionalString(proposal.parserName) || 'policy-change-monitor',
          parserVersion:
            this.optionalString(proposal.parserVersion) || 'phase-4-initial',
          metadata: this.optionalRecord(proposal.metadata),
        });
        recordedProposals++;
      }
    }

    this.logger.log(
      `policy-change-monitor: recorded documents=${recordedDocuments} proposals=${recordedProposals}`,
    );
  }

  private isRecord(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private optionalRecord(value: unknown): JsonObject | null {
    return this.isRecord(value) ? value : null;
  }

  private optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private optionalNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private optionalDateLike(value: unknown): string | Date | null {
    return typeof value === 'string' || value instanceof Date ? value : null;
  }
}
