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
    const summaryRows: {
      name: string;
      quantity: number;
      unitPrice: string;
      lineTotal: string;
      imageUrl: string | null;
    }[] = [];
    let itemsSubtotal = new Prisma.Decimal(0);

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
        const lineTotal = product.price.mul(item.quantity);
        total = total.add(lineTotal);
        itemsSubtotal = itemsSubtotal.add(lineTotal);
        items.push({
          productId: product.id,
          quantity: item.quantity,
          unitPrice: product.price,
        });
        summaryRows.push({
          name: product.name,
          quantity: item.quantity,
          unitPrice: product.price.toFixed(2),
          lineTotal: lineTotal.toFixed(2),
          imageUrl: product.imageUrl,
        });
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
    const shippingCost = order.shippingCost ?? new Prisma.Decimal(0);
    const orderDate = new Date(order.createdAt).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const ink = '#1f2124';
    const sub = '#6b6b6b';
    const line = '#e6e6e6';
    const panel = '#f5f5f5';

    // Lignes de produits (image, nom, qté, prix) — style neutre
    const rowsHtml = summaryRows
      .map((r) => {
        const img = r.imageUrl
          ? `<img src="${r.imageUrl}" alt="${r.name}" width="56" height="56"
              style="width:56px;height:56px;border-radius:8px;object-fit:cover;
              border:1px solid ${line};display:block;" />`
          : `<div style="width:56px;height:56px;border-radius:8px;background:${panel};
              border:1px solid ${line};"></div>`;
        return `<tr>
          <td style="padding:14px 0;width:56px;vertical-align:top;">${img}</td>
          <td style="padding:14px 12px;vertical-align:top;">
            <div style="font-weight:700;color:${ink};font-size:14px;">${r.name}</div>
            <div style="color:${sub};font-size:12px;margin-top:4px;">Qté : ${r.quantity}</div>
          </td>
          <td style="padding:14px 0;vertical-align:top;text-align:right;
            white-space:nowrap;font-weight:700;color:${ink};font-size:14px;">
            ${r.lineTotal} FCFA
          </td>
        </tr>
        <tr><td colspan="3" style="border-bottom:1px solid ${line};"></td></tr>`;
      })
      .join('');

    // Adresse de livraison capturée au checkout
    const a = (dto.shippingAddress ?? {}) as Record<string, string | undefined>;
    const addressHtml = [
      a.fullName,
      a.address,
      [a.postalCode, a.city].filter(Boolean).join(' '),
      a.country,
      a.phone,
    ]
      .filter(Boolean)
      .map(
        (l) =>
          `<div style="color:${sub};font-size:13px;line-height:1.6;">${l}</div>`,
      )
      .join('');

    const totalRow = (label: string, value: string, strong = false) =>
      `<tr>
        <td style="padding:${strong ? '12px' : '4px'} 0;color:${strong ? ink : sub};
          font-size:${strong ? '16px' : '13px'};font-weight:${strong ? '800' : '400'};
          ${strong ? `border-top:2px solid ${ink};` : ''}">${label}</td>
        <td style="padding:${strong ? '12px' : '4px'} 0;text-align:right;
          color:${strong ? ink : sub};font-size:${strong ? '16px' : '13px'};
          font-weight:${strong ? '800' : '400'};
          ${strong ? `border-top:2px solid ${ink};` : ''}">${value}</td>
      </tr>`;

    void this.mail
      .send(
        order.user.email,
        `Confirmation de votre commande ${ref}`,
        `<div style="text-align:center;">
           ${this.mail.heading('Commande confirmée', 26)}
           <p style="margin:8px 0 0;color:${sub};font-size:13px;letter-spacing:0.5px;">
             COMMANDE #${ref} · ${orderDate}
           </p>
         </div>
         <p style="margin:24px 0 4px;color:${ink};">
           Bonjour ${order.user.firstName ?? ''}, merci pour votre achat !
         </p>
         <p style="margin:0 0 20px;color:${sub};">
           Nous préparons votre commande. Vous serez notifié dès son expédition.
         </p>
         <div style="text-align:center;margin:8px 0 28px;">
           ${this.mail.button('Suivre ma commande', this.mail.appUrl('/account/orders'), 'primary')}
           &nbsp;
           ${this.mail.button('Continuer mes achats', this.mail.appUrl('/shop'), 'secondary')}
         </div>

         <div style="background:${panel};border-radius:12px;padding:20px 22px;">
           ${this.mail.heading('Détail de la commande', 16)}
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border-collapse:collapse;margin-top:8px;">
             ${rowsHtml}
             ${totalRow('Sous-total', `${itemsSubtotal.toFixed(2)} FCFA`)}
             ${totalRow('Livraison', `${shippingCost.toFixed(2)} FCFA`)}
             ${totalRow('Total', `${order.total.toFixed(2)} FCFA`, true)}
           </table>
         </div>

         ${
           addressHtml
             ? `<div style="margin-top:28px;">
                 ${this.mail.heading('Adresse de livraison', 16)}
                 <div style="margin-top:8px;">${addressHtml}</div>
               </div>`
             : ''
         }`,
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
          `${this.mail.heading('Mise à jour de votre commande', 22)}
           <p style="margin:20px 0 4px;color:#1f2124;">Bonjour ${updated.user.firstName ?? ''},</p>
           <p style="margin:0 0 20px;color:#6b6b6b;">
             Votre commande <strong style="color:#1f2124;">#${ref}</strong> ${STATUS_MESSAGE[status]}.
           </p>
           <div style="text-align:center;margin:8px 0;">
             ${this.mail.button('Suivre ma commande', this.mail.appUrl('/account/orders'), 'primary')}
           </div>`,
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
      `Mise à jour de votre commande ${ref}`,
      `${this.mail.heading('Mise à jour de votre commande', 22)}
       <p style="margin:20px 0 4px;color:#1f2124;">Bonjour ${order.user.firstName ?? ''},</p>
       <p style="margin:0 0 20px;color:#6b6b6b;">
         Votre commande <strong style="color:#1f2124;">#${ref}</strong> ${STATUS_MESSAGE[order.status]}.
       </p>
       <div style="text-align:center;margin:8px 0;">
         ${this.mail.button('Suivre ma commande', this.mail.appUrl('/account/orders'), 'primary')}
       </div>`,
    );
    return { sent: true };
  }
}
