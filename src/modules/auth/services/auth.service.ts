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

interface GoogleOAuthStatePayload {
  returnTo: string;
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
  ) {
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await this.userRepository.findOne({
      where: { email: normalizedEmail },
      select: ['id'],
    });
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const resolvedOrganizationId =
      organizationId || (await this.createOrganizationForNewUser(firstName, normalizedEmail)).id;
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
