import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { TestimonialsService } from './testimonials.service';
import { CreateTestimonialDto } from './dto/create-testimonial.dto';
import { UpdateTestimonialDto } from './dto/update-testimonial.dto';
import { SubmitTestimonialDto } from './dto/submit-testimonial.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('testimonials')
@Controller('testimonials')
export class TestimonialsController {
  constructor(private testimonials: TestimonialsService) {}

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateTestimonialDto) {
    return this.testimonials.create(dto);
  }

  // Any signed-in customer: submit or edit their own testimonial. Goes back
  // to pending review each time.
  @ApiBearerAuth()
  @Post('me')
  submitOwn(
    @CurrentUser('sub') userId: string,
    @Body() dto: SubmitTestimonialDto,
  ) {
    return this.testimonials.submitOwn(userId, dto);
  }

  // Any signed-in customer: fetch their own testimonial (or null), so the
  // form can show "pending approval" / let them edit it.
  @ApiBearerAuth()
  @Get('me')
  findOwn(@CurrentUser('sub') userId: string) {
    return this.testimonials.findOwn(userId);
  }

  // Public: homepage testimonials section.
  @Public()
  @Get()
  findActive() {
    return this.testimonials.findActive();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('admin/all')
  findAllForAdmin() {
    return this.testimonials.findAllForAdmin();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTestimonialDto,
  ) {
    return this.testimonials.update(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.testimonials.remove(id);
  }
}
