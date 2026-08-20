import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTestimonialDto } from './dto/create-testimonial.dto';
import { UpdateTestimonialDto } from './dto/update-testimonial.dto';
import { SubmitTestimonialDto } from './dto/submit-testimonial.dto';

@Injectable()
export class TestimonialsService {
  constructor(private prisma: PrismaService) {}

  // Staff-curated testimonial: goes live immediately, no associated account.
  create(dto: CreateTestimonialDto) {
    return this.prisma.testimonial.create({ data: dto });
  }

  // Customer's own testimonial: one per account (upsert, like a product
  // review). Author identity is always pulled fresh from their profile —
  // never taken as free text — and every submission (new or edited) goes
  // back to `isActive: false` pending admin approval.
  async submitOwn(userId: string, dto: SubmitTestimonialDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true, avatarUrl: true },
    });
    const authorName =
      [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
    return this.prisma.testimonial.upsert({
      where: { userId },
      create: {
        userId,
        authorName,
        authorTitle: 'Verified Customer',
        avatarUrl: user.avatarUrl,
        quote: dto.quote,
        rating: dto.rating,
        isActive: false,
      },
      update: {
        authorName,
        avatarUrl: user.avatarUrl,
        quote: dto.quote,
        rating: dto.rating,
        isActive: false,
      },
    });
  }

  // The signed-in customer's own testimonial, if they've submitted one.
  findOwn(userId: string) {
    return this.prisma.testimonial.findUnique({ where: { userId } });
  }

  // Public: active testimonials only, for the homepage section.
  findActive() {
    return this.prisma.testimonial.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  // Admin: everything, including hidden ones.
  findAllForAdmin() {
    return this.prisma.testimonial.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async update(id: string, dto: UpdateTestimonialDto) {
    await this.ensureExists(id);
    return this.prisma.testimonial.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.testimonial.delete({ where: { id } });
    return { deleted: true };
  }

  private async ensureExists(id: string) {
    const found = await this.prisma.testimonial.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException(`Testimonial ${id} not found`);
    }
  }
}
