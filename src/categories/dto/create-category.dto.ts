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

// Keys of the frontend's icon registry (src/lib/categoryIcon.ts) — kept in
// sync manually since it's a small, curated set.
export const CATEGORY_ICONS = [
  'Leaf',
  'Pill',
  'Droplet',
  'Flower2',
  'Dumbbell',
  'Sparkles',
  'Coffee',
  'Moon',
  'Waves',
  'Laptop',
  'Shirt',
  'Sofa',
  'BookOpen',
  'Baby',
  'Apple',
  'Tag',
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

  // Icon key shown on the homepage "Shop by Category" section (only used
  // when `featured` is true).
  @IsOptional()
  @IsIn(CATEGORY_ICONS as unknown as string[])
  icon?: string;

  // Whether this category is shown in the homepage "Shop by Category" section.
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
