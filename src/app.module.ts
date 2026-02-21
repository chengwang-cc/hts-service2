import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomNamingStrategy } from '@hts/core';
import { CoreModule } from '@hts/core';
import { CoreWrapperModule } from './modules/core/core.module';
import { KnowledgebaseModule } from './modules/knowledgebase/knowledgebase.module';
import { LookupModule } from './modules/lookup/lookup.module';
import { CalculatorModule } from './modules/calculator/calculator.module';
import { AuthModule } from './modules/auth/auth.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { WidgetModule } from './modules/widget/widget.module';
import { ExtensionModule } from './modules/extension/extension.module';
import { ExportModule } from './modules/export/export.module';
import { BillingModule } from './modules/billing/billing.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { ConnectorsModule } from './modules/connectors/connectors.module';
import { I18nModule } from './modules/i18n/i18n.module';
import { AdminModule } from './modules/admin/admin.module';
import { TestModule } from './modules/test/test.module';
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
              :false,
            //: { rejectUnauthorized: false },
        logging: (process.env?.DB_LOGGING ?? 'false') === 'true',
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

    // Core wrapper module (entities, repositories, controllers)
    CoreWrapperModule,

    // Auth module
    AuthModule,

    // API Keys module
    ApiKeysModule,

    // Public API module (versioned external APIs)
    PublicApiModule,

    // Widget module
    WidgetModule,

    // Extension module (Chrome extension support)
    ExtensionModule,

    // Export module (Export templates & data completeness)
    ExportModule,

    // Billing module (Subscriptions & usage tracking)
    BillingModule,

    // Onboarding module (User onboarding & templates)
    OnboardingModule,

    // Connectors module (External system integrations)
    ConnectorsModule,

    // I18n module (Multi-country support)
    I18nModule,

    // Admin module (HTS import, knowledge base admin, etc.)
    AdminModule,

    // Knowledgebase module
    KnowledgebaseModule,

    // Lookup module
    LookupModule,

    // Calculator module
    CalculatorModule,

    // Test module (E2E testing endpoints)
    TestModule,
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
