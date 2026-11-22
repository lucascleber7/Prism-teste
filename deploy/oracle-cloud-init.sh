#!/bin/bash
# Abyss Live 24h - configuração automática da máquina.
# Cole este texto no Oracle, ao criar a máquina, em: Advanced options -> Management -> Initialization script.
# Ele roda sozinho no primeiro boot (como root): instala o Docker, baixa o jogo e liga a live. Depois o
# Docker religa tudo se a máquina reiniciar, e a cada 10 min a máquina busca correções no GitHub sozinha.
# Andamento: /var/log/abyss-live-setup.log   Atualizações: /var/log/abyss-live-update.log
TIKTOK_USER='SEU_PERFIL_SEM_ARROBA'
STREAM_URL='rtmp://live.restream.io/live/SUA_CHAVE'

exec >> /var/log/abyss-live-setup.log 2>&1
chmod 600 /var/log/abyss-live-setup.log
set -u
REPO=lucascleber7/Prism-teste
echo "== início $(date)"
for i in $(seq 1 60); do curl -fsS -o /dev/null https://github.com && break; sleep 5; done                 # espera a rede
for i in $(seq 1 120); do fuser /var/lib/dpkg/lock-frontend > /dev/null 2>&1 || break; sleep 5; done   # espera atualizações do sistema

mkdir -p /opt/abyss-live
for i in 1 2 3 4 5; do
  SHA=$(curl -fsS -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$REPO/commits/abyss-live-24h") \
    && curl -fsSL "https://github.com/$REPO/archive/$SHA.tar.gz" -o /tmp/abyss-live.tar.gz && break
  sleep 15
done
tar xzf /tmp/abyss-live.tar.gz --strip-components=1 -C /opt/abyss-live
cd /opt/abyss-live

for i in 1 2 3 4 5; do
  if TIKTOK_USER="$TIKTOK_USER" STREAM_URL="$STREAM_URL" bash deploy/instalar-servidor.sh; then
    echo "$SHA" > /opt/abyss-live/.versao
    echo "*/10 * * * * root bash /opt/abyss-live/deploy/atualizar.sh" > /etc/cron.d/abyss-live
    echo "== live ligada $(date)"
    exit 0
  fi
  echo "== tentativa $i falhou; tento de novo em 30 s"
  sleep 30
done
echo "== FALHOU $(date)"
exit 1
