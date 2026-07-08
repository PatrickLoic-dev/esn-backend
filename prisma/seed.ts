import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const categories = [
  { name: 'Electronics', slug: 'electronics', description: 'Phones, computers, audio, and gadgets' },
  { name: 'Fashion', slug: 'fashion', description: 'Clothing, shoes, bags and accessories' },
  { name: 'Home & Living', slug: 'home-living', description: 'Furniture, decor, and kitchen items' },
  { name: 'Sports', slug: 'sports', description: 'Sports equipment and activewear' },
  { name: 'Beauty', slug: 'beauty', description: 'Skincare, makeup, and fragrances' },
];

const products = [
  { name: 'Premium Wireless Headphones', price: 299.99, stock: 45, category: 'electronics', imageUrl: '/images/product-1.png', description: 'Active noise cancellation, 30-hour battery life.' },
  { name: 'Designer Watch Collection', price: 549.99, stock: 12, category: 'fashion', imageUrl: '/images/product-2.png', description: 'Elegant designer watch.' },
  { name: 'Athletic Sneakers Pro', price: 159.99, stock: 80, category: 'sports', imageUrl: '/images/product-3.png', description: 'Lightweight running shoes.' },
  { name: 'Professional Camera Kit', price: 1299.99, stock: 8, category: 'electronics', imageUrl: '/images/product-4.png', description: 'Full-frame camera kit.' },
  { name: 'Gaming Mouse', price: 59.99, stock: 120, category: 'electronics', imageUrl: '/images/product-1.png', description: 'High-DPI gaming mouse.' },
  { name: 'Mechanical Keyboard', price: 149.99, stock: 5, category: 'electronics', imageUrl: '/images/product-2.png', description: 'Hot-swappable mechanical keyboard.' },
];

async function main() {
  for (const c of categories) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: { description: c.description },
      create: c,
    });
  }

  for (const p of products) {
    const category = await prisma.category.findUnique({
      where: { slug: p.category },
    });
    const existing = await prisma.product.findFirst({
      where: { name: p.name },
    });
    const data = {
      name: p.name,
      description: p.description,
      price: p.price,
      stock: p.stock,
      imageUrl: p.imageUrl,
      categoryId: category?.id,
    };
    if (existing) {
      await prisma.product.update({ where: { id: existing.id }, data });
    } else {
      await prisma.product.create({ data });
    }
  }

  // Local-auth admin account for the admin panel (AUTH_MODE=local only)
  const fullAccess = Object.fromEntries(
    [
      'dashboard',
      'products',
      'categories',
      'orders',
      'customers',
      'sav',
      'analytics',
      'users',
    ].map((m) => [m, { view: true, create: true, edit: true, delete: true }]),
  );

  await prisma.user.upsert({
    where: { email: 'admin@esn.dev' },
    update: { role: Role.SUPER_ADMIN, permissions: fullAccess },
    create: {
      email: 'admin@esn.dev',
      passwordHash: await bcrypt.hash('Admin123!', 10),
      firstName: 'Admin',
      lastName: 'User',
      role: Role.SUPER_ADMIN,
      permissions: fullAccess,
    },
  });

  console.log('Seed complete:', {
    categories: await prisma.category.count(),
    products: await prisma.product.count(),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
