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

# Proteção do celular: lê a bateria a cada minuto (termux-battery-status, app Termux:API).
#   normal -> "quente" (FPS_HOT) a partir de TEMP_HOT; qualquer modo -> "pausa" a partir de TEMP_STOP ou com
#   bateria abaixo de BATTERY_MIN fora da tomada; "pausa" -> "quente" abaixo de TEMP_HOT; "quente" -> normal abaixo de TEMP_OK.
TEMP_HOT=${TEMP_HOT:-42}; TEMP_STOP=${TEMP_STOP:-45}; TEMP_OK=${TEMP_OK:-40}; FPS_HOT=${FPS_HOT:-15}; BATTERY_MIN=${BATTERY_MIN:-15}
STATE=logs/termico
echo normal > "$STATE"
ge() { awk -v a="$1" -v b="$2" 'BEGIN { exit !(a >= b) }'; }
thermal() {
  local json t pct plugged mode last=normal n=0
  command -v termux-battery-status > /dev/null || { log "sem termux-battery-status: proteção de temperatura desligada"; return 0; }
  while true; do
    json=$(timeout 20 termux-battery-status 2> /dev/null)
    t=$(sed -n 's/.*"temperature": *\([0-9.]*\).*/\1/p' <<< "$json")
    pct=$(sed -n 's/.*"percentage": *\([0-9]*\).*/\1/p' <<< "$json")
    plugged=$(sed -n 's/.*"plugged": *"\([A-Z_]*\)".*/\1/p' <<< "$json")
    if [ -n "$t" ]; then
      mode=$last
      if ge "$t" "$TEMP_STOP" || { [ "$plugged" = UNPLUGGED ] && [ -n "$pct" ] && [ "$pct" -lt "$BATTERY_MIN" ]; }; then mode=pausa
      else
        case $last in
          normal) ge "$t" "$TEMP_HOT" && mode=quente ;;
          quente) ge "$t" "$TEMP_OK" || mode=normal ;;
          pausa) ge "$t" "$TEMP_HOT" || mode=quente ;;
        esac
      fi
      if [ "$mode" != "$last" ]; then
        log "temperatura ${t}°C, bateria ${pct}% ($plugged): modo $last -> $mode"
        echo "$mode" > "$STATE"; last=$mode
        pkill -f "stream/render-node.js" 2> /dev/null # reinicia a transmissão já no modo novo
      fi
      [ $((n++ % 10)) -eq 0 ] && log "temperatura ${t}°C, bateria ${pct}% ($plugged), modo $mode"
    fi
    sleep 60
  done
}
thermal &

venc() { # venc FPS
  if [ "$ENCODER" = "h264_mediacodec" ]; then
    echo -c:v h264_mediacodec -pix_fmt nv12 -b:v "$VIDEO_BITRATE" -bitrate_mode cbr -g "$(($1 * 2))"
  else
    echo -c:v libx264 -preset veryfast -pix_fmt yuv420p -b:v "$VIDEO_BITRATE" -maxrate "$VIDEO_BITRATE" -bufsize "$((${VIDEO_BITRATE%k} * 2))k" -g "$(($1 * 2))" -sc_threshold 0
  fi
}
send() {
  local mode fps
  mode=$(cat "$STATE" 2> /dev/null || echo normal)
  if [ "$mode" = pausa ]; then log "transmissão pausada para proteger o celular"; sleep 60; return 0; fi
  fps=$FPS; [ "$mode" = quente ] && fps=$FPS_HOT
  log "transmitindo ${WIDTH}x${HEIGHT} a ${fps} fps ($ENCODER, modo $mode)"
  # shellcheck disable=SC2046
  WIDTH=$WIDTH HEIGHT=$HEIGHT FPS=$fps PORT=$PORT node stream/render-node.js | \
  ffmpeg -hide_banner -loglevel info -stats_period 30 -stats \
    -f rawvideo -pix_fmt rgba -s "${WIDTH}x${HEIGHT}" -r "$fps" -i pipe:0 \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
    $(venc "$fps") -c:a aac -b:a 128k -ar 44100 -f flv "$STREAM_URL" 2>&1 | stdbuf -oL tr '\r' '\n' | mask
}
keep transmissao send
