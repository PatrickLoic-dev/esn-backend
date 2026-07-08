import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const PROFILE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarUrl: true,
  role: true,
  permissions: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

function splitName(fullName: string) {
  const [firstName, ...rest] = fullName.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') || null };
}

function generatePassword() {
  // 12 chars, URL-safe — sent to the new admin by email
  return randomBytes(9).toString('base64url');
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  // Admin: list all users with their order counts
  findAll() {
    return this.prisma.user.findMany({
      select: { ...PROFILE_SELECT, _count: { select: { orders: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Admin: create a staff account; the premade password is emailed
  async createUser(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new BadRequestException('A user with this email already exists');
    }
    const password = generatePassword();
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        ...splitName(dto.fullName),
        role: dto.role,
        permissions: (dto.permissions ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        passwordHash: await bcrypt.hash(password, 10),
      },
      select: PROFILE_SELECT,
    });

    void this.mail
      .send(
        dto.email,
        'Your Easy Shop Network admin account',
        `<p>Hello ${dto.fullName},</p>
         <p>An administrator account has been created for you on Easy Shop Network.</p>
         <p><strong>Email:</strong> ${dto.email}<br/>
         <strong>Temporary password:</strong> ${password}</p>
         <p>Please sign in at the admin panel and change this password immediately.</p>`,
      )
      .catch(() => undefined);

    return user;
  }

  // Admin: update role / permissions / active flag / name
  async updateUser(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.fullName ? splitName(dto.fullName) : {}),
        ...(dto.role ? { role: dto.role } : {}),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
        ...(dto.permissions === undefined
          ? {}
          : { permissions: dto.permissions as Prisma.InputJsonValue }),
      },
      select: PROFILE_SELECT,
    });
  }

  // Admin: deactivate rather than hard-delete (orders reference users)
  async deactivate(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: PROFILE_SELECT,
    });
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_SELECT,
    });
    if (!user) {
      throw new NotFoundException('Profile not found');
    }
    return user;
  }

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: PROFILE_SELECT,
    });
  }
}
