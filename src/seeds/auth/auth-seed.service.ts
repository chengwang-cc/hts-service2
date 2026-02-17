/**
 * Auth Seed Service
 *
 * Handles seeding of authentication-related entities:
 * - Organizations
 * - Roles
 * - Users (with role assignments)
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationEntity } from '../../modules/auth/entities/organization.entity';
import { RoleEntity } from '../../modules/auth/entities/role.entity';
import { UserEntity } from '../../modules/auth/entities/user.entity';
import { OrganizationSeed } from './organization.seed';
import { RoleSeed } from './role.seed';
import { UserSeed } from './user.seed';

@Injectable()
export class AuthSeedService {
  private readonly logger = new Logger(AuthSeedService.name);

  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  /**
   * Upsert organizations
   */
  async upsertOrganizations(
    data: OrganizationSeed[],
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    for (const item of data) {
      const existing = await this.orgRepo.findOne({
        where: { id: item.id },
      });

      if (existing) {
        // Update existing
        await this.orgRepo.update(item.id, {
          name: item.name,
          plan: item.plan,
          isActive: item.isActive,
          settings: item.settings || null,
          usageQuotas: item.usageQuotas || null,
          currentUsage: item.currentUsage || null,
        });
        updated++;
      } else {
        // Create new
        const org = this.orgRepo.create({
          id: item.id,
          name: item.name,
          plan: item.plan,
          isActive: item.isActive,
          settings: item.settings || null,
          usageQuotas: item.usageQuotas || null,
          currentUsage: item.currentUsage || null,
        });
        await this.orgRepo.save(org);
        created++;
      }
    }

    this.logger.log(
      `Upserted ${data.length} organizations: ${created} created, ${updated} updated`,
    );
    return { created, updated };
  }

  /**
   * Upsert roles
   */
  async upsertRoles(
    data: RoleSeed[],
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    for (const item of data) {
      const existing = await this.roleRepo.findOne({
        where: { id: item.id },
      });

      if (existing) {
        // Update existing
        await this.roleRepo.update(item.id, {
          name: item.name,
          description: item.description,
          permissions: item.permissions,
          isActive: item.isActive,
        });
        updated++;
      } else {
        // Create new
        const role = this.roleRepo.create({
          id: item.id,
          name: item.name,
          description: item.description,
          permissions: item.permissions,
          isActive: item.isActive,
        });
        await this.roleRepo.save(role);
        created++;
      }
    }

    this.logger.log(
      `Upserted ${data.length} roles: ${created} created, ${updated} updated`,
    );
    return { created, updated };
  }

  /**
   * Upsert users with role assignments
   */
  async upsertUsers(
    data: UserSeed[],
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    for (const item of data) {
      const existing = await this.userRepo.findOne({
        where: { id: item.id },
        relations: ['roles'],
      });

      // Get roles
      const roles = await this.roleRepo.findByIds(item.roleIds);

      if (existing) {
        // Update existing
        await this.userRepo.update(item.id, {
          email: item.email,
          password: item.password,
          firstName: item.firstName,
          lastName: item.lastName,
          organizationId: item.organizationId,
          isActive: item.isActive,
          emailVerified: item.emailVerified,
        });

        // Update role mapping without re-saving stale user fields.
        await this.userRepo
          .createQueryBuilder()
          .relation(UserEntity, 'roles')
          .of(item.id)
          .addAndRemove(
            roles.map((role) => role.id),
            (existing.roles || []).map((role) => role.id),
          );
        updated++;
      } else {
        // Create new
        const user = this.userRepo.create({
          id: item.id,
          email: item.email,
          password: item.password,
          firstName: item.firstName,
          lastName: item.lastName,
          organizationId: item.organizationId,
          isActive: item.isActive,
          emailVerified: item.emailVerified,
          roles: roles,
        });
        await this.userRepo.save(user);
        created++;
      }
    }

    this.logger.log(
      `Upserted ${data.length} users: ${created} created, ${updated} updated`,
    );
    return { created, updated };
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    organizations: number;
    roles: number;
    users: number;
  }> {
    const [organizations, roles, users] = await Promise.all([
      this.orgRepo.count(),
      this.roleRepo.count(),
      this.userRepo.count(),
    ]);

    return { organizations, roles, users };
  }
}
