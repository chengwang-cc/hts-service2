import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { ShopifySessionEntity } from '../entities/shopify-session.entity';
import { ConnectorEntity } from '../../connectors/entities/connector.entity';
import { SyncLogEntity } from '../../connectors/entities/sync-log.entity';
import { CheckoutOrderEntity } from '../../widget/entities/checkout-order.entity';
import {
  EncryptedSecret,
  EncryptedSecretService,
} from '../../security/encrypted-secret.service';

interface ShopifyTokenResponse {
  access_token: string;
  scope: string;
}

@Injectable()
export class ShopifyAuthService {
  private readonly logger = new Logger(ShopifyAuthService.name);

  private readonly apiKey = process.env.SHOPIFY_API_KEY ?? '';
  private readonly apiSecret = process.env.SHOPIFY_API_SECRET ?? '';
  private readonly scopes =
    process.env.SHOPIFY_SCOPES ??
    'read_products,write_products,read_orders,write_orders,read_inventory,write_inventory';
  private readonly appUrl =
    process.env.SHOPIFY_APP_URL ?? 'https://api.usahts.com/shopify/app';

  constructor(
    @InjectRepository(ShopifySessionEntity)
    private readonly sessionRepository: Repository<ShopifySessionEntity>,
    @InjectRepository(ConnectorEntity)
    private readonly connectorRepository: Repository<ConnectorEntity>,
    @InjectRepository(SyncLogEntity)
    private readonly syncLogRepository: Repository<SyncLogEntity>,
    @InjectRepository(CheckoutOrderEntity)
    private readonly checkoutOrderRepository: Repository<CheckoutOrderEntity>,
    private readonly encryptedSecrets: EncryptedSecretService,
  ) {}

