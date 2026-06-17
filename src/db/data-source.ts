import { DataSource } from 'typeorm';
import { CustomNamingStrategy } from '../configs/custom-naming.strategy';

console.log('DB:', process.env.DB_DATABASE);
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_USERNAME:', process.env.DB_USERNAME);
console.log('DB_PORT:', process.env.DB_PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('dir:', __dirname);

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432'),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  entities: [
    __dirname + '/../../packages/*/src/**/*.entity{.ts,.js}',
    __dirname + '/../../src/**/*.entity{.ts,.js}',
  ], // Include all entities, excluding dist directories
  database: process.env.DB_DATABASE ?? 'hts',
  namingStrategy: new CustomNamingStrategy(),
  synchronize: false, // Default to false
  ssl:
    process.env.DB_SSL === 'true'
      ? { rejectUnauthorized: false }
      : process.env.NODE_ENV === 'development'
        ? false // Disable SSL in development
        : { rejectUnauthorized: false },
  // Migrations path.
  // - dev: scan repo source (.ts files, run via ts-node).
  // - prod (compiled): scan next to this file's compiled location.
  //   __dirname at runtime is `/app/dist/db`, so migrations live at
  //   `/app/dist/db/migrations/*.js`. The previous "/app/db/migrations"
  //   path was wrong (the Dockerfile only copies `/app/dist`), which
  //   silently produced "No migrations are pending" on container boot
  //   — every prior deploy needed a manual `npm run db:run` over a
  //   tunnel to apply schema. Fixed 2026-06-17.
  migrations:
    process.env.NODE_ENV === 'development'
      ? [__dirname + '/../../src/db/migrations/**/*{.ts,.js}']
      : [__dirname + '/migrations/**/*{.js}'],
  migrationsTableName: 'typeorm_migrations', // Table to track migrations
  logging: true,
});
