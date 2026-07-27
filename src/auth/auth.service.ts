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
    // Public frontend base URL, used to build the reset-password link.
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
        throw new BadRequestException('This email address is already in use.');
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
        .send(dto.email, 'Welcome to Easy Shop Network', this.welcomeBody(dto.firstName))
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
      'Welcome to Easy Shop Network',
      this.welcomeBody(dto.firstName),
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
        throw new UnauthorizedException('Incorrect email or password.');
      }
      if (!user.isActive) {
        throw new UnauthorizedException('This account has been deactivated.');
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      // Security notification: email sent on every sign-in
      const when = new Date().toLocaleString('en-US');
      void this.mail
        .send(
          user.email,
          'New sign-in to your account',
          `${this.mail.heading('New sign-in', 22)}
           <p style="margin:20px 0 4px;color:#1f2124;">Hello ${user.firstName ?? ''},</p>
           <p style="margin:0 0 8px;color:#6b6b6b;">
             A sign-in to your Easy Shop Network account just occurred on
             <strong style="color:#1f2124;">${when}</strong>.
           </p>
           <p style="margin:0 0 20px;color:#6b6b6b;">
             If this wasn't you, reset your password immediately.
           </p>
           <div style="text-align:center;margin:8px 0;">
             ${this.mail.button('Secure my account', this.mail.appUrl('/auth/forgot-password'), 'primary')}
           </div>`,
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
      throw new UnauthorizedException('Incorrect email or password.');
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
        throw new UnauthorizedException('Your session has expired, please sign in again.');
      }
    }

    const { data, error } = await this.requireSupabase().auth.refreshSession({
      refresh_token: dto.refreshToken,
    });
    if (error || !data.session) {
      throw new UnauthorizedException('Your session has expired, please sign in again.');
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
      throw new UnauthorizedException('The current password is incorrect.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) },
    });
    return { success: true };
  }

  // Forgot password: sends a password reset link by email.
  // Same response whether the account exists or not (no email enumeration).
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
    // No account, or account without a local password → stop silently
    // (same response), no email sent.
    if (!user?.passwordHash || !user.isActive) {
      return generic;
    }

    // Signed token tied to a fingerprint of the current hash: as soon as the
    // password changes, the link becomes invalid (single use, no schema migration).
    const token = jwt.sign(
      { sub: user.id, email: user.email, pf: this.passwordFingerprint(user.passwordHash) },
      this.jwtSecret,
      { audience: 'reset', expiresIn: RESET_TTL },
    );
    const link = `${this.frontendUrl}/auth/reset-password?token=${encodeURIComponent(token)}`;

    void this.mail
      .send(
        user.email,
        'Reset your password',
        `${this.mail.heading('Reset your password', 22)}
         <p style="margin:20px 0 4px;color:#1f2124;">Hello ${user.firstName ?? ''},</p>
         <p style="margin:0 0 20px;color:#6b6b6b;">
           You requested to reset the password for your Easy Shop Network
           account. Click the button below to choose a new one. This link
           expires in 1 hour.
         </p>
         <div style="text-align:center;margin:8px 0 24px;">
           ${this.mail.button('Reset my password', link, 'primary')}
         </div>
         <p style="margin:0;color:#6b6b6b;font-size:13px;">
           If this wasn't you, ignore this email: your password will remain
           unchanged.
         </p>`,
      )
      .catch(() => undefined);

    return generic;
  }

  // Resets the password from the token received by email.
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
        'This reset link is invalid or has expired.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    // The fingerprint must match the current hash: otherwise the link has
    // already been used (or the password changed since) → reject.
    if (
      !user?.passwordHash ||
      payload.pf !== this.passwordFingerprint(user.passwordHash)
    ) {
      throw new BadRequestException(
        'This reset link has already been used or has expired.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) },
    });

    void this.mail
      .send(
        user.email,
        'Your password has been changed',
        `${this.mail.heading('Password changed', 22)}
         <p style="margin:20px 0 4px;color:#1f2124;">Hello ${user.firstName ?? ''},</p>
         <p style="margin:0 0 20px;color:#6b6b6b;">
           The password for your Easy Shop Network account has just been
           changed successfully. You can now sign in with your new password.
         </p>
         <div style="text-align:center;margin:8px 0 20px;">
           ${this.mail.button('Sign in', this.mail.appUrl('/auth/sign-in'), 'primary')}
         </div>
         <p style="margin:0;color:#6b6b6b;font-size:13px;">
           If this wasn't you, contact our support immediately.
         </p>`,
      )
      .catch(() => undefined);

    return { success: true };
  }

  // Short, non-reversible fingerprint of the password hash, used to tie a
  // reset token to the state of the password at the time it was issued.
  private passwordFingerprint(passwordHash: string): string {
    return createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
  }

  // Safe access to the Supabase client (Supabase auth mode only): returns an
  // explicit 503 error if Supabase isn't configured rather than crashing on
  // a null access.
  private requireSupabase(): SupabaseClient {
    if (!this.supabase.client) {
      throw new ServiceUnavailableException(
        'Supabase authentication is not configured on this server.',
      );
    }
    return this.supabase.client;
  }

  private welcomeBody(firstName?: string | null): string {
    return `${this.mail.heading('Welcome!', 26)}
      <p style="margin:20px 0 4px;color:#1f2124;">Hello ${firstName ?? ''},</p>
      <p style="margin:0 0 20px;color:#6b6b6b;">
        Your Easy Shop Network account has been created. Discover our catalog
        and enjoy a simple, fast shopping experience.
      </p>
      <div style="text-align:center;margin:8px 0;">
        ${this.mail.button('Discover the shop', this.mail.appUrl('/shop'), 'primary')}
        &nbsp;
        ${this.mail.button('My account', this.mail.appUrl('/account'), 'secondary')}
      </div>`;
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
