import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject: string;

  @IsString()
  @MinLength(1)
  message: string;
}
