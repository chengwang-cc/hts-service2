import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { RequestContext } from '../../auth/interfaces/request-context.interface';
import {
  EncryptedSecret,
  EncryptedSecretService,
} from '../../security/encrypted-secret.service';
import {
  AdminListBrokerProfilesDto,
  CreateBrokerCredentialDto,
  SearchMarketplaceBrokersDto,
  UpsertBrokerProfileDto,
  VerifyBrokerProfileDto,
} from '../dto/marketplace.dto';
import {
  MarketplaceBrokerCredentialEntity,
  MarketplaceBrokerProfileEntity,
} from '../entities';

@Injectable()
export class MarketplaceService {
  constructor(
    @InjectRepository(MarketplaceBrokerProfileEntity)
    private readonly profiles: Repository<MarketplaceBrokerProfileEntity>,
    @InjectRepository(MarketplaceBrokerCredentialEntity)
    private readonly credentials: Repository<MarketplaceBrokerCredentialEntity>,
    private readonly encryptedSecrets: EncryptedSecretService,
    private readonly audit: AuditService,
  ) {}

  async searchPublic(dto: SearchMarketplaceBrokersDto) {
    const limit = dto.limit ?? 20;
    const offset = dto.offset ?? 0;
    const qb = this.profiles
      .createQueryBuilder('profile')
      .where('profile.status = :status', { status: 'published' })
      .andWhere('profile.verificationStatus = :verificationStatus', {
        verificationStatus: 'verified',
      });

    this.applySearchFilters(qb, dto);

    qb.orderBy('profile.publishedAt', 'DESC')
      .addOrderBy('profile.companyName', 'ASC')
      .take(limit)
      .skip(offset);

    const [rows, total] = await qb.getManyAndCount();
    return {
      rows: rows.map((row) => this.toPublicProfile(row)),
      total,
      limit,
      offset,
    };
  }

  async getPublicProfile(slug: string) {
    const profile = await this.profiles.findOne({
      where: {
        slug,
        status: 'published',
        verificationStatus: 'verified',
      },
    });

    if (!profile) {
      throw new NotFoundException('Broker profile not found');
    }

    return this.toPublicProfile(profile);
  }

  async getMyProfile(ctx: RequestContext) {
    this.assertAuthenticated(ctx);
    const profile = await this.profiles.findOne({
      where: { organizationId: ctx.organizationId },
      relations: { credentials: true },
    });

    return profile ? this.toPrivateProfile(profile) : null;
  }

  async upsertMyProfile(ctx: RequestContext, dto: UpsertBrokerProfileDto) {
    this.assertAuthenticated(ctx);

    const existing = await this.profiles.findOne({
      where: { organizationId: ctx.organizationId },
    });
    const now = new Date();
    const requestedStatus = dto.status ?? existing?.status ?? 'draft';

    if (requestedStatus === 'published' && !this.isPublishable(dto, existing)) {
      throw new BadRequestException(
        'Company name, description, contact email, countries, and service categories are required before publishing',
      );
    }

    const profile = this.profiles.create({
      ...(existing ?? {}),
      organizationId: ctx.organizationId,
      ownerUserId: existing?.ownerUserId ?? ctx.userId,
      companyName: dto.companyName,
      slug: existing?.slug ?? (await this.createUniqueSlug(dto.companyName)),
      tagline: dto.tagline ?? null,
      description: dto.description ?? null,
      status: requestedStatus,
      countries: this.normalizeList(dto.countries),
      ports: this.normalizeList(dto.ports),
      serviceCategories: this.normalizeList(dto.serviceCategories),
      shipmentModes: this.normalizeList(dto.shipmentModes),
      languages: this.normalizeList(dto.languages),
      specialties: this.normalizeList(dto.specialties),
      complianceBadges: this.normalizeList(dto.complianceBadges),
      aiCapabilities: dto.aiCapabilities ?? null,
      metrics: dto.metrics ?? null,
      websiteUrl: dto.websiteUrl ?? null,
      contactEmailEnc: this.encryptString(dto.contactEmail ?? null),
      contactPhoneEnc: this.encryptString(dto.contactPhone ?? null),
      officeAddressEnc: this.encryptJson(dto.officeAddress ?? null),
      minimumEngagement: dto.minimumEngagement ?? null,
      searchKeywords: this.buildSearchKeywords(dto),
      publishedAt:
        requestedStatus === 'published'
          ? (existing?.publishedAt ?? now)
          : (existing?.publishedAt ?? null),
    });

    const saved = await this.profiles.save(profile);
    await this.audit.record({
      eventType: existing
        ? 'marketplace.broker_profile.updated'
        : 'marketplace.broker_profile.created',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_broker_profile',
      resourceId: saved.id,
      source: 'marketplace',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { status: saved.status },
    });

    return this.toPrivateProfile(saved);
  }

