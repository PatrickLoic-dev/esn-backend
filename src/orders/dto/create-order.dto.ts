import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class OrderItemDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateOrderDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  // { fullName, email, phone, address, city, postalCode, country }
  @IsOptional()
  @IsObject()
  shippingAddress?: Record<string, string>;

  @IsOptional()
  @IsString()
  shippingMethod?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  shippingCost?: number;

  // MLM points to use to reduce the amount due (100 pts = 10 FCFA)
  @IsOptional()
  @IsInt()
  @Min(0)
  pointsToUse?: number;
}
