import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export const CATEGORY_COLORS = [
  'Red',
  'Blue',
  'Green',
  'Purple',
  'Orange',
  'Pink',
] as const;

export class CreateCategoryDto {
  @IsString()
  name: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase kebab-case',
  })
  slug: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(CATEGORY_COLORS as unknown as string[])
  color?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
