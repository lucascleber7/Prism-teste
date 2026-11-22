#!/usr/bin/env bash
# Liga a transmissão 24h num servidor Ubuntu/Debian novo. Rode como root, de dentro da pasta do projeto:
#   sudo bash deploy/instalar-servidor.sh
# O que faz: instala o Docker (se faltar), pergunta o seu @ do TikTok e o endereço+chave do Restream
# (a chave não aparece na tela), grava o .env só para o root (chmod 600), escolhe a qualidade pelo número de
# núcleos e sobe tudo com religamento automático.
# Sem perguntas: TIKTOK_USER=... STREAM_URL=... sudo -E bash deploy/instalar-servidor.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ "$(id -u)" = "0" ] || { echo "Rode como root: sudo bash deploy/instalar-servidor.sh"; exit 1; }

if ! command -v docker > /dev/null || ! docker compose version > /dev/null 2>&1; then
  if [ "${SKIP_DOCKER_INSTALL:-0}" = "1" ]; then echo "Docker com 'compose' não encontrado"; exit 1; fi
  echo "== instalando o Docker (script oficial get.docker.com)"
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  systemctl enable --now docker
fi

ask() { # ask VARIÁVEL "pergunta" [secreto]
  local var=$1 prompt=$2 secret=${3:-} value=${!1:-}
  if [ -z "$value" ]; then
    if [ -n "$secret" ]; then read -rsp "$prompt" value < /dev/tty; echo; else read -rp "$prompt" value < /dev/tty; fi
  fi
  printf -v "$var" '%s' "$value"
}

if [ -f .env ] && [ "${REWRITE_ENV:-0}" != "1" ]; then
  echo "== .env já existe: mantido (para refazer: REWRITE_ENV=1)"
else
  ask TIKTOK_USER "Seu @ do TikTok (sem o @): "
  ask STREAM_URL "Endereço RTMP + chave do Restream (ex.: rtmp://live.restream.io/live/CHAVE; não aparece na tela): " secret
  TIKTOK_USER=${TIKTOK_USER#@}
  case "$STREAM_URL" in rtmp://*/*|rtmps://*/*) ;; *) echo "STREAM_URL precisa começar com rtmp:// e terminar com a chave"; exit 1 ;; esac
  [[ "$TIKTOK_USER" =~ ^[A-Za-z0-9_.]{2,24}$ ]] || { echo "@ do TikTok inválido: $TIKTOK_USER"; exit 1; }

  CORES=$(nproc)
  if [ "$CORES" -ge 4 ]; then Q=(1080 1920 60 6000k); else Q=(720 1280 30 3000k); fi
  echo "== $CORES núcleos: transmitindo em ${Q[0]}x${Q[1]} a ${Q[2]} fps (${Q[3]})"

  umask 077
  {
    echo "STREAM_URL=$STREAM_URL"
    echo "TIKTOK_USER=$TIKTOK_USER"
    echo "WIDTH=${Q[0]}"
    echo "HEIGHT=${Q[1]}"
    echo "FPS=${Q[2]}"
    echo "VIDEO_BITRATE=${Q[3]}"
    echo "X264_PRESET=veryfast"
    echo "EULER_API_KEY=${EULER_API_KEY:-}"
    echo "DEMO=${DEMO:-0}"
  } > .env
  chmod 600 .env
  echo "== .env gravado (só o root lê)"
fi

if [ "${DRY_RUN:-0}" = "1" ]; then echo "== DRY_RUN: não subi o contêiner"; exit 0; fi

docker compose up -d --build
echo
echo "== no ar. Comandos úteis (nesta pasta):"
echo "   docker compose logs -f --tail 50   # acompanhar (fps e speed a cada 30 s)"
echo "   docker compose restart             # reiniciar"
echo "   docker compose down                # parar a transmissão"
