import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { JwtPayload } from '../auth/decorators/current-user.decorator';
import { isStaff } from '../auth/roles.util';
import { SavGateway } from './sav.gateway';

const MESSAGE_INCLUDE = {
  author: {
    select: { id: true, firstName: true, lastName: true, role: true },
  },
} as const;

const TICKET_META_INCLUDE = {
  user: {
    select: { id: true, email: true, firstName: true, lastName: true },
  },
  assignee: { select: { id: true, firstName: true, lastName: true } },
  order: { select: { id: true } },
} as const;

@Injectable()
export class SavService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    // forwardRef breaks the SavService <-> SavGateway circular dependency
    @Inject(forwardRef(() => SavGateway))
    private gateway: SavGateway,
  ) {}

  async createTicket(user: JwtPayload, dto: CreateTicketDto) {
    const ticket = await this.prisma.ticket.create({
      data: {
        userId: user.sub,
        subject: dto.subject,
        priority: dto.priority,
        category: dto.category,
        orderId: dto.orderId,
        messages: {
          create: { authorId: user.sub, content: dto.message },
        },
      },
      include: { messages: { include: MESSAGE_INCLUDE }, ...TICKET_META_INCLUDE },
    });

    void this.mail.send(
      user.email,
      `Ticket received: ${ticket.subject}`,
      `${this.mail.heading('We have received your request', 22)}
       <p style="margin:20px 0 4px;color:#1f2124;">Hello ${user.email.split('@')[0]},</p>
       <p style="margin:0 0 20px;color:#6b6b6b;">
         Your ticket <strong style="color:#1f2124;">${ticket.subject}</strong>
         (no. TKT-${String(ticket.number).padStart(3, '0')}) has been recorded.
         Our team will respond as soon as possible.
       </p>
       <div style="text-align:center;margin:8px 0;">
         ${this.mail.button('View my ticket', this.mail.appUrl(`/account/support/${ticket.id}`), 'primary')}
       </div>`,
    );

    return ticket;
  }

  findAllForUser(user: JwtPayload) {
    const where = isStaff(user.role) ? {} : { userId: user.sub };
    return this.prisma.ticket.findMany({
      where,
      include: {
        _count: { select: { messages: true } },
        ...TICKET_META_INCLUDE,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // Customer area: always limited to the current user's tickets, even for a
  // staff account (which sees everything via the admin panel).
  findOwn(user: JwtPayload) {
    return this.prisma.ticket.findMany({
      where: { userId: user.sub },
      include: {
        _count: { select: { messages: true } },
        ...TICKET_META_INCLUDE,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string, user: JwtPayload) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        messages: {
          include: MESSAGE_INCLUDE,
          orderBy: { createdAt: 'asc' },
        },
        ...TICKET_META_INCLUDE,
      },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
    this.assertCanAccess(ticket.userId, user);
    return ticket;
  }

  async addMessage(
    ticketId: string,
    user: JwtPayload,
    input: { content?: string; imageUrl?: string },
  ) {
    const content = input.content?.trim() ?? '';
    const imageUrl = input.imageUrl;
    if (!content && !imageUrl) {
      throw new BadRequestException('Un message ou une image est requis.');
    }
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }
    this.assertCanAccess(ticket.userId, user);

    // A closed ticket no longer accepts new messages (chat locked).
    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException(
        'This ticket is closed — you can no longer send messages to it.',
      );
    }

    // a staff reply moves the ticket from OPEN to IN_PROGRESS
    const nextStatus =
      isStaff(user.role) && ticket.status === TicketStatus.OPEN
        ? TicketStatus.IN_PROGRESS
        : ticket.status;

    const [message] = await this.prisma.$transaction([
      this.prisma.ticketMessage.create({
        data: { ticketId, authorId: user.sub, content, imageUrl },
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.ticket.update({
        where: { id: ticketId },
        data: { updatedAt: new Date(), status: nextStatus },
      }),
    ]);

    // push to everyone watching this ticket, regardless of how they sent it
    this.gateway.emitMessage(ticketId, message);
    if (nextStatus !== ticket.status) {
      this.gateway.emitStatus(ticketId, nextStatus);
    }

    // Staff reply → notify the customer by email
    if (isStaff(user.role)) {
      const owner = await this.prisma.user.findUnique({
        where: { id: ticket.userId },
        select: { email: true, firstName: true },
      });
      if (owner) {
        void this.mail
          .send(
            owner.email,
            `Reply to your ticket: ${ticket.subject}`,
            `${this.mail.heading('New reply to your ticket', 22)}
             <p style="margin:20px 0 4px;color:#1f2124;">Hello ${owner.firstName ?? ''},</p>
             <p style="margin:0 0 12px;color:#6b6b6b;">
               Our team replied to your ticket
               <strong style="color:#1f2124;">${ticket.subject}</strong>:
             </p>
             <blockquote style="margin:0 0 20px;padding:12px 16px;border-left:3px solid #e6e6e6;
               background:#f5f5f5;border-radius:6px;color:#1f2124;">
               ${content || '📎 Attachment (image)'}
             </blockquote>
             <div style="text-align:center;margin:8px 0;">
               ${this.mail.button('Reply', this.mail.appUrl(`/account/support/${ticket.id}`), 'primary')}
             </div>`,
          )
          .catch(() => undefined);
      }
    }
    return message;
  }

  // Admin: update status / priority / category / assignee
  async update(id: string, dto: UpdateTicketDto) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.priority ? { priority: dto.priority } : {}),
        ...(dto.category === undefined ? {} : { category: dto.category }),
        ...(dto.assigneeId === undefined
          ? {}
          : { assigneeId: dto.assigneeId }),
      },
      include: TICKET_META_INCLUDE,
    });
    if (dto.status) {
      this.gateway.emitStatus(id, dto.status);
    }
    return updated;
  }

  assertCanAccess(ownerId: string, user: JwtPayload) {
    if (!isStaff(user.role) && ownerId !== user.sub) {
      throw new ForbiddenException();
    }
  }
}
