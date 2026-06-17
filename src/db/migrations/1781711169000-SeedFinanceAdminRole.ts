import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Provisions the "Finance Administrator" role used by the new
 * /admin/financial/* endpoints (PR F3.1).
 *
 * Deterministic UUID (`20000000-0000-0000-0000-000000000005`) matches
 * the pattern of the other seeded roles:
 *   0...001 Platform Administrator
 *   0...002 Organization Administrator
 *   0...003 Business User
 *   0...004 Viewer
 *   0...005 Finance Administrator   ← this PR
 *
 * Idempotent: ON CONFLICT (name) DO NOTHING. Re-running the migration
 * is safe.
 *
 * Permissions: Finance Administrator can:
 *   - GET /admin/financial/organizations/:id/financial-summary
 *   - GET /admin/financial/organizations/:id/ledger
 *   - POST /admin/financial/organizations/:id/credits/adjust
 * They CANNOT edit org plan, type, slug, users, or any non-financial state.
 *
 * Source: docs/2026-06-17/0747_financial-management-execution-plan.md §12.2
 */
export class SeedFinanceAdminRole1781711169000 implements MigrationInterface {
    name = 'SeedFinanceAdminRole1781711169000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            INSERT INTO roles (id, name, description, permissions, is_active, created_at, updated_at)
            VALUES (
              '20000000-0000-0000-0000-000000000005'::uuid,
              'Finance Administrator',
              'Can issue manual credit grants/debits and view financial state. Cannot edit org plan, users, or non-financial state.',
              '["admin.financial.read","admin.financial.credits.adjust"]'::jsonb,
              true,
              now(),
              now()
            )
            ON CONFLICT (name) DO NOTHING
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Roll back by deleting the row IFF no users are linked to it,
        // so a rollback doesn't accidentally orphan user_roles rows.
        await queryRunner.query(`
            DELETE FROM roles
             WHERE name = 'Finance Administrator'
               AND NOT EXISTS (
                 SELECT 1 FROM user_roles ur WHERE ur.role_id = roles.id
               )
        `);
    }
}
