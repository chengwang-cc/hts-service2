import { MigrationInterface, QueryRunner } from "typeorm";

export class KnowledgeSourceRegistry1779816627873 implements MigrationInterface {
    name = 'KnowledgeSourceRegistry1779816627873'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "knowledge_sources" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(180) NOT NULL, "publisher" character varying(120), "source_type" character varying(32) NOT NULL DEFAULT 'rss', "url" text NOT NULL, "jurisdiction" character varying(8), "document_type" character varying(50), "category" character varying(64), "trust_tier" character varying(32) NOT NULL DEFAULT 'official', "status" character varying(16) NOT NULL DEFAULT 'active', "crawl_frequency_hours" integer NOT NULL DEFAULT '6', "item_limit" integer NOT NULL DEFAULT '25', "priority" integer NOT NULL DEFAULT '100', "respect_robots" boolean NOT NULL DEFAULT true, "requires_review" boolean NOT NULL DEFAULT true, "metadata" jsonb, "last_crawled_at" TIMESTAMP WITH TIME ZONE, "last_success_at" TIMESTAMP WITH TIME ZONE, "last_failure_at" TIMESTAMP WITH TIME ZONE, "last_discovered_at" TIMESTAMP WITH TIME ZONE, "last_error_message" text, "created_by" character varying(200) NOT NULL DEFAULT 'system', "updated_by" character varying(200) NOT NULL DEFAULT 'system', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d92b58df209366bc2a9cc542581" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0b8632976aee387a49ba58eb4f" ON "knowledge_sources" ("priority", "name") `);
        await queryRunner.query(`CREATE INDEX "IDX_cb60f4d9fa051bc0115810ecaa" ON "knowledge_sources" ("publisher") `);
        await queryRunner.query(`CREATE INDEX "IDX_1f1b6e0cb0e348808308b384f2" ON "knowledge_sources" ("jurisdiction", "document_type") `);
        await queryRunner.query(`CREATE INDEX "IDX_0304007b7e55c7e1db5ba7adb7" ON "knowledge_sources" ("status", "source_type") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2e7f8a157608ddce99e70e83a5" ON "knowledge_sources" ("url") `);
        await queryRunner.query(`CREATE TABLE "knowledge_source_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "source_id" uuid NOT NULL, "url" text NOT NULL, "title" text, "published_at" TIMESTAMP WITH TIME ZONE, "status" character varying(24) NOT NULL DEFAULT 'discovered', "knowledge_card_id" uuid, "content_hash" character varying(64), "first_seen_at" TIMESTAMP WITH TIME ZONE, "last_seen_at" TIMESTAMP WITH TIME ZONE, "last_ingested_at" TIMESTAMP WITH TIME ZONE, "error_message" text, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_19edca5335160bbefe283bb5a9c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2235d75a2565f54d9ceb8bedd4" ON "knowledge_source_items" ("last_seen_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_76bdfc70fb14290d288c618e9d" ON "knowledge_source_items" ("published_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_b680a8159940701b401601686f" ON "knowledge_source_items" ("content_hash") `);
        await queryRunner.query(`CREATE INDEX "IDX_af3e20a1b2c3151f39888e82de" ON "knowledge_source_items" ("source_id", "status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_knowledge_source_items_source_url" ON "knowledge_source_items" ("source_id", "url") `);
        await queryRunner.query(`CREATE TABLE "knowledge_source_crawl_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "source_id" uuid, "status" character varying(24) NOT NULL DEFAULT 'running', "trigger" character varying(80), "job_id" character varying(120), "attempted_items" integer NOT NULL DEFAULT '0', "succeeded_items" integer NOT NULL DEFAULT '0', "failed_items" integer NOT NULL DEFAULT '0', "result_json" jsonb, "error_message" text, "started_at" TIMESTAMP NOT NULL DEFAULT now(), "finished_at" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_51109f876fb085091a0ba738355" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_eaf83b0c9b5e3a3abc6a8b4fc9" ON "knowledge_source_crawl_runs" ("job_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_e8cce406635ca00d24125ba7b7" ON "knowledge_source_crawl_runs" ("status", "started_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_39d8b00ae3a7d32b4f5b653877" ON "knowledge_source_crawl_runs" ("source_id", "started_at") `);
        await queryRunner.query(`ALTER TABLE "knowledge_source_items" ADD CONSTRAINT "FK_03d0894e3f937bf32fc19fc0bb2" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "knowledge_source_crawl_runs" ADD CONSTRAINT "FK_75af710b66b49a81127e75293c9" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "knowledge_source_crawl_runs" DROP CONSTRAINT "FK_75af710b66b49a81127e75293c9"`);
        await queryRunner.query(`ALTER TABLE "knowledge_source_items" DROP CONSTRAINT "FK_03d0894e3f937bf32fc19fc0bb2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_39d8b00ae3a7d32b4f5b653877"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e8cce406635ca00d24125ba7b7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_eaf83b0c9b5e3a3abc6a8b4fc9"`);
        await queryRunner.query(`DROP TABLE "knowledge_source_crawl_runs"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_knowledge_source_items_source_url"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_af3e20a1b2c3151f39888e82de"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b680a8159940701b401601686f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_76bdfc70fb14290d288c618e9d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2235d75a2565f54d9ceb8bedd4"`);
        await queryRunner.query(`DROP TABLE "knowledge_source_items"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2e7f8a157608ddce99e70e83a5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0304007b7e55c7e1db5ba7adb7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1f1b6e0cb0e348808308b384f2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cb60f4d9fa051bc0115810ecaa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0b8632976aee387a49ba58eb4f"`);
        await queryRunner.query(`DROP TABLE "knowledge_sources"`);
    }

}
