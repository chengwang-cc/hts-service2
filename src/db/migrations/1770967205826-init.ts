import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1770967205826 implements MigrationInterface {
    name = 'Init1770967205826'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hts_note_references" DROP CONSTRAINT "FK_fd9155ed6d95683dd6aa46044c9"`);
        await queryRunner.query(`ALTER TABLE "hts_test_cases" DROP CONSTRAINT "FK_01f246f0fd1ebca76678d8da285"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP CONSTRAINT "FK_a1cf654b27e104c2fced933b4d7"`);
        await queryRunner.query(`ALTER TABLE "hts_extra_taxes" DROP CONSTRAINT "FK_9fb329c9c48a32c253835b8b00e"`);
        await queryRunner.query(`ALTER TABLE "hts_embeddings" DROP CONSTRAINT "FK_2b2d2ffc9e5fd488f7e769f1b1d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a3556e2401986f8dc3d73b48b5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e46fc3cee7cecae8d2c222fc77"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a66723be2c5dbc14f9e9499834"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bf27c0875b0ac5b9cf479757ed"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2346e1e1cef73d83169202b3be"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1152d1384521d2ee766acad864"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6ee464e145bf6c67aa60d92dc8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_786ea8af5850526f0eb9b373d0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fd9155ed6d95683dd6aa46044c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a837423a998abb076b6581a183"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_30ce60d81e37aba59d8bc2f519"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_46830e3723aee7d5bd5072d2ca"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2b2d2ffc9e5fd488f7e769f1b1"`);
        await queryRunner.query(`CREATE TABLE "knowledge_chunks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "document_id" uuid NOT NULL, "chunk_index" integer NOT NULL, "content" text NOT NULL, "token_count" integer NOT NULL, "embedding" vector(1536), "embedding_status" character varying(20) NOT NULL DEFAULT 'PENDING', "embedding_generated_at" TIMESTAMP, "error_message" text, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_81af684d79d321813c41019a5cd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_bdb0c523efff746aa871147aae" ON "knowledge_chunks" ("embedding_status") `);
        await queryRunner.query(`CREATE INDEX "IDX_a89c759be5f9fcd1afd18906c0" ON "knowledge_chunks" ("chunk_index") `);
        await queryRunner.query(`CREATE INDEX "IDX_2089ee83745a2f45c4f97faf2a" ON "knowledge_chunks" ("document_id") `);
        await queryRunner.query(`ALTER TABLE "hts_documents" DROP COLUMN "pdf_data"`);
        await queryRunner.query(`ALTER TABLE "hts_documents" DROP COLUMN "document_type"`);
        await queryRunner.query(`ALTER TABLE "hts_documents" DROP COLUMN "source_url"`);
        await queryRunner.query(`ALTER TABLE "hts_documents" DROP COLUMN "file_hash"`);
        await queryRunner.query(`ALTER TABLE "hts_notes" DROP COLUMN "contains_rate"`);
        await queryRunner.query(`ALTER TABLE "hts_notes" DROP COLUMN "note_type"`);
        await queryRunner.query(`ALTER TABLE "hts_notes" DROP COLUMN "rate_text"`);
        await queryRunner.query(`ALTER TABLE "hts_notes" DROP COLUMN "rate_type"`);
        await queryRunner.query(`ALTER TABLE "hts_note_references" DROP COLUMN "resolved_note_id"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "verified"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "verified_at"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "is_active"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "priority"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "effective_date"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "expiration_date"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "test_results"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "original_formula"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "updated_formula"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "reason"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "updated_by"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "verified_by"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "notes"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "country"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "rate_type"`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" DROP COLUMN "original_rate_text"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_93e6f2a2f936e142ed01b07741"`);
        await queryRunner.query(`ALTER TABLE "hts" DROP CONSTRAINT "UQ_30ce60d81e37aba59d8bc2f519c"`);
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT '0.01'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_93e6f2a2f936e142ed01b07741" ON "hts" ("hts_number", "version") `);
        await queryRunner.query(`ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "FK_2089ee83745a2f45c4f97faf2a5" FOREIGN KEY ("document_id") REFERENCES "hts_documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "knowledge_chunks" DROP CONSTRAINT "FK_2089ee83745a2f45c4f97faf2a5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_93e6f2a2f936e142ed01b07741"`);
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT 0.01`);
        await queryRunner.query(`ALTER TABLE "hts" ADD CONSTRAINT "UQ_30ce60d81e37aba59d8bc2f519c" UNIQUE ("hts_number")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_93e6f2a2f936e142ed01b07741" ON "hts" ("hts_number", "version") `);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "original_rate_text" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "rate_type" character varying(20) NOT NULL DEFAULT 'GENERAL'`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "country" character varying(3) NOT NULL DEFAULT 'ALL'`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "notes" text`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "verified_by" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "updated_by" character varying(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "reason" text NOT NULL`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "updated_formula" text NOT NULL`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "original_formula" text`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "test_results" jsonb`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "expiration_date" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "effective_date" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "priority" integer NOT NULL DEFAULT '100'`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "is_active" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "verified_at" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD "verified" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "hts_note_references" ADD "resolved_note_id" uuid`);
        await queryRunner.query(`ALTER TABLE "hts_notes" ADD "rate_type" character varying(50)`);
        await queryRunner.query(`ALTER TABLE "hts_notes" ADD "rate_text" text`);
        await queryRunner.query(`ALTER TABLE "hts_notes" ADD "note_type" character varying(50) NOT NULL DEFAULT 'ADDITIONAL_US_NOTE'`);
        await queryRunner.query(`ALTER TABLE "hts_notes" ADD "contains_rate" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "hts_documents" ADD "file_hash" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "hts_documents" ADD "source_url" text NOT NULL`);
        await queryRunner.query(`ALTER TABLE "hts_documents" ADD "document_type" character varying(20) NOT NULL DEFAULT 'GENERAL'`);
        await queryRunner.query(`ALTER TABLE "hts_documents" ADD "pdf_data" bytea`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2089ee83745a2f45c4f97faf2a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a89c759be5f9fcd1afd18906c0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bdb0c523efff746aa871147aae"`);
        await queryRunner.query(`DROP TABLE "knowledge_chunks"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2b2d2ffc9e5fd488f7e769f1b1" ON "hts_embeddings" ("hts_number") `);
        await queryRunner.query(`CREATE INDEX "IDX_46830e3723aee7d5bd5072d2ca" ON "hts_formula_updates" ("country", "hts_number", "is_active") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_30ce60d81e37aba59d8bc2f519" ON "hts" ("hts_number") `);
        await queryRunner.query(`CREATE INDEX "IDX_a837423a998abb076b6581a183" ON "hts_note_references" ("hts_number") `);
        await queryRunner.query(`CREATE INDEX "IDX_fd9155ed6d95683dd6aa46044c" ON "hts_note_references" ("resolved_note_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_786ea8af5850526f0eb9b373d0" ON "hts_note_references" ("resolution_method") `);
        await queryRunner.query(`CREATE INDEX "IDX_6ee464e145bf6c67aa60d92dc8" ON "hts_notes" ("document_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_1152d1384521d2ee766acad864" ON "hts_notes" ("chapter") `);
        await queryRunner.query(`CREATE INDEX "IDX_2346e1e1cef73d83169202b3be" ON "hts_notes" ("note_type") `);
        await queryRunner.query(`CREATE INDEX "IDX_bf27c0875b0ac5b9cf479757ed" ON "hts_notes" ("note_number") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a66723be2c5dbc14f9e9499834" ON "hts_note_embeddings" ("note_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_e46fc3cee7cecae8d2c222fc77" ON "hts_documents" ("chapter") `);
        await queryRunner.query(`CREATE INDEX "IDX_a3556e2401986f8dc3d73b48b5" ON "hts_documents" ("document_type") `);
        await queryRunner.query(`ALTER TABLE "hts_embeddings" ADD CONSTRAINT "FK_2b2d2ffc9e5fd488f7e769f1b1d" FOREIGN KEY ("hts_number") REFERENCES "hts"("hts_number") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "hts_extra_taxes" ADD CONSTRAINT "FK_9fb329c9c48a32c253835b8b00e" FOREIGN KEY ("hts_number") REFERENCES "hts"("hts_number") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "hts_formula_updates" ADD CONSTRAINT "FK_a1cf654b27e104c2fced933b4d7" FOREIGN KEY ("hts_number") REFERENCES "hts"("hts_number") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ADD CONSTRAINT "FK_01f246f0fd1ebca76678d8da285" FOREIGN KEY ("hts_number") REFERENCES "hts"("hts_number") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "hts_note_references" ADD CONSTRAINT "FK_fd9155ed6d95683dd6aa46044c9" FOREIGN KEY ("resolved_note_id") REFERENCES "hts_notes"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

}
