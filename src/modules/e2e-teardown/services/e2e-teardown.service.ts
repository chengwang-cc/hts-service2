import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface E2eTeardownResult {
  outreachLeads: number;
  ecommerceHandoffs: number;
  queryBuilderTemplates: number;
  dataTransformerProfiles: number;
  dataTransformerRuns: number;
  dataTransformerMappings: number;
  dataTransformerRunIssues: number;
  prefix: string;
  durationMs: number;
}

/**
 * Sweeps rows seeded by the live-backend Playwright e2e suite. Every
 * test stamps a `liveTag(testTitle)` of the form `e2e-<slug>-<base36ts>`
 * into the user-facing identifying field (companyName, externalOrderId,
 * template name, profile name). This sweep is keyed on that prefix and
 * only deletes rows whose identifier starts with it — production data
 * is never touched as long as the prefix isn't accidentally exposed.
 *
 * The default prefix is `e2e-` (matches `liveTag` output). Override
 * with `E2E_TEARDOWN_PREFIX` if you need a project-specific tag.
 */
@Injectable()
export class E2eTeardownService {
  private readonly logger = new Logger(E2eTeardownService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Returns the configured prefix; centralized so the worker and the
   * CLI both pick up the same value.
   */
  prefix(): string {
    return process.env.E2E_TEARDOWN_PREFIX || 'e2e-';
  }

  async sweep(): Promise<E2eTeardownResult> {
    const prefix = this.prefix();
    if (!prefix || prefix.length < 3) {
      throw new Error(
        `E2E_TEARDOWN_PREFIX="${prefix}" is too short — refusing to sweep (would risk deleting production data)`,
      );
    }
    const like = `${prefix}%`;
    const start = Date.now();
    const result: E2eTeardownResult = {
      outreachLeads: 0,
      ecommerceHandoffs: 0,
      queryBuilderTemplates: 0,
      dataTransformerProfiles: 0,
      dataTransformerRuns: 0,
      dataTransformerMappings: 0,
      dataTransformerRunIssues: 0,
      prefix,
      durationMs: 0,
    };

    await this.dataSource.transaction(async (manager) => {
      // 1. data_transformer: identify profiles by name, then cascade
      //    children explicitly (no DB-side ON DELETE CASCADE).
      const profileRows: Array<{ id: string }> = await manager.query(
        `SELECT id FROM data_transformer_profiles WHERE name LIKE $1`,
        [like],
      );
      const profileIds = profileRows.map((r) => r.id);
      if (profileIds.length > 0) {
        const runRows: Array<{ id: string }> = await manager.query(
          `SELECT id FROM data_transformer_runs WHERE profile_id = ANY($1::uuid[])`,
          [profileIds],
        );
        const runIds = runRows.map((r) => r.id);
        if (runIds.length > 0) {
          const issuesRes = await manager.query(
            `DELETE FROM data_transformer_run_issues WHERE run_id = ANY($1::uuid[])`,
            [runIds],
          );
          result.dataTransformerRunIssues = rowCount(issuesRes);
        }
        const runsRes = await manager.query(
          `DELETE FROM data_transformer_runs WHERE profile_id = ANY($1::uuid[])`,
          [profileIds],
        );
        result.dataTransformerRuns = rowCount(runsRes);
        const mapRes = await manager.query(
          `DELETE FROM data_transformer_mappings WHERE profile_id = ANY($1::uuid[])`,
          [profileIds],
        );
        result.dataTransformerMappings = rowCount(mapRes);
        const profRes = await manager.query(
          `DELETE FROM data_transformer_profiles WHERE id = ANY($1::uuid[])`,
          [profileIds],
        );
        result.dataTransformerProfiles = rowCount(profRes);
      }

      // 2. query_builder_templates: keyed on name.
      const qbRes = await manager.query(
        `DELETE FROM query_builder_templates WHERE name LIKE $1`,
        [like],
      );
      result.queryBuilderTemplates = rowCount(qbRes);

      // 3. ecommerce_handoffs: keyed on external_order_id.
      const ehRes = await manager.query(
        `DELETE FROM ecommerce_handoffs WHERE external_order_id LIKE $1`,
        [like],
      );
      result.ecommerceHandoffs = rowCount(ehRes);

      // 4. broker_outreach_leads: company_name + contact_email LIKE prefix.
      //    Invites cascade automatically (onDelete: 'CASCADE').
      const leadsRes = await manager.query(
        `DELETE FROM broker_outreach_leads
         WHERE company_name LIKE $1 OR contact_email LIKE $1`,
        [like],
      );
      result.outreachLeads = rowCount(leadsRes);
    });

    result.durationMs = Date.now() - start;
    this.logger.log(
      `e2e teardown swept prefix="${prefix}" leads=${result.outreachLeads} handoffs=${result.ecommerceHandoffs} templates=${result.queryBuilderTemplates} profiles=${result.dataTransformerProfiles} runs=${result.dataTransformerRuns} mappings=${result.dataTransformerMappings} issues=${result.dataTransformerRunIssues} duration=${result.durationMs}ms`,
    );
    return result;
  }
}

function rowCount(result: unknown): number {
  if (Array.isArray(result) && result.length === 2 && typeof result[1] === 'number') {
    return result[1] as number;
  }
  return 0;
}
