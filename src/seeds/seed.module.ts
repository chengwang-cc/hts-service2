/**
 * Seed Module for HTS Service
 *
 * Provides seed data functionality for authentication and core entities
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// Auth entities
import { OrganizationEntity } from '../modules/auth/entities/organization.entity';
import { RoleEntity } from '../modules/auth/entities/role.entity';
import { UserEntity } from '../modules/auth/entities/user.entity';

// Seed services
import { AuthSeedService } from './auth/auth-seed.service';
import { SeedService } from './seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      // Auth entities
      OrganizationEntity,
      RoleEntity,
      UserEntity,
    ]),
  ],
  providers: [
    AuthSeedService,
    SeedService,
  ],
  exports: [
    SeedService,
    AuthSeedService,
  ],
})
export class SeedModule {}
