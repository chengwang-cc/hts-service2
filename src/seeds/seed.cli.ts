/**
 * Seed CLI Entry Point
 *
 * Standalone script to run seed operations
 * Usage: npm run db:seed -- [Entity]
 */

import { NestFactory } from '@nestjs/core';
import { SeedModule } from './seed.module';
import { SeedService } from './seed.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CustomNamingStrategy } from '../configs/custom-naming.strategy';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get('DB_PORT', 5432),
        username: configService.get('DB_USERNAME', 'postgres'),
        password: configService.get('DB_PASSWORD', 'postgres'),
        database: configService.get('DB_DATABASE', 'hts'),
        entities: [__dirname + '/../**/*.entity{.ts,.js}'],
        autoLoadEntities: true,
        synchronize: false,
        namingStrategy: new CustomNamingStrategy(), // ← Add naming strategy
      }),
    }),
    SeedModule,
  ],
})
class SeedCliModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SeedCliModule);

  const seedService = app.get(SeedService);
  const entity = process.argv.slice(2).find((arg) => arg && arg !== '--');

  try {
    await seedService.upsertSeedData(entity);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
