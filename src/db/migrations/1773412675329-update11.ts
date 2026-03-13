import { MigrationInterface, QueryRunner } from "typeorm";

export class Update111773412675329 implements MigrationInterface {
    name = 'Update111773412675329'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "product_classifications" ADD "input_method" character varying(32) NOT NULL DEFAULT 'TEXT'`);
        await queryRunner.query(`ALTER TABLE "product_classifications" ADD "source_url" character varying(2048)`);
        await queryRunner.query(`ALTER TABLE "product_classifications" ADD "source_image_url" character varying(2048)`);
        await queryRunner.query(`ALTER TABLE "product_classifications" ADD "source_image_hash" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "product_classifications" ADD "source_evidence" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "product_classifications" DROP COLUMN "source_evidence"`);
        await queryRunner.query(`ALTER TABLE "product_classifications" DROP COLUMN "source_image_hash"`);
        await queryRunner.query(`ALTER TABLE "product_classifications" DROP COLUMN "source_image_url"`);
        await queryRunner.query(`ALTER TABLE "product_classifications" DROP COLUMN "source_url"`);
        await queryRunner.query(`ALTER TABLE "product_classifications" DROP COLUMN "input_method"`);
    }

}
