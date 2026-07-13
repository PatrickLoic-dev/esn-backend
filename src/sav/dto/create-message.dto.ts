import { IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class CreateMessageDto {
  // Le texte est requis SAUF si une image est jointe (message image seul).
  @ValidateIf((o: CreateMessageDto) => !o.imageUrl)
  @IsString()
  @MinLength(1)
  content?: string;

  // URL d'une image téléversée (capture d'écran) — optionnelle.
  @IsOptional()
  @IsString()
  imageUrl?: string;
}
