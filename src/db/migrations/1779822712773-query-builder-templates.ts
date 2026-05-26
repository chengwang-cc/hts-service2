import { MigrationInterface, QueryRunner } from "typeorm";

export class QueryBuilderTemplates1779822712773 implements MigrationInterface {
    name = 'QueryBuilderTemplates1779822712773'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "query_builder_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "name" character varying(120) NOT NULL, "description" text, "input" jsonb NOT NULL, "created_by" character varying(200) NOT NULL DEFAULT 'system', "updated_by" character varying(200) NOT NULL DEFAULT 'system', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_8bc783b1902c39c17fcfab0e3c3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_095b60f432284184a80f6999f0" ON "query_builder_templates" ("organization_id", "name") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_095b60f432284184a80f6999f0"`);
        await queryRunner.query(`DROP TABLE "query_builder_templates"`);
    }

}
