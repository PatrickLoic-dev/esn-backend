import {
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
import { JwtPayload } from '../auth/decorators/current-user.decorator';
import { isStaff } from '../auth/roles.util';
import { SavGateway } from './sav.gateway';

const MESSAGE_INCLUDE = {
  author: {
    select: { id: true, firstName: true, lastName: true, role: true },
  },
} as const;

const TICKET_USER_INCLUDE = {
  user: {
    select: { id: true, email: true, firstName: true, lastName: true },
  },
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
        messages: {
          create: { authorId: user.sub, content: dto.message },
        },
      },
      include: { messages: { include: MESSAGE_INCLUDE }, ...TICKET_USER_INCLUDE },
    });

    void this.mail.send(
      user.email,
      `Ticket received: ${ticket.subject}`,
      `<p>Your support ticket <b>#${ticket.id}</b> has been created. Our team will reply shortly.</p>`,
    );

    return ticket;
  }

  findAllForUser(user: JwtPayload) {
    const where = isStaff(user.role) ? {} : { userId: user.sub };
    return this.prisma.ticket.findMany({
      where,
      include: {
        _count: { select: { messages: true } },
        ...TICKET_USER_INCLUDE,
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
        ...TICKET_USER_INCLUDE,
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

    // a staff reply moves the ticket from OPEN to IN_PROGRESS
    const nextStatus =
      isStaff(user.role) && ticket.status === TicketStatus.OPEN
        ? TicketStatus.IN_PROGRESS
        : ticket.status;

    const [message] = await this.prisma.$transaction([
      this.prisma.ticketMessage.create({
        data: { ticketId, authorId: user.sub, content },
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
    return message;
  }

  async updateStatus(id: string, status: TicketStatus) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { status },
    });
    this.gateway.emitStatus(id, status);
    return updated;
  }

  assertCanAccess(ownerId: string, user: JwtPayload) {
    if (!isStaff(user.role) && ownerId !== user.sub) {
      throw new ForbiddenException();
    }
  }
}
