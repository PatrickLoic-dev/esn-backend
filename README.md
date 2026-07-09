# Easy Shop Network — Backend

REST + WebSocket API for **Easy Shop Network (ESN)**, an e-commerce platform
(storefront + admin panel). Built with **NestJS 11**, **Prisma 6**, and
**PostgreSQL** (Supabase in production). It powers the
[`easy-shop-network-frontend`](../easy-shop-network-frontend) Next.js app.

---

## Table of contents

- [Stack](#stack)
- [Architecture](#architecture)
- [Domain model](#domain-model)
- [Authentication & authorization](#authentication--authorization)
- [Modules & API surface](#modules--api-surface)
- [Real-time SAV (WebSocket)](#real-time-sav-websocket)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Database workflow](#database-workflow)
- [Seed data & default accounts](#seed-data--default-accounts)
- [Running & scripts](#running--scripts)
- [API docs (Swagger)](#api-docs-swagger)
- [Project layout](#project-layout)
- [Notes & gotchas](#notes--gotchas)

---

## Stack

| Concern         | Tool                                                        |
| --------------- | ----------------------------------------------------------- |
| Framework       | NestJS 11 (TypeScript)                                       |
| ORM / DB        | Prisma 6 → PostgreSQL (Supabase pooled connection)          |
| Auth            | Dual mode: Supabase Auth **or** local bcrypt + self-issued JWT (HS256) |
| Authorization   | Global `JwtAuthGuard` + `RolesGuard` + per-module permissions |
| Real-time       | `@nestjs/websockets` + Socket.IO (SAV live chat)            |
| Payments        | Notch Pay (mobile money + card)                             |
| Email           | Resend (transactional)                                       |
| Logging         | `nestjs-pino` (pretty in dev)                               |
| API docs        | Swagger (`@nestjs/swagger`) at `/api/docs`                  |
| Validation      | `class-validator` / `class-transformer` (global pipe, whitelist) |

---

## Architecture

```
                    ┌──────────────────────────────────────────┐
                    │  Next.js frontend (storefront + admin)   │
                    └───────────────┬──────────────────────────┘
                        REST /api        WebSocket /sav
                            │                 │
        ┌───────────────────▼─────────────────▼───────────────────┐
        │                    NestJS application                     │
        │  Global pipe: ValidationPipe(whitelist, transform)        │
        │  Global guards: JwtAuthGuard → RolesGuard                 │
        │                                                           │
        │  auth · users · products · categories · orders ·          │
        │  payments · sav · analytics · mail · supabase · prisma    │
        └───────────────────────────┬───────────────────────────────┘
                                     │ Prisma Client (pooler-safe URL)
                          ┌──────────▼──────────┐
                          │  PostgreSQL / Supabase │
                          └────────────────────────┘
                External services: Resend (email), Notch Pay (payments)
```

- **Global prefix**: every route is served under `/api` (e.g. `GET /api/products`).
- **Global guards** (in `app.module.ts`): `JwtAuthGuard` authenticates every
  request unless the handler is marked `@Public()`; `RolesGuard` then enforces
  `@Roles(...)`. See [Authentication & authorization](#authentication--authorization).
- **PrismaService** normalizes the Supabase pooled URL at runtime (adds
  `pgbouncer=true` + connection limits) so PgBouncer transaction mode doesn't
  throw `prepared statement "s0" already exists`. The `.env` is left untouched.

---

## Domain model

Defined in [`prisma/schema.prisma`](prisma/schema.prisma).

| Model            | Purpose                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `User`           | Customers **and** staff. Holds `role`, per-module `permissions` (JSON), `isActive`, `lastLoginAt`, and (local mode) `passwordHash`. |
| `Review`         | Product rating (1–5) + comment; one per `(product, user)`.              |
| `Category`       | Product category with `slug`, `description`, and a color tag.           |
| `Product`        | Catalogue item: `price`, `comparePrice`, `sku`, `stock`, `imageUrl`, markdown `description`, `isActive` (draft flag), category + reviews. |
| `Order`          | Customer order with `status`, `total`, shipping address, items.         |
| `OrderItem`      | Line item (product snapshot: quantity + unit price).                    |
| `Payment`        | Notch Pay transaction linked to an order (`method`, `status`, `reference`). |
| `Ticket`         | SAV/support ticket: `number` (TKT-00N), `subject`, `status`, `priority`, `category`, optional `order` + staff `assignee`. |
| `TicketMessage`  | A message in a ticket thread (author + content).                        |
| `AnalyticsEvent` | Generic tracked event for analytics.                                    |

**Enums**: `Role` (CUSTOMER, SUPER_ADMIN, ADMIN, MODERATOR, SUPPORT),
`OrderStatus` (PENDING, PAID, SHIPPED, DELIVERED, CANCELLED),
`TicketStatus` (OPEN, IN_PROGRESS, RESOLVED, CLOSED),
`TicketPriority` (LOW, NORMAL, HIGH, URGENT),
`PaymentMethod` (MOBILE_MONEY, CARD), `PaymentStatus`.

---

## Authentication & authorization

**Two auth modes**, selected by `AUTH_MODE`:

- `AUTH_MODE=supabase` (default/prod): register/login/refresh go through
  Supabase Auth; the `JwtStrategy` verifies Supabase-issued HS256 tokens.
- `AUTH_MODE=local` (dev, no Supabase needed): the API issues its own HS256
  tokens signed with `SUPABASE_JWT_SECRET` and stores bcrypt password hashes.
  Register/login/refresh/change-password all work offline.

Either way the frontend stores `{ accessToken, refreshToken }` and sends
`Authorization: Bearer <accessToken>`.

**Guards (applied globally):**

1. `JwtAuthGuard` — rejects unauthenticated requests unless the route is
   `@Public()`.
2. `RolesGuard` — enforces `@Roles(...)`. Key rules:
   - `SUPER_ADMIN` is a superset — passes everything.
   - **`@Roles(ADMIN)` means "any staff member"** (SUPER_ADMIN/ADMIN/MODERATOR/SUPPORT).
     The admin panel is gated **on the client** (modules are hidden per
     permission); the API never blocks staff by role. This is why a Moderator
     can load and mutate every admin resource the UI exposes to them.

**Per-module permissions**: each staff `User` has a `permissions` JSON of the
shape `{ [module]: { view, create, edit, delete } }` for the 8 admin modules
(dashboard, products, categories, orders, customers, sav, analytics, users).
The frontend uses it to show/hide modules; role presets live in the frontend's
`lib/permissions.ts` and are applied when creating a user.

---

## Modules & API surface

All paths are prefixed with `/api`. 🔓 = `@Public()`, otherwise auth required.
"staff" = any non-customer role.

### `auth`
| Method | Path                    | Access | Notes |
| ------ | ----------------------- | ------ | ----- |
| POST   | `/auth/register` 🔓     | public | email + password (+ names) |
| POST   | `/auth/login` 🔓        | public | returns access + refresh tokens; stamps `lastLoginAt`; rejects deactivated accounts |
| POST   | `/auth/refresh` 🔓      | public | rotate tokens |
| POST   | `/auth/change-password` | self   | local mode: verifies current password |
| GET    | `/auth/me`              | self   | decoded token payload |

### `users`
| Method | Path                          | Access | Notes |
| ------ | ----------------------------- | ------ | ----- |
| GET    | `/users`                      | staff  | all users + order counts |
| POST   | `/users`                      | staff  | create staff account; **emails a generated password** |
| GET    | `/users/customers`            | staff  | customers with order count + total spent |
| GET    | `/users/customers/:id`        | staff  | full customer profile + recent orders + stats |
| POST   | `/users/customers/:id/email`  | staff  | send a one-off email to a customer |
| GET    | `/users/me`                   | self   | own profile |
| PATCH  | `/users/me`                   | self   | update own profile |
| PATCH  | `/users/:id`                  | staff  | update role / permissions / active / name |
| DELETE | `/users/:id`                  | staff  | deactivate (soft) |

### `products`
| Method | Path                  | Access | Notes |
| ------ | --------------------- | ------ | ----- |
| GET    | `/products` 🔓        | public | active products + rating aggregates |
| GET    | `/products/:id` 🔓    | public | single product + rating |
| GET    | `/products/admin/all` | staff  | **includes drafts** + rating + category |
| POST   | `/products`           | staff  | create (supports `categoryId`, `comparePrice`, `sku`, markdown `description`, `isActive` draft) |
| PATCH  | `/products/:id`       | staff  | update |
| DELETE | `/products/:id`       | staff  | soft delete (sets `isActive:false`) |

### `categories`
CRUD (`GET` list/one public; `POST`/`PATCH`/`DELETE` staff). Supports color tags.

### `orders`
| Method | Path                   | Access | Notes |
| ------ | ---------------------- | ------ | ----- |
| POST   | `/orders`              | auth   | create from cart items; decrements stock in a transaction |
| GET    | `/orders`              | auth   | customers see own; **staff see all** (with customer info) |
| GET    | `/orders/:id`          | auth   | scoped like above |
| PATCH  | `/orders/:id/status`   | staff  | update status |
| POST   | `/orders/:id/notify`   | staff  | email the customer about their order |

### `payments`
`POST /payments/initiate` (starts a Notch Pay transaction — amount rounded,
XAF has no minor units), `GET /payments`, `POST /payments/webhook` 🔓 (Notch Pay
callback; verifies signature).

### `sav` (support tickets) — base path `/api/sav/tickets`
| Method | Path                          | Access | Notes |
| ------ | ----------------------------- | ------ | ----- |
| POST   | `/sav/tickets`                | auth   | customer opens a ticket (subject, message, priority, category, order) |
| GET    | `/sav/tickets`                | auth   | own for customers, **all for staff** |
| GET    | `/sav/tickets/:id`            | auth   | thread + participants |
| POST   | `/sav/tickets/:id/messages`   | auth   | reply (also broadcast over WebSocket) |
| PATCH  | `/sav/tickets/:id`            | staff  | update status / priority / category / assignee |

### `analytics`
`POST /analytics/events` 🔓 (track), `GET /analytics/summary`,
`GET /analytics/dashboard` (monthly revenue/orders + top products),
`GET /analytics/overview` (Sales / Categories / Products / Reviews tabs) — all staff.

---

## Real-time SAV (WebSocket)

Namespace **`/sav`** (Socket.IO). Clients connect with the access token:

```ts
import { io } from "socket.io-client";
const socket = io("http://localhost:3001/sav", { auth: { token: accessToken } });
socket.emit("ticket:join", ticketId);
socket.on("ticket:message", (msg) => { /* new message */ });
socket.on("ticket:status", ({ status }) => { /* status changed */ });
socket.emit("ticket:message", { ticketId, content });
```

The gateway authenticates the socket (same JWT secret), enforces ticket access,
and **the service emits over the gateway on every change — REST or socket** — so
the customer and the agent stay in sync regardless of how a message was sent.

---

## Getting started

### Prerequisites

- **Node.js 20+** and npm
- A **PostgreSQL** database — either:
  - a **Supabase** project (recommended, matches prod), or
  - local Postgres via **Docker** (`docker compose up -d db` → port 5433).

### Install & run

```bash
cd easy-shop-network-backend
npm install
cp .env.example .env          # then fill in the values (see below)
npm run db:push               # create tables from the Prisma schema
npm run db:seed               # optional: demo data + admin account
npm run start:dev             # http://localhost:3001 (if PORT=3001)
```

Swagger UI: **http://localhost:<PORT>/api/docs**

---

## Environment variables

Copy `.env.example` → `.env`. Keys:

| Variable                | Required | Description |
| ----------------------- | -------- | ----------- |
| `DATABASE_URL`          | ✅       | Postgres connection used by the app. Supabase: the **pooled** URL (port 6543). |
| `DIRECT_URL`            | ✅       | Direct (non-pooled) URL used by Prisma for migrations / `db push` (port 5432). |
| `SUPABASE_URL`          | supabase mode | Supabase project URL. |
| `SUPABASE_ANON_KEY`     | supabase mode | Supabase anon key. |
| `SUPABASE_JWT_SECRET`   | ✅       | HS256 secret. **Also used to sign tokens in local mode.** |
| `RESEND_API_KEY`        | for email | Resend API key. |
| `MAIL_FROM`             | for email | From address, e.g. `"ESN <noreply@yourdomain.com>"`. |
| `NOTCHPAY_PUBLIC_KEY`   | for payments | Notch Pay public key. |
| `NOTCHPAY_HASH_KEY`     | for payments | Webhook signature key. |
| `NOTCHPAY_CALLBACK_URL` | for payments | Payment callback URL. |
| `PORT`                  | ✅       | HTTP port (this project runs the API on **3001**). |
| `LOG_LEVEL`             |          | pino level (`info`, `debug`, …). |
| `AUTH_MODE`             |          | `supabase` (default) or `local` (dev without Supabase). |

> The Prisma service auto-appends `pgbouncer=true&connection_limit=…` to a
> Supabase pooled URL at runtime — don't add it to `.env` yourself.

---

## Database workflow

```bash
npm run db:up      # (optional) start local Postgres in Docker on :5433
npm run db:push    # sync the schema to the DB (no migration files)
npx prisma generate  # regenerate the Prisma client after schema changes
npm run db:seed    # (re)seed demo data — idempotent upserts
npx prisma studio  # browse the DB in a GUI
```

This project uses `prisma db push` (schema-sync) rather than migration files.
After editing `schema.prisma`, run `db:push` then `prisma generate`.

---

## Seed data & default accounts

`prisma/seed.ts` creates categories, products (with reviews), demo customers,
and SAV tickets. It also creates the **super-admin** used to sign into the
admin panel:

| Account         | Password    | Role          |
| --------------- | ----------- | ------------- |
| `admin@esn.dev` | `Admin123!` | `SUPER_ADMIN` |

Staff accounts created through the admin **User Management** screen receive a
generated password by email (Resend).

---

## Running & scripts

| Script               | What it does                              |
| -------------------- | ----------------------------------------- |
| `npm run start:dev`  | Watch mode (recommended for development)   |
| `npm run start`      | Run once                                   |
| `npm run build`      | Compile to `dist/`                         |
| `npm run start:prod` | Run the compiled build (`node dist/main`)  |
| `npm run db:up`      | Start local Postgres (Docker)              |
| `npm run db:push`    | Sync Prisma schema to the DB               |
| `npm run db:seed`    | Seed demo data + admin                     |
| `npm run lint`       | ESLint (autofix)                           |
| `npm run test`       | Jest unit tests                            |
| `npm run test:e2e`   | Jest e2e tests                             |

---

## API docs (Swagger)

Interactive docs are generated at **`/api/docs`**. Use the **Authorize**
button with a Bearer token (from `POST /api/auth/login`) to call protected
endpoints.

---

## Project layout

```
easy-shop-network-backend/
├─ prisma/
│  ├─ schema.prisma        # data model (source of truth)
│  └─ seed.ts              # demo data + admin account
├─ src/
│  ├─ main.ts              # bootstrap: /api prefix, validation, CORS, Swagger
│  ├─ app.module.ts        # wires modules + global JwtAuthGuard & RolesGuard
│  ├─ auth/                # login/register/refresh, JWT strategy, guards, roles.util
│  ├─ users/               # profiles, staff CRUD, customers, permissions
│  ├─ products/            # catalogue CRUD + admin listing + ratings
│  ├─ categories/          # categories CRUD + color tags
│  ├─ orders/              # order creation, scoping, status
│  ├─ payments/            # Notch Pay client + webhook
│  ├─ sav/                 # tickets: controller, service, socket gateway
│  ├─ analytics/           # summary / dashboard / overview aggregations
│  ├─ mail/                # Resend wrapper (global module)
│  ├─ supabase/            # Supabase client provider
│  └─ prisma/              # PrismaService (pooler-safe URL)
├─ docker-compose.yml      # local Postgres (:5433)
└─ .env.example
```

---

## Notes & gotchas

- **The `/api` prefix is global** — call `http://localhost:3001/api/...`.
- **Frontend must point at the API**: set `NEXT_PUBLIC_API_URL` in the frontend
  to `http://127.0.0.1:3001/api`. Prefer `127.0.0.1` over `localhost` so Node's
  server-side fetch doesn't resolve to IPv6 `::1`.
- **Supabase pooler quirks**: the app handles the `pgbouncer=true` requirement
  automatically. If you ever see `prepared statement already exists`, confirm
  `DATABASE_URL` is the **pooled** URL and `DIRECT_URL` the direct one.
- **XAF payments**: amounts are rounded before hitting Notch Pay (XAF has no
  decimal minor units).
- **Soft deletes**: products and users are deactivated, not hard-deleted, so
  existing orders keep their references.
