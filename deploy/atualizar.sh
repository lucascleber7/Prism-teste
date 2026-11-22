#!/bin/bash
# Atualização automática: se o branch abyss-live-24h mudou no GitHub, baixa a versão nova e religa a live,
# mantendo o .env (o @ e a chave). O cron roda isto a cada 10 min (instalado pelo oracle-cloud-init.sh).
# Para desligar a atualização automática:  sudo rm /etc/cron.d/abyss-live
set -u
APP=${APP:-/opt/abyss-live}
OWNER_REPO=lucascleber7/Prism-teste
BRANCH=abyss-live-24h
exec >> /var/log/abyss-live-update.log 2>&1
exec 9> /var/lock/abyss-live-update.lock
flock -n 9 || exit 0
log() { echo "$(date '+%F %T') $*"; }

NEW=$(curl -fsS --max-time 20 -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$OWNER_REPO/commits/$BRANCH" 2>/dev/null)
[[ "$NEW" =~ ^[0-9a-f]{40}$ ]] || { log "GitHub sem resposta; tento na próxima"; exit 0; }
OLD=$(cat "$APP/.versao" 2>/dev/null || true)
[ "$NEW" = "$OLD" ] && exit 0

log "versão nova $NEW (antes: ${OLD:-nenhuma})"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL --max-time 120 "https://github.com/$OWNER_REPO/archive/$NEW.tar.gz" -o "$TMP/v.tar.gz" || { log "download falhou"; exit 0; }
mkdir "$TMP/src" && tar xzf "$TMP/v.tar.gz" --strip-components=1 -C "$TMP/src" || { log "arquivo inválido"; exit 0; }
[ -f "$TMP/src/docker-compose.yml" ] && [ -f "$TMP/src/stream/stream.sh" ] || { log "versão incompleta; ignorada"; exit 0; }

find "$APP" -mindepth 1 -maxdepth 1 ! -name .env ! -name .versao -exec rm -rf {} +
cp -a "$TMP/src/." "$APP/"
cd "$APP" || exit 0
if docker compose up -d --build; then
  echo "$NEW" > "$APP/.versao"
  log "atualizado e religado"
else
  log "falhou ao montar a versão nova; a próxima rodada tenta de novo"
fi
