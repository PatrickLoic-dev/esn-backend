import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ProductFulfilment } from '@prisma/client';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  comparePrice?: number;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsInt()
  @Min(0)
  stock: number;

  // Reorder threshold — surfaced in the admin inventory view.
  @IsOptional()
  @IsInt()
  @Min(0)
  stockMin?: number;

  // Max shelf/warehouse capacity — surfaced in the admin inventory view.
  @IsOptional()
  @IsInt()
  @Min(0)
  stockMax?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // STOCK (default) sells from `stock` via the cart; MADE_TO_ORDER routes the
  // customer to a quote request instead (no stock tracking, no "MTO" label
  // shown to the customer).
  @IsOptional()
  @IsEnum(ProductFulfilment)
  fulfilment?: ProductFulfilment;
}
