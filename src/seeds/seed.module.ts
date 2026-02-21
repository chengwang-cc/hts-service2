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
import {
  HtsExtraTaxEntity,
  HtsSettingEntity,
  HtsTariffHistory2025Entity,
} from '@hts/core';

// Seed services
import { AuthSeedService } from './auth/auth-seed.service';
import { SeedService } from './seed.service';
import { TariffHistory2025SeedService } from './tariff-history';
import { ReciprocalTariffs2026SeedService } from './reciprocal';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      // Auth entities
      OrganizationEntity,
      RoleEntity,
      UserEntity,
      HtsExtraTaxEntity,
      HtsSettingEntity,
      HtsTariffHistory2025Entity,
    ]),
  ],
  providers: [
    AuthSeedService,
    TariffHistory2025SeedService,
    ReciprocalTariffs2026SeedService,
    SeedService,
  ],
  exports: [
    SeedService,
    AuthSeedService,
    TariffHistory2025SeedService,
    ReciprocalTariffs2026SeedService,
  ],
})
export class SeedModule {}
