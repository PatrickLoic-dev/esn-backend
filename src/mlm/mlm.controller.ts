import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { MlmService } from './mlm.service';
import { UpdateMlmConfigDto } from './dto/update-mlm-config.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

// Seuls ces rôles peuvent modifier le barème (ni SUPPORT ni CUSTOMER).
const CAN_EDIT_CONFIG: Role[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.MODERATOR,
];

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

  // Barème courant — lisible par tout membre connecté (checkout, dashboard)
  @Get('config')
  config() {
    return this.mlm.getConfig();
  }

  // Édition du barème — réservée à l'admin et au modérateur
  @Roles(Role.ADMIN)
  @Patch('config')
  updateConfig(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateMlmConfigDto,
  ) {
    if (!CAN_EDIT_CONFIG.includes(user.role as Role)) {
      throw new ForbiddenException(
        'Seuls un administrateur ou un modérateur peuvent modifier le barème.',
      );
    }
    return this.mlm.updateConfig(dto);
  }

  // Admin : vue d'ensemble du réseau MLM
  @Roles(Role.ADMIN)
  @Get('admin/network')
  network() {
    return this.mlm.getNetwork();
  }
}
