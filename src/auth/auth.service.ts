import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Session } from '@supabase/supabase-js';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const ACCESS_TTL = 60 * 60; // 1h
const REFRESH_TTL = 60 * 60 * 24 * 7; // 7d

@Injectable()
export class AuthService {
  private readonly localMode: boolean;
  private readonly jwtSecret: string;

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

    const { data, error } = await this.supabase.client.auth.signUp({
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
      return this.issueTokens(user.id, user.email);
    }

    const { data, error } =
      await this.supabase.client.auth.signInWithPassword({
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

    const { data, error } = await this.supabase.client.auth.refreshSession({
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
