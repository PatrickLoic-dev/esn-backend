import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PaymentsService } from './payments.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { Public } from '../auth/decorators/public.decorator';
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

  @ApiBearerAuth()
  @Post('initiate')
  initiate(@CurrentUser() user: JwtPayload, @Body() dto: InitiatePaymentDto) {
    return this.paymentsService.initiate(user, dto);
  }

  @ApiBearerAuth()
  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.paymentsService.findAllForUser(user);
  }

  // Notch Pay calls this endpoint; authenticity is proven by the HMAC signature
  @Public()
  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Body() body: NotchPayWebhookBody,
    @Headers('x-notch-signature') signature: string,
  ) {
    this.verifySignature(body, signature);
    return this.paymentsService.handleWebhookEvent(body.event, body.data);
  }

  private verifySignature(body: unknown, signature: string | undefined) {
    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }
    const expected = createHmac(
      'sha256',
      this.config.getOrThrow<string>('NOTCHPAY_HASH_KEY'),
    )
      .update(JSON.stringify(body))
      .digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
