import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

export interface EncryptedSecret {
  algorithm: 'aes-256-gcm';
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}

@Injectable()
export class EncryptedSecretService {
  private readonly algorithm = 'aes-256-gcm' as const;

  encrypt(plaintext: string): EncryptedSecret {
    const key = this.resolveKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algorithm, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return {
      algorithm: this.algorithm,
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: process.env.SECRET_ENCRYPTION_KEY_VERSION || 'v1',
    };
  }

  decrypt(secret: EncryptedSecret): string {
    if (secret.algorithm !== this.algorithm) {
      throw new InternalServerErrorException('Unsupported secret algorithm');
    }

    const decipher = createDecipheriv(
      this.algorithm,
      this.resolveKey(),
      Buffer.from(secret.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private resolveKey(): Buffer {
    return this.resolveKeyFromEnv('SECRET_ENCRYPTION_KEY');
  }

  /**
   * Resolves the active encryption key. Used both for normal encrypt/decrypt
   * and (in concert with rotateSecret) to migrate ciphertext from old keys.
   */
  resolveKeyFromEnv(envName: string): Buffer {
    const configured = process.env[envName];

    if (configured) {
      const key = Buffer.from(configured, 'base64');
      if (key.length === 32) {
        return key;
      }
      // Misconfigured key — fail loudly regardless of environment so a
      // staging deploy can't silently downgrade to dev-mode fallback.
      throw new InternalServerErrorException(
        `${envName} must be a base64 encoded 32-byte key (got ${key.length} bytes)`,
      );
    }

    if (envName === 'SECRET_ENCRYPTION_KEY') {
      const env = (process.env.NODE_ENV || '').toLowerCase();
      if (env === 'production' || env === 'staging') {
        throw new InternalServerErrorException(
          `SECRET_ENCRYPTION_KEY must be set in ${env} (base64-encoded 32 bytes)`,
        );
      }
      return createHash('sha256')
        .update(process.env.JWT_SECRET || 'hts-local-development-secret')
        .digest();
    }

    throw new InternalServerErrorException(`${envName} is not configured`);
  }

  /**
   * Re-encrypts a stored secret with the current active key. Reads the
   * source ciphertext using the supplied legacy key (typically
   * SECRET_ENCRYPTION_KEY_OLD). Used by the admin rotation endpoint to
   * upgrade rows in batches without service downtime.
   */
  rotateSecret(secret: EncryptedSecret, oldKeyEnv: string): EncryptedSecret {
    if (secret.algorithm !== this.algorithm) {
      throw new InternalServerErrorException('Unsupported secret algorithm');
    }
    const oldKey = this.resolveKeyFromEnv(oldKeyEnv);
    const decipher = createDecipheriv(
      this.algorithm,
      oldKey,
      Buffer.from(secret.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return this.encrypt(plaintext);
  }
}
