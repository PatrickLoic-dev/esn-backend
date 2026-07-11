import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtPayload } from '../auth/decorators/current-user.decorator';
import { isStaff } from '../auth/roles.util';

const STATUS_MESSAGE: Record<OrderStatus, string> = {
  PENDING: 'a bien été reçue et est en attente de paiement',
  PAID: 'a été payée et est en cours de préparation',
  SHIPPED: 'a été expédiée et est en route',
  DELIVERED: 'a été livrée — bonne réception !',
  CANCELLED: 'a été annulée',
};

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  async create(userId: string, dto: CreateOrderDto) {
    // Lignes de récapitulatif (nom/quantité/prix) pour l'email de confirmation
    const summaryLines: string[] = [];

    const order = await this.prisma.$transaction(async (tx) => {
      let total = new Prisma.Decimal(0);
      const items: {
        productId: string;
        quantity: number;
        unitPrice: Prisma.Decimal;
      }[] = [];

      for (const item of dto.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });
        if (!product || !product.isActive) {
          throw new NotFoundException(`Product ${item.productId} not found`);
        }
        if (product.stock < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for product ${product.name}`,
          );
        }
        await tx.product.update({
          where: { id: product.id },
          data: { stock: { decrement: item.quantity } },
        });
        total = total.add(product.price.mul(item.quantity));
        items.push({
          productId: product.id,
          quantity: item.quantity,
          unitPrice: product.price,
        });
        summaryLines.push(
          `${item.quantity} × ${product.name} — ${product.price
            .mul(item.quantity)
            .toFixed(2)} FCFA`,
        );
      }

      const shippingCost = dto.shippingCost
        ? new Prisma.Decimal(dto.shippingCost)
        : new Prisma.Decimal(0);

      return tx.order.create({
        data: {
          userId,
          total: total.add(shippingCost),
          shippingAddress: (dto.shippingAddress ??
            undefined) as Prisma.InputJsonValue,
          shippingMethod: dto.shippingMethod,
          shippingCost,
          items: { create: items },
        },
        include: {
          items: true,
          user: { select: { email: true, firstName: true } },
        },
      });
    });

    // Email de confirmation de commande (fire-and-forget, ne bloque pas)
    const ref = order.id.slice(0, 8).toUpperCase();
    void this.mail
      .send(
        order.user.email,
        `Confirmation de votre commande ${ref}`,
        `<p>Bonjour ${order.user.firstName ?? ''},</p>
         <p>Merci ! Votre commande <b>${ref}</b> a bien été enregistrée.</p>
         <ul>${summaryLines.map((l) => `<li>${l}</li>`).join('')}</ul>
         <p><b>Total : ${order.total.toFixed(2)} FCFA</b></p>
         <p>Vous pouvez suivre son statut depuis votre espace client.</p>
         <p>— Easy Shop Network</p>`,
      )
      .catch(() => undefined);

    return order;
  }

  findAllForUser(user: JwtPayload) {
    const where = isStaff(user.role) ? {} : { userId: user.sub };
    return this.prisma.order.findMany({
      where,
      include: {
        items: { include: { product: true } },
        // staff order lists need the customer's identity
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        payments: { orderBy: { createdAt: 'desc' } },
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    if (!isStaff(user.role) && order.userId !== user.sub) {
      throw new ForbiddenException();
    }
    return order;
  }

  async updateStatus(id: string, status: OrderStatus) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    const updated = await this.prisma.order.update({
      where: { id },
      data: { status },
      include: { user: { select: { email: true, firstName: true } } },
    });
    // Notifie automatiquement le client du nouveau statut (si changement réel)
    if (status !== order.status) {
      const ref = updated.id.slice(0, 8).toUpperCase();
      void this.mail
        .send(
          updated.user.email,
          `Mise à jour de votre commande ${ref}`,
          `<p>Bonjour ${updated.user.firstName ?? ''},</p>
           <p>Votre commande <b>${ref}</b> ${STATUS_MESSAGE[status]}.</p>
           <p>— Easy Shop Network</p>`,
        )
        .catch(() => undefined);
    }
    return updated;
  }

  // Admin: email the customer their current order status
  async notifyCustomer(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { user: { select: { email: true, firstName: true } } },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    const ref = order.id.slice(0, 8).toUpperCase();
    await this.mail.send(
      order.user.email,
      `Update on your order ${ref}`,
      `<p>Hi ${order.user.firstName ?? ''},</p>
       <p>Your order <b>${ref}</b> ${STATUS_MESSAGE[order.status]}.</p>
       <p>Thank you for shopping with Easy Shop Network.</p>`,
    );
    return { sent: true };
  }
}
