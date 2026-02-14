# Seed Data Guide - HTS Service

This guide explains how to add new seed data to the HTS Service. Follow these patterns to ensure consistency and proper integration.

## Directory Structure

```
src/seeds/
├── SEED_GUIDE.md              # This guide
├── seed.module.ts             # NestJS module registering all entities and services
├── seed.service.ts            # Main orchestrator for all seed operations
├── seed.cli.ts                # CLI entry point for running seeds
├── index.ts                   # Root exports
│
└── auth/                      # Authentication-related seeds
    ├── index.ts
    ├── organization.seed.ts   # Organization seed data
    ├── role.seed.ts           # Role seed data
    ├── user.seed.ts           # User seed data
    └── auth-seed.service.ts   # Service for auth entity seeding
```

## Adding New Seed Data - Step by Step

### Step 1: Create the Seed Data File

Create `[entity-name].seed.ts` in the appropriate directory (create new directory if needed).

```typescript
/**
 * [Entity Name] Seed Data
 *
 * Description of what this seed data contains
 */

// Define interface for type safety
export interface MyEntitySeed {
  id: string;
  name: string;
  // ... other fields matching entity columns
}

// Pre-generated UUIDs for consistent seeding (idempotent)
// IMPORTANT: UUIDs must be valid hexadecimal (0-9, a-f only)
const ENTITY_IDS = {
  ITEM_ONE: '40000000-0001-0001-0001-000000000001',
  ITEM_TWO: '40000000-0001-0001-0001-000000000002',
};

// Export the seed data array
export const myEntitySeed: MyEntitySeed[] = [
  {
    id: ENTITY_IDS.ITEM_ONE,
    name: 'Item One',
    // ...
  },
  {
    id: ENTITY_IDS.ITEM_TWO,
    name: 'Item Two',
    // ...
  },
];

export { ENTITY_IDS };
```

### Step 2: Create the Seed Service

Create `[entity-name]-seed.service.ts` (or add methods to existing service if related).

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MyEntity } from '../../modules/[module]/entities/my-entity.entity';
import { MyEntitySeed } from './my-entity.seed';

@Injectable()
export class MyEntitySeedService {
  private readonly logger = new Logger(MyEntitySeedService.name);

  constructor(
    @InjectRepository(MyEntity)
    private readonly myEntityRepo: Repository<MyEntity>,
  ) {}

  /**
   * Upsert seed data - creates new records or updates existing ones
   */
  async upsertMyEntities(
    data: MyEntitySeed[],
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    for (const item of data) {
      const existing = await this.myEntityRepo.findOne({
        where: { id: item.id },
      });

      if (existing) {
        // Update existing record
        await this.myEntityRepo.update(item.id, {
          name: item.name,
          // ... map other fields
        });
        updated++;
      } else {
        // Create new record
        const entity = this.myEntityRepo.create({
          id: item.id,
          name: item.name,
          // ... map other fields
        });
        await this.myEntityRepo.save(entity);
        created++;
      }
    }

    this.logger.log(
      `Upserted ${data.length} entities: ${created} created, ${updated} updated`,
    );
    return { created, updated };
  }

  /**
   * Get statistics about seeded data
   */
  async getStats(): Promise<{ total: number }> {
    const total = await this.myEntityRepo.count();
    return { total };
  }
}
```

### Step 3: Update the Directory's index.ts

Export your new files from the directory's `index.ts`:

```typescript
// In src/seeds/[category]/index.ts
export * from './my-entity.seed';
export * from './my-entity-seed.service';
```

### Step 4: Register in seed.module.ts

Add entity and service to the module:

```typescript
// Import entity
import { MyEntity } from '../modules/[module]/entities/my-entity.entity';

// Import seed service
import { MyEntitySeedService } from './[category]/my-entity-seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      // ... existing entities
      MyEntity,  // Add your entity
    ]),
  ],
  providers: [
    // ... existing services
    MyEntitySeedService,  // Add your service
  ],
  exports: [
    // ... existing exports
    MyEntitySeedService,  // Export if needed elsewhere
  ],
})
export class SeedModule {}
```

### Step 5: Integrate into seed.service.ts

Update the main seed service:

```typescript
// 1. Import seed data and service
import { myEntitySeed } from './[category]';
import { MyEntitySeedService } from './[category]/my-entity-seed.service';

@Injectable()
export class SeedService {
  constructor(
    // 2. Inject the service
    private readonly myEntitySeedService: MyEntitySeedService,
    // ... other services
  ) {}

  // 3. Add to seedOperations list for documentation
  private readonly seedOperations = [
    // ... existing
    { entityName: 'MyEntity', group: 'mygroup' },
  ];

  // 4. Add command handler in upsertSeedData()
  async upsertSeedData(entity?: string): Promise<void> {
    const normalizedEntity = entity.toUpperCase();

    // Add handler for your entity
    if (normalizedEntity === 'MYENTITY' || normalizedEntity === 'MYENTITIES') {
      await this.seedMyEntities();
      return;
    }

    // ... rest of handlers
  }

