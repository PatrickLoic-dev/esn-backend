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

  // Sécurité : en-têtes durcis (Helmet) + compression gzip des réponses.
  // CSP désactivée : API JSON + Swagger UI (scripts inline) — les autres
  // protections Helmet (nosniff, frameguard, HSTS, etc.) restent actives.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  // Limite la taille des payloads JSON (anti-DoS par gros corps de requête).
  const express = app.getHttpAdapter().getInstance() as {
    use: (m: unknown) => void;
  };
  const { json, urlencoded } = await import('express');
  express.use(json({ limit: '1mb' }));
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
  // CORS : allowlist via CORS_ORIGINS (séparés par des virgules). À défaut,
  // on autorise toutes les origines (rétrocompatible) mais on log un avertissement.
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

  // Arrêt gracieux : déclenche les hooks onModuleDestroy (fermeture propre du
  // pool Prisma) quand le conteneur reçoit SIGTERM/SIGINT.
  app.enableShutdownHooks();

  // 0.0.0.0 est indispensable en conteneur : sinon le serveur n'écoute que sur
  // la boucle locale et n'est pas joignable depuis l'extérieur du conteneur.
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
