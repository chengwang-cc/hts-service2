import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLookupConversationTables1760000001000
  implements MigrationInterface
{
  name = 'CreateLookupConversationTables1760000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS lookup_conversation_sessions (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id varchar(100) NULL,
        user_profile varchar(200) NULL,
        status varchar(30) NOT NULL DEFAULT 'active',
        context_json jsonb NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS lookup_conversation_messages (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        session_id uuid NOT NULL REFERENCES lookup_conversation_sessions(id) ON DELETE CASCADE,
        role varchar(20) NOT NULL,
        content_json jsonb NOT NULL,
        tool_trace_json jsonb NULL,
        token_usage jsonb NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS lookup_conversation_feedback (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        session_id uuid NOT NULL REFERENCES lookup_conversation_sessions(id) ON DELETE CASCADE,
        message_id uuid NULL REFERENCES lookup_conversation_messages(id) ON DELETE SET NULL,
        is_correct boolean NOT NULL,
        chosen_hts varchar(20) NULL,
        comment text NULL,
        metadata jsonb NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_lookup_conversation_sessions_org
      ON lookup_conversation_sessions (organization_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_lookup_conversation_sessions_status
      ON lookup_conversation_sessions (status)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_lookup_conversation_messages_session_created
      ON lookup_conversation_messages (session_id, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_lookup_conversation_feedback_session_created
      ON lookup_conversation_feedback (session_id, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_lookup_conversation_feedback_correct
      ON lookup_conversation_feedback (is_correct)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_lookup_conversation_feedback_correct`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_lookup_conversation_feedback_session_created`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_lookup_conversation_messages_session_created`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_lookup_conversation_sessions_status`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_lookup_conversation_sessions_org`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS lookup_conversation_feedback`);
    await queryRunner.query(`DROP TABLE IF EXISTS lookup_conversation_messages`);
    await queryRunner.query(`DROP TABLE IF EXISTS lookup_conversation_sessions`);
  }
}
