# Easy Shop Network — Backend

API REST + temps réel de **Easy Shop Network (ESN)**, une plateforme e-commerce.
Construite avec **NestJS 11** (TypeScript), **Prisma 6** sur **PostgreSQL**
(Supabase), authentification par **JWT** (mode local bcrypt _ou_ Supabase Auth),
paiements **Notch Pay** (Mobile Money + carte), emails **Resend**, SAV en temps
réel via **Socket.IO**, logs **Pino** et documentation **Swagger**.

---

## Sommaire

- [Stack technique](#stack-technique)
- [Architecture](#architecture)
- [Modèle de données](#modèle-de-données)
- [Authentification & autorisations](#authentification--autorisations)
- [Prérequis](#prérequis)
- [Configuration (.env)](#configuration-env)
- [Démarrage rapide](#démarrage-rapide)
- [Base de données (Prisma)](#base-de-données-prisma)
- [Scripts npm](#scripts-npm)
- [Endpoints principaux](#endpoints-principaux)
- [Temps réel (SAV)](#temps-réel-sav)
- [Santé & observabilité](#santé--observabilité)
- [Docker](#docker)
- [Dépôts distants](#dépôts-distants)

---

## Stack technique

| Domaine            | Outil                                             |
| ------------------ | ------------------------------------------------- |
| Framework          | NestJS 11 (TypeScript)                            |
| Base de données    | PostgreSQL (Supabase) via Prisma 6                |
| Authentification   | JWT HS256 (Passport) — mode `local` ou `supabase` |
| Temps réel         | Socket.IO (`@nestjs/websockets`)                  |
| Paiements          | Notch Pay (Mobile Money + carte)                  |
| Emails             | Resend                                            |
| Logs               | Pino (`nestjs-pino`)                              |
| Documentation API  | Swagger (`@nestjs/swagger`)                       |
| Validation         | `class-validator` / `class-transformer`           |

---

## Architecture

Application NestJS modulaire. Chaque domaine métier est un module autonome
(controller + service + DTO), branché dans `AppModule`.

```
src/
├── main.ts                 # bootstrap : ValidationPipe global, préfixe /api, Swagger, CORS
├── app.module.ts           # assemble tous les modules
│
├── prisma/                 # PrismaService (connexion, normalisation URL pooler)
├── supabase/               # client Supabase (auth optionnelle)
├── mail/                   # MailService (Resend) — module global
│
├── auth/                   # register / login / refresh / change-password / me
│   ├── guards/             # JwtAuthGuard (global), RolesGuard
│   ├── decorators/         # @Public(), @Roles(), @CurrentUser()
│   ├── strategies/         # JwtStrategy (vérifie les tokens HS256)
│   └── roles.util.ts       # isStaff() — tout rôle ≠ CUSTOMER voit les données transverses
│
├── users/                  # profil, gestion du staff (rôles + permissions), clients
├── products/               # catalogue (public) + gestion admin (drafts, ratings)
├── categories/             # catégories + tag couleur
├── orders/                 # commandes, items, statut
├── payments/               # initiation Notch Pay + webhook
├── sav/                    # tickets support + passerelle Socket.IO temps réel
└── analytics/              # événements + agrégats dashboard / overview
```

**Points transverses :**

- **`ValidationPipe` global** avec `whitelist` + `forbidNonWhitelisted` : toute
  propriété non déclarée dans un DTO est rejetée (400).
- **Préfixe global `/api`** sur toutes les routes.
- **`JwtAuthGuard` global** : toutes les routes sont protégées par défaut ; on
  ouvre explicitement avec `@Public()`.
- **`RolesGuard`** : les routes `@Roles(Role.ADMIN)` sont accessibles à **tout
  membre du staff** (SUPER_ADMIN / ADMIN / MODERATOR / SUPPORT). Le contrôle fin
  par module se fait côté client (masquage des modules selon les permissions) —
  l'API ne bloque pas par rôle au-delà de « staff vs client ».

---

## Modèle de données

Défini dans [`prisma/schema.prisma`](prisma/schema.prisma).

| Modèle           | Rôle                                                                  |
| ---------------- | -------------------------------------------------------------------- |
| `User`           | comptes clients **et** staff (`role`, `permissions` JSON, `isActive`)|
| `Category`       | catégories produit (`slug`, `color`)                                 |
| `Product`        | produits (`price`, `comparePrice`, `sku`, `stock`, `isActive` = brouillon) |
| `Review`         | avis clients (note + commentaire) → ratings produits                 |
| `Order` / `OrderItem` | commandes et leurs lignes                                       |
| `Payment`        | transactions Notch Pay                                               |
| `Ticket` / `TicketMessage` | SAV : sujet, `status`, `priority`, `category`, assigné, messages |
| `AnalyticsEvent` | événements de tracking (pour les agrégats analytics)                 |

**Enums :** `Role`, `OrderStatus`, `TicketStatus`, `TicketPriority`,
`PaymentMethod`, `PaymentStatus`.

---

## Authentification & autorisations

Deux modes, choisis via `AUTH_MODE` :

- **`local`** (recommandé pour le dev) — le backend gère lui-même les mots de
  passe (bcrypt) et émet ses propres JWT HS256 signés avec `SUPABASE_JWT_SECRET`
  (audience `authenticated`). Aucun projet Supabase Auth requis.
- **`supabase`** — délègue `register` / `login` / `refresh` à Supabase Auth. Si
  Supabase n'est pas configuré, ces routes renvoient un **503 explicite** (le
  reste de l'API reste opérationnel).

**Rôles :** `CUSTOMER`, `SUPPORT`, `MODERATOR`, `ADMIN`, `SUPER_ADMIN`.
Les permissions fines par module (`view` / `create` / `edit` / `delete`) sont
stockées dans `User.permissions` (JSON) et pilotent le masquage des modules du
panneau d'administration côté frontend.

---

## Prérequis

- **Node.js ≥ 20**
- **npm ≥ 10**
- Une base **PostgreSQL** : soit Supabase, soit un Postgres local (voir
  [`docker-compose.yml`](docker-compose.yml) : `npm run db:up`).

---

## Configuration (.env)

Copier `.env.example` vers `.env` puis renseigner :

| Variable                 | Description                                                        |
| ------------------------ | ----------------------------------------------------------------- |
| `DATABASE_URL`           | URL Postgres applicative (pooler Supabase port 6543 en prod)      |
| `DIRECT_URL`             | URL directe (migrations Prisma)                                   |
| `SUPABASE_URL`           | URL du projet Supabase (mode `supabase` ; peut être factice en local) |
| `SUPABASE_ANON_KEY`      | clé anon Supabase                                                 |
| `SUPABASE_JWT_SECRET`    | secret HS256 signant/vérifiant les JWT (**obligatoire**)          |
| `RESEND_API_KEY`         | clé API Resend (emails)                                           |
| `MAIL_FROM`              | expéditeur des emails (`Nom <no-reply@domaine>`)                  |
| `NOTCHPAY_PUBLIC_KEY`    | clé publique Notch Pay                                            |
| `NOTCHPAY_HASH_KEY`      | clé de vérification du webhook Notch Pay                          |
| `NOTCHPAY_CALLBACK_URL`  | URL de callback paiement                                          |
| `PORT`                   | port HTTP (défaut `3000`, `3001` en dev local ici)               |
| `LOG_LEVEL`              | niveau de log Pino (`info`, `debug`, …)                           |
| `AUTH_MODE`              | `local` ou `supabase`                                             |

> **Note pooler Supabase :** `PrismaService` ajoute automatiquement
> `pgbouncer=true` (+ limites de connexion) à l'URL du pooler (port 6543) pour
> éviter l'erreur `prepared statement "s0" already exists`. Le `.env` n'a pas à
> être modifié.

---

## Démarrage rapide

```bash
# 1. Dépendances
npm install

# 2. (Option A) Base Postgres locale via Docker
npm run db:up

# 3. Configurer .env (voir ci-dessus), puis appliquer le schéma
npm run db:push

# 4. (Optionnel) Jeu de données de démonstration
npm run db:seed

# 5. Lancer en développement (watch)
npm run start:dev
```

L'API écoute sur `http://localhost:$PORT/api` — Swagger sur `/api/docs`.

Le seed crée un compte **super-admin** de démonstration :
`admin@esn.dev` / `Admin123!`.

---

## Base de données (Prisma)

```bash
npm run db:push      # applique le schéma (dev, sans migration versionnée)
npm run db:seed      # peuple des données de démo (catégories, produits, avis, tickets)
npx prisma studio    # explorateur de données
```

Le client Prisma est régénéré automatiquement par `db:push` /
`prisma generate`.

---

## Scripts npm

| Script              | Effet                                             |
| ------------------- | ------------------------------------------------- |
| `npm run start:dev` | dev en watch mode                                 |
| `npm run start`     | démarrage simple                                  |
| `npm run start:prod`| exécute le build (`node dist/src/main`)           |
| `npm run build`     | compilation Nest → `dist/`                        |
| `npm run lint`      | ESLint (auto-fix)                                 |
| `npm run format`    | Prettier                                          |
| `npm test`          | tests unitaires Jest                              |
| `npm run test:e2e`  | tests end-to-end                                  |
| `npm run db:up`     | Postgres local via Docker Compose                 |
| `npm run db:push`   | applique le schéma Prisma                         |
| `npm run db:seed`   | seed de démonstration                             |

---

## Endpoints principaux

Toutes les routes sont préfixées par `/api`. `🔓` = public, sinon JWT requis ;
`👑` = staff (`@Roles(ADMIN)`).

**Auth** — `POST /auth/register` 🔓, `POST /auth/login` 🔓,
`POST /auth/refresh` 🔓, `POST /auth/change-password`, `GET /auth/me`.

**Users** — `GET /users/me`, `PATCH /users/me`,
`GET /users` 👑, `POST /users` 👑 (crée un staff, mot de passe envoyé par email),
`PATCH /users/:id` 👑 (rôle / permissions / actif), `DELETE /users/:id` 👑,
`GET /users/customers` 👑, `GET /users/customers/:id` 👑,
`POST /users/customers/:id/email` 👑.

**Products** — `GET /products` 🔓, `GET /products/:id` 🔓,
`GET /products/admin/all` 👑 (inclut les brouillons + ratings),
`POST /products` 👑, `PATCH /products/:id` 👑, `DELETE /products/:id` 👑.

**Categories** — `GET /categories` 🔓, `GET /categories/:id` 🔓,
`POST /categories` 👑, `PATCH /categories/:id` 👑, `DELETE /categories/:id` 👑.

**Orders** — `POST /orders`, `GET /orders`, `GET /orders/:id`,
`PATCH /orders/:id/status` 👑, `POST /orders/:id/notify` 👑.

**Payments** — `POST /payments/initiate`, `GET /payments`,
`POST /payments/webhook` 🔓 (callback Notch Pay).

**SAV** — `POST /sav/tickets`, `GET /sav/tickets`, `GET /sav/tickets/:id`,
`POST /sav/tickets/:id/messages`, `PATCH /sav/tickets/:id` 👑.

**Analytics** — `POST /analytics/events` 🔓, `GET /analytics/summary` 👑,
`GET /analytics/dashboard` 👑, `GET /analytics/overview` 👑.

> La liste exhaustive et interactive est disponible dans **Swagger** sur
> `/api/docs`.

---

## Temps réel (SAV)

Le SAV utilise **Socket.IO**, namespace `/sav`. Le client se connecte avec son
token :

```js
io("http://localhost:3001/sav", { auth: { token: "<accessToken>" } });
```

- `emit("ticket:join", ticketId)` — rejoint la conversation.
- `emit("ticket:message", { ticketId, content })` — envoie un message.
- écoute `ticket:message` et `ticket:status` — mises à jour en direct.

Les changements arrivés **par REST** (`POST …/messages`, `PATCH …`) sont aussi
diffusés à la room, donc admin et client restent synchronisés quel que soit le
canal.

---

## Santé & observabilité

- `GET /api/health` — **liveness** : renvoie `200 { status: "ok", uptime }` dès
  que le process tourne (ne dépend pas de la base).
- `GET /api/health/ready` — **readiness** : effectue un `SELECT 1` ;
  `200 { database: "up" }` si la base répond, sinon `503`.

La connexion Prisma au démarrage est **non bloquante** : si la base est
momentanément injoignable, l'application démarre quand même (la liveness passe,
la readiness reste en 503 jusqu'au rétablissement). Cela évite un crash-loop du
conteneur au boot.

Logs structurés via Pino (`LOG_LEVEL`).

---

## Docker

Image multi-stage optimisée (`deps` → `build` → `runner`), utilisateur non-root,
`tini` comme PID 1, `HEALTHCHECK` intégré.

```bash
# Build (le builder classique évite un accès registry superflu si l'image de base
# est déjà en cache)
DOCKER_BUILDKIT=0 docker build -t esn-backend:local .

# Run — env sans guillemets (docker --env-file ne les retire pas, contrairement à
# docker compose / dotenv)
docker run -d --name esn --env-file .env -e PORT=3000 -p 3001:3000 esn-backend:local

# Vérifier la santé
curl http://localhost:3001/api/health
curl http://localhost:3001/api/health/ready
docker inspect --format '{{.State.Health.Status}}' esn
```

Le `docker-compose.yml` fournit aussi un **Postgres de développement** local
(`npm run db:up`).

---

## Dépôts distants

| Remote   | URL                                              |
| -------- | ------------------------------------------------ |
| `origin` | `https://gitlab.com/easy-shop-network/backend.git` |
| `github` | `https://github.com/PatrickLoic-dev/esn-backend.git` |

Workflow Git : `main` (releases) ← `develop` (intégration) ←
`feature/<nom>` (gitflow).
