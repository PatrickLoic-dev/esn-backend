import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../decorators/current-user.decorator';

// Verifies Supabase-issued access tokens (HS256, audience "authenticated").
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('SUPABASE_JWT_SECRET'),
      audience: 'authenticated',
    });
  }

  async validate(payload: { sub: string; email: string }): Promise<JwtPayload> {
    // Role lives in our DB, not in the Supabase token
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { role: true },
    });
    if (!user) {
      throw new UnauthorizedException('User profile not found');
    }
    return { sub: payload.sub, email: payload.email, role: user.role };
  }
}
