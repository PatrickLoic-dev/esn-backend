import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MlmService } from './mlm.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('affiliation')
@ApiBearerAuth()
@Controller('affiliation')
export class MlmController {
  constructor(private mlm: MlmService) {}

  // Tableau de bord affiliation du membre connecté
  @Get('me')
  me(@CurrentUser('sub') userId: string) {
    return this.mlm.getSummary(userId);
  }
}
