import { IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class CreateMessageDto {
  // Le texte est requis SAUF si une image est jointe (message image seul).
  @ValidateIf((o: CreateMessageDto) => !o.imageUrl)
  @IsString()
  @MinLength(1)
  content?: string;

  // URL of an uploaded image (screenshot) — optional.
  @IsOptional()
  @IsString()
  imageUrl?: string;
}
