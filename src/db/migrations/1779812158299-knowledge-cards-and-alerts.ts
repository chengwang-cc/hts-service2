import { MigrationInterface, QueryRunner } from "typeorm";

export class KnowledgeCardsAndAlerts1779812158299 implements MigrationInterface {
    name = 'KnowledgeCardsAndAlerts1779812158299'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "rule_review_alerts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "rule_id" character varying(200) NOT NULL, "card_key" character varying(200) NOT NULL, "previous_hash" character varying(64), "new_hash" character varying(64) NOT NULL, "diff_summary" text, "ai_advisory_json" jsonb, "status" character varying(16) NOT NULL DEFAULT 'open', "resolved_by" character varying(200), "resolution_note" text, "resolution_pr_url" text, "resolved_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6b7ebae16a7b578932e767c9fad" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7b0bad5a6de29a3ca2755cc140" ON "rule_review_alerts" ("status", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_99a4f46845d1a2bda8dd96d26b" ON "rule_review_alerts" ("card_key") `);
        await queryRunner.query(`CREATE INDEX "IDX_1140cb3e0074ed37a01f55e7fa" ON "rule_review_alerts" ("rule_id", "status") `);
        await queryRunner.query(`CREATE TABLE "knowledge_cards" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "card_key" character varying(200) NOT NULL, "document_type" character varying(50) NOT NULL, "jurisdiction" character varying(8), "source_url" text, "content_hash" character varying(64) NOT NULL, "storage_ref" text, "payload" jsonb NOT NULL, "status" character varying(32) NOT NULL DEFAULT 'pending_ingest', "error_message" text, "effective_date" TIMESTAMP WITH TIME ZONE, "expiration_date" TIMESTAMP WITH TIME ZONE, "embedding" vector(1024), "embedding_openai" vector(1536), "ingested_by" character varying(200) NOT NULL DEFAULT 'system', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a5d07efab90482d7bd095c35bc7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6e15fe5e2ab942e5f73cae0dfd" ON "knowledge_cards" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_3f43690c46c12359b04bd5329d" ON "knowledge_cards" ("content_hash") `);
        await queryRunner.query(`CREATE INDEX "IDX_0cefab02191f8798ed3e4c7c77" ON "knowledge_cards" ("card_key", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_9e8a5679a872e1f8106a2fd458" ON "knowledge_cards" ("card_key") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_9e8a5679a872e1f8106a2fd458"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0cefab02191f8798ed3e4c7c77"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3f43690c46c12359b04bd5329d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6e15fe5e2ab942e5f73cae0dfd"`);
        await queryRunner.query(`DROP TABLE "knowledge_cards"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1140cb3e0074ed37a01f55e7fa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_99a4f46845d1a2bda8dd96d26b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7b0bad5a6de29a3ca2755cc140"`);
        await queryRunner.query(`DROP TABLE "rule_review_alerts"`);
    }

}
