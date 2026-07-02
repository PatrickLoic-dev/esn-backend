# Easy Shop Network — Backend

Backend API of Easy Shop Network (ESN), built on a production-ready NestJS ecommerce stack: Supabase (Auth + Postgres), Prisma, Notch Pay payments (mobile money + card), Resend emails, Pino logging, real-time SAV support chat, and Swagger docs.

## Stack

| Concern | Tool |
|---|---|
| Framework | NestJS 11 (TypeScript) |
| Database | Supabase Postgres via Prisma 6 |
| Auth | Supabase Auth (access + refresh tokens), Passport JWT guard |
| Payments | Notch Pay (MTN MoMo / Orange Money / cards, XAF) |
| Email | Resend |
| Logging | Pino (`nestjs-pino`), pretty in dev, JSON in prod |
| Realtime | Socket.IO gateway for ticket chat |
| Docs | Swagger at `/api/docs` |

## Modules

- **auth** — register / login / refresh via Supabase Auth; global `JwtAuthGuard` verifies Supabase access tokens; `RolesGuard` + `@Roles(Role.ADMIN)` for admin routes; `@Public()` to opt out; role is stored in the local `User` table.
- **users** — logged-in profile management (`GET/PATCH /api/users/me`).
- **categories** — public listing, admin CRUD, linked to products.
- **products** — public catalog, admin CRUD, soft delete.
- **orders** — transactional creation with stock decrement, owner/admin access.
- **payments** — `POST /api/payments/initiate` creates a Notch Pay transaction and returns an `authorizationUrl`; `POST /api/payments/webhook` (HMAC-verified) marks payments complete and flips the order to PAID, then emails the customer.
- **sav** — support tickets (`/api/sav/tickets`) plus instant messaging over Socket.IO namespace `/sav` (`ticket:join`, `ticket:message`), admin status workflow, email notification on ticket creation.
- **analytics** — `POST /api/analytics/events` (public event tracking) and admin `GET /api/analytics/summary` (users, orders, revenue, open tickets, top events).

## Setup

1. Create a [Supabase](https://supabase.com) project. Grab from the dashboard:
   - `DATABASE_URL` (pooled, port 6543) and `DIRECT_URL` (port 5432) — Settings → Database
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` — Settings → API
2. Create a [Resend](https://resend.com) API key and verify your sending domain.
3. Create a [Notch Pay](https://notchpay.co) account; grab the public key and webhook hash key, and point the webhook to `https://<your-host>/api/payments/webhook`.
4. Then:

```bash
npm install
cp .env.example .env      # fill in the values above
npx prisma migrate dev    # creates tables in Supabase Postgres
npm run start:dev
```

- API: `http://localhost:3000/api`
- Swagger: `http://localhost:3000/api/docs`
- Chat: `io('http://localhost:3000/sav', { auth: { token: accessToken } })`

To promote an admin: `UPDATE "User" SET role = 'ADMIN' WHERE email = '...';`

## Auth flow

1. `POST /api/auth/register` → Supabase creates the auth user; a profile row is created in Postgres; returns `accessToken` + `refreshToken` (null if email confirmation is enabled — confirm, then log in).
2. Send `Authorization: Bearer <accessToken>` on every request.
3. When the access token expires, `POST /api/auth/refresh` with the `refreshToken` for a new pair (refresh tokens are single-use and rotated by Supabase).

## Deployment

Any Node host works; the repo ships a production `Dockerfile`.

**Railway / Render (simplest):** connect the GitHub repo, set the env vars from `.env.example`, build command `npm ci && npx prisma generate && npm run build`, start command `npx prisma migrate deploy && node dist/main.js`.

**Docker:**

```bash
docker build -t ecommerce-backend .
docker run -p 3000:3000 --env-file .env ecommerce-backend
```

Run migrations against production once per release: `npx prisma migrate deploy`.

**Checklist:** use the pooled `DATABASE_URL` (pgBouncer) in the app; restrict CORS to your frontend origin in `main.ts`; keep `NODE_ENV=production` so logs stay JSON; configure the Notch Pay webhook URL to your public domain.

## Scripts

```bash
npm run start:dev   # watch mode
npm run build       # compile to dist/
npm run lint        # eslint
npm test            # unit tests
```

## License

MIT — use it freely as a starter for your own projects.
