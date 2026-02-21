/**
 * Main Seed Service
 *
 * Orchestrates all seed operations for HTS Service
 * Usage: npm run db:seed -- [Entity]
 * Example: npm run db:seed -- Organizations
 *          npm run db:seed -- All
 */

import { Injectable, Logger } from '@nestjs/common';
import { AuthSeedService } from './auth/auth-seed.service';
import { organizationSeed, roleSeed, userSeed } from './auth';
import { TariffHistory2025SeedService } from './tariff-history';
import { ReciprocalTariffs2026SeedService } from './reciprocal';

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly authSeedService: AuthSeedService,
    private readonly tariffHistory2025SeedService: TariffHistory2025SeedService,
    private readonly reciprocalTariffs2026SeedService: ReciprocalTariffs2026SeedService,
  ) {}

  /**
   * List of all seed operations for documentation
   */
  private readonly seedOperations = [
    { entityName: 'Organizations', group: 'auth' },
    { entityName: 'Roles', group: 'auth' },
    { entityName: 'Users', group: 'auth' },
    { entityName: 'Auth', group: 'auth', description: 'Seeds all auth entities (orgs, roles, users)' },
    {
      entityName: 'TariffHistory2025',
      group: 'tariff',
      description: 'One-time load of tariff_database_2025.txt for 2026 math reference',
    },
    {
      entityName: 'ReciprocalTariffs2026',
      group: 'tariff',
      description: 'One-time load of reciprocal baseline/exception + country framework rows into hts_extra_taxes',
    },
  ];

  /**
   * Main entry point - seeds specific entity or all
   */
  async upsertSeedData(entity?: string): Promise<void> {
    if (!entity) {
      this.printUsage();
      return;
    }

    const normalizedEntity = entity.toUpperCase();

    // Handle individual entity seeds
    if (normalizedEntity === 'ORGANIZATIONS' || normalizedEntity === 'ORGS') {
      await this.seedOrganizations();
      return;
    }

    if (normalizedEntity === 'ROLES') {
      await this.seedRoles();
      return;
    }

    if (normalizedEntity === 'USERS') {
      await this.seedUsers();
      return;
    }

    if (normalizedEntity === 'AUTH') {
      await this.seedAuth();
      return;
    }

    if (
      normalizedEntity === 'TARIFFHISTORY2025' ||
      normalizedEntity === 'TARIFF2025'
    ) {
      await this.seedTariffHistory2025();
      return;
    }

    if (
      normalizedEntity === 'RECIPROCALTARIFFS2026' ||
      normalizedEntity === 'RECIPROCAL2026' ||
      normalizedEntity === 'RECIPROCALTARIFFS'
    ) {
      await this.seedReciprocalTariffs2026();
      return;
    }

    if (normalizedEntity === 'ALL') {
      await this.seedAll();
      return;
    }

    // Entity not found
    this.logger.error(`Unknown entity: ${entity}`);
    this.printUsage();
  }

  /**
   * Seed all entities
   */
  private async seedAll(): Promise<void> {
    this.logger.log('🌱 Starting full database seed...\n');

    const startTime = Date.now();

    // Seed in dependency order
    await this.seedAuth();
    await this.seedTariffHistory2025();
    await this.seedReciprocalTariffs2026();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    this.logger.log(`\n✅ All seeds completed in ${duration}s`);

    // Print statistics
    await this.printStats();
  }

  /**
   * Seed all auth entities (organizations, roles, users)
   */
  private async seedAuth(): Promise<void> {
    this.logger.log('📦 Seeding authentication data...\n');
    await this.seedOrganizations();
    await this.seedRoles();
    await this.seedUsers();
  }

  /**
   * One-time 2025 tariff history load for 2026 calculations.
   */
  private async seedTariffHistory2025(): Promise<void> {
    this.logger.log('Seeding 2025 tariff history data...');

    const result = await this.tariffHistory2025SeedService.upsertTariffHistory2025();

    if (result.skipped) {
      this.logger.log(`✅ Tariff history seed skipped: ${result.reason}\n`);
      return;
    }

    this.logger.log(
      `✅ Tariff history seed complete: ${result.processed} rows loaded from ${result.filePath}\n`,
    );
  }

  private async seedReciprocalTariffs2026(): Promise<void> {
    this.logger.log('Seeding reciprocal tariff policy data (2026)...');

    const result = await this.reciprocalTariffs2026SeedService.upsertReciprocalTariffs2026();

    if (result.skipped) {
      this.logger.log(`✅ Reciprocal tariff seed skipped: ${result.reason}\n`);
      return;
    }

    this.logger.log(`✅ Reciprocal tariff seed complete: ${result.processed} rows upserted\n`);
  }

  /**
   * Seed organizations
   */
  private async seedOrganizations(): Promise<void> {
    this.logger.log('Seeding organizations...');
    this.logger.log(`Total organizations to seed: ${organizationSeed.length}`);

    const result =
      await this.authSeedService.upsertOrganizations(organizationSeed);

    this.logger.log(
      `✅ Organizations seed complete: ${result.created} created, ${result.updated} updated\n`,
    );
  }

  /**
   * Seed roles
   */
  private async seedRoles(): Promise<void> {
    this.logger.log('Seeding roles...');
    this.logger.log(`Total roles to seed: ${roleSeed.length}`);

    const result = await this.authSeedService.upsertRoles(roleSeed);

    this.logger.log(
      `✅ Roles seed complete: ${result.created} created, ${result.updated} updated\n`,
    );
  }

  /**
   * Seed users
   */
  private async seedUsers(): Promise<void> {
    this.logger.log('Seeding users...');
    this.logger.log(`Total users to seed: ${userSeed.length}`);

    const result = await this.authSeedService.upsertUsers(userSeed);

    this.logger.log(
      `✅ Users seed complete: ${result.created} created, ${result.updated} updated\n`,
    );
  }

  /**
   * Print database statistics
   */
  private async printStats(): Promise<void> {
    this.logger.log('\n📊 Database Statistics:');
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const stats = await this.authSeedService.getStats();

    this.logger.log(`Organizations: ${stats.organizations}`);
    this.logger.log(`Roles:         ${stats.roles}`);
    this.logger.log(`Users:         ${stats.users}`);
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  /**
   * Print usage instructions
   */
  private printUsage(): void {
    console.log('\n📖 HTS Service Seed Usage:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\nSeed specific entities:');
    console.log('  npm run db:seed -- Organizations   (seeds organizations)');
    console.log('  npm run db:seed -- Roles           (seeds roles)');
    console.log('  npm run db:seed -- Users           (seeds users with role assignments)');
    console.log('  npm run db:seed -- Auth            (seeds all auth entities)');
    console.log('  npm run db:seed -- TariffHistory2025 (one-time 2025 tariff history load)');
    console.log('  npm run db:seed -- ReciprocalTariffs2026 (one-time reciprocal tariff baseline seed)');
    console.log('\nSeed everything:');
    console.log('  npm run db:seed -- All             (seeds all entities)');
    console.log('\nNotes:');
    console.log('  - Entity names are case-insensitive');
    console.log('  - All operations are idempotent (safe to run multiple times)');
    console.log('  - Existing records are updated, new records are created');
    console.log('  - For TariffHistory2025, set TARIFF_DATABASE_2025_FILE if file is not in default paths');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Available entities:');
    this.seedOperations.forEach((op) => {
      const desc = op.description ? ` - ${op.description}` : '';
      console.log(`  • ${op.entityName} (${op.group})${desc}`);
    });
    console.log('');
  }
}
