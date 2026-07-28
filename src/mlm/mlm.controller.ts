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

// Only these roles may edit the schedule (neither SUPPORT nor CUSTOMER).
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

  // Affiliation dashboard for the signed-in member
  @Get('me')
  me(@CurrentUser('sub') userId: string) {
    return this.mlm.getSummary(userId);
  }

  // Current schedule — readable by any signed-in member (checkout, dashboard)
  @Get('config')
  config() {
    return this.mlm.getConfig();
  }

  // Editing the schedule — reserved to admin and moderator
  @Roles(Role.ADMIN)
  @Patch('config')
  updateConfig(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateMlmConfigDto,
  ) {
    if (!CAN_EDIT_CONFIG.includes(user.role as Role)) {
      throw new ForbiddenException(
        'Only an administrator or moderator may edit the schedule.',
      );
    }
    return this.mlm.updateConfig(dto);
  }

  // Admin: overview of the MLM network
  @Roles(Role.ADMIN)
  @Get('admin/network')
  network() {
    return this.mlm.getNetwork();
  }
}
