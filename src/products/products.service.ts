import { Injectable, NotFoundException } from '@nestjs/common';
import { ProductFulfilment } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import type { ImportProductsResult } from './dto/import-products-result.dto';

// One tolerant lookup per accepted column, so the spreadsheet's header
// wording/casing doesn't have to match our field names exactly.
const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'product', 'product name', 'title'],
  description: ['description', 'desc'],
  price: ['price'],
  comparePrice: ['compareprice', 'compare price', 'was price', 'old price'],
  sku: ['sku'],
  stock: ['stock', 'quantity', 'qty'],
  stockMin: ['stockmin', 'stock min', 'reorder threshold', 'min stock'],
  stockMax: ['stockmax', 'stock max', 'max stock', 'capacity'],
  imageUrl: ['imageurl', 'image url', 'image'],
  category: ['category', 'category name'],
  fulfilment: ['fulfilment', 'fulfillment', 'type'],
};

function normalizeKey(k: string): string {
  return k.trim().toLowerCase();
}

// Builds a { field: rawValue } row from a raw spreadsheet row, matching
// each accepted field against any of its known header spellings.
function mapRow(raw: Record<string, unknown>): Record<string, unknown> {
  const byNormalizedKey = new Map(
    Object.entries(raw).map(([k, v]) => [normalizeKey(k), v]),
  );
  const mapped: Record<string, unknown> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      if (byNormalizedKey.has(alias)) {
        mapped[field] = byNormalizedKey.get(alias);
        break;
      }
    }
  }
  return mapped;
}

function toOptionalNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Shape returned to the storefront/admin with computed rating fields
function withRating<
  T extends { reviews?: { rating: number }[]; _count?: { reviews: number } },
>(product: T) {
  const reviews = product.reviews ?? [];
  const rating =
    reviews.length > 0
      ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
      : 0;
  const { reviews: _omit, ...rest } = product;
  return {
    ...rest,
    rating: Math.round(rating * 10) / 10,
    reviewCount: product._count?.reviews ?? reviews.length,
  };
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateProductDto) {
    return this.prisma.product.create({ data: dto });
  }

  async findAll() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      include: { reviews: { select: { rating: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return products.map(withRating);
  }

  // Admin: every product, including drafts, with rating + category info +
  // a 30-day rotation index (units sold / current stock) for inventory review.
  async findAllForAdmin() {
    const [products, sold] = await Promise.all([
      this.prisma.product.findMany({
        include: {
          reviews: { select: { rating: true } },
          category: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.soldLast30Days(),
    ]);
    return products.map((p) => ({
      ...withRating(p),
      rotationIndex: this.rotationIndex(p, sold.get(p.id) ?? 0),
    }));
  }

  // Units sold per product over the last 30 days (from paid/shipped/delivered
  // order items — cancelled/pending orders don't count as real turnover).
  private async soldLast30Days(): Promise<Map<string, number>> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: { order: { createdAt: { gte: since } } },
      _sum: { quantity: true },
    });
    return new Map(rows.map((r) => [r.productId, r._sum.quantity ?? 0]));
  }

  // Sales velocity relative to current stock. Not meaningful for
  // made-to-order products (no stock to turn over).
  private rotationIndex(
    product: { fulfilment: string; stock: number },
    unitsSold30d: number,
  ): number | null {
    if (product.fulfilment === 'MADE_TO_ORDER') return null;
    return Math.round((unitsSold30d / Math.max(product.stock, 1)) * 100) / 100;
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { reviews: { select: { rating: true } } },
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return withRating(product);
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.ensureExists(id);
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private async ensureExists(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
  }

  // Parses + validates every row without touching the database. Shared by
  // the preview (dry-run) and the actual import, so they can never disagree
  // about which rows are valid.
  private async validateRows(buffer: Buffer): Promise<
    { row: number; data: CreateProductDto | null; error: string | null }[]
  > {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    });

    const categories = await this.prisma.category.findMany({
      select: { id: true, name: true },
    });
    const categoryIdByName = new Map(
      categories.map((c) => [c.name.trim().toLowerCase(), c.id]),
    );

    return rows.map((raw, i) => {
      const row = mapRow(raw);
      try {
        const data = this.rowToProductData(row, categoryIdByName);
        return { row: i + 2, data, error: null }; // header is row 1
      } catch (err) {
        return {
          row: i + 2,
          data: null,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    });
  }

  // Admin: dry-run of an uploaded .xlsx/.csv file — validates every row
  // without inserting anything, so the admin can review exactly what will
  // and won't be created before confirming.
  async previewImport(buffer: Buffer): Promise<{
    willInsert: { row: number; product: CreateProductDto }[];
    willReject: { row: number; message: string }[];
  }> {
    const results = await this.validateRows(buffer);
    return {
      willInsert: results
        .filter((r) => r.data)
        .map((r) => ({ row: r.row, product: r.data! })),
      willReject: results
        .filter((r) => r.error)
        .map((r) => ({ row: r.row, message: r.error! })),
    };
  }

  // Admin: bulk-create products from an uploaded .xlsx/.csv file. Each row
  // is validated and inserted independently — one bad row doesn't block the
  // rest — and the row-by-row outcome is returned so the admin can fix and
  // re-upload just the failures.
  async importFromExcel(buffer: Buffer): Promise<ImportProductsResult> {
    const results = await this.validateRows(buffer);
    const result: ImportProductsResult = { created: 0, errors: [] };

    for (const r of results) {
      if (!r.data) {
        result.errors.push({ row: r.row, message: r.error! });
        continue;
      }
      try {
        await this.prisma.product.create({ data: r.data });
        result.created++;
      } catch (err) {
        result.errors.push({
          row: r.row,
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
    return result;
  }

  private rowToProductData(
    row: Record<string, unknown>,
    categoryIdByName: Map<string, string>,
  ): CreateProductDto {
    const name = String(row.name ?? '').trim();
    if (!name) throw new Error('Missing product name');

    const price = toOptionalNumber(row.price);
    if (price === undefined) throw new Error('Missing or invalid price');

    const fulfilmentRaw = String(row.fulfilment ?? 'STOCK')
      .trim()
      .toUpperCase()
      .replace(/[\s-]/g, '_');
    const fulfilment: ProductFulfilment =
      fulfilmentRaw === 'MADE_TO_ORDER'
        ? ProductFulfilment.MADE_TO_ORDER
        : ProductFulfilment.STOCK;

    let categoryId: string | undefined;
    const categoryName = String(row.category ?? '').trim();
    if (categoryName) {
      categoryId = categoryIdByName.get(categoryName.toLowerCase());
      if (!categoryId) {
        throw new Error(`Unknown category "${categoryName}"`);
      }
    }

    return {
      name,
      description: String(row.description ?? '').trim() || undefined,
      price,
      comparePrice: toOptionalNumber(row.comparePrice),
      sku: String(row.sku ?? '').trim() || undefined,
      stock: fulfilment === 'MADE_TO_ORDER' ? 0 : (toOptionalNumber(row.stock) ?? 0),
      stockMin: toOptionalNumber(row.stockMin),
      stockMax: toOptionalNumber(row.stockMax),
      imageUrl: String(row.imageUrl ?? '').trim() || undefined,
      categoryId,
      fulfilment,
    };
  }
}
