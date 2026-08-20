import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PromoScope } from '@prisma/client';

export class CreatePromoCodeDto {
  @IsString()
  @MaxLength(50)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  percentOff: number;

  @IsOptional()
  @IsEnum(PromoScope)
  scope?: PromoScope;

  // Required when scope = CATEGORY, ignored otherwise.
  @ValidateIf((o: CreatePromoCodeDto) => o.scope === PromoScope.CATEGORY)
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
