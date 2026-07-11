import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
  // Optionnels : si absents, l'initiation d'un paiement renvoie un 503 clair
  // au lieu de faire planter le démarrage de toute l'API.
  private readonly publicKey: string | undefined;
  private readonly callbackUrl: string | undefined;

  constructor(config: ConfigService) {
    this.publicKey = config.get<string>('NOTCHPAY_PUBLIC_KEY');
    this.callbackUrl = config.get<string>('NOTCHPAY_CALLBACK_URL');
  }

  async initializePayment(params: {
    amount: number;
    currency: string;
    email: string;
    phone?: string;
    reference: string;
    description: string;
  }): Promise<NotchPayInitResponse> {
    if (!this.publicKey || !this.callbackUrl) {
      throw new ServiceUnavailableException(
        "Les paiements Notch Pay ne sont pas configurés sur ce serveur.",
      );
    }
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
