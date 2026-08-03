import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';

@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  // Public: guest checkout is allowed. If a valid access token is present,
  // the order is linked to that account; otherwise the service resolves
  // ownership from the shipping email (see OrdersService.create).
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  create(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.create(user?.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.ordersService.findAllForUser(user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordersService.findOne(id, user);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto.status);
  }

  @Roles(Role.ADMIN)
  @Post(':id/notify')
  notify(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.notifyCustomer(id);
  }
}
