# ============================================================================
#  Easy Shop Network — Backend (NestJS + Prisma)
#  Image de production multi-étapes, optimisée pour la taille et la sécurité.
# ============================================================================

# ----------------------------------------------------------------------------
# Étape 1 — "deps" : installe TOUTES les dépendances (dev incluses) et prépare
# la génération du client Prisma. On sépare cette étape pour profiter du cache
# de couches : tant que package*.json et le schéma ne changent pas, npm ci
# n'est pas rejoué.
# ----------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# On copie d'abord uniquement les manifestes + le schéma Prisma.
COPY package*.json ./
COPY prisma ./prisma

# On utilise `npm install` plutôt que `npm ci` : certaines dépendances
# optionnelles sont spécifiques à la plateforme (ex. @emnapi/* ciblant
# Linux/WASM) et un lockfile généré sous un autre OS (Windows) fait échouer
# `npm ci` sous Alpine ("Missing ... from lock file"). `npm install` résout
# ici les binaires corrects pour l'image Linux.
RUN npm install --no-audit --no-fund

# ----------------------------------------------------------------------------
# Étape 2 — "build" : compile le TypeScript en JavaScript (dossier dist/).
# ----------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Réutilise les node_modules déjà installés à l'étape deps.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Génère le client Prisma puis compile l'application.
RUN npx prisma generate && npm run build

# ----------------------------------------------------------------------------
# Étape 3 — "runner" : image finale minimale, ne contient QUE ce qui est
# nécessaire à l'exécution (dépendances de prod + dist + client Prisma).
# ----------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# tini = init minimal : réémet correctement les signaux (SIGTERM) vers Node
# pour un arrêt propre, et évite les processus zombies.
RUN apk add --no-cache tini

COPY package*.json ./
COPY prisma ./prisma

# On réutilise les node_modules déjà résolus (bons binaires Linux) à l'étape
# "deps" plutôt que de refaire un `npm install` (évite un second accès réseau,
# source de lenteur et d'échecs transitoires). Séquence :
#   1) prisma generate : crée le client (le CLI prisma est encore présent) ;
#   2) npm prune --omit=dev : retire les devDependencies HORS LIGNE ;
#   3) nettoyage du cache npm.
COPY --from=deps /app/node_modules ./node_modules
RUN npx prisma generate \
  && npm prune --omit=dev --no-audit --no-fund \
  && npm cache clean --force

# Récupère uniquement le résultat de compilation depuis l'étape build.
COPY --from=build /app/dist ./dist

# L'entrypoint applique optionnellement le schéma Prisma avant de démarrer.
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Sécurité : l'image node:alpine fournit déjà un utilisateur non-root "node".
# On lui donne la propriété du dossier de travail puis on bascule dessus.
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Sonde de santé : l'orchestrateur redémarre le conteneur si la readiness échoue.
# --start-period laisse le temps au démarrage (connexion DB, migrations).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider \
      "http://127.0.0.1:${PORT}/api/health/ready" || exit 1

# tini comme PID 1, puis notre entrypoint, puis le serveur.
# Nest imbrique la sortie sous dist/src/ (présence du dossier prisma/ à la
# racine), l'entrée compilée est donc dist/src/main.js.
ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
