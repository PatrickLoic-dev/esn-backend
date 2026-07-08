import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  fullName: string;

  @IsEmail()
  email: string;

  @IsEnum(Role)
  role: Role;

  // { [module]: { view, create, edit, delete } }
  @IsOptional()
  permissions?: Record<
    string,
    { view: boolean; create: boolean; edit: boolean; delete: boolean }
  >;
}
