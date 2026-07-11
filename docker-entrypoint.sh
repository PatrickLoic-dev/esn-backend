#!/bin/sh
# ============================================================================
#  Point d'entrée du conteneur backend.
#  Rôle : (optionnellement) synchroniser le schéma de base de données AVANT
#  de démarrer le serveur, puis lancer la commande passée en CMD.
# ============================================================================
set -e

# DB_PUSH_ON_START=true  -> applique le schéma Prisma via `prisma db push`.
#   Utile en environnement où l'on ne gère pas de migrations formelles
#   (comme ce projet). À N'UTILISER qu'avec précaution en production : db push
#   n'a pas d'historique de migration et peut être destructif sur un drift.
if [ "${DB_PUSH_ON_START}" = "true" ]; then
  echo "[entrypoint] Synchronisation du schéma Prisma (prisma db push)…"
  npx prisma db push --skip-generate
fi

# MIGRATE_ON_START=true -> applique les migrations Prisma versionnées.
#   Voie recommandée en production si le projet utilise `prisma migrate`.
if [ "${MIGRATE_ON_START}" = "true" ]; then
  echo "[entrypoint] Application des migrations Prisma (prisma migrate deploy)…"
  npx prisma migrate deploy
fi

echo "[entrypoint] Démarrage de l'application : $*"
# exec remplace le shell par le process Node : les signaux (SIGTERM) lui
# parviennent directement pour un arrêt propre.
exec "$@"