  /**
   * Build the Shopify OAuth authorization URL and store a nonce for validation.
   */
  async buildAuthUrl(shop: string): Promise<string> {
    const sanitizedShop = this.sanitizeShop(shop);
    if (!sanitizedShop) {
      throw new UnauthorizedException('Invalid shop domain');
    }

    const nonce = randomBytes(16).toString('hex');

    // Upsert session with nonce for later validation
    let session = await this.sessionRepository.findOne({
      where: { shop: sanitizedShop },
    });
    if (session) {
      session.nonce = nonce;
      await this.sessionRepository.save(session);
    } else {
      session = this.sessionRepository.create({
        shop: sanitizedShop,
        accessToken: '',
        scopes: [],
        nonce,
        isActive: false,
      });
      await this.sessionRepository.save(session);
    }

    const redirectUri = `${this.appUrl.replace('/app', '')}/auth/callback`;
    const params = new URLSearchParams({
      client_id: this.apiKey,
      scope: this.scopes,
      redirect_uri: redirectUri,
      state: nonce,
    });

    return `https://${sanitizedShop}/admin/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for a permanent access token.
   */
  async handleCallback(
    shop: string,
    code: string,
    state: string,
    hmac: string,
    queryString: string,
  ): Promise<ShopifySessionEntity> {
    const sanitizedShop = this.sanitizeShop(shop);
    if (!sanitizedShop) {
      throw new UnauthorizedException('Invalid shop domain');
    }

    // Verify HMAC
    if (!this.verifyHmac(hmac, queryString)) {
      throw new UnauthorizedException('Invalid HMAC signature');
    }

    // Verify nonce
    const session = await this.sessionRepository.findOne({
      where: { shop: sanitizedShop },
    });
    if (!session || session.nonce !== state) {
      throw new UnauthorizedException('Invalid state parameter');
    }

    // Exchange code for token
    const tokenResponse = await this.exchangeToken(sanitizedShop, code);

    // Update session
    session.accessToken = this.encryptAccessToken(tokenResponse.access_token);
    session.scopes = tokenResponse.scope.split(',').map((s) => s.trim());
    session.nonce = null;
    session.isActive = true;

    const saved = await this.sessionRepository.save(session);
    saved.accessToken = tokenResponse.access_token;

    this.logger.log(`Shopify app installed for shop: ${sanitizedShop}`);
    return saved;
  }

  /**
   * Save session updates (e.g. after linking connector).
   */
  async saveSession(session: ShopifySessionEntity): Promise<void> {
    const plaintext = this.decryptAccessToken(session.accessToken);
    session.accessToken = this.encryptAccessToken(plaintext);
    await this.sessionRepository.save(session);
    session.accessToken = plaintext;
  }

  /**
   * Find an active session for a shop.
   */
  async getSession(shop: string): Promise<ShopifySessionEntity | null> {
    const session = await this.sessionRepository.findOne({
      where: { shop: this.sanitizeShop(shop) || shop, isActive: true },
    });
    if (session) {
      session.accessToken = this.decryptAccessToken(session.accessToken);
    }
    return session;
  }

  /**
   * Verify a Shopify App Bridge session token (JWT).
   */
  verifySessionToken(token: string): { shop: string; sub: string } {
    // Shopify session tokens are HS256 JWTs signed with the API secret
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Invalid session token format');
    }

    let header: { alg?: string };
    let payload: { iss?: string; aud?: string; exp?: number; sub?: string };
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    } catch {
      throw new UnauthorizedException('Malformed session token');
    }

    if (header.alg !== 'HS256') {
      throw new UnauthorizedException('Unsupported token algorithm');
    }

    // Verify signature
    const signInput = `${parts[0]}.${parts[1]}`;
    const expectedSig = createHmac('sha256', this.apiSecret)
      .update(signInput)
      .digest('base64url');

    // Compare as raw bytes decoded from base64url
    const expectedBuf = Buffer.from(expectedSig, 'base64url');
    const actualBuf = Buffer.from(parts[2], 'base64url');
    if (
      expectedBuf.length !== actualBuf.length ||
      !timingSafeEqual(expectedBuf, actualBuf)
    ) {
      this.logger.warn(
        `Session token signature mismatch for aud=${payload.aud}`,
      );
      throw new UnauthorizedException('Invalid session token signature');
    }

    // Verify expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new UnauthorizedException('Session token expired');
    }

    // Verify audience
    if (payload.aud !== this.apiKey) {
      throw new UnauthorizedException('Invalid session token audience');
    }

    // Extract shop from iss: "https://mystore.myshopify.com/admin"
    if (!payload.iss) {
      throw new UnauthorizedException('Session token missing issuer');
    }
    let shop: string;
    try {
      shop = new URL(payload.iss).host;
    } catch {
      throw new UnauthorizedException('Invalid session token issuer');
    }

    return { shop, sub: payload.sub ?? '' };
  }

  /**
   * Deactivate a session (on app uninstall).
   */
  async deactivateSession(shop: string): Promise<void> {
    const sanitizedShop = this.sanitizeShop(shop);
    if (!sanitizedShop) return;

    await this.sessionRepository.update(
      { shop: sanitizedShop },
      { isActive: false, accessToken: '' },
    );
    this.logger.log(`Shopify session deactivated for shop: ${sanitizedShop}`);
  }

  /**
   * Delete all data for a shop (GDPR shop/redact).
   */
  async deleteShopData(shop: string): Promise<void> {
    const sanitizedShop = this.sanitizeShop(shop);
    if (!sanitizedShop) return;

    // Find session to get connector reference
    const session = await this.sessionRepository.findOne({
      where: { shop: sanitizedShop },
    });

    // Delete connector data (sync logs, connector record)
    if (session?.connectorId) {
      await this.syncLogRepository.delete({ connectorId: session.connectorId });
      await this.connectorRepository.delete({ id: session.connectorId });
      this.logger.log(
        `Deleted connector ${session.connectorId} and sync logs for shop: ${sanitizedShop}`,
      );
    }

    // Delete any connectors matching this shop domain (in case of orphaned records)
    const connectors = await this.connectorRepository.find({
      where: { connectorType: 'shopify' },
    });
    for (const c of connectors) {
      if ((c.config.shopUrl ?? '').toLowerCase().includes(sanitizedShop)) {
        await this.syncLogRepository.delete({ connectorId: c.id });
        await this.connectorRepository.delete({ id: c.id });
      }
    }

    // Delete checkout orders linked to this organization
    if (session?.organizationId) {
      await this.checkoutOrderRepository.delete({
        organizationId: session.organizationId,
      });
    }

    // Delete session
    await this.sessionRepository.delete({ shop: sanitizedShop });
    this.logger.log(`GDPR shop data fully deleted for: ${sanitizedShop}`);
  }

  private async exchangeToken(
    shop: string,
    code: string,
  ): Promise<ShopifyTokenResponse> {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.apiKey,
        client_secret: this.apiSecret,
        code,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new UnauthorizedException(`Token exchange failed: ${text}`);
    }

    return response.json() as Promise<ShopifyTokenResponse>;
  }

  private verifyHmac(hmac: string, queryString: string): boolean {
    // Remove hmac param from query string for verification
    const params = new URLSearchParams(queryString);
    params.delete('hmac');
    params.sort();
    const message = params.toString();

    const computed = createHmac('sha256', this.apiSecret)
      .update(message)
      .digest('hex');

    const computedBuf = Buffer.from(computed, 'utf8');
    const providedBuf = Buffer.from(hmac, 'utf8');

    if (computedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(computedBuf, providedBuf);
  }

  private sanitizeShop(shop: string): string {
    const trimmed = (shop ?? '').trim().toLowerCase();
    if (!trimmed) return '';

    // Must match *.myshopify.com pattern
    const match = trimmed.match(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/);
    if (match) return trimmed;

    // Try to extract from URL
    try {
      const url = trimmed.includes('://')
        ? new URL(trimmed)
        : new URL(`https://${trimmed}`);
      if (url.host.endsWith('.myshopify.com')) return url.host;
    } catch {
      // not a URL
    }

    return '';
  }

  encryptAccessToken(token: string): string {
    if (!token || this.isEncryptedTokenString(token)) return token;
    return JSON.stringify(this.encryptedSecrets.encrypt(token));
  }

  decryptAccessToken(token: string): string {
    if (!token || !this.isEncryptedTokenString(token)) return token;
    return this.encryptedSecrets.decrypt(JSON.parse(token) as EncryptedSecret);
  }

  private isEncryptedTokenString(token: string): boolean {
    try {
      const parsed = JSON.parse(token) as Partial<EncryptedSecret>;
      return (
        parsed?.algorithm === 'aes-256-gcm' &&
        typeof parsed.ciphertext === 'string' &&
        typeof parsed.iv === 'string' &&
        typeof parsed.authTag === 'string'
      );
    } catch {
      return false;
    }
  }
}
