import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeEmbeddingDimTo10241772383435823 implements MigrationInterface {
    name = 'ChangeEmbeddingDimTo10241772383435823'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Clear stale 1536-dim embeddings — they are incompatible with BGE-M3 (1024-dim).
        // hts.embedding is nullable so nullify; hts_note_embeddings requires truncate since embedding is NOT NULL.
        await queryRunner.query(`UPDATE "hts" SET "embedding" = NULL, "embedding_model" = NULL, "embedding_generated_at" = NULL`);
        await queryRunner.query(`TRUNCATE TABLE "hts_note_embeddings"`);
        await queryRunner.query(`UPDATE "knowledge_chunks" SET "embedding" = NULL`);

        await queryRunner.query(`ALTER TABLE "hts" DROP COLUMN "embedding"`);
        await queryRunner.query(`ALTER TABLE "hts" ADD "embedding" vector(1024)`);
        await queryRunner.query(`ALTER TABLE "hts_note_embeddings" DROP COLUMN "embedding"`);
        await queryRunner.query(`ALTER TABLE "hts_note_embeddings" ADD "embedding" vector(1024) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "knowledge_chunks" DROP COLUMN "embedding"`);
        await queryRunner.query(`ALTER TABLE "knowledge_chunks" ADD "embedding" vector(1024)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`TRUNCATE TABLE "hts_note_embeddings"`);
        await queryRunner.query(`ALTER TABLE "knowledge_chunks" DROP COLUMN "embedding"`);
        await queryRunner.query(`ALTER TABLE "knowledge_chunks" ADD "embedding" vector(1536)`);
        await queryRunner.query(`ALTER TABLE "hts_note_embeddings" DROP COLUMN "embedding"`);
        await queryRunner.query(`ALTER TABLE "hts_note_embeddings" ADD "embedding" vector(1536) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "hts" DROP COLUMN "embedding"`);
        await queryRunner.query(`ALTER TABLE "hts" ADD "embedding" vector(1536)`);
    }

}
