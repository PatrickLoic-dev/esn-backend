import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { MlmService } from './mlm.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

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

  // Admin : vue d'ensemble du réseau MLM
  @Roles(Role.ADMIN)
  @Get('admin/network')
  network() {
    return this.mlm.getNetwork();
  }
}
