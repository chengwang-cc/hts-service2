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
import { CalculatorV2QuoteModule } from './modules/calculator-v2-quote/calculator-v2-quote.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { ExceptionRulesModule } from './modules/exception-rules/exception-rules.module';
import { UsExceptionRulesModule } from './modules/exception-rules/us/us-exception-rules.module';
import { AuExceptionRulesModule } from './modules/exception-rules/au/au-exception-rules.module';
import { TwExceptionRulesModule } from './modules/exception-rules/tw/tw-exception-rules.module';
import { KrExceptionRulesModule } from './modules/exception-rules/kr/kr-exception-rules.module';
import { SgExceptionRulesModule } from './modules/exception-rules/sg/sg-exception-rules.module';
import { NzExceptionRulesModule } from './modules/exception-rules/nz/nz-exception-rules.module';
import { CaExceptionRulesModule } from './modules/exception-rules/ca/ca-exception-rules.module';
import { GbExceptionRulesModule } from './modules/exception-rules/gb/gb-exception-rules.module';
import { EuExceptionRulesModule } from './modules/exception-rules/eu/eu-exception-rules.module';
// W1 (2026-05-26): Japan + Mexico
import { JpExceptionRulesModule } from './modules/exception-rules/jp/jp-exception-rules.module';
import { MxExceptionRulesModule } from './modules/exception-rules/mx/mx-exception-rules.module';
// W2: China + India
import { CnExceptionRulesModule } from './modules/exception-rules/cn/cn-exception-rules.module';
import { InExceptionRulesModule } from './modules/exception-rules/in/in-exception-rules.module';
// W3: ASEAN cluster (VN, PH, ID, MY, TH)
import { VnExceptionRulesModule } from './modules/exception-rules/vn/vn-exception-rules.module';
import { PhExceptionRulesModule } from './modules/exception-rules/ph/ph-exception-rules.module';
import { IdExceptionRulesModule } from './modules/exception-rules/id/id-exception-rules.module';
import { MyExceptionRulesModule } from './modules/exception-rules/my/my-exception-rules.module';
import { ThExceptionRulesModule } from './modules/exception-rules/th/th-exception-rules.module';
// W4: UAE + Brazil
import { AeExceptionRulesModule } from './modules/exception-rules/ae/ae-exception-rules.module';
import { BrExceptionRulesModule } from './modules/exception-rules/br/br-exception-rules.module';
import { KnowledgebaseCardsModule } from './modules/knowledgebase-cards/knowledgebase-cards.module';
import { ExceptionRulesSchedulerModule } from './modules/exception-rules-scheduler/exception-rules-scheduler.module';
import { JurisdictionModule } from './modules/jurisdiction/jurisdiction.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ClassificationModule } from './modules/classification/classification.module';
import { LandedCostModule } from './modules/landed-cost/landed-cost.module';
import { AuthModule } from './modules/auth/auth.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { WidgetModule } from './modules/widget/widget.module';
import { ExtensionModule } from './modules/extension/extension.module';
import { ExtensionAuthModule } from './modules/extension-auth/extension-auth.module';
import { ExportModule } from './modules/export/export.module';
import { BillingModule } from './modules/billing/billing.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { ConnectorsModule } from './modules/connectors/connectors.module';
import { I18nModule } from './modules/i18n/i18n.module';
import { AdminModule } from './modules/admin/admin.module';
import { TestModule } from './modules/test/test.module';
import { BatchModule } from './modules/batch/batch.module';
import { ShopifyAppModule } from './modules/shopify-app/shopify-app.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { BrokerCoreModule } from './modules/broker-core/broker-core.module';
import { BrokerEntriesModule } from './modules/broker-entries/broker-entries.module';
import { MarketplaceRequestsModule } from './modules/marketplace-requests/marketplace-requests.module';
import { BrokerPacketsModule } from './modules/broker-packets/broker-packets.module';
import { BrokerDecisionsModule } from './modules/broker-decisions/broker-decisions.module';
import { BrokerRulesModule } from './modules/broker-rules/broker-rules.module';
import { BrokerTasksModule } from './modules/broker-tasks/broker-tasks.module';
import { BrokerAdaptersModule } from './modules/broker-adapters/broker-adapters.module';
import { MarketplaceReviewsModule } from './modules/marketplace-reviews/marketplace-reviews.module';
import { BrokerPostEntryModule } from './modules/broker-post-entry/broker-post-entry.module';
import { BrokerAdminModule } from './modules/broker-admin/broker-admin.module';
import { BrokerOutreachModule } from './modules/broker-outreach/broker-outreach.module';
import { QueryBuilderModule } from './modules/query-builder/query-builder.module';
import { DataTransformerModule } from './modules/data-transformer/data-transformer.module';
import { EcommerceHandoffModule } from './modules/ecommerce-handoff/ecommerce-handoff.module';
import { E2eTeardownModule } from './modules/e2e-teardown/e2e-teardown.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { ObservabilityGaugesModule } from './modules/observability/observability-gauges.module';
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
          process.env?.DB_SSL === 'true'
            ? { rejectUnauthorized: false }
            : process.env?.NODE_ENV === 'development'
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

    // Calculator module (must be before PublicApiModule to ensure @Public() routes take priority)
    CalculatorModule,

    // Jurisdiction module (P1 — adapter interface + per-country tariff rules)
    JurisdictionModule,

    // Catalog module (P2 — products, variants, classifications)
    CatalogModule,

    // Classification module (P2 — first-class POST /classify + bulk job)
    ClassificationModule,

    // Landed-cost module (P3 — POST /landed-cost/quotes + quote lifecycle)
    LandedCostModule,

    // Exception rules module (Phase 1 — runner + registry + admin console)
    ExceptionRulesModule,

    // US exception rules (Phase 2 + 3 + 4 — aluminum smelt/cast, steel,
    // §301 lists, exclusions, IEEPA fentanyl + reciprocal, Chapter 98,
    // USMCA, Section 201 solar). Rules ship DISABLED by default;
    // operators enable per rule via /admin/exception-rules after
    // baseline diff.
    UsExceptionRulesModule,

    // Phase 5 — non-US destination tax rules. All disabled by default.
    AuExceptionRulesModule,
    TwExceptionRulesModule,
    KrExceptionRulesModule,
    SgExceptionRulesModule,
    NzExceptionRulesModule,

    // Phase 6 — non-US trade remedies + sanctions + FTA preferences.
    // Phase 7 — EU CBAM (lives inside EuExceptionRulesModule).
    CaExceptionRulesModule,
    GbExceptionRulesModule,
    EuExceptionRulesModule,

    // Wave 1+ (2026-05-26) — 11-country expansion. All rules ship
    // DISABLED; per-country adapters still need source ingestion. See
    // docs/2026-05-26/1420_11-country-tariff-source-of-truth-execution-plan.md
    JpExceptionRulesModule,   // W1
    MxExceptionRulesModule,   // W1
    CnExceptionRulesModule,   // W2
    InExceptionRulesModule,   // W2
    VnExceptionRulesModule,   // W3 ASEAN
    PhExceptionRulesModule,   // W3 ASEAN
    IdExceptionRulesModule,   // W3 ASEAN
    MyExceptionRulesModule,   // W3 ASEAN
    ThExceptionRulesModule,   // W3 ASEAN
    AeExceptionRulesModule,   // W4
    BrExceptionRulesModule,   // W4

    // Phase 8 — knowledge-cards ingestion + rule-review-alert loop.
    KnowledgebaseCardsModule,

    // Phase-8/9 follow-up — pg-boss cron registrations (env-gated; off
    // by default so test/dev runs don't poll external sources).
    ExceptionRulesSchedulerModule,

    // Calculator V2 quote module (Phase A — unified multi-country calculator)
    CalculatorV2QuoteModule,

    // Phase 5 — Workspace (account-scoped saved shipments + history)
    ShipmentsModule,

    // Public API module (versioned external APIs)
    PublicApiModule,

    // Widget module
    WidgetModule,

    // Extension module (Chrome extension support)
    ExtensionModule,

    // Extension Auth module (public register/login → returns API key)
    ExtensionAuthModule,

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

    // Test module (E2E testing endpoints)
    TestModule,

    // Batch module (async bulk HTS lookup)
    BatchModule,

    // Shopify App module (OAuth, embedded app, GDPR webhooks)
    ShopifyAppModule,

    // Broker marketplace module
    MarketplaceModule,

    // Broker platform — Phase 2 core (clients, POA, relationships)
    BrokerCoreModule,

    // Broker platform — Phase 2 entries (shipments, entries, lines)
    BrokerEntriesModule,

    // Broker platform — Phase 3+4 marketplace requests, matching, quotes, messaging
    MarketplaceRequestsModule,

    // Broker platform — Phase 5 packets, extraction, reconciliation
    BrokerPacketsModule,

    // Broker platform — Phase 6 AI suggestions + broker decisions
    BrokerDecisionsModule,

    // Broker platform — Phase 6 validation rules + policy exposure
    BrokerRulesModule,

    // Broker platform — Phase 7 missing-info tasks, status timeline, notification jobs
    BrokerTasksModule,

    // Broker platform — Phase 8 export adapters, exports, status imports
    BrokerAdaptersModule,

    // Broker platform — Phase 9 marketplace reviews, broker performance, credits/monetization
    MarketplaceReviewsModule,

    // Broker platform — outreach leads, campaigns, and one-click trial invites
    BrokerOutreachModule,
    QueryBuilderModule,
    DataTransformerModule,
    EcommerceHandoffModule,
    E2eTeardownModule,

    // Broker platform — Phase 10 post-entry cases, audit pack, prior decisions
    BrokerPostEntryModule,

    // Broker platform — plan-aligned /admin/marketplace/* and /admin/broker/*
    // endpoints (analytics, audit, ai-governance, rules, adapters, requests).
    BrokerAdminModule,

    // Observability — global telemetry service + per-tenant request metrics
    // middleware on broker / broker-portal / marketplace routes.
    ObservabilityModule,
    ObservabilityGaugesModule,
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
