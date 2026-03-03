import { MigrationInterface, QueryRunner } from "typeorm";

export class RerankerTrainingRuns1772464116661 implements MigrationInterface {
    name = 'RerankerTrainingRuns1772464116661'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."idx_hts_embedding_hnsw"`);
        await queryRunner.query(`CREATE TABLE "reranker_training_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "status" character varying(20) NOT NULL DEFAULT 'pending', "feedback_pairs_added" integer NOT NULL DEFAULT '0', "total_pairs" integer NOT NULL DEFAULT '0', "triggered_by" character varying(100), "error_message" text, "started_at" TIMESTAMP NOT NULL DEFAULT now(), "completed_at" TIMESTAMP, CONSTRAINT "PK_a1193a076a7523e2075384a324e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_77ea19f149b7a173c03e600a30" ON "reranker_training_runs" ("status", "started_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_77ea19f149b7a173c03e600a30"`);
        await queryRunner.query(`DROP TABLE "reranker_training_runs"`);
        await queryRunner.query(`CREATE INDEX "idx_hts_embedding_hnsw" ON "hts" ("embedding") `);
    }

}
