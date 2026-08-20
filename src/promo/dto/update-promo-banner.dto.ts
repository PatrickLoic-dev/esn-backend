import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePromoBannerDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
