import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import compression = require('compression');
import { validationExceptionFactory } from './common/validation-exception.factory';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Security: hardened headers (Helmet) + gzip response compression.
  // CSP disabled: JSON API + Swagger UI (inline scripts) — the other Helmet
  // protections (nosniff, frameguard, HSTS, etc.) remain active.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  // Limits JSON payload size (anti-DoS via large request bodies).
  const express = app.getHttpAdapter().getInstance() as {
    use: (m: unknown) => void;
  };
  const { json, urlencoded } = await import('express');
  express.use(
    json({
      limit: '1mb',
      // Keep the exact raw bytes alongside the parsed body: the Notch Pay
      // webhook signature is an HMAC over the original request bytes, and
      // re-serializing the parsed object with JSON.stringify never
      // reproduces them byte-for-byte (key order, spacing, number
      // formatting can all differ) — verifying against that would always fail.
      verify: (req: unknown, _res, buf) => {
        (req as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  express.use(urlencoded({ extended: true, limit: '1mb' }));

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  // CORS: allowlist via CORS_ORIGINS (comma-separated). Otherwise, all
  // origins are allowed (backward-compatible) but a warning is logged.
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Easy Shop Network API')
    .setDescription(
      'Easy Shop Network (ESN) e-commerce backend — Supabase auth, products, orders, Notch Pay payments, SAV ticketing',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // Graceful shutdown: triggers the onModuleDestroy hooks (clean closing of
  // the Prisma pool) when the container receives SIGTERM/SIGINT.
  app.enableShutdownHooks();

  // 0.0.0.0 is required in a container: otherwise the server only listens on
  // the loopback interface and isn't reachable from outside the container.
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
