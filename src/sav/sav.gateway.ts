import {
  forwardRef,
  Inject,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TicketStatus } from '@prisma/client';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { SavService } from './sav.service';
import { JwtPayload } from '../auth/decorators/current-user.decorator';

interface AuthedSocket extends Socket {
  data: { user: JwtPayload };
}

// Instant messaging on support tickets. Clients connect with
// `io('/sav', { auth: { token: '<supabase access token>' } })`,
// emit `ticket:join` with a ticketId, then exchange `ticket:message`.
@WebSocketGateway({ namespace: 'sav', cors: { origin: '*' } })
export class SavGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SavGateway.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    @Inject(forwardRef(() => SavService))
    private savService: SavService,
  ) {}

  // Called by SavService so REST-originated changes also reach live sockets
  emitMessage(ticketId: string, message: unknown) {
    this.server?.to(`ticket:${ticketId}`).emit('ticket:message', message);
  }

  emitStatus(ticketId: string, status: TicketStatus) {
    this.server?.to(`ticket:${ticketId}`).emit('ticket:status', { status });
  }

  async handleConnection(client: AuthedSocket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) {
        throw new UnauthorizedException();
      }
      const payload = jwt.verify(
        token,
        this.config.getOrThrow<string>('SUPABASE_JWT_SECRET'),
        { audience: 'authenticated' },
      ) as { sub: string; email: string };

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { role: true },
      });
      if (!user) {
        throw new UnauthorizedException();
      }
      client.data.user = {
        sub: payload.sub,
        email: payload.email,
        role: user.role,
      };
    } catch {
      this.logger.warn(`Rejected socket ${client.id}: invalid token`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('ticket:join')
  async joinTicket(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() ticketId: string,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new WsException('Ticket not found');
    }
    this.savService.assertCanAccess(ticket.userId, client.data.user);
    await client.join(`ticket:${ticketId}`);
    return { joined: ticketId };
  }

  @SubscribeMessage('ticket:message')
  async sendMessage(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { ticketId: string; content: string },
  ) {
    // addMessage persists and broadcasts to the room via emitMessage()
    const message = await this.savService.addMessage(
      body.ticketId,
      client.data.user,
      body.content,
    );
    return message;
  }
}
