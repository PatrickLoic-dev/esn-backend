import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// What a signed-in customer can control about their own testimonial —
// author identity comes from their account, not free text, so a submission
// can't impersonate someone else.
export class SubmitTestimonialDto {
  @IsString()
  @MaxLength(1000)
  quote: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}
