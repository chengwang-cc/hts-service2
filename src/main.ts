import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Body parser limit — broker packet uploads send base64-encoded PDFs that
  // need headroom above the express default (100kb). 25mb matches the
  // DOCUMENT_SCAN_MAX_BYTES default; oversize uploads fail loudly with 413.
  const bodyLimit = process.env.HTTP_BODY_LIMIT || '25mb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  // Enable CORS for frontend
  const devOrigins = [
    'http://localhost:7000',
    'http://localhost:4200',
    'http://localhost:4201',
    'http://localhost:4202',
    'http://localhost:4299',
    'http://localhost:4300',
    // hts-web2's `npm start` script: ng serve --port 8001
    'http://localhost:8001',
    'http://127.0.0.1:4200',
    'http://127.0.0.1:4299',
    'http://127.0.0.1:4300',
    'http://127.0.0.1:8001',
  ];
  const envOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
  const allOrigins = [...devOrigins, ...envOrigins];
  const TRUSTED_DOMAINS = ['usahts.com', 'www.usahts.com', 'api.usahts.com'];
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (server-to-server, curl, mobile apps)
      if (!origin) return callback(null, true);
      // Allow configured origins (dev + CORS_ORIGIN env)
      if (allOrigins.includes(origin)) return callback(null, true);
      // Allow trusted production domains explicitly
      try {
        const host = new URL(origin).host;
        if (TRUSTED_DOMAINS.includes(host)) return callback(null, true);
      } catch {
        // not a parseable origin
      }
      // Allow Shopify domains (storefront, admin, checkout extensions)
      if (
        origin.endsWith('.shopify.com') ||
        origin.endsWith('.shopifycdn.com') ||
        origin.endsWith('.shopifypreview.com') ||
        origin.endsWith('.myshopify.com')
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Guest-Token',
      'x-guest-token',
      'X-Widget-Key',
    ],
  });

  // Set global API prefix
  app.setGlobalPrefix('api/v1', {
    // Keep backward compatibility for legacy controllers that already include "api/v1"
    // in their route decorators, while still prefixing newer module routes.
    // `api/v2/(.*)` is excluded so public-api v2 controllers register at
    // their documented `/api/v2/...` paths instead of `/api/v1/api/v2/...`.
    exclude: [
      { path: 'api/v1/(.*)', method: RequestMethod.ALL },
      { path: 'api/v2/(.*)', method: RequestMethod.ALL },
      { path: 'widget/(.*)', method: RequestMethod.ALL },
      { path: 'shopify/(.*)', method: RequestMethod.ALL },
    ],
  });

  // Enable global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true, // Auto-transform to DTO types
      whitelist: true, // Strip non-DTO properties
      forbidNonWhitelisted: false, // Don't throw on extra props
      transformOptions: {
        enableImplicitConversion: true, // "123" → 123
      },
    }),
  );

  // OpenAPI/Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('HTS Service API')
    .setDescription(
      'HTS duty calculation and lookup API with AI-powered classification. ' +
        'Provides duty calculation, HTS code lookup, trade agreement analysis, and embeddable widgets.',
    )
    .setVersion('1.0')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description:
          'API key for authentication. Format: hts_{environment}_{random}',
      },
      'api-key',
    )
    .addTag('Calculator', 'Duty calculation endpoints')
    .addTag('HTS Lookup', 'HTS code lookup and search')
    .addTag('Knowledgebase', 'AI-powered HTS classification')
    .addTag('Widgets', 'Embeddable widget management')
    .addTag('Auth', 'Authentication and user management')
    .addTag('API Keys', 'API key management')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // H4 fix (2026-05-27): k8s sends SIGTERM at pod shutdown. Without
  // this, OnModuleDestroy hooks (notably QueueService → pg-boss
  // graceful stop with a 30s timeout) DO NOT run, and in-flight jobs
  // get cut. Pair with `terminationGracePeriodSeconds: 35` in the
  // Deployment manifest.
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
