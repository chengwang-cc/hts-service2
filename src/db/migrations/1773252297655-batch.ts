import { MigrationInterface, QueryRunner } from "typeorm";

export class Batch1773252297655 implements MigrationInterface {
    name = 'Batch1773252297655'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "batch_job" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "owner_key" character varying(64) NOT NULL, "owner_type" character varying(10) NOT NULL, "organization_id" character varying(36), "user_id" character varying(36), "method" character varying(20) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'pending', "total_items" integer NOT NULL, "processed_items" integer NOT NULL DEFAULT '0', "failed_items" integer NOT NULL DEFAULT '0', "source" character varying(10) NOT NULL, "original_filename" character varying(255), "error_message" text, "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e57f84d485145d5be96bc6d871e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7453940a70a0d639c921f24996" ON "batch_job" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_f518d97b1f015f34eeb6278c4e" ON "batch_job" ("organization_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_aa3a2e9d11826ee9882cc5d535" ON "batch_job" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_06ca43226608dd2a47850a7e57" ON "batch_job" ("owner_key") `);
        await queryRunner.query(`CREATE TABLE "batch_job_item" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "job_id" uuid NOT NULL, "row_index" integer NOT NULL, "reference_id" character varying(255), "query" text NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'pending', "hts_number" character varying(20), "description" text, "full_description" jsonb, "confidence" numeric(5,4), "top_results" jsonb, "phases" jsonb, "error_message" text, "processing_ms" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "completed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_b8c7d29eb29a138755e2057ab2b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d24cdbc234a0e168489c9757a1" ON "batch_job_item" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_b2c46a04b36f2e8d38e9fc4654" ON "batch_job_item" ("job_id", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_988b09607bd8cdca32b6e77880" ON "batch_job_item" ("job_id", "row_index") `);
        await queryRunner.query(`CREATE INDEX "IDX_fccac72157ba0964ada573fb4f" ON "batch_job_item" ("job_id") `);
        await queryRunner.query(`ALTER TABLE "batch_job_item" ADD CONSTRAINT "FK_fccac72157ba0964ada573fb4f2" FOREIGN KEY ("job_id") REFERENCES "batch_job"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "batch_job_item" DROP CONSTRAINT "FK_fccac72157ba0964ada573fb4f2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fccac72157ba0964ada573fb4f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_988b09607bd8cdca32b6e77880"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b2c46a04b36f2e8d38e9fc4654"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d24cdbc234a0e168489c9757a1"`);
        await queryRunner.query(`DROP TABLE "batch_job_item"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_06ca43226608dd2a47850a7e57"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_aa3a2e9d11826ee9882cc5d535"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f518d97b1f015f34eeb6278c4e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7453940a70a0d639c921f24996"`);
        await queryRunner.query(`DROP TABLE "batch_job"`);
    }

}
