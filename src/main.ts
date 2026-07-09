import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors();

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
