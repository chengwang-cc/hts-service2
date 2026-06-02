import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomNamingStrategy } from '@hts/core';
import { CoreModule } from '@hts/core';
import { DgxModule } from './core/dgx';
import { CoreWrapperModule } from './modules/core/core.module';
import { KnowledgebaseModule } from './modules/knowledgebase/knowledgebase.module';
import { LookupModule } from './modules/lookup/lookup.module';
import { CalculatorModule } from './modules/calculator/calculator.module';
import { AuthModule } from './modules/auth/auth.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { DataSource } from 'typeorm';
import { WithLengthColumnType } from 'typeorm/driver/types/ColumnTypes';

@Module({
  imports: [
    // Configuration module to load .env file
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Database configuration
    TypeOrmModule.forRootAsync({
      useFactory: async () => ({
        type: (process.env?.DB_PROVIDER as any) ?? 'postgres',
        host: process.env?.DB_HOST ?? 'localhost',
        port: parseInt(process.env?.DB_PORT ?? '5432'),
        username: process.env?.DB_USERNAME ?? 'postgres',
        password: process.env?.DB_PASSWORD ?? '',
        database: process.env?.DB_DATABASE ?? 'hts',
        namingStrategy: new CustomNamingStrategy(),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: (process.env?.DB_SYNCHRONIZE ?? 'false') === 'true',
        migrations: [__dirname + '/db/migrations/**/*{.ts,.js}'],
        migrationsTableName: 'typeorm_migrations',
        ssl:
          process.env?.NODE_ENV === 'development'
            ? false
            : { rejectUnauthorized: false },
        logging: (process.env?.DB_LOGGING ?? 'false') === 'true',
        // Limit pool size so pg-boss + app together stay under max_connections
        extra: { max: parseInt(process.env?.DB_POOL_MAX ?? '8') },
      }),
      dataSourceFactory: async (options: any) => {
        const dataSource = new DataSource(options);

        // Push vector into length column type for PostgreSQL vector extension
        dataSource.driver.supportedDataTypes.push(
          'vector' as WithLengthColumnType,
        );
        dataSource.driver.withLengthColumnTypes.push(
          'vector' as WithLengthColumnType,
        );

        dataSource.driver.supportedDataTypes.push(
          'tsvector' as WithLengthColumnType,
        );
        dataSource.driver.withLengthColumnTypes.push(
          'tsvector' as WithLengthColumnType,
        );



        // Initialize datasource
        await dataSource.initialize();

        return dataSource;
      },
    }),    

    // Core module with OpenAI configuration
    CoreModule.forRoot({
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
      },
    }),

    // DGX Spark AI services (embedding + reranker)
    DgxModule,

    // Core wrapper module (entities, repositories, controllers)
    CoreWrapperModule,

    // Auth module
    AuthModule,

    // API Keys module
    ApiKeysModule,

    // Knowledgebase module
    KnowledgebaseModule,

    // Lookup module
    LookupModule,

    // Calculator module
    CalculatorModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global JWT authentication guard - all routes require auth by default
    // Use @Public() decorator to mark routes that don't need authentication
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
