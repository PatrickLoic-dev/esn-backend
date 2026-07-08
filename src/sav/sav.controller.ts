import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { SavService } from './sav.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';

@ApiTags('sav')
@ApiBearerAuth()
@Controller('sav/tickets')
export class SavController {
  constructor(private savService: SavService) {}

  @Post()
  createTicket(@CurrentUser() user: JwtPayload, @Body() dto: CreateTicketDto) {
    return this.savService.createTicket(user, dto);
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.savService.findAllForUser(user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.savService.findOne(id, user);
  }

  @Post(':id/messages')
  addMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateMessageDto,
  ) {
    return this.savService.addMessage(id, user, dto.content);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.savService.update(id, dto);
  }
}
