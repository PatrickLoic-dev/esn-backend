import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface NotchPayInitResponse {
  status: number;
  transaction: { reference: string; status: string };
  authorization_url: string;
}

// Minimal Notch Pay REST client (https://developer.notchpay.co).
// Supports mobile money (MTN MoMo, Orange Money) and card payments.
@Injectable()
export class NotchPayClient {
  private readonly baseUrl = 'https://api.notchpay.co';
  private readonly publicKey: string;
  private readonly callbackUrl: string;

  constructor(config: ConfigService) {
    this.publicKey = config.getOrThrow<string>('NOTCHPAY_PUBLIC_KEY');
    this.callbackUrl = config.getOrThrow<string>('NOTCHPAY_CALLBACK_URL');
  }

  async initializePayment(params: {
    amount: number;
    currency: string;
    email: string;
    phone?: string;
    reference: string;
    description: string;
  }): Promise<NotchPayInitResponse> {
    const res = await fetch(`${this.baseUrl}/payments/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.publicKey,
      },
      body: JSON.stringify({
        amount: params.amount,
        currency: params.currency,
        customer: { email: params.email, phone: params.phone },
        reference: params.reference,
        description: params.description,
        callback: this.callbackUrl,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new InternalServerErrorException(
        `Notch Pay initialization failed: ${res.status} ${body}`,
      );
    }
    return (await res.json()) as NotchPayInitResponse;
  }
}
