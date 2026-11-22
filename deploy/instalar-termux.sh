#!/data/data/com.termux/files/usr/bin/bash
# Liga a live 24h no próprio celular (Termux), sem navegador e sem OBS. Rode de dentro da pasta do projeto:
#   bash deploy/instalar-termux.sh
# Sem perguntas: TIKTOK_USER=... STREAM_URL=... bash deploy/instalar-termux.sh
# Parar a live:  bash deploy/instalar-termux.sh parar
set -euo pipefail
cd "$(dirname "$0")/.."
APP=$(pwd)
PIDFILE=$APP/logs/live.pid
mkdir -p logs

stop_live() {
  # Para todas as cópias do lançador (cada uma é líder do próprio grupo de processos) e o que elas abriram.
  local found=0 p
  for p in $(ps -eo pid,args | awk '/[s]tream\/stream-termux\.sh/ {print $1}'); do
    found=1
    kill -TERM -- "-$p" 2> /dev/null || kill -TERM "$p" 2> /dev/null
  done
  sleep 3
  for p in $(ps -eo pid,args | awk '/[s]tream\/stream-termux\.sh|[s]tream\/render-node\.js/ {print $1}'); do
    kill -KILL -- "-$p" 2> /dev/null || kill -KILL "$p" 2> /dev/null
  done
  rm -f "$PIDFILE"
  command -v termux-wake-unlock > /dev/null && termux-wake-unlock
  [ "$found" = 1 ] && echo "== live parada" || echo "== a live não estava rodando"
}
start_live() {
  stop_live > /dev/null
  setsid bash stream/stream-termux.sh < /dev/null > /dev/null 2>&1 &   # o próprio lançador grava logs/live.pid
  sleep 8
  echo "== live ligada (pid $(cat "$PIDFILE")). Log: $APP/logs/live.log"
  tail -5 logs/live.log || true
}
case "${1:-}" in
  parar) stop_live; exit 0 ;;
  iniciar) start_live; exit 0 ;; # usado ao religar o celular (Termux:Boot)
esac

echo "== pacotes"
# Instala só o que faltar, olhando o COMANDO (não o nome do pacote): quem já tem nodejs-lts continua com ele.
command -v node > /dev/null || pkg install -y nodejs-lts
command -v ffmpeg > /dev/null || pkg install -y ffmpeg
command -v stdbuf > /dev/null || pkg install -y coreutils
command -v termux-wake-lock > /dev/null || echo "aviso: termux-wake-lock não encontrado (instale o app Termux:API para mais estabilidade)"

echo "== bibliotecas do jogo"
npm install --omit=dev --no-audit --no-fund --loglevel=error
npm install --no-save --no-audit --no-fund --loglevel=error @napi-rs/canvas@1.2.0
node -e "require('@napi-rs/canvas')" && echo "   biblioteca de desenho ok"

if [ -f .env ] && [ "${REWRITE_ENV:-0}" != "1" ]; then
  echo "== .env já existe: mantido (para refazer: REWRITE_ENV=1)"
else
  [ -n "${TIKTOK_USER:-}" ] || read -rp "Seu @ do TikTok (sem o @): " TIKTOK_USER
  [ -n "${STREAM_URL:-}" ] || { read -rsp "Endereço RTMP + chave do Restream (não aparece na tela): " STREAM_URL; echo; }
  TIKTOK_USER=${TIKTOK_USER#@}
  case "$STREAM_URL" in rtmp://*/*|rtmps://*/*) ;; *) echo "STREAM_URL precisa começar com rtmp:// e terminar com a chave"; exit 1 ;; esac
  [[ "$TIKTOK_USER" =~ ^[A-Za-z0-9_.]{2,24}$ ]] || { echo "@ do TikTok inválido"; exit 1; }
  umask 077
  printf 'STREAM_URL=%s\nTIKTOK_USER=%s\nWIDTH=720\nHEIGHT=1280\nFPS=30\nVIDEO_BITRATE=3000k\nENCODER=%s\nDEMO=%s\n' \
    "$STREAM_URL" "$TIKTOK_USER" "${ENCODER:-h264_mediacodec}" "${DEMO:-0}" > .env
  chmod 600 .env
  echo "== .env gravado"
fi

# Religar sozinho quando o celular reiniciar (só funciona com o app Termux:Boot instalado).
mkdir -p ~/.termux/boot
printf '#!/data/data/com.termux/files/usr/bin/sh\ntermux-wake-lock 2>/dev/null\nsleep 30\ncd %s && bash deploy/instalar-termux.sh iniciar\n' "$APP" > ~/.termux/boot/abyss-live.sh
chmod 700 ~/.termux/boot/abyss-live.sh

start_live
