import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { AnalyticsService } from './analytics.service';
import { TrackEventDto } from './dto/track-event.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  // Public so anonymous visitors can be tracked too; user id is attached when present
  @Public()
  @Post('events')
  track(@Body() dto: TrackEventDto, @Req() req: Request) {
    const user = req.user as JwtPayload | undefined;
    return this.analyticsService.track(dto, user?.sub);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('summary')
  summary() {
    return this.analyticsService.summary();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('dashboard')
  dashboard() {
    return this.analyticsService.dashboard();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('overview')
  overview() {
    return this.analyticsService.adminOverview();
  }
}
