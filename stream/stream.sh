#!/usr/bin/env bash
# Transmissão 24h sem OBS e sem celular:
#   Xvfb (tela virtual) -> Chromium mostrando o jogo -> ffmpeg (H.264 + áudio) -> RTMP (ex.: Restream)
# Cada peça é vigiada: se cair, volta sozinha (espera crescente até 60 s).
#
# Configuração por variáveis de ambiente (veja .env.example). A chave de transmissão fica só em STREAM_URL
# e é mascarada em todos os logs.
set -uo pipefail

: "${STREAM_URL:?defina STREAM_URL (ex.: rtmp://live.restream.io/live/SUA_CHAVE) no arquivo .env}"
WIDTH=${WIDTH:-1080}
HEIGHT=${HEIGHT:-1920}
FPS=${FPS:-60}
VIDEO_BITRATE=${VIDEO_BITRATE:-6000k}
X264_PRESET=${X264_PRESET:-veryfast}
PORT=${PORT:-8787}
DISPLAY_NUM=${DISPLAY_NUM:-99}
TIKTOK_USER=${TIKTOK_USER:-}
DEMO=${DEMO:-0}
APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
CHROME=${CHROME_BIN:-$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)}
export DISPLAY=:$DISPLAY_NUM

KEY=${STREAM_URL##*/}
mask() { if [ -n "$KEY" ]; then sed -u "s|$(printf '%s' "$KEY" | sed 's/[][\\/.*^$|]/\\&/g')|***|g"; else cat; fi; }
log() { echo "[$(date '+%F %T')] $*"; }

[ -n "$CHROME" ] || { log "Chromium não encontrado (defina CHROME_BIN)"; exit 1; }

# keep NOME COMANDO...: roda o comando e o reinicia sempre que terminar.
keep() {
  local name=$1 wait=2 start rc ran
  shift
  while true; do
    start=$(date +%s)
    log "$name: iniciando"
    "$@"
    rc=$?
    ran=$(($(date +%s) - start))
    [ "$ran" -gt 120 ] && wait=2
    log "$name: parou (código $rc) depois de ${ran}s; volta em ${wait}s"
    sleep "$wait"
    wait=$((wait < 60 ? wait * 2 : 60))
  done
}

wait_for() { # wait_for DESCRIÇÃO TESTE...
  local what=$1 i
  shift
  for i in $(seq 1 120); do "$@" 2>/dev/null && return 0; sleep 0.5; done
  log "aviso: $what não ficou pronto em 60 s"
  return 1
}

cleanup() { log "encerrando"; kill 0; }
trap cleanup INT TERM

# 1) tela virtual do tamanho exato da transmissão
keep tela Xvfb ":$DISPLAY_NUM" -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp -ac &
wait_for "tela virtual" test -e "/tmp/.X11-unix/X$DISPLAY_NUM"

# 2) ponte com a live (comentários, presentes...). Sem TIKTOK_USER o jogo roda sem eventos.
BRIDGE_ARGS=(--port "$PORT")
if [ "$DEMO" = "1" ]; then
  log "ATENÇÃO: DEMO=1 mostra espectadores FALSOS. Use só para teste, nunca numa live real."
  BRIDGE_ARGS+=(--demo)
elif [ -n "$TIKTOK_USER" ]; then
  BRIDGE_ARGS+=("@${TIKTOK_USER#@}")
else
  log "aviso: TIKTOK_USER vazio: o jogo vai ao ar, mas não reage à live"
fi
keep ponte node "$APP_DIR/server.js" "${BRIDGE_ARGS[@]}" &
wait_for "ponte" bash -c "exec 3<>/dev/tcp/127.0.0.1/$PORT"

# 3) navegador em tela cheia mostrando o jogo (sem cursor, sem barras, sem economia de energia em segundo plano)
CHROME_FLAGS=(
  --kiosk "--app=http://127.0.0.1:$PORT/?fps=$FPS&scale=$(awk -v w="$WIDTH" 'BEGIN{s=w/540; if(s<1)s=1; if(s>2)s=2; print s}')"
  --window-position=0,0 "--window-size=$WIDTH,$HEIGHT" --force-device-scale-factor=1
  --user-data-dir=/tmp/abyss-live-chrome --no-first-run --noerrdialogs --disable-infobars
  --disable-session-crashed-bubble --disable-translate --disable-features=Translate,MediaRouter
  --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows
  --autoplay-policy=no-user-gesture-required --hide-scrollbars --mute-audio
  # sem tráfego de fundo do navegador (sincronização, atualizações de componentes, mensagens do Google)
  --disable-background-networking --disable-component-update --disable-sync --disable-default-apps
  --no-default-browser-check --password-store=basic --disable-dev-shm-usage
)
[ "${CHROME_NO_SANDBOX:-0}" = "1" ] && CHROME_FLAGS+=(--no-sandbox)
# O Chromium escreve muitos avisos inofensivos (dbus etc.); só vão para o log com CHROME_LOG=1.
browser() { if [ "${CHROME_LOG:-0}" = "1" ]; then "$CHROME" "${CHROME_FLAGS[@]}"; else "$CHROME" "${CHROME_FLAGS[@]}" > /dev/null 2>&1; fi; }
keep navegador browser &
sleep "${BROWSER_WARMUP_SECONDS:-4}"

# 4) captura + codificação + envio. Quadro-chave a cada 2 s (o que o Restream recomenda). Áudio silencioso
#    (as plataformas exigem uma trilha de áudio). Estatísticas a cada 30 s no log: fps e "speed" (precisa ficar ~1.0x).
BUF=$(( ${VIDEO_BITRATE%k} * 2 ))k
send() {
  ffmpeg -hide_banner -loglevel info -stats_period 30 -stats \
    -thread_queue_size 1024 -f x11grab -draw_mouse 0 -framerate "$FPS" -video_size "${WIDTH}x${HEIGHT}" -i ":$DISPLAY_NUM.0" \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
    -c:v libx264 -preset "$X264_PRESET" -pix_fmt yuv420p -r "$FPS" \
    -b:v "$VIDEO_BITRATE" -maxrate "$VIDEO_BITRATE" -bufsize "$BUF" \
    -g "$((FPS * 2))" -keyint_min "$((FPS * 2))" -sc_threshold 0 \
    -c:a aac -b:a 128k -ar 44100 \
    -f flv "$STREAM_URL" 2>&1 | stdbuf -oL tr '\r' '\n' | mask
}
keep transmissao send
