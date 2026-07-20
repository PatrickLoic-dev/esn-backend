import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateMlmConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  level1Rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  level2Rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  level3Rate?: number;

  // Valeur d'un point en FCFA à la dépense (0,1 => 100 pts = 10 FCFA)
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  pointValueFcfa?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxDirectReferrals?: number;
}
