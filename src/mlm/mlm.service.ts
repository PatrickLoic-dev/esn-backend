import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

// Barème MLM : points = pourcentage de la valeur de la commande, par niveau.
// Niveau 1 = filleul direct, 2 = filleul de filleul, 3 = 3e génération.
const LEVEL_RATES = [0.1, 0.05, 0.02];
const MAX_LEVELS = LEVEL_RATES.length;

// Conversion : 100 points = 10 FCFA, soit 1 point = 0,1 FCFA.
export const POINT_VALUE_FCFA = 0.1;
export const pointsToFcfa = (points: number) => points * POINT_VALUE_FCFA;

export type AwardedPoints = {
  level: number;
  beneficiaryId: string;
  points: number;
};

@Injectable()
export class MlmService {
  private readonly logger = new Logger(MlmService.name);

  constructor(private prisma: PrismaService) {}

  // Génère un code de parrainage lisible (ESN-XXXXXX), unique en base.
  private newCode(): string {
    const raw = randomBytes(4)
      .toString('base64')
      .replace(/[^A-Z0-9]/gi, '')
      .toUpperCase()
      .slice(0, 6)
      .padEnd(6, '0');
    return `ESN-${raw}`;
  }

  // Attribue un code au membre s'il n'en a pas encore. Idempotent.
  async ensureReferralCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (user?.referralCode) return user.referralCode;

    // Réessaie en cas de collision d'unicité (rare).
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = this.newCode();
      try {
        await this.prisma.user.update({
          where: { id: userId },
          data: { referralCode: code },
        });
        return code;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          continue; // collision : on régénère
        }
        throw err;
      }
    }
    throw new Error('Impossible de générer un code de parrainage unique');
  }

  // Rattache un nouveau membre à son parrain à partir d'un code.
  // Silencieux si le code est invalide ou pointe vers le membre lui-même.
  async linkReferrer(newUserId: string, referralCode?: string): Promise<void> {
    const code = referralCode?.trim().toUpperCase();
    if (!code) return;
    const referrer = await this.prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!referrer || referrer.id === newUserId) return;
    await this.prisma.user.update({
      where: { id: newUserId },
      data: { referredById: referrer.id },
    });
  }

  // Crédite la lignée ascendante (jusqu'à 3 niveaux) des points d'une commande
  // et renvoie le détail des attributions (pour l'email de confirmation).
  // `commissionable` = montant cash réellement payé (hors part payée en points)
  // afin de NE PAS sur-attribuer de points. Idempotent (@@unique orderId+bénéf).
  async awardForOrder(
    orderId: string,
    buyerId: string,
    commissionable: Prisma.Decimal | number,
  ): Promise<AwardedPoints[]> {
    const awarded: AwardedPoints[] = [];
    const total =
      commissionable instanceof Prisma.Decimal
        ? commissionable.toNumber()
        : commissionable;
    if (!Number.isFinite(total) || total <= 0) return awarded;

    // Remonte la chaîne parrain par parrain.
    let currentId: string = buyerId;
    const seen = new Set<string>([buyerId]); // garde-fou anti-cycle

    for (let level = 1; level <= MAX_LEVELS; level++) {
      const node: { referredById: string | null } | null =
        await this.prisma.user.findUnique({
          where: { id: currentId },
          select: { referredById: true },
        });
      const uplineId = node?.referredById;
      if (!uplineId || seen.has(uplineId)) break;
      seen.add(uplineId);

      const points = Math.round(total * LEVEL_RATES[level - 1]);
      if (points > 0) {
        try {
          await this.prisma.$transaction([
            this.prisma.referralCommission.create({
              data: {
                beneficiaryId: uplineId,
                sourceId: buyerId,
                orderId,
                level,
                points,
              },
            }),
            this.prisma.user.update({
              where: { id: uplineId },
              data: { pointsBalance: { increment: points } },
            }),
          ]);
          awarded.push({ level, beneficiaryId: uplineId, points });
        } catch (err) {
          // Doublon (commande déjà traitée pour ce bénéficiaire) → on ignore.
          if (
            !(
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === 'P2002'
            )
          ) {
            this.logger.error({ err, orderId, uplineId }, 'MLM award failed');
          }
        }
      }
      currentId = uplineId;
    }
    return awarded;
  }

  // Admin : vue d'ensemble du réseau MLM (participants + stats globales).
  async getNetwork() {
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { referredById: { not: null } },
          { referrals: { some: {} } },
          { pointsBalance: { gt: 0 } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        referralCode: true,
        pointsBalance: true,
        createdAt: true,
        referredBy: {
          select: { firstName: true, lastName: true, email: true },
        },
        _count: { select: { referrals: true } },
      },
      orderBy: { pointsBalance: 'desc' },
    });

    const grouped = await this.prisma.referralCommission.groupBy({
      by: ['beneficiaryId'],
      _sum: { points: true },
    });
    const earnedByUser = new Map(
      grouped.map((g) => [g.beneficiaryId, g._sum.points ?? 0]),
    );

    const totalDistributed = await this.prisma.referralCommission.aggregate({
      _sum: { points: true },
      _count: { _all: true },
    });

    const label = (u: {
      firstName: string | null;
      lastName: string | null;
      email: string;
    }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

    return {
      stats: {
        participants: users.length,
        withReferrer: users.filter((u) => u.referredBy).length,
        pointsDistributed: totalDistributed._sum.points ?? 0,
        commissions: totalDistributed._count._all,
      },
      members: users.map((u) => ({
        id: u.id,
        name: label(u),
        email: u.email,
        referralCode: u.referralCode,
        parrain: u.referredBy ? label(u.referredBy) : null,
        directReferrals: u._count.referrals,
        pointsBalance: u.pointsBalance,
        pointsEarned: earnedByUser.get(u.id) ?? 0,
        joinedAt: u.createdAt,
      })),
    };
  }

  // Tableau de bord affiliation du membre courant.
  async getSummary(userId: string) {
    const code = await this.ensureReferralCode(userId);
    const [user, directReferrals, commissions, levelCounts] = await Promise.all(
      [
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { pointsBalance: true },
        }),
        this.prisma.user.findMany({
          where: { referredById: userId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.referralCommission.findMany({
          where: { beneficiaryId: userId },
          select: {
            id: true,
            level: true,
            points: true,
            createdAt: true,
            source: { select: { firstName: true, lastName: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.referralCommission.groupBy({
          by: ['level'],
          where: { beneficiaryId: userId },
          _sum: { points: true },
          _count: { _all: true },
        }),
      ],
    );

    const byLevel = [1, 2, 3].map((lvl) => {
      const row = levelCounts.find((r) => r.level === lvl);
      return {
        level: lvl,
        rate: LEVEL_RATES[lvl - 1],
        points: row?._sum.points ?? 0,
        count: row?._count._all ?? 0,
      };
    });

    return {
      referralCode: code,
      pointsBalance: user?.pointsBalance ?? 0,
      directReferralCount: directReferrals.length,
      byLevel,
      referrals: directReferrals.map((r) => ({
        id: r.id,
        name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email,
        joinedAt: r.createdAt,
      })),
      recent: commissions.map((c) => ({
        id: c.id,
        level: c.level,
        points: c.points,
        createdAt: c.createdAt,
        from:
          [c.source.firstName, c.source.lastName].filter(Boolean).join(' ') ||
          c.source.email,
      })),
    };
  }
}
