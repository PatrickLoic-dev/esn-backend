import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { QuoteStatus } from '@prisma/client';

// Staff-only: respond to a quote request.
export class UpdateQuoteDto {
  @IsOptional()
  @IsEnum(QuoteStatus)
  status?: QuoteStatus;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  quotedPrice?: number;

  @IsOptional()
  @IsString()
  quotedMessage?: string;
}
