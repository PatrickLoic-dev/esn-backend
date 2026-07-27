import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import { JwtPayload } from '../auth/decorators/current-user.decorator';
import { isStaff } from '../auth/roles.util';

const QUOTE_INCLUDE = {
  product: { select: { id: true, name: true, imageUrl: true } },
  user: {
    select: { id: true, email: true, firstName: true, lastName: true },
  },
} as const;

@Injectable()
export class QuotesService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  async create(user: JwtPayload, dto: CreateQuoteDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product || !product.isActive) {
      throw new NotFoundException(`Product ${dto.productId} not found`);
    }

    const quote = await this.prisma.quoteRequest.create({
      data: {
        productId: dto.productId,
        userId: user.sub,
        quantity: dto.quantity,
        message: dto.message,
      },
      include: QUOTE_INCLUDE,
    });

    void this.mail
      .send(
        user.email,
        `Your quote request — ${product.name}`,
        `${this.mail.heading('Quote request received', 22)}
         <p style="margin:20px 0 4px;color:#1f2124;">Hello ${quote.user.firstName ?? ''},</p>
         <p style="margin:0 0 20px;color:#6b6b6b;">
           Your quote request for <strong style="color:#1f2124;">${product.name}</strong>
           (quantity: ${dto.quantity}) has been recorded. Our team will get back to
           you with a proposal as soon as possible.
         </p>
         <div style="text-align:center;margin:8px 0;">
           ${this.mail.button('View my request', this.mail.appUrl(`/account/quotes`), 'primary')}
         </div>`,
      )
      .catch(() => undefined);

    return quote;
  }

  findMine(user: JwtPayload) {
    return this.prisma.quoteRequest.findMany({
      where: { userId: user.sub },
      include: QUOTE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  // Staff: every quote request across all customers.
  findAllForAdmin() {
    return this.prisma.quoteRequest.findMany({
      include: QUOTE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: JwtPayload) {
    const quote = await this.prisma.quoteRequest.findUnique({
      where: { id },
      include: QUOTE_INCLUDE,
    });
    if (!quote) {
      throw new NotFoundException(`Quote ${id} not found`);
    }
    if (!isStaff(user.role) && quote.userId !== user.sub) {
      throw new ForbiddenException();
    }
    return quote;
  }

  // Staff-only: price the quote / change its status.
  async update(id: string, dto: UpdateQuoteDto) {
    const existing = await this.prisma.quoteRequest.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Quote ${id} not found`);
    }
    const quote = await this.prisma.quoteRequest.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.quotedPrice !== undefined ? { quotedPrice: dto.quotedPrice } : {}),
        ...(dto.quotedMessage !== undefined
          ? { quotedMessage: dto.quotedMessage }
          : {}),
      },
      include: QUOTE_INCLUDE,
    });

    // Notify the customer whenever staff sets a price or changes the status.
    if (dto.status || dto.quotedPrice !== undefined) {
      void this.mail
        .send(
          quote.user.email,
          `Your quote for ${quote.product.name} has been updated`,
          `${this.mail.heading('Update on your quote', 22)}
           <p style="margin:20px 0 4px;color:#1f2124;">Hello ${quote.user.firstName ?? ''},</p>
           <p style="margin:0 0 12px;color:#6b6b6b;">
             Your quote request for <strong style="color:#1f2124;">${quote.product.name}</strong>
             has been updated: <strong style="color:#1f2124;">${STATUS_LABEL[quote.status]}</strong>.
           </p>
           ${
             quote.quotedPrice
               ? `<div style="background:#f5f5f5;border-radius:12px;padding:16px 20px;margin-bottom:16px;">
                   <div style="font-size:13px;color:#6b6b6b;">Proposed price</div>
                   <div style="font-weight:800;color:#1f2124;font-size:20px;">${Number(quote.quotedPrice).toFixed(2)} FCFA</div>
                   ${quote.quotedMessage ? `<div style="margin-top:8px;color:#6b6b6b;font-size:13px;">${quote.quotedMessage}</div>` : ''}
                 </div>`
               : ''
           }
           <div style="text-align:center;margin:8px 0;">
             ${this.mail.button('View my request', this.mail.appUrl('/account/quotes'), 'primary')}
           </div>`,
        )
        .catch(() => undefined);
    }

    return quote;
  }
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'pending',
  QUOTED: 'quote provided',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
};
