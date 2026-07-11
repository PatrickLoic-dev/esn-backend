import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  // null si Resend n'est pas configuré : l'envoi d'email devient un no-op
  // plutôt que de faire planter le démarrage de toute l'API.
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.from = config.get<string>('MAIL_FROM') ?? '';
    if (!apiKey || !this.from) {
      this.logger.warn(
        'RESEND_API_KEY/MAIL_FROM absents : envoi d\'emails désactivé.',
      );
      this.resend = null;
    } else {
      this.resend = new Resend(apiKey);
    }
  }

  async send(to: string, subject: string, html: string) {
    if (!this.resend) {
      this.logger.warn(`Email non envoyé (Resend désactivé) : "${subject}"`);
      return;
    }
    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject,
      html,
    });
    if (error) {
      // Email failures must never break the main request flow
      this.logger.error({ err: error, to, subject }, 'Failed to send email');
    }
  }
}
