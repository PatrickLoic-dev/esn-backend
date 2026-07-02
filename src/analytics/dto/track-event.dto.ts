import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class TrackEventDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
