#!/bin/bash
# Abyss Live 24h - configuração automática da máquina.
# Cole este texto no Oracle, ao criar a máquina, em: Advanced options -> Management -> Initialization script.
# Ele roda sozinho no primeiro boot (como root): instala o Docker, baixa o jogo e liga a live.
# Depois disso o Docker religa tudo sozinho se a máquina reiniciar. Andamento: /var/log/abyss-live-setup.log
TIKTOK_USER='SEU_PERFIL_SEM_ARROBA'
STREAM_URL='rtmp://live.restream.io/live/SUA_CHAVE'

exec >> /var/log/abyss-live-setup.log 2>&1
chmod 600 /var/log/abyss-live-setup.log
set -u
echo "== início $(date)"
for i in $(seq 1 60); do curl -fsS -o /dev/null https://github.com && break; sleep 5; done                 # espera a rede
for i in $(seq 1 120); do fuser /var/lib/dpkg/lock-frontend > /dev/null 2>&1 || break; sleep 5; done   # espera atualizações do sistema

mkdir -p /opt/abyss-live
for i in 1 2 3 4 5; do
  curl -fsSL https://github.com/lucascleber7/Prism-teste/archive/refs/heads/abyss-live-24h.tar.gz -o /tmp/abyss-live.tar.gz && break
  sleep 15
done
tar xzf /tmp/abyss-live.tar.gz --strip-components=1 -C /opt/abyss-live
cd /opt/abyss-live

for i in 1 2 3 4 5; do
  if TIKTOK_USER="$TIKTOK_USER" STREAM_URL="$STREAM_URL" bash deploy/instalar-servidor.sh; then
    echo "== live ligada $(date)"
    exit 0
  fi
  echo "== tentativa $i falhou; tento de novo em 30 s"
  sleep 30
done
echo "== FALHOU $(date)"
exit 1
