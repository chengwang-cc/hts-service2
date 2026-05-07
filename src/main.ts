import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Enable CORS for frontend
  const devOrigins = [
    'http://localhost:7000',
    'http://localhost:4200',
    'http://localhost:4201',
    'http://localhost:4202',
    'http://localhost:4299',
    'http://localhost:4300',
    'http://127.0.0.1:4200',
  ];
  const envOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
  const allOrigins = [...devOrigins, ...envOrigins];
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (server-to-server, curl, mobile apps)
      if (!origin) return callback(null, true);
      // Allow all origins for widget/shopify endpoints (checkout extensions run on unpredictable origins)
      if (allOrigins.length === 0 || allOrigins.includes(origin)) return callback(null, true);
      // Allow Shopify domains
      if (origin.endsWith('.shopify.com') || origin.endsWith('.shopifycdn.com') || origin.endsWith('.myshopify.com')) return callback(null, true);
      // Allow all origins — checkout extensions require this
      return callback(null, true);
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
    exclude: [
      { path: 'api/v1/(.*)', method: RequestMethod.ALL },
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

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
