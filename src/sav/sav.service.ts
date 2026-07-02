import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { JwtPayload } from '../auth/decorators/current-user.decorator';

const MESSAGE_INCLUDE = {
  author: {
    select: { id: true, firstName: true, lastName: true, role: true },
  },
} as const;

@Injectable()
export class SavService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  async createTicket(user: JwtPayload, dto: CreateTicketDto) {
    const ticket = await this.prisma.ticket.create({
      data: {
        userId: user.sub,
        subject: dto.subject,
        messages: {
          create: { authorId: user.sub, content: dto.message },
        },
      },
      include: { messages: { include: MESSAGE_INCLUDE } },
    });

    void this.mail.send(
      user.email,
      `Ticket received: ${ticket.subject}`,
      `<p>Your support ticket <b>#${ticket.id}</b> has been created. Our team will reply shortly.</p>`,
    );

    return ticket;
  }

  findAllForUser(user: JwtPayload) {
    const where = user.role === Role.ADMIN ? {} : { userId: user.sub };
    return this.prisma.ticket.findMany({
      where,
      include: { _count: { select: { messages: true } } },
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
      },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
    this.assertCanAccess(ticket.userId, user);
    return ticket;
  }

  async addMessage(ticketId: string, user: JwtPayload, content: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }
    this.assertCanAccess(ticket.userId, user);

    const [message] = await this.prisma.$transaction([
      this.prisma.ticketMessage.create({
        data: { ticketId, authorId: user.sub, content },
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.ticket.update({
        where: { id: ticketId },
        data: {
          updatedAt: new Date(),
          // an admin reply moves the ticket to IN_PROGRESS
          ...(user.role === Role.ADMIN && ticket.status === TicketStatus.OPEN
            ? { status: TicketStatus.IN_PROGRESS }
            : {}),
        },
      }),
    ]);
    return message;
  }

  async updateStatus(id: string, status: TicketStatus) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
    return this.prisma.ticket.update({ where: { id }, data: { status } });
  }

  assertCanAccess(ownerId: string, user: JwtPayload) {
    if (user.role !== Role.ADMIN && ownerId !== user.sub) {
      throw new ForbiddenException();
    }
  }
}
