import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.resend = new Resend(config.getOrThrow<string>('RESEND_API_KEY'));
    this.from = config.getOrThrow<string>('MAIL_FROM');
  }

  async send(to: string, subject: string, html: string) {
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