  // 5. Create the seed method
  private async seedMyEntities(): Promise<void> {
    this.logger.log('Seeding my entities...');
    this.logger.log(`Total items to seed: ${myEntitySeed.length}`);

    const result = await this.myEntitySeedService.upsertMyEntities(myEntitySeed);

    this.logger.log(
      `✅ My entity seed complete: ${result.created} created, ${result.updated} updated\n`,
    );
  }

  // 6. Add to seedAll() if it should run with "All" command
  private async seedAll(): Promise<void> {
    // ... existing seeds
    await this.seedMyEntities();
    // ...
  }

  // 7. Update printUsage() documentation
  private printUsage(): void {
    console.log('  npm run db:seed -- MyEntity     (seeds my entity data)');
  }

  // 8. Update printStats() if needed
  private async printStats(): Promise<void> {
    const stats = await this.myEntitySeedService.getStats();
    this.logger.log(`My Entities: ${stats.total}`);
  }
}
```

## UUID Generation Rules

**CRITICAL**: PostgreSQL UUID columns require valid UUIDs with hexadecimal characters only (0-9, a-f).

### Valid UUID Format
```
xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```
Each `x` must be a hexadecimal digit (0-9, a-f).

### UUID Prefix Convention

Use the first segment to indicate entity type:

```typescript
const PREFIXES = {
  ORGANIZATION: '10000000',
  ROLE: '20000000',
  USER: '30000000',
  // Add new prefixes as needed
  MY_ENTITY: '40000000',
};
```

### Good Examples
```typescript
const VALID_IDS = {
  ITEM_A: '40000000-0001-0001-0001-000000000001',
  ITEM_B: '40000000-0001-0001-0001-000000000002',
  ITEM_C: 'abcdef00-1234-5678-9abc-def012345678',
};
```

### Bad Examples (WILL FAIL)
```typescript
const INVALID_IDS = {
  // ❌ Contains 'opt' which has non-hex characters
  BAD_1: '40000000-opt1-0000-0000-000000000000',

  // ❌ Contains 'g' which is not hex
  BAD_2: '40000000-000g-0000-0000-000000000000',

  // ❌ Wrong segment lengths
  BAD_3: '4000000-0001-0001-0001-000000000001',
};
```

## Best Practices

### 1. Idempotent Operations
Always use upsert (update or insert) pattern so seeds can be run multiple times safely.

### 2. Deterministic IDs
Use pre-generated UUIDs instead of random ones. This ensures:
- Consistent foreign key relationships
- Repeatable seeding
- Predictable test data

### 3. Dependency Order
Seed entities in order of dependencies:
1. Independent entities first (organizations, roles)
2. Parent entities (users depend on organizations and roles)
3. Child entities (entities that reference users)

### 4. Logging
Always log:
- What you're seeding
- How many items
- Results (created/updated counts)

### 5. Error Handling
Handle errors gracefully and provide meaningful error messages.

## Running Seeds

```bash
# Seed specific entity
npm run db:seed -- Organizations
npm run db:seed -- Roles
npm run db:seed -- Users

# Seed all auth entities
npm run db:seed -- Auth

# Seed all entities
npm run db:seed -- All

# View available commands
npm run db:seed
```

## Pre-seeded Data

### Default Users

| Email | Password | Role | Organization |
|-------|----------|------|--------------|
| admin@hts.com | password123 | Platform Administrator | HTS Platform Admin |
| john@acmecorp.com | password123 | Organization Administrator | Acme Corporation |
| jane@acmecorp.com | password123 | Business User | Acme Corporation |
| admin@globaltrade.com | password123 | Organization Administrator | Global Trade Inc |

### Default Organizations

1. **HTS Platform Admin** - System organization for platform admins
2. **Acme Corporation** - Test business organization (Professional plan)
3. **Global Trade Inc** - Test business organization (Enterprise plan)

### Default Roles

1. **Platform Administrator** - Full system access
2. **Organization Administrator** - Organization management + business features
3. **Business User** - Classification and calculation only
4. **Viewer** - Read-only access

## Troubleshooting

### "invalid input syntax for type uuid"
Your UUID contains non-hexadecimal characters. Check for letters g-z or special characters.

### "violates foreign key constraint"
Seed parent entities before children. Check the `seedAll()` order in seed.service.ts.

### "duplicate key value violates unique constraint"
Your seed data has duplicate IDs. Ensure all IDs are unique across the seed file.

### Entity not found in TypeORM
Make sure the entity is:
1. Imported in `seed.module.ts`
2. Added to `TypeOrmModule.forFeature([...])`

### Password hash issues
Make sure you're using bcrypt to generate password hashes:
```javascript
const bcrypt = require('bcryptjs');
const hash = await bcrypt.hash('password123', 10);
```

## Security Notes

- ⚠️ **NEVER commit real passwords or sensitive data**
- ⚠️ Default password hashes are for development only
- ⚠️ Change all default passwords in production
- ⚠️ Use environment variables for sensitive configuration

---

**Document Version**: 1.0
**Last Updated**: 2026-02-13
**Status**: ✅ Ready for Use