  async submitForVerification(ctx: RequestContext) {
    this.assertAuthenticated(ctx);
    const profile = await this.requireOwnedProfile(ctx);
    profile.verificationStatus = 'pending';
    profile.submittedForVerificationAt = new Date();
    profile.moderationNote = null;
    const saved = await this.profiles.save(profile);

    await this.audit.record({
      eventType: 'marketplace.broker_profile.verification_submitted',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_broker_profile',
      resourceId: saved.id,
      source: 'marketplace',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.toPrivateProfile(saved);
  }

  async addCredential(ctx: RequestContext, dto: CreateBrokerCredentialDto) {
    this.assertAuthenticated(ctx);
    const profile = await this.requireOwnedProfile(ctx);
    const identifier = dto.identifier?.trim() || null;

    const credential = this.credentials.create({
      brokerProfileId: profile.id,
      organizationId: ctx.organizationId,
      credentialType: dto.credentialType.trim(),
      label: dto.label.trim(),
      issuingAuthority: dto.issuingAuthority?.trim() || null,
      identifierLast4: identifier ? identifier.slice(-4) : null,
      encryptedValue: dto.secretValue
        ? this.encryptedSecrets.encrypt(dto.secretValue)
        : null,
      expiresAt: dto.expiresAt ?? null,
      verificationStatus: 'pending',
      metadata: dto.metadata ?? null,
    });

    const saved = await this.credentials.save(credential);
    await this.audit.record({
      eventType: 'marketplace.broker_credential.created',
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_broker_credential',
      resourceId: saved.id,
      source: 'marketplace',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { credentialType: saved.credentialType },
    });

    return this.toCredentialResponse(saved);
  }

  async listAdmin(dto: AdminListBrokerProfilesDto) {
    const limit = dto.limit ?? 25;
    const offset = dto.offset ?? 0;
    const qb = this.profiles.createQueryBuilder('profile');

    if (dto.status) {
      qb.andWhere('profile.status = :status', { status: dto.status });
    }
    if (dto.verificationStatus) {
      qb.andWhere('profile.verificationStatus = :verificationStatus', {
        verificationStatus: dto.verificationStatus,
      });
    }

    this.applySearchFilters(qb, dto);
    qb.orderBy('profile.updatedAt', 'DESC').take(limit).skip(offset);

    const [rows, total] = await qb.getManyAndCount();
    return {
      rows: rows.map((row) => this.toAdminProfile(row)),
      total,
      limit,
      offset,
    };
  }

  async adminReview(
    id: string,
    dto: VerifyBrokerProfileDto,
    ctx: RequestContext,
  ) {
    const profile = await this.profiles.findOne({ where: { id } });
    if (!profile) {
      throw new NotFoundException('Broker profile not found');
    }

    if (dto.status === 'suspended') {
      profile.status = 'suspended';
      profile.suspendedAt = new Date();
      profile.moderationNote = dto.note ?? null;
    } else {
      profile.verificationStatus = dto.status;
      profile.verifiedAt = dto.status === 'verified' ? new Date() : null;
      profile.verifiedByUserId = dto.status === 'verified' ? ctx.userId : null;
      profile.moderationNote = dto.note ?? null;
    }

    const saved = await this.profiles.save(profile);
    await this.audit.record({
      eventType: 'marketplace.broker_profile.reviewed',
      organizationId: saved.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_broker_profile',
      resourceId: saved.id,
      source: 'admin',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { reviewStatus: dto.status, note: dto.note ?? null },
    });

    return this.toAdminProfile(saved);
  }

  /**
   * Admin-controlled toggle for the public contact exposure level on a
   * broker profile. Every change is audited (reason is required so the
   * audit trail explains the operator decision).
   */
  async setContactExposure(
    id: string,
    input: {
      exposure: 'platform_only' | 'email_only' | 'phone_only' | 'full';
      reason: string;
    },
    ctx: RequestContext,
  ) {
    const profile = await this.profiles.findOne({ where: { id } });
    if (!profile) {
      throw new NotFoundException('Broker profile not found');
    }
    const previousExposure = profile.publicContactExposure;
    profile.publicContactExposure = input.exposure;
    const saved = await this.profiles.save(profile);
    await this.audit.record({
      eventType: 'marketplace_profile.contact_exposure_set',
      organizationId: saved.organizationId,
      actorUserId: ctx.userId,
      resourceType: 'marketplace_broker_profile',
      resourceId: saved.id,
      source: 'admin',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        previousExposure,
        exposure: input.exposure,
        reason: input.reason,
      },
    });
    return this.toAdminProfile(saved);
  }

  private applySearchFilters(
    qb: ReturnType<
      Repository<MarketplaceBrokerProfileEntity>['createQueryBuilder']
    >,
    dto: SearchMarketplaceBrokersDto,
  ) {
    if (dto.q?.trim()) {
      qb.andWhere(
        '(profile.companyName ILIKE :q OR profile.tagline ILIKE :q OR profile.searchKeywords ILIKE :q)',
        { q: `%${dto.q.trim()}%` },
      );
    }

    if (dto.country?.trim()) {
      qb.andWhere('profile.countries @> :countryFilter', {
        countryFilter: JSON.stringify([dto.country.trim().toUpperCase()]),
      });
    }

    if (dto.service?.trim()) {
      qb.andWhere('profile.serviceCategories @> :serviceFilter', {
        serviceFilter: JSON.stringify([dto.service.trim()]),
      });
    }
  }

  private async requireOwnedProfile(ctx: RequestContext) {
    const profile = await this.profiles.findOne({
      where: { organizationId: ctx.organizationId },
    });

    if (!profile) {
      throw new NotFoundException('Broker profile not found');
    }

    if (profile.ownerUserId !== ctx.userId) {
      throw new ForbiddenException('Broker profile owner access required');
    }

    return profile;
  }

  private assertAuthenticated(ctx: RequestContext) {
    if (!ctx.userId || !ctx.organizationId) {
      throw new ForbiddenException('Authenticated user context is required');
    }
  }

  private isPublishable(
    dto: UpsertBrokerProfileDto,
    existing?: MarketplaceBrokerProfileEntity | null,
  ): boolean {
    const companyName = dto.companyName || existing?.companyName;
    const description = dto.description || existing?.description;
    const contactEmail =
      dto.contactEmail || this.decryptString(existing?.contactEmailEnc ?? null);
    const countries = dto.countries ?? existing?.countries ?? [];
    const serviceCategories =
      dto.serviceCategories ?? existing?.serviceCategories ?? [];

    return Boolean(
      companyName &&
      description &&
      contactEmail &&
      countries.length > 0 &&
      serviceCategories.length > 0,
    );
  }

  private async createUniqueSlug(companyName: string): Promise<string> {
    const base = this.slugify(companyName);
    let candidate = base;
    let suffix = 2;

    while (await this.profiles.exist({ where: { slug: candidate } })) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  private slugify(value: string): string {
    const slug = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 150);

    return slug || `broker-${Date.now()}`;
  }

  private normalizeList(values?: string[]): string[] {
    return Array.from(
      new Set(
        (values ?? [])
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    );
  }

  private buildSearchKeywords(dto: UpsertBrokerProfileDto): string {
    return [
      dto.companyName,
      dto.tagline,
      dto.description,
      ...(dto.countries ?? []),
      ...(dto.ports ?? []),
      ...(dto.serviceCategories ?? []),
      ...(dto.shipmentModes ?? []),
      ...(dto.languages ?? []),
      ...(dto.specialties ?? []),
      ...(dto.complianceBadges ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 8000);
  }

  private toPublicProfile(profile: MarketplaceBrokerProfileEntity) {
    const exposure = profile.publicContactExposure ?? 'platform_only';
    const exposeEmail = exposure === 'email_only' || exposure === 'full';
    const exposePhone = exposure === 'phone_only' || exposure === 'full';
    const exposeAddress = exposure === 'full';
    const contactEmail = this.decryptString(profile.contactEmailEnc);
    const contactPhone = this.decryptString(profile.contactPhoneEnc);
    const officeAddress = this.decryptJson<NonNullable<UpsertBrokerProfileDto['officeAddress']>>(
      profile.officeAddressEnc,
    );
    return {
      id: profile.id,
      companyName: profile.companyName,
      slug: profile.slug,
      tagline: profile.tagline,
      description: profile.description,
      verificationStatus: profile.verificationStatus,
      countries: profile.countries,
      ports: profile.ports,
      serviceCategories: profile.serviceCategories,
      shipmentModes: profile.shipmentModes,
      languages: profile.languages,
      specialties: profile.specialties,
      complianceBadges: profile.complianceBadges,
      aiCapabilities: profile.aiCapabilities,
      metrics: profile.metrics,
      websiteUrl: profile.websiteUrl,
      contactCta: {
        mode: 'platform_lead',
        label: 'Contact through marketplace',
        brokerProfileId: profile.id,
      },
      publicContactEnabled: exposure !== 'platform_only',
      publicContactExposure: exposure,
      publicContactEmail: exposeEmail ? contactEmail : null,
      publicContactPhone: exposePhone ? contactPhone : null,
      publicOfficeAddress: exposeAddress ? officeAddress : null,
      minimumEngagement: profile.minimumEngagement,
      publishedAt: profile.publishedAt,
    };
  }

  private toPrivateProfile(profile: MarketplaceBrokerProfileEntity) {
    return {
      ...this.toPublicProfile(profile),
      contactEmail: this.decryptString(profile.contactEmailEnc),
      contactPhone: this.decryptString(profile.contactPhoneEnc),
      officeAddress: this.decryptJson<NonNullable<UpsertBrokerProfileDto['officeAddress']>>(
        profile.officeAddressEnc,
      ),
      status: profile.status,
      submittedForVerificationAt: profile.submittedForVerificationAt,
      verifiedAt: profile.verifiedAt,
      moderationNote: profile.moderationNote,
      credentials: profile.credentials?.map((credential) =>
        this.toCredentialResponse(credential),
      ),
    };
  }

  private toAdminProfile(profile: MarketplaceBrokerProfileEntity) {
    return {
      ...this.toPrivateProfile(profile),
      organizationId: profile.organizationId,
      ownerUserId: profile.ownerUserId,
      verifiedByUserId: profile.verifiedByUserId,
      suspendedAt: profile.suspendedAt,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  /**
   * Encrypt a plaintext contact value for at-rest storage. Returns null
   * (no envelope written) for null/empty inputs so the column stays
   * NULL — keeps the publishable-check distinction between "absent" and
   * "set to empty string" intact.
   */
  private encryptString(value: string | null | undefined): EncryptedSecret | null {
    if (value === null || value === undefined || value === '') return null;
    return this.encryptedSecrets.encrypt(value);
  }

  private decryptString(secret: EncryptedSecret | null | undefined): string | null {
    if (!secret) return null;
    return this.encryptedSecrets.decrypt(secret);
  }

  private encryptJson(value: unknown): EncryptedSecret | null {
    if (value === null || value === undefined) return null;
    return this.encryptedSecrets.encrypt(JSON.stringify(value));
  }

  private decryptJson<T>(secret: EncryptedSecret | null | undefined): T | null {
    if (!secret) return null;
    return JSON.parse(this.encryptedSecrets.decrypt(secret)) as T;
  }

  private toCredentialResponse(credential: MarketplaceBrokerCredentialEntity) {
    return {
      id: credential.id,
      credentialType: credential.credentialType,
      label: credential.label,
      issuingAuthority: credential.issuingAuthority,
      identifierLast4: credential.identifierLast4,
      verificationStatus: credential.verificationStatus,
      expiresAt: credential.expiresAt,
      metadata: credential.metadata,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      hasSecret: Boolean(credential.encryptedValue),
    };
  }
}
