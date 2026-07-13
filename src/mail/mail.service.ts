import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

// Charte graphique Easy Shop Network (alignée sur le storefront)
const BRAND = {
  name: 'Easy Shop Network',
  primary: '#ff0040',
  primaryDark: '#af0b46',
  ink: '#333632',
  muted: '#6b6b6b',
  line: '#e5e5e5',
  blush: '#fff0f5',
  bg: '#f5f5f5',
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  // null si Resend n'est pas configuré : l'envoi d'email devient un no-op
  // plutôt que de faire planter le démarrage de toute l'API.
  private readonly resend: Resend | null;
  private readonly from: string;
  // URL publique d'un logo PNG/JPG (SVG non supporté par la plupart des
  // clients mail). Optionnel : à défaut on affiche un wordmark stylé.
  private readonly logoUrl?: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.from = config.get<string>('MAIL_FROM') ?? '';
    this.logoUrl = config.get<string>('MAIL_LOGO_URL');
    if (!apiKey || !this.from) {
      this.logger.warn(
        "RESEND_API_KEY/MAIL_FROM absents : envoi d'emails désactivé.",
      );
      this.resend = null;
    } else {
      this.resend = new Resend(apiKey);
    }
  }

  async send(to: string, subject: string, bodyHtml: string) {
    if (!this.resend) {
      this.logger.warn(`Email non envoyé (Resend désactivé) : "${subject}"`);
      return;
    }
    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject,
      html: this.layout(subject, bodyHtml),
    });
    if (error) {
      // Email failures must never break the main request flow
      this.logger.error({ err: error, to, subject }, 'Failed to send email');
    }
  }

  // En-tête de marque : logo hébergé si fourni, sinon wordmark stylé
  private header(): string {
    if (this.logoUrl) {
      return `<img src="${this.logoUrl}" alt="${BRAND.name}" height="40"
        style="height:40px;display:block;border:0;" />`;
    }
    return `<span style="font-size:22px;font-weight:800;letter-spacing:-0.5px;
      color:#ffffff;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
      Easy&nbsp;Shop<span style="color:${BRAND.blush};">Network</span></span>`;
  }

  // Gabarit responsive, compatible clients mail (tables + styles inline)
  private layout(title: string, bodyHtml: string): string {
    const year = new Date().getFullYear();
    return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="background:${BRAND.bg};padding:24px 12px;
    font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.ink};">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
          style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;
          overflow:hidden;border:1px solid ${BRAND.line};">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(90deg,${BRAND.primary},${BRAND.primaryDark});
              padding:24px 32px;">
              ${this.header()}
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;font-size:15px;line-height:1.65;color:${BRAND.ink};">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background:${BRAND.blush};
              border-top:1px solid ${BRAND.line};font-size:12px;color:${BRAND.muted};
              text-align:center;">
              <p style="margin:0 0 4px;">
                Cet email vous a été envoyé par <strong style="color:${BRAND.ink};">${BRAND.name}</strong>.
              </p>
              <p style="margin:0;">© ${year} ${BRAND.name}. Tous droits réservés.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  // Bouton d'action réutilisable (CTA), styles inline pour compat mail
  button(label: string, href: string): string {
    return `<a href="${href}" style="display:inline-block;background:${BRAND.primary};
      color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;
      padding:11px 22px;border-radius:8px;">${label}</a>`;
  }
}
