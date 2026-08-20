import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { MlmService } from '../mlm/mlm.service';
import { PromoService } from '../promo/promo.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtPayload } from '../auth/decorators/current-user.decorator';
import { isStaff } from '../auth/roles.util';

const STATUS_MESSAGE: Record<OrderStatus, string> = {
  PENDING: 'has been received and is being prepared',
  SHIPPED: 'has been shipped and is on its way',
  DELIVERED: 'has been delivered — enjoy!',
  CANCELLED: 'has been cancelled',
};

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private mlm: MlmService,
    private promo: PromoService,
  ) {}

  // `userId` is undefined for guest checkout (no auth). In that case the
  // shipping address email is required: if it matches an existing account,
  // the order is linked to that account; otherwise it's saved as a guest
  // order (`guestEmail` set, `userId` null) until the customer registers.
  async create(userId: string | undefined, dto: CreateOrderDto) {
    let ownerId = userId;
    let guestEmail: string | undefined;
    if (!ownerId) {
      const email = dto.shippingAddress?.email?.trim();
      if (!email) {
        throw new BadRequestException(
          'Email is required to place an order without an account.',
        );
      }
      const existing = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existing) {
        ownerId = existing.id;
      } else {
        guestEmail = email;
      }
    }

    // Promo code (optional): resolved once up front — an invalid/expired
    // code fails the whole order rather than silently charging full price.
    const promo = dto.promoCode
      ? await this.promo.findValidByCode(dto.promoCode)
      : null;
    if (dto.promoCode && !promo) {
      throw new BadRequestException('This promo code is invalid or has expired.');
    }

    // Summary rows (name/quantity/price) for the confirmation email
    const summaryRows: {
      name: string;
      quantity: number;
      unitPrice: string;
      lineTotal: string;
      imageUrl: string | null;
    }[] = [];
    let itemsSubtotal = new Prisma.Decimal(0);
    // Subtotal of items the promo actually applies to (per its scope).
    let promoEligibleSubtotal = new Prisma.Decimal(0);
    let promoDiscount = new Prisma.Decimal(0);
    // MLM points used (redemption) — computed within the transaction.
    let pointsUsed = 0;
    let pointsDiscount = new Prisma.Decimal(0);
    // Current schedule (point value when spending).
    const mlmConfig = await this.mlm.getConfig();
    const pointValue = mlmConfig.pointValueFcfa;

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
        if (promo && this.promo.isEligible(promo, product)) {
          promoEligibleSubtotal = promoEligibleSubtotal.add(lineTotal);
        }
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

      if (promo) {
        promoDiscount = this.promo.discountFor(promo.percentOff, promoEligibleSubtotal);
      }

      const shippingCost = dto.shippingCost
        ? new Prisma.Decimal(dto.shippingCost)
        : new Prisma.Decimal(0);
      const afterPromo = total.add(shippingCost).sub(promoDiscount);

      // Points redemption: 100 pts = 10 FCFA (1 pt = 0.1 FCFA).
      // Capped by both the member's balance AND the (post-promo) order amount.
      // Only accounts can hold points — guest orders never redeem any.
      const requested = ownerId
        ? Math.max(0, Math.floor(dto.pointsToUse ?? 0))
        : 0;
      if (requested > 0 && ownerId) {
        const buyer = await tx.user.findUnique({
          where: { id: ownerId },
          select: { pointsBalance: true },
        });
        const maxByOrder = Math.floor(afterPromo.toNumber() / pointValue);
        pointsUsed = Math.min(requested, buyer?.pointsBalance ?? 0, maxByOrder);
        if (pointsUsed > 0) {
          pointsDiscount = new Prisma.Decimal(pointsUsed).mul(pointValue);
          await tx.user.update({
            where: { id: ownerId },
            data: { pointsBalance: { decrement: pointsUsed } },
          });
        }
      }

      return tx.order.create({
        data: {
          userId: ownerId,
          guestEmail,
          // Amount actually due after deducting the promo and points
          total: afterPromo.sub(pointsDiscount),
          pointsUsed,
          promoCodeId: promo?.id,
          promoDiscount: promo ? promoDiscount : undefined,
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

    // MLM layer: credits the upline (fire-and-forget). The service sends its
    // own dedicated email to each referrer. Base = cash paid on the items
    // (excluding the part settled in points) → no over-attribution. The
    // points-earned recap does NOT appear in the buyer's order confirmation email.
    // Skipped entirely for guest orders (no account, so no upline to credit).
    if (ownerId) {
      let commissionBase = itemsSubtotal.sub(pointsDiscount).sub(promoDiscount);
      if (commissionBase.isNegative()) commissionBase = new Prisma.Decimal(0);
      void this.mlm
        .awardForOrder(order.id, ownerId, commissionBase)
        .catch(() => undefined);
    }

    // Order confirmation email (fire-and-forget, non-blocking)
    const ref = order.id.slice(0, 8).toUpperCase();
    const shippingCost = order.shippingCost ?? new Prisma.Decimal(0);
    const orderDate = new Date(order.createdAt).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const ink = '#1f2124';
    const sub = '#6b6b6b';
    const line = '#e6e6e6';
    const panel = '#f5f5f5';

    // Product rows (image, name, qty, price) — neutral style
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
            <div style="color:${sub};font-size:12px;margin-top:4px;">Qty: ${r.quantity}</div>
          </td>
          <td style="padding:14px 0;vertical-align:top;text-align:right;
            white-space:nowrap;font-weight:700;color:${ink};font-size:14px;">
            ${r.lineTotal} FCFA
          </td>
        </tr>
        <tr><td colspan="3" style="border-bottom:1px solid ${line};"></td></tr>`;
      })
      .join('');

    // Shipping address captured at checkout
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

    const recipientEmail = order.user?.email ?? guestEmail ?? a.email;
    const recipientFirstName = order.user?.firstName ?? a.fullName?.split(' ')[0];

    if (recipientEmail) {
      void this.mail
        .send(
          recipientEmail,
          `Your order confirmation ${ref}`,
          `<div style="text-align:center;">
           ${this.mail.heading('Order confirmed', 26)}
           <p style="margin:8px 0 0;color:${sub};font-size:13px;letter-spacing:0.5px;">
             ORDER #${ref} · ${orderDate}
           </p>
         </div>
         <p style="margin:24px 0 4px;color:${ink};">
           Hello ${recipientFirstName ?? ''}, thank you for your purchase!
         </p>
         <p style="margin:0 0 20px;color:${sub};">
           We're preparing your order. You'll be notified as soon as it ships.
         </p>
         <div style="text-align:center;margin:8px 0 28px;">
           ${this.mail.button('Track my order', this.mail.appUrl('/account/orders'), 'primary')}
           &nbsp;
           ${this.mail.button('Continue shopping', this.mail.appUrl('/shop'), 'secondary')}
         </div>

         <div style="background:${panel};border-radius:12px;padding:20px 22px;">
           ${this.mail.heading('Order details', 16)}
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border-collapse:collapse;margin-top:8px;">
             ${rowsHtml}
             ${totalRow('Subtotal', `${itemsSubtotal.toFixed(2)} FCFA`)}
             ${
               order.promoCodeId
                 ? totalRow(
                     `Promo applied${promo ? ` (${promo.code})` : ''}`,
                     `- ${promoDiscount.toFixed(2)} FCFA`,
                   )
                 : ''
             }
             ${totalRow('Shipping', `${shippingCost.toFixed(2)} FCFA`)}
             ${
               pointsUsed > 0
                 ? totalRow(
                     `Points used (${pointsUsed} pts)`,
                     `- ${pointsDiscount.toFixed(2)} FCFA`,
                   )
                 : ''
             }
             ${totalRow('Total', `${order.total.toFixed(2)} FCFA`, true)}
           </table>
         </div>

         ${
           addressHtml
             ? `<div style="margin-top:28px;">
                 ${this.mail.heading('Shipping address', 16)}
                 <div style="margin-top:8px;">${addressHtml}</div>
               </div>`
             : ''
         }`,
        )
        .catch(() => undefined);
    }

    // The confirmation page nudges the customer to register only when this
    // order isn't tied to any account yet (true guest checkout).
    return { ...order, requiresRegistration: !order.userId };
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
    // Automatically notifies the customer of the new status (if it actually changed)
    const updatedEmail = updated.user?.email ?? updated.guestEmail;
    if (status !== order.status && updatedEmail) {
      const ref = updated.id.slice(0, 8).toUpperCase();
      void this.mail
        .send(
          updatedEmail,
          `Update on your order ${ref}`,
          `${this.mail.heading('Update on your order', 22)}
           <p style="margin:20px 0 4px;color:#1f2124;">Hello ${updated.user?.firstName ?? ''},</p>
           <p style="margin:0 0 20px;color:#6b6b6b;">
             Your order <strong style="color:#1f2124;">#${ref}</strong> ${STATUS_MESSAGE[status]}.
           </p>
           <div style="text-align:center;margin:8px 0;">
             ${this.mail.button('Track my order', this.mail.appUrl('/account/orders'), 'primary')}
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
    const email = order.user?.email ?? order.guestEmail;
    if (!email) {
      throw new BadRequestException('This order has no contactable email.');
    }
    const ref = order.id.slice(0, 8).toUpperCase();
    await this.mail.send(
      email,
      `Update on your order ${ref}`,
      `${this.mail.heading('Update on your order', 22)}
       <p style="margin:20px 0 4px;color:#1f2124;">Hello ${order.user?.firstName ?? ''},</p>
       <p style="margin:0 0 20px;color:#6b6b6b;">
         Your order <strong style="color:#1f2124;">#${ref}</strong> ${STATUS_MESSAGE[order.status]}.
       </p>
       <div style="text-align:center;margin:8px 0;">
         ${this.mail.button('Track my order', this.mail.appUrl('/account/orders'), 'primary')}
       </div>`,
    );
    return { sent: true };
  }
}
