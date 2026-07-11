import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const categories = [
  { name: 'Electronics', slug: 'electronics', description: 'Phones, computers, audio, and gadgets', color: 'Blue', isActive: true },
  { name: 'Fashion', slug: 'fashion', description: 'Clothing, shoes, bags and accessories', color: 'Pink', isActive: true },
  { name: 'Home & Living', slug: 'home-living', description: 'Furniture, decor, and kitchen items', color: 'Green', isActive: true },
  { name: 'Sports', slug: 'sports', description: 'Sports equipment and activewear', color: 'Orange', isActive: true },
  { name: 'Beauty', slug: 'beauty', description: 'Skincare, makeup, and fragrances', color: 'Purple', isActive: false },
];

const products = [
  { name: 'Premium Wireless Headphones', price: 299.99, comparePrice: 399.99, sku: 'ELEC-001', stock: 45, category: 'electronics', imageUrl: '/images/product-1.png', description: '## Studio-grade sound\nExperience **exceptional audio quality** with powerful bass and crystal-clear highs.\n\n### Key features\n- Active noise cancellation\n- Up to *30 hours* of battery life\n- Quick charging & foldable design\n- Premium memory-foam ear cushions\n\nPerfect for long commutes or travel. Includes a hard carrying case.' },
  { name: 'Designer Watch Collection', price: 549.99, comparePrice: 649.99, sku: 'FASH-001', stock: 12, category: 'fashion', imageUrl: '/images/product-2.png', description: 'Elegant designer watch.' },
  { name: 'Athletic Sneakers Pro', price: 159.99, comparePrice: 199.99, sku: 'SPRT-001', stock: 80, category: 'sports', imageUrl: '/images/product-3.png', description: 'Lightweight running shoes.' },
  { name: 'Professional Camera Kit', price: 1299.99, sku: 'ELEC-002', stock: 8, category: 'electronics', imageUrl: '/images/product-4.png', description: 'Full-frame camera kit.' },
  { name: 'Gaming Mouse', price: 59.99, sku: 'ELEC-003', stock: 120, category: 'electronics', imageUrl: '/images/product-1.png', description: 'High-DPI gaming mouse.' },
  { name: 'Mechanical Keyboard', price: 149.99, sku: 'ELEC-004', stock: 5, category: 'electronics', imageUrl: '/images/product-2.png', description: 'Hot-swappable mechanical keyboard.' },
];

// Sample shoppers so the admin has real customers + reviews to display
const customers = [
  { email: 'john.doe@example.com', firstName: 'John', lastName: 'Doe' },
  { email: 'jane.smith@example.com', firstName: 'Jane', lastName: 'Smith' },
  { email: 'bob.johnson@example.com', firstName: 'Bob', lastName: 'Johnson' },
];

async function main() {
  for (const c of categories) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: {
        description: c.description,
        color: c.color,
        isActive: c.isActive,
      },
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
      comparePrice: p.comparePrice ?? null,
      sku: p.sku ?? null,
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

  // Sample customers
  for (const c of customers) {
    await prisma.user.upsert({
      where: { email: c.email },
      update: {},
      create: {
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        passwordHash: await bcrypt.hash('Password123!', 10),
        role: Role.CUSTOMER,
      },
    });
  }

  // Reviews (drive the product ratings + the Reviews analytics tab)
  const allCustomers = await prisma.user.findMany({
    where: { role: Role.CUSTOMER },
  });
  const allProducts = await prisma.product.findMany();
  const reviewPlan: Record<string, number[]> = {
    'Premium Wireless Headphones': [5, 4, 5],
    'Designer Watch Collection': [4, 4],
    'Athletic Sneakers Pro': [5, 3, 4],
    'Professional Camera Kit': [5],
    'Gaming Mouse': [4, 5],
  };
  for (const prod of allProducts) {
    const ratings = reviewPlan[prod.name];
    if (!ratings) continue;
    for (let i = 0; i < ratings.length && i < allCustomers.length; i++) {
      await prisma.review.upsert({
        where: {
          productId_userId: { productId: prod.id, userId: allCustomers[i].id },
        },
        update: { rating: ratings[i] },
        create: {
          productId: prod.id,
          userId: allCustomers[i].id,
          rating: ratings[i],
          comment: 'Great product, would recommend!',
        },
      });
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

  // Support tickets matching the SAV frame
  const admin = await prisma.user.findUnique({
    where: { email: 'admin@esn.dev' },
  });
  const byEmail = (e: string) => allCustomers.find((c) => c.email === e);
  const ticketSeed = [
    {
      subject: 'Order not delivered after 10 days',
      email: 'john.doe@example.com',
      priority: 'HIGH' as const,
      category: 'Delivery',
      status: 'IN_PROGRESS' as const,
      messages: [
        { from: 'customer', text: "Hello, I placed order ORD-2026-001 over 10 days ago and it hasn't arrived. Can you investigate?" },
        { from: 'agent', text: "Hi John! I'm sorry about the delay. I've escalated this to our logistics team. You should get an update within 24 hours." },
        { from: 'customer', text: "Thank you, I'll wait." },
      ],
    },
    {
      subject: 'Wrong item received in my package',
      email: 'john.doe@example.com',
      priority: 'URGENT' as const,
      category: 'Order Issue',
      status: 'OPEN' as const,
      messages: [
        { from: 'customer', text: 'I ordered a Designer Watch but received running shoes instead. Please help.' },
      ],
    },
    {
      subject: 'Payment charged twice',
      email: 'jane.smith@example.com',
      priority: 'URGENT' as const,
      category: 'Payment',
      status: 'RESOLVED' as const,
      messages: [
        { from: 'customer', text: 'I was charged twice for the same order.' },
        { from: 'agent', text: 'We have refunded the duplicate charge. It should appear within 3-5 business days.' },
        { from: 'customer', text: 'Confirmed, thank you!' },
      ],
    },
    {
      subject: 'How do I return a product?',
      email: 'bob.johnson@example.com',
      priority: 'LOW' as const,
      category: 'Return',
      status: 'OPEN' as const,
      messages: [
        { from: 'customer', text: 'What is the process to return an item I no longer need?' },
      ],
    },
  ];

  for (const t of ticketSeed) {
    const owner = byEmail(t.email);
    if (!owner) continue;
    const existing = await prisma.ticket.findFirst({
      where: { subject: t.subject, userId: owner.id },
    });
    if (existing) continue;
    await prisma.ticket.create({
      data: {
        userId: owner.id,
        subject: t.subject,
        priority: t.priority,
        category: t.category,
        status: t.status,
        assigneeId: t.status !== 'OPEN' ? admin?.id : undefined,
        messages: {
          create: t.messages.map((m) => ({
            authorId: m.from === 'agent' ? (admin?.id ?? owner.id) : owner.id,
            content: m.text,
          })),
        },
      },
    });
  }

  console.log('Seed complete:', {
    categories: await prisma.category.count(),
    products: await prisma.product.count(),
    customers: await prisma.user.count({ where: { role: Role.CUSTOMER } }),
    reviews: await prisma.review.count(),
    tickets: await prisma.ticket.count(),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
