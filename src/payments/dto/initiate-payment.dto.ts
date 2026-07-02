import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class InitiatePaymentDto {
  @IsUUID()
  orderId: string;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  // Required for MOBILE_MONEY (e.g. +2376xxxxxxxx)
  @IsOptional()
  @IsString()
  phone?: string;
}
