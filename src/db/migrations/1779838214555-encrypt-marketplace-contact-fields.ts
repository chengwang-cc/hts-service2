import { MigrationInterface, QueryRunner } from "typeorm";
import { createCipheriv, createHash, randomBytes } from "crypto";

/**
 * Encrypt the marketplace broker contact fields at rest.
 *
 * Adds three JSONB columns to `marketplace_broker_profiles` that store
 * AES-256-GCM envelopes (`{algorithm, ciphertext, iv, authTag,
 * keyVersion}`) compatible with `EncryptedSecretService`, encrypts any
 * existing plaintext rows in-place using the same key resolution the
 * service uses, then drops the old plaintext columns.
 *
 * The encryption logic is inlined here (rather than calling the service)
 * because TypeORM migrations don't have NestJS DI available. If you
 * change the envelope format in EncryptedSecretService, mirror it here
 * before deploying.
 */
export class EncryptMarketplaceContactFields1779838214555 implements MigrationInterface {
    name = 'EncryptMarketplaceContactFields1779838214555'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Add the new encrypted-envelope columns (nullable, no default).
        await queryRunner.query(`ALTER TABLE "marketplace_broker_profiles" ADD "contact_email_enc" jsonb`);
        await queryRunner.query(`ALTER TABLE "marketplace_broker_profiles" ADD "contact_phone_enc" jsonb`);
        await queryRunner.query(`ALTER TABLE "marketplace_broker_profiles" ADD "office_address_enc" jsonb`);

        // 2. Encrypt existing plaintext rows in-place, batch-mode.
        const key = resolveKey();
        const keyVersion = process.env.SECRET_ENCRYPTION_KEY_VERSION || 'v1';
        const rows: Array<{
            id: string;
            contact_email: string | null;
            contact_phone: string | null;
            office_address: Record<string, unknown> | null;
        }> = await queryRunner.query(
            `SELECT id, contact_email, contact_phone, office_address
             FROM marketplace_broker_profiles
             WHERE contact_email IS NOT NULL
                OR contact_phone IS NOT NULL
                OR office_address IS NOT NULL`,
        );
        for (const row of rows) {
            const emailEnc = encryptOrNull(row.contact_email, key, keyVersion);
            const phoneEnc = encryptOrNull(row.contact_phone, key, keyVersion);
            const addressEnc = encryptOrNull(
                row.office_address == null ? null : JSON.stringify(row.office_address),
                key,
                keyVersion,
            );
            await queryRunner.query(
                `UPDATE marketplace_broker_profiles
                 SET contact_email_enc = $1, contact_phone_enc = $2, office_address_enc = $3
                 WHERE id = $4`,
                [emailEnc, phoneEnc, addressEnc, row.id],
            );
        }

        // 3. Drop the plaintext columns now that ciphertext is in place.
        await queryRunner.query(`ALTER TABLE "marketplace_broker_profiles" DROP COLUMN "contact_email"`);
        await queryRunner.query(`ALTER TABLE "marketplace_broker_profiles" DROP COLUMN "contact_phone"`);
        await queryRunner.query(`ALTER TABLE "marketplace_broker_profiles" DROP COLUMN "office_address"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Restore plaintext columns. The ciphertext columns are dropped;
        // there is no automatic decryption-on-rollback because production
        // rotations should be forward-only — this `down` is a development
        // safety net, not a rollback strategy.
        await queryRunner.query(`ALTER TABLE "marketplace_broker_profiles" ADD "contact_email" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "marketplace_broker_profiles" ADD "contact_phone" character varying(60)`);
        await queryRunner.query(`ALTER TABLE "marketplace_broker_profiles" ADD "office_address" jsonb`);
        await queryRunner.query(`ALTER TABLE "marketplace_broker_profiles" DROP COLUMN "office_address_enc"`);
        await queryRunner.query(`ALTER TABLE "marketplace_broker_profiles" DROP COLUMN "contact_phone_enc"`);
        await queryRunner.query(`ALTER TABLE "marketplace_broker_profiles" DROP COLUMN "contact_email_enc"`);
    }
}

interface EncryptedSecret {
    algorithm: 'aes-256-gcm';
    ciphertext: string;
    iv: string;
    authTag: string;
    keyVersion: string;
}

function encryptOrNull(
    plaintext: string | null,
    key: Buffer,
    keyVersion: string,
): EncryptedSecret | null {
    if (plaintext === null || plaintext === undefined || plaintext === '') return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
        algorithm: 'aes-256-gcm',
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        keyVersion,
    };
}

/**
 * Mirror of EncryptedSecretService.resolveKeyFromEnv('SECRET_ENCRYPTION_KEY')
 * for use inside this migration. Keep in sync if the service ever
 * changes its key-resolution rules.
 */
function resolveKey(): Buffer {
    const configured = process.env.SECRET_ENCRYPTION_KEY;
    if (configured) {
        const key = Buffer.from(configured, 'base64');
        if (key.length === 32) return key;
        throw new Error(
            `SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key (got ${key.length} bytes)`,
        );
    }
    const env = (process.env.NODE_ENV || '').toLowerCase();
    if (env === 'production' || env === 'staging') {
        throw new Error(
            `SECRET_ENCRYPTION_KEY must be set in ${env} (base64-encoded 32 bytes)`,
        );
    }
    return createHash('sha256')
        .update(process.env.JWT_SECRET || 'hts-local-development-secret')
        .digest();
}
