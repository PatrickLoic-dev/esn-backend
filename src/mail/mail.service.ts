import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

// Charte Easy Shop Network. Palette réservée aux CTA ; le reste de l'email
// reste neutre (encre / gris / blanc) comme la maquette de référence.
const BRAND = {
  name: 'Easy Shop Network',
  primary: '#ff0040', // action principale
  primaryDark: '#af0b46', // action secondaire
  ink: '#1f2124',
  sub: '#6b6b6b',
  line: '#e6e6e6',
  panel: '#f5f5f5',
  bg: '#ffffff',
};

// Sora pour les titres (chargé via Google Fonts ; repli sans-serif si le
// client mail ne charge pas les polices distantes).
const HEADING_FONT =
  "'Sora','Segoe UI',Helvetica,Arial,sans-serif";
const BODY_FONT = "'Segoe UI',Helvetica,Arial,sans-serif";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly logoUrl?: string;
  private readonly frontendUrl: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.from = config.get<string>('MAIL_FROM') ?? '';
    this.logoUrl = config.get<string>('MAIL_LOGO_URL');
    this.frontendUrl = (
      config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
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
      this.logger.error({ err: error, to, subject }, 'Failed to send email');
    }
  }

  // URL absolue vers une page du storefront (pour les CTA)
  appUrl(path = ''): string {
    return `${this.frontendUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  // Titre de section en Sora (couleur encre, pas de palette)
  heading(text: string, size = 22): string {
    return `<h1 style="margin:0;font-family:${HEADING_FONT};font-weight:800;
      font-size:${size}px;line-height:1.2;color:${BRAND.ink};
      letter-spacing:-0.3px;">${text}</h1>`;
  }

  // CTA — seuls éléments à porter la palette de marque.
  // variant "primary" = action principale, "secondary" = action secondaire.
  button(label: string, href: string, variant: 'primary' | 'secondary' = 'primary'): string {
    const styles =
      variant === 'primary'
        ? `background:${BRAND.primary};color:#ffffff;border:2px solid ${BRAND.primary};`
        : `background:#ffffff;color:${BRAND.primary};border:2px solid ${BRAND.primary};`;
    return `<a href="${href}" style="display:inline-block;${styles}
      text-decoration:none;font-weight:700;font-size:14px;font-family:${BODY_FONT};
      padding:12px 26px;border-radius:10px;">${label}</a>`;
  }

  private header(): string {
    const logo = this.logoUrl
      ? `<img src="${this.logoUrl}" alt="${BRAND.name}" height="44"
          style="height:44px;display:inline-block;border:0;" />`
      : `<span style="font-family:${HEADING_FONT};font-weight:800;font-size:24px;
          letter-spacing:1px;color:${BRAND.ink};text-transform:uppercase;">
          Easy Shop <span style="color:${BRAND.primary};">Network</span></span>`;
    return `<div style="text-align:center;padding:28px 32px 8px;">${logo}</div>`;
  }

  private footer(): string {
    const feature = (icon: string, label: string) =>
      `<td align="center" style="padding:6px;font-family:${BODY_FONT};font-size:11px;
        color:${BRAND.sub};text-transform:uppercase;letter-spacing:0.5px;">
        <div style="font-size:22px;line-height:1;">${icon}</div>
        <div style="margin-top:6px;">${label}</div></td>`;
    const nav = (label: string, path: string) =>
      `<a href="${this.appUrl(path)}" style="color:${BRAND.ink};text-decoration:none;
        font-family:${BODY_FONT};font-size:12px;margin:0 10px;">${label}</a>`;
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="background:${BRAND.panel};margin-top:24px;">
        <tr>
          ${feature('✅', 'Quality Assurance')}
          ${feature('🚚', 'Free Shipping')}
          ${feature('💳', 'Easy Payments')}
          ${feature('↩️', 'Quick Return')}
        </tr>
      </table>
      <div style="text-align:center;padding:20px 24px 8px;">
        ${nav('Boutique', '/shop')}
        ${nav('Mon compte', '/account')}
        ${nav('Support', '/account/support')}
      </div>
      <div style="text-align:center;padding:4px 24px 28px;font-family:${BODY_FONT};
        font-size:11px;color:${BRAND.sub};">
        © ${new Date().getFullYear()} ${BRAND.name}. Tous droits réservés.
      </div>`;
  }

  private layout(title: string, bodyHtml: string): string {
    return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <title>${title}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&display=swap');
  </style>
</head>
<body style="margin:0;padding:0;background:${BRAND.panel};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="background:${BRAND.panel};padding:24px 12px;font-family:${BODY_FONT};
    color:${BRAND.ink};">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
          style="max-width:600px;width:100%;background:${BRAND.bg};border-radius:16px;
          overflow:hidden;border:1px solid ${BRAND.line};">
          <tr><td>${this.header()}</td></tr>
          <tr>
            <td style="padding:16px 32px 8px;font-size:15px;line-height:1.65;
              color:${BRAND.ink};">
              ${bodyHtml}
            </td>
          </tr>
          <tr><td>${this.footer()}</td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}
