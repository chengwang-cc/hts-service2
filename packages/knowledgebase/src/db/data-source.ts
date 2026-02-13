import { DataSource } from 'typeorm';
import { CustomNamingStrategy } from '@hts/core';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'hts',
  namingStrategy: new CustomNamingStrategy(),
  entities: [
    // Core entities
    __dirname + '/../../../core/src/entities/*.entity{.ts,.js}',
    // Knowledgebase entities
    __dirname + '/../entities/*.entity{.ts,.js}',
    // Lookup entities
    __dirname + '/../../../lookup/src/entities/*.entity{.ts,.js}',
    // Calculator entities
    __dirname + '/../../../calculator/src/entities/*.entity{.ts,.js}',
    // Auth entities
    __dirname + '/../../../../src/modules/auth/entities/*.entity{.ts,.js}',
    // API Keys entities
    __dirname + '/../../../../src/modules/api-keys/entities/*.entity{.ts,.js}',
    // Widget entities
    __dirname + '/../../../../src/modules/widget/entities/*.entity{.ts,.js}',
  ],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  synchronize: false,
  logging: true,
});
