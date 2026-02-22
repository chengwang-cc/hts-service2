import { MigrationInterface, QueryRunner } from "typeorm";

export class Init121771735436253 implements MigrationInterface {
    name = 'Init121771735436253'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."idx_hts_embedding_hnsw"`);
        await queryRunner.query(`DROP INDEX "public"."idx_hts_search_vector"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX "idx_hts_search_vector" ON "hts" ("search_vector") `);
        await queryRunner.query(`CREATE INDEX "idx_hts_embedding_hnsw" ON "hts" ("embedding") WHERE (embedding IS NOT NULL)`);
    }

}
