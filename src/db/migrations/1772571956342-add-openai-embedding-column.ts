import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOpenaiEmbeddingColumn1772571956342 implements MigrationInterface {
    name = 'AddOpenaiEmbeddingColumn1772571956342'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hts" ADD "embedding_openai" vector(1536)`);
        await queryRunner.query(`ALTER TABLE "hts" ADD "embedding_openai_generated_at" TIMESTAMP`);
        // HNSW index on DGX column (vector(1024)) — fixes full table scan
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_hts_embedding_dgx_hnsw"
             ON "hts" USING hnsw (embedding vector_cosine_ops)
             WHERE embedding IS NOT NULL`
        );
        // HNSW index on OpenAI column (vector(1536))
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_hts_embedding_openai_hnsw"
             ON "hts" USING hnsw (embedding_openai vector_cosine_ops)
             WHERE embedding_openai IS NOT NULL`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_hts_embedding_openai_hnsw"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_hts_embedding_dgx_hnsw"`);
        await queryRunner.query(`ALTER TABLE "hts" DROP COLUMN "embedding_openai_generated_at"`);
        await queryRunner.query(`ALTER TABLE "hts" DROP COLUMN "embedding_openai"`);
    }

}
