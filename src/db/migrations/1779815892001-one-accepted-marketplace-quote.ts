import { MigrationInterface, QueryRunner } from 'typeorm';

export class OneAcceptedMarketplaceQuote1779815892001 implements MigrationInterface {
  name = 'OneAcceptedMarketplaceQuote1779815892001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_marketplace_quotes_one_accepted_per_request" ON "marketplace_quotes" ("request_id") WHERE status = 'accepted'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_marketplace_quotes_one_accepted_per_request"`,
    );
  }
}
