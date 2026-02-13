import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomNamingStrategy } from '@hts/core';
import { CoreModule } from '@hts/core';
import { KnowledgebaseModule } from '@hts/knowledgebase';
import { LookupModule } from '@hts/lookup';
import { CalculatorModule } from '@hts/calculator';
import { AuthModule } from './modules/auth/auth.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { WidgetModule } from './modules/widget/widget.module';
import { ExtensionModule } from './modules/extension/extension.module';
import { ExportModule } from './modules/export/export.module';
import { BillingModule } from './modules/billing/billing.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';

@Module({
  imports: [
    // Database configuration
    TypeOrmModule.forRoot({
      //@ts-ignore
      type: process.env.DB_PROVIDER ?? 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: parseInt(process.env.DB_PORT ?? '5432'),
      username: process.env.DB_USERNAME ?? 'postgres',
      password: process.env.DB_PASSWORD ?? '',
      namingStrategy: new CustomNamingStrategy(),
      entities: [__dirname + '/../../**/*.entity{.ts,.js}'], // Include all entities
      database: process.env.DB_DATABASE ?? 'hts',
      synchronize: (process.env.DB_SYNCHRONIZE ?? 'false') === 'true', // Default to false
      migrations: [__dirname + '/migrations/**/*{.ts,.js}'], // Path to migration files
      migrationsTableName: 'typeorm_migrations', // Table to track migrations
      ssl:
        process.env.NODE_ENV === 'development'
          ? false // Disable SSL in development
          : { rejectUnauthorized: false },
      logging: (process.env.DB_LOGGING ?? 'false') === 'true',
    }),

    // Core module with OpenAI configuration
    CoreModule.forRoot({
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
      },
    }),

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

    // Knowledgebase module
    KnowledgebaseModule.forRoot(),

    // Lookup module
    LookupModule.forRoot(),

    // Calculator module
    CalculatorModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
