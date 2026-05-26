import { MigrationInterface, QueryRunner } from "typeorm";

export class RuleStatus1779807644414 implements MigrationInterface {
    name = 'RuleStatus1779807644414'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "rule_status" ("rule_id" character varying(200) NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "effective_from" TIMESTAMP WITH TIME ZONE, "effective_to" TIMESTAMP WITH TIME ZONE, "reason" text, "changed_by" character varying(200) NOT NULL, "changed_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3a71016dd3d722b7892ccf9a3e0" PRIMARY KEY ("rule_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_11413067841b1806fc3d7cbb75" ON "rule_status" ("effective_to") `);
        await queryRunner.query(`CREATE INDEX "IDX_cfb91ba21a5010a560e7b5f601" ON "rule_status" ("effective_from") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_cfb91ba21a5010a560e7b5f601"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_11413067841b1806fc3d7cbb75"`);
        await queryRunner.query(`DROP TABLE "rule_status"`);
    }

}
