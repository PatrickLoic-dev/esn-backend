import { Module } from '@nestjs/common';
import { MlmController } from './mlm.controller';
import { MlmService } from './mlm.service';

@Module({
  controllers: [MlmController],
  providers: [MlmService],
  // Exporté pour que Auth (parrainage à l'inscription) et Orders (attribution
  // des points à l'achat) puissent réutiliser le service.
  exports: [MlmService],
})
export class MlmModule {}
