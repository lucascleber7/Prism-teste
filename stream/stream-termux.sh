#!/data/data/com.termux/files/usr/bin/bash
# Live 24h a partir do celular (Termux), sem navegador e sem OBS:
#   server.js (eventos da live) -> render-node.js (desenha o jogo) -> ffmpeg (codificador do celular) -> RTMP
# Configuração em .env na pasta do projeto (STREAM_URL, TIKTOK_USER, WIDTH, HEIGHT, FPS, VIDEO_BITRATE, ENCODER).
# Ligar:  bash stream/stream-termux.sh   (o instalador deploy/instalar-termux.sh já deixa isso rodando)
set -uo pipefail
cd "$(dirname "$0")/.."
APP=$(pwd)
set -a; [ -f .env ] && . ./.env; set +a
: "${STREAM_URL:?falta STREAM_URL no .env}"
WIDTH=${WIDTH:-720}; HEIGHT=${HEIGHT:-1280}; FPS=${FPS:-30}; VIDEO_BITRATE=${VIDEO_BITRATE:-3000k}
ENCODER=${ENCODER:-h264_mediacodec}; PORT=${PORT:-8787}; TIKTOK_USER=${TIKTOK_USER:-}; DEMO=${DEMO:-0}
mkdir -p logs
LOG=logs/live.log
[ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 5000000 ] && mv -f "$LOG" logs/live.old.log
exec >> "$LOG" 2>&1

KEY=${STREAM_URL##*/}
mask() { sed -u "s|$(printf '%s' "$KEY" | sed 's/[][\\/.*^$|]/\\&/g')|***|g"; }
log() { echo "[$(date '+%F %T')] $*"; }
keep() {
  local name=$1 wait=2 start rc ran
  shift
  while true; do
    start=$(date +%s); log "$name: iniciando"
    "$@"; rc=$?
    ran=$(($(date +%s) - start)); [ "$ran" -gt 120 ] && wait=2
    log "$name: parou (código $rc) depois de ${ran}s; volta em ${wait}s"
    sleep "$wait"; wait=$((wait < 60 ? wait * 2 : 60))
  done
}
trap 'log encerrando; command -v termux-wake-unlock > /dev/null && termux-wake-unlock; kill 0' INT TERM

# Sem isto o Android pode pausar o Termux com a tela apagada.
command -v termux-wake-lock > /dev/null && termux-wake-lock && log "wake-lock ativo"

BRIDGE=(--port "$PORT")
if [ "$DEMO" = "1" ]; then BRIDGE+=(--demo); log "ATENÇÃO: DEMO=1 mostra espectadores falsos; só para teste"
elif [ -n "$TIKTOK_USER" ]; then BRIDGE+=("@${TIKTOK_USER#@}")
else log "aviso: TIKTOK_USER vazio: o jogo vai ao ar sem reagir à live"; fi
keep ponte node server.js "${BRIDGE[@]}" &
for i in $(seq 1 60); do (exec 3<> "/dev/tcp/127.0.0.1/$PORT") 2> /dev/null && break; sleep 0.5; done

if [ "$ENCODER" = "h264_mediacodec" ]; then
  VENC=(-c:v h264_mediacodec -pix_fmt nv12 -b:v "$VIDEO_BITRATE" -bitrate_mode cbr -g "$((FPS * 2))")
else
  VENC=(-c:v libx264 -preset veryfast -pix_fmt yuv420p -b:v "$VIDEO_BITRATE" -maxrate "$VIDEO_BITRATE" -bufsize "$((${VIDEO_BITRATE%k} * 2))k" -g "$((FPS * 2))" -sc_threshold 0)
fi
send() {
  WIDTH=$WIDTH HEIGHT=$HEIGHT FPS=$FPS PORT=$PORT node stream/render-node.js | \
  ffmpeg -hide_banner -loglevel info -stats_period 30 -stats \
    -f rawvideo -pix_fmt rgba -s "${WIDTH}x${HEIGHT}" -r "$FPS" -i pipe:0 \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
    "${VENC[@]}" -c:a aac -b:a 128k -ar 44100 -f flv "$STREAM_URL" 2>&1 | stdbuf -oL tr '\r' '\n' | mask
}
keep transmissao send
