import { Injectable } from '@nestjs/common';
import { BrokerClientRelationshipEntity } from '../../broker-core/entities/broker-client-relationship.entity';
import { BrokerEntryEntity } from '../../broker-entries/entities/broker-entry.entity';
import { BrokerEntryLineEntity } from '../../broker-entries/entities/broker-entry-line.entity';
import { BrokerRuleEntity } from '../entities/broker-rule.entity';
import { BrokerValidationResultEntity } from '../entities/broker-validation-result.entity';

export interface ValidationIssue {
  ruleCode: string;
  severity: 'info' | 'warning' | 'blocker';
  message: string;
  lineId?: string | null;
  details?: Record<string, unknown>;
}

export interface ValidationInput {
  entry: BrokerEntryEntity;
  lines: BrokerEntryLineEntity[];
  rules: BrokerRuleEntity[];
  relationship?: BrokerClientRelationshipEntity | null;
  documentTypesAvailable?: string[];
}

@Injectable()
export class BrokerRuleEngine {
  evaluate(input: ValidationInput): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Built-in: every line must have an HTS number
    for (const line of input.lines) {
      if (!line.htsNumber) {
        issues.push({
          ruleCode: 'LINE_HTS_REQUIRED',
          severity: 'blocker',
          message: `Line ${line.lineNumber} is missing an HTS classification`,
          lineId: line.id,
        });
      } else if (!/^\d{4}\.\d{2}(\.\d{2}(\.\d{2})?)?$/.test(line.htsNumber)) {
        issues.push({
          ruleCode: 'LINE_HTS_FORMAT',
          severity: 'warning',
          message: `Line ${line.lineNumber} HTS '${line.htsNumber}' is not in dotted format`,
          lineId: line.id,
        });
      }

      if (!line.countryOfOrigin) {
        issues.push({
          ruleCode: 'LINE_COUNTRY_OF_ORIGIN_REQUIRED',
          severity: 'blocker',
          message: `Line ${line.lineNumber} is missing country of origin`,
          lineId: line.id,
        });
      }

      if (!line.unitOfMeasure) {
        issues.push({
          ruleCode: 'LINE_UOM_RECOMMENDED',
          severity: 'warning',
          message: `Line ${line.lineNumber} is missing unit of measure`,
          lineId: line.id,
        });
      }

      const total = Number(line.totalValue ?? 0);
      const unit = Number(line.unitValue ?? 0);
      const qty = Number(line.quantity ?? 0);
      if (
        unit > 0 &&
        qty > 0 &&
        total > 0 &&
        Math.abs(unit * qty - total) / Math.max(total, 1) > 0.01
      ) {
        issues.push({
          ruleCode: 'LINE_VALUE_MATH',
          severity: 'warning',
          message: `Line ${line.lineNumber} totalValue ${total} differs from quantity × unit value`,
          lineId: line.id,
          details: { total, unit, qty },
        });
      }
    }

    if (input.lines.length === 0) {
      issues.push({
        ruleCode: 'ENTRY_LINES_REQUIRED',
        severity: 'blocker',
        message: 'Entry has no lines',
      });
    }

    if (
      !input.entry.entryNumber &&
      (input.entry.status === 'ready_to_file' ||
        input.entry.status === 'approved')
    ) {
      issues.push({
        ruleCode: 'ENTRY_NUMBER_REQUIRED_BEFORE_FILE',
        severity: 'blocker',
        message: 'Entry must have a CBP entry number before approval',
      });
    }

    if (input.relationship) {
      if (
        input.relationship.poaStatus === 'missing' ||
        input.relationship.poaStatus === 'expired'
      ) {
        issues.push({
          ruleCode: 'POA_REQUIRED',
          severity: 'blocker',
          message: `POA is ${input.relationship.poaStatus}; cannot file on behalf of client`,
        });
      }
    }

    // Policy exposure based on country of origin (CN → Section 301/Chapter 99 placeholder)
    const cnLines = input.lines.filter(
      (l) => l.countryOfOrigin?.toUpperCase() === 'CN',
    );
    for (const line of cnLines) {
      const has301 = (line.policyFlags ?? []).some(
        (f) => f.program === 'SECTION_301' || f.program === 'CHAPTER_99',
      );
      if (!has301) {
        issues.push({
          ruleCode: 'POLICY_SECTION_301_CHECK',
          severity: 'warning',
          message: `Line ${line.lineNumber} origin CN — verify Section 301 / Chapter 99 applicability`,
          lineId: line.id,
        });
      }
    }

    // Required docs check
    if (input.documentTypesAvailable) {
      const required = ['commercial_invoice', 'packing_list'];
      const missing = required.filter(
        (r) => !input.documentTypesAvailable!.includes(r),
      );
      for (const m of missing) {
        issues.push({
          ruleCode: `DOC_REQUIRED_${m.toUpperCase()}`,
          severity: 'blocker',
          message: `Required document type missing: ${m}`,
        });
      }
    }

    // Org/client-scoped configurable rules
    for (const rule of input.rules) {
      if (!rule.enabled) continue;
      issues.push(...this.evaluateConfigurableRule(rule, input));
    }

    return issues;
  }

  private evaluateConfigurableRule(
    rule: BrokerRuleEntity,
    input: ValidationInput,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const config = rule.config ?? {};

    switch (rule.ruleType) {
      case 'value_threshold': {
        const threshold = Number(config.threshold ?? 0);
        const total = Number(input.entry.totalValue ?? 0);
        if (threshold > 0 && total > threshold) {
          issues.push({
            ruleCode: rule.code,
            severity: rule.severity,
            message: `${rule.title}: entry total ${total} exceeds ${threshold}`,
            details: { total, threshold },
          });
        }
        break;
      }
      case 'required_field': {
        const path = String(config.field ?? '');
        if (path === 'entry.assigneeUserId' && !input.entry.assigneeUserId) {
          issues.push({
            ruleCode: rule.code,
            severity: rule.severity,
            message: rule.title,
          });
        }
        if (path === 'entry.entryNumber' && !input.entry.entryNumber) {
          issues.push({
            ruleCode: rule.code,
            severity: rule.severity,
            message: rule.title,
          });
        }
        break;
      }
      case 'docs_required': {
        const requiredDocs = Array.isArray(config.documentTypes)
          ? (config.documentTypes as string[])
          : [];
        const available = input.documentTypesAvailable ?? [];
        for (const required of requiredDocs) {
          if (!available.includes(required)) {
            issues.push({
              ruleCode: rule.code,
              severity: rule.severity,
              message: `${rule.title}: missing ${required}`,
              details: { required, available },
            });
          }
        }
        break;
      }
      default:
        break;
    }
    return issues;
  }

  static toEntryBlockers(
    issues: ValidationIssue[],
  ): NonNullable<BrokerEntryEntity['blockers']> {
    return issues
      .filter((i) => i.severity !== 'info')
      .map((i) => ({
        code: i.ruleCode,
        message: i.message,
        severity: i.severity === 'blocker' ? 'blocker' : 'warning',
      }));
  }

  static toValidationResults(
    entry: BrokerEntryEntity,
    issues: ValidationIssue[],
  ): Partial<BrokerValidationResultEntity>[] {
    return issues.map((i) => ({
      brokerOrganizationId: entry.brokerOrganizationId,
      entryId: entry.id,
      lineId: i.lineId ?? null,
      ruleCode: i.ruleCode,
      severity: i.severity,
      status: 'open' as const,
      message: i.message,
      details: i.details ?? null,
    }));
  }
}
