import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Session, SupabaseClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const ACCESS_TTL = 60 * 60; // 1h
const REFRESH_TTL = 60 * 60 * 24 * 7; // 7d
const RESET_TTL = 60 * 60; // 1h

@Injectable()
export class AuthService {
  private readonly localMode: boolean;
  private readonly jwtSecret: string;
  private readonly frontendUrl: string;

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
    private mail: MailService,
    config: ConfigService,
  ) {
    // AUTH_MODE=local issues our own HS256 tokens (same secret/audience the
    // JwtStrategy verifies), so the full auth flow works without Supabase.
    this.localMode = config.get<string>('AUTH_MODE') === 'local';
    this.jwtSecret = config.getOrThrow<string>('SUPABASE_JWT_SECRET');
    // Base publique du frontend, pour bâtir le lien de réinitialisation
    this.frontendUrl = (
      config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  async register(dto: RegisterDto) {
    if (this.localMode) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (existing) {
        throw new BadRequestException('Email already registered');
      }
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash: await bcrypt.hash(dto.password, 10),
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
      });
      void this.mail
        .send(
          dto.email,
          'Welcome!',
          `<p>Hi ${dto.firstName ?? ''}, your account has been created.</p>`,
        )
        .catch(() => undefined);
      return { userId: user.id, ...this.issueTokens(user.id, user.email) };
    }

    const { data, error } = await this.requireSupabase().auth.signUp({
      email: dto.email,
      password: dto.password,
    });
    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data.user) {
      throw new BadRequestException('Registration failed');
    }

    await this.prisma.user.upsert({
      where: { id: data.user.id },
      create: {
        id: data.user.id,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
      update: {},
    });

    void this.mail.send(
      dto.email,
      'Welcome!',
      `<p>Hi ${dto.firstName ?? ''}, your account has been created.</p>`,
    );

    // session is null when email confirmation is enabled in Supabase
    return {
      userId: data.user.id,
      ...this.toTokens(data.session),
    };
  }

  async login(dto: LoginDto) {
    if (this.localMode) {
      const user = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (
        !user?.passwordHash ||
        !(await bcrypt.compare(dto.password, user.passwordHash))
      ) {
        throw new UnauthorizedException('Invalid credentials');
      }
      if (!user.isActive) {
        throw new UnauthorizedException('This account has been deactivated');
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      // Notification de sécurité : email à chaque connexion
      const when = new Date().toLocaleString('fr-FR');
      void this.mail
        .send(
          user.email,
          'Nouvelle connexion à votre compte Easy Shop Network',
          `<p>Bonjour ${user.firstName ?? ''},</p>
           <p>Une connexion à votre compte vient d'avoir lieu le ${when}.</p>
           <p>Si vous n'êtes pas à l'origine de cette connexion, changez votre
           mot de passe immédiatement.</p>
           <p>— Easy Shop Network</p>`,
        )
        .catch(() => undefined);
      return this.issueTokens(user.id, user.email);
    }

    const { data, error } =
      await this.requireSupabase().auth.signInWithPassword({
        email: dto.email,
        password: dto.password,
      });
    if (error || !data.session) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.toTokens(data.session);
  }

  async refresh(dto: RefreshTokenDto) {
    if (this.localMode) {
      try {
        const payload = jwt.verify(dto.refreshToken, this.jwtSecret, {
          audience: 'refresh',
        }) as { sub: string; email: string };
        return this.issueTokens(payload.sub, payload.email);
      } catch {
        throw new UnauthorizedException('Invalid refresh token');
      }
    }

    const { data, error } = await this.requireSupabase().auth.refreshSession({
      refresh_token: dto.refreshToken,
    });
    if (error || !data.session) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.toTokens(data.session);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (!this.localMode) {
      throw new BadRequestException(
        'Password change is managed by Supabase in this mode',
      );
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user?.passwordHash ||
      !(await bcrypt.compare(dto.currentPassword, user.passwordHash))
    ) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) },
    });
    return { success: true };
  }

  // Mot de passe oublié : envoie un lien de réinitialisation par email.
  // Réponse identique que le compte existe ou non (pas d'énumération d'emails).
  async forgotPassword(dto: ForgotPasswordDto) {
    if (!this.localMode) {
      throw new BadRequestException(
        'Password reset is managed by Supabase in this mode',
      );
    }
    const generic = { success: true } as const;
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    // Pas de compte, ou compte sans mot de passe local → on s'arrête
    // silencieusement (même réponse), aucun email envoyé.
    if (!user?.passwordHash || !user.isActive) {
      return generic;
    }

    // Jeton signé, lié à l'empreinte du hash actuel : dès que le mot de passe
    // change, le lien devient invalide (usage unique, sans migration de schéma).
    const token = jwt.sign(
      { sub: user.id, email: user.email, pf: this.passwordFingerprint(user.passwordHash) },
      this.jwtSecret,
      { audience: 'reset', expiresIn: RESET_TTL },
    );
    const link = `${this.frontendUrl}/auth/reset-password?token=${encodeURIComponent(token)}`;

    void this.mail
      .send(
        user.email,
        'Réinitialisation de votre mot de passe',
        `<p style="margin:0 0 8px;">Bonjour ${user.firstName ?? ''},</p>
         <p style="margin:0 0 20px;color:#6b6b6b;">
           Vous avez demandé à réinitialiser le mot de passe de votre compte
           Easy Shop Network. Cliquez sur le bouton ci-dessous pour en choisir
           un nouveau. Ce lien expire dans 1 heure.
         </p>
         <p style="margin:0 0 24px;">${this.mail.button('Réinitialiser mon mot de passe', link)}</p>
         <p style="margin:0;color:#6b6b6b;font-size:13px;">
           Si vous n'êtes pas à l'origine de cette demande, ignorez cet email :
           votre mot de passe restera inchangé.
         </p>`,
      )
      .catch(() => undefined);

    return generic;
  }

  // Réinitialise le mot de passe à partir du jeton reçu par email.
  async resetPassword(dto: ResetPasswordDto) {
    if (!this.localMode) {
      throw new BadRequestException(
        'Password reset is managed by Supabase in this mode',
      );
    }
    let payload: { sub: string; email: string; pf?: string };
    try {
      payload = jwt.verify(dto.token, this.jwtSecret, {
        audience: 'reset',
      }) as { sub: string; email: string; pf?: string };
    } catch {
      throw new BadRequestException(
        'Ce lien de réinitialisation est invalide ou a expiré.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    // L'empreinte doit correspondre au hash courant : sinon le lien a déjà
    // servi (ou le mot de passe a changé entre-temps) → refus.
    if (
      !user?.passwordHash ||
      payload.pf !== this.passwordFingerprint(user.passwordHash)
    ) {
      throw new BadRequestException(
        'Ce lien de réinitialisation a déjà été utilisé ou a expiré.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) },
    });

    void this.mail
      .send(
        user.email,
        'Votre mot de passe a été modifié',
        `<p style="margin:0 0 8px;">Bonjour ${user.firstName ?? ''},</p>
         <p style="margin:0 0 20px;color:#6b6b6b;">
           Le mot de passe de votre compte Easy Shop Network vient d'être
           modifié avec succès. Vous pouvez désormais vous connecter avec votre
           nouveau mot de passe.
         </p>
         <p style="margin:0;color:#6b6b6b;font-size:13px;">
           Si vous n'êtes pas à l'origine de ce changement, contactez notre
           support immédiatement.
         </p>`,
      )
      .catch(() => undefined);

    return { success: true };
  }

  // Empreinte courte et non réversible du hash de mot de passe, pour lier un
  // jeton de réinitialisation à l'état du mot de passe au moment de l'émission.
  private passwordFingerprint(passwordHash: string): string {
    return createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
  }

  // Accès sûr au client Supabase (mode d'auth Supabase uniquement) : renvoie
  // une erreur 503 explicite si Supabase n'est pas configuré plutôt que de
  // planter sur un accès à null.
  private requireSupabase(): SupabaseClient {
    if (!this.supabase.client) {
      throw new ServiceUnavailableException(
        "L'authentification Supabase n'est pas configurée sur ce serveur.",
      );
    }
    return this.supabase.client;
  }

  private issueTokens(userId: string, email: string) {
    const accessToken = jwt.sign({ sub: userId, email }, this.jwtSecret, {
      audience: 'authenticated',
      expiresIn: ACCESS_TTL,
    });
    const refreshToken = jwt.sign({ sub: userId, email }, this.jwtSecret, {
      audience: 'refresh',
      expiresIn: REFRESH_TTL,
    });
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL };
  }

  private toTokens(session: Session | null) {
    if (!session) {
      return { accessToken: null, refreshToken: null };
    }
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresIn: session.expires_in,
    };
  }
}
