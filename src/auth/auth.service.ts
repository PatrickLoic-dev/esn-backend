import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Session } from '@supabase/supabase-js';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
    private mail: MailService,
  ) {}

  async register(dto: RegisterDto) {
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
    const { data, error } = await this.supabase.client.auth.refreshSession({
      refresh_token: dto.refreshToken,
    });
    if (error || !data.session) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.toTokens(data.session);
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
