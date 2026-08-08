import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PaymentsService } from './payments.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { Public } from '../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';

interface NotchPayWebhookBody {
  event: string;
  data: { reference: string };
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private paymentsService: PaymentsService,
    private config: ConfigService,
  ) {}

  // Public: guest checkout may pay for its own order without an account.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('initiate')
  initiate(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: InitiatePaymentDto,
  ) {
    return this.paymentsService.initiate(user, dto);
  }

  @ApiBearerAuth()
  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.paymentsService.findAllForUser(user);
  }

  // Polled by the checkout callback page while waiting for Notch Pay's
  // webhook. Public: a guest needs to check their own just-placed payment.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('reference/:reference')
  findByReference(
    @Param('reference') reference: string,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    return this.paymentsService.findByReference(reference, user);
  }

  // Notch Pay calls this endpoint; authenticity is proven by the HMAC signature
  @Public()
  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Body() body: NotchPayWebhookBody,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-notch-signature') signature: string,
  ) {
    this.verifySignature(req.rawBody, signature);
    return this.paymentsService.handleWebhookEvent(body.event, body.data);
  }

  private verifySignature(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }
    if (!rawBody) {
      throw new UnauthorizedException('Missing raw request body');
    }
    // Must be computed over the exact bytes Notch Pay sent — re-serializing
    // the parsed body with JSON.stringify would never match their signature.
    const expected = createHmac(
      'sha256',
      this.config.getOrThrow<string>('NOTCHPAY_HASH_KEY'),
    )
      .update(rawBody)
      .digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
