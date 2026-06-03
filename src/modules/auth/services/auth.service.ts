import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { Profile as GoogleProfile } from 'passport-google-oauth20';
import { UserEntity } from '../entities/user.entity';
import { OrganizationEntity } from '../entities/organization.entity';
import { RoleEntity } from '../entities/role.entity';
import { CreditPurchaseService } from '../../billing/services/credit-purchase.service';
import { BillingChargeService } from '../../billing/services/billing-charge.service';

interface GoogleOAuthStatePayload {
  returnTo: string;
}

export type IntegrationType = 'ecommerce' | 'supply_chain' | null;

export interface ShippingSettings {
  country: string | null;
  shippingCarrier: string | null;
  websiteUrl: string | null;
  integrationType: IntegrationType;
  platform: string | null;
}

export interface UpdateOrganizationPatch {
  name?: string;
  country?: string | null;
  shippingCarrier?: string | null;
  websiteUrl?: string | null;
  integrationType?: string | null;
  platform?: string | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeString(value: unknown, maxLength: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeIntegrationType(value: unknown): IntegrationType {
  if (value === 'ecommerce' || value === 'supply_chain') return value;
  return null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly organizationRepository: Repository<OrganizationEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    private readonly jwtService: JwtService,
    private readonly creditPurchaseService: CreditPurchaseService,
    private readonly billingChargeService: BillingChargeService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase().trim() },
      relations: ['roles', 'organization'],
    });

    if (user && user.password && (await bcrypt.compare(password, user.password))) {
      user.lastLoginAt = new Date();
      await this.userRepository.save(user);
      return this.toAuthUser(user);
    }

    return null;
  }

  async login(user: { id: string }) {
    const freshUser = await this.findUserById(user.id);
    if (!freshUser || !freshUser.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const payload = {
      sub: freshUser.id,
      email: freshUser.email,
      organizationId: freshUser.organizationId,
      roles: freshUser.roles?.map((r) => r.name) || [],
    };

    return {
      user: this.toAuthUser(freshUser),
      tokens: {
        accessToken: this.jwtService.sign(payload, { expiresIn: '1h' }),
        refreshToken: this.jwtService.sign(payload, { expiresIn: '7d' }), // 1 week
        expiresIn: 3600, // 1 hour in seconds
      },
    };
  }

  async refreshTokens(refreshToken: string) {
    try {
      // Verify the refresh token
      const payload = this.jwtService.verify(refreshToken);

      // Get fresh user data
      const user = await this.findUserById(payload.sub);

      if (!user || !user.isActive) {
        throw new Error('User not found or inactive');
      }

      // Generate new tokens
      const newPayload = {
        sub: user.id,
        email: user.email,
        organizationId: user.organizationId,
        roles: user.roles?.map((r) => r.name) || [],
      };

      return {
        user: this.toAuthUser(user),
        tokens: {
          accessToken: this.jwtService.sign(newPayload, { expiresIn: '1h' }),
          refreshToken: this.jwtService.sign(newPayload, { expiresIn: '7d' }),
          expiresIn: 3600,
        },
      };
    } catch (error) {
      throw new Error('Invalid or expired refresh token');
    }
  }

  async register(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    organizationId: string | null,
    company?: {
      name?: string;
      websiteUrl?: string;
      country?: string;
      shippingCarrier?: string;
      integrationType?: string;
      platform?: string;
    },
  ) {
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await this.userRepository.findOne({
      where: { email: normalizedEmail },
      select: ['id'],
    });
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    // Create or find organization, populating company metadata if provided
    let resolvedOrganizationId: string;
    if (organizationId) {
      resolvedOrganizationId = organizationId;
    } else {
      const org = await this.createOrganizationForNewUser(firstName, normalizedEmail);
      // Apply company metadata to settings JSONB
      if (company) {
        if (company.name) org.name = company.name.trim();
        org.settings = {
          ...(org.settings || {}),
          country: company.country,
          shippingCarrier: company.shippingCarrier,
          integrationType: company.integrationType,
          platform: company.platform,
          websiteUrl: company.websiteUrl,
        };
        await this.organizationRepository.save(org);
      }
      resolvedOrganizationId = org.id;

      // Phase 4: grant signup bonus credits so the merchant has runway on
      // day one. Idempotent — if a balance row already exists (e.g. from a
      // partial earlier register attempt), we leave it alone. Always runs,
      // independent of BILLING_ENABLED, so flipping that flag later doesn't
      // surprise anyone.
      try {
        await this.creditPurchaseService.ensureBalanceRow(
          resolvedOrganizationId,
          this.billingChargeService.signupBonusCredits(),
        );
      } catch {
        // Granting credits must never block registration. If the billing
        // schema is unhealthy, the merchant can still register and we can
        // backfill later.
      }
    }

    const defaultRole = await this.resolveDefaultSignupRole();
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = this.userRepository.create({
      email: normalizedEmail,
      password: hashedPassword,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      organizationId: resolvedOrganizationId,
      emailVerified: false,
      metadata: { authProvider: 'password' },
      roles: defaultRole ? [defaultRole] : [],
    });

    const saved = await this.userRepository.save(user);
    const resolvedUser = await this.findUserById(saved.id);
    if (!resolvedUser) {
      throw new UnauthorizedException('Unable to resolve newly registered user');
    }
    return resolvedUser;
  }

  isGoogleOauthConfigured(): boolean {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }

  buildGoogleOauthState(returnTo?: string): string {
    const payload: GoogleOAuthStatePayload = {
      returnTo: this.sanitizeReturnTo(returnTo),
    };
    return this.jwtService.sign(payload, { expiresIn: '10m' });
  }

  readGoogleOauthState(rawState?: string): GoogleOAuthStatePayload {
    if (!rawState) {
      return { returnTo: '/' };
    }

    try {
      const payload = this.jwtService.verify(rawState) as Partial<GoogleOAuthStatePayload>;
      return {
        returnTo: this.sanitizeReturnTo(payload.returnTo),
      };
    } catch {
      return { returnTo: '/' };
    }
  }

  async validateGoogleUser(profile: GoogleProfile): Promise<{ id: string }> {
    const email = profile.emails?.[0]?.value?.toLowerCase()?.trim();
    if (!email) {
      throw new UnauthorizedException(
        'Google account did not provide an email address',
      );
    }

    let user = await this.userRepository.findOne({
      where: { email },
      relations: ['roles', 'organization'],
    });

    if (!user) {
      const firstName =
        profile.name?.givenName?.trim() ||
        profile.displayName?.split(' ')?.[0] ||
        'Google';
      const lastName =
        profile.name?.familyName?.trim() ||
        profile.displayName?.split(' ')?.slice(1)?.join(' ') ||
        'User';

      const organization = await this.createOrganizationForNewUser(
        firstName,
        email,
      );
      const defaultRole = await this.resolveDefaultSignupRole();
      const placeholderPassword = await bcrypt.hash(randomUUID(), 10);

      const created = this.userRepository.create({
        email,
        password: placeholderPassword,
        firstName,
        lastName,
        organizationId: organization.id,
        emailVerified: true,
        lastLoginAt: new Date(),
        metadata: {
          authProvider: 'google',
          googleId: profile.id,
          googleProfileUrl: profile.profileUrl || null,
        },
        roles: defaultRole ? [defaultRole] : [],
      });

      user = await this.userRepository.save(created);
      user = await this.findUserById(user.id);
      if (!user) {
        throw new UnauthorizedException('Unable to resolve Google user');
      }
    } else {
      user.lastLoginAt = new Date();
      user.emailVerified = user.emailVerified || Boolean(profile.emails?.[0]?.verified);
      user.metadata = {
        ...(user.metadata || {}),
        authProvider: 'google',
        googleId: profile.id,
        googleProfileUrl: profile.profileUrl || null,
      };
      await this.userRepository.save(user);
    }

    return { id: user.id };
  }

  toClientUser(user: UserEntity): Omit<UserEntity, 'password'> & { permissions: string[] } {
    return this.toAuthUser(user);
  }

  /**
   * Return the organization record for an authenticated user, exposing only
   * the fields that are safe to surface (no usage/billing internals).
   *
   * `slug` and `type` are required by the portal frontend to route the user
   * to the right portal tree (/partner-portal vs /business-portal) after
   * login. Both are nullable on the entity but stable to expose.
   */
  async getOrganizationForUser(organizationId: string): Promise<{
    id: string;
    name: string;
    slug: string | null;
    type: 'internal' | 'partner' | 'customer';
    plan: string;
    settings: ShippingSettings;
  } | null> {
    if (!organizationId) return null;
    const org = await this.organizationRepository.findOne({
      where: { id: organizationId },
    });
    if (!org) return null;

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      type: org.type as 'internal' | 'partner' | 'customer',
      plan: org.plan,
      settings: this.pickShippingSettings(org.settings),
    };
  }

  /**
   * Update the subset of organization settings that the customer is allowed
   * to manage from the website (shipping/integration metadata + display name).
   */
  async updateOrganizationForUser(
    organizationId: string,
    patch: UpdateOrganizationPatch,
  ): Promise<{
    id: string;
    name: string;
    slug: string | null;
    type: 'internal' | 'partner' | 'customer';
    plan: string;
    settings: ShippingSettings;
  }> {
    const org = await this.organizationRepository.findOne({
      where: { id: organizationId },
    });
    if (!org) {
      throw new UnauthorizedException('Organization not found');
    }

    if (typeof patch.name === 'string') {
      const trimmed = patch.name.trim();
      if (trimmed) {
        org.name = trimmed.slice(0, 255);
      }
    }

    const existing = this.pickShippingSettings(org.settings);
    const next: ShippingSettings = { ...existing };

    if ('country' in patch) {
      next.country = normalizeString(patch.country, 64);
    }
    if ('shippingCarrier' in patch) {
      next.shippingCarrier = normalizeString(patch.shippingCarrier, 64);
    }
    if ('websiteUrl' in patch) {
      next.websiteUrl = normalizeString(patch.websiteUrl, 512);
    }
    if ('integrationType' in patch) {
      next.integrationType = normalizeIntegrationType(patch.integrationType);
    }
    if ('platform' in patch) {
      next.platform = normalizeString(patch.platform, 64);
    }

    org.settings = {
      ...(org.settings ?? {}),
      country: next.country,
      shippingCarrier: next.shippingCarrier,
      websiteUrl: next.websiteUrl,
      integrationType: next.integrationType,
      platform: next.platform,
    };

    const saved = await this.organizationRepository.save(org);

    return {
      id: saved.id,
      name: saved.name,
      slug: saved.slug,
      type: saved.type as 'internal' | 'partner' | 'customer',
      plan: saved.plan,
      settings: this.pickShippingSettings(saved.settings),
    };
  }

  private pickShippingSettings(
    settings: Record<string, any> | null | undefined,
  ): ShippingSettings {
    const s = settings ?? {};
    return {
      country: stringOrNull(s.country),
      shippingCarrier: stringOrNull(s.shippingCarrier),
      websiteUrl: stringOrNull(s.websiteUrl),
      integrationType: normalizeIntegrationType(s.integrationType),
      platform: stringOrNull(s.platform),
    };
  }

  private async findUserById(id: string): Promise<UserEntity | null> {
    return this.userRepository.findOne({
      where: { id },
      relations: ['roles', 'organization'],
    });
  }

  private toAuthUser(user: UserEntity): Omit<UserEntity, 'password'> & { permissions: string[] } {
    const { password, ...safeUser } = user;
    const permissions = Array.from(
      new Set(
        (user.roles || []).flatMap((role) =>
          Array.isArray(role.permissions) ? role.permissions : [],
        ),
      ),
    );
    return {
      ...safeUser,
      permissions,
    };
  }

  private sanitizeReturnTo(returnTo?: string): string {
    if (!returnTo || typeof returnTo !== 'string') {
      return '/';
    }

    const normalized = returnTo.trim();
    if (!normalized.startsWith('/') || normalized.startsWith('//')) {
      return '/';
    }

    return normalized;
  }

  private async createOrganizationForNewUser(
    firstName: string,
    email: string,
  ): Promise<OrganizationEntity> {
    const organization = this.organizationRepository.create({
      name: this.generateOrganizationName(firstName, email),
      plan: 'FREE',
      isActive: true,
    });
    return this.organizationRepository.save(organization);
  }

  private generateOrganizationName(firstName: string, email: string): string {
    const domainPart = email.split('@')[1]?.split('.')?.[0] || '';
    const personalDomains = new Set([
      'gmail',
      'outlook',
      'hotmail',
      'yahoo',
      'icloud',
      'protonmail',
    ]);

    if (domainPart && !personalDomains.has(domainPart.toLowerCase())) {
      const prettyDomain =
        domainPart.charAt(0).toUpperCase() + domainPart.slice(1).toLowerCase();
      return `${prettyDomain} Organization`;
    }

    return `${firstName || 'New'} Organization`;
  }

  private async resolveDefaultSignupRole(): Promise<RoleEntity | null> {
    const roles = await this.roleRepository.find({
      where: {
        name: In(['Organization Administrator', 'Business User']),
        isActive: true,
      },
      order: { createdAt: 'ASC' },
    });

    return (
      roles.find((role) => role.name === 'Organization Administrator') ||
      roles.find((role) => role.name === 'Business User') ||
      null
    );
  }
}
