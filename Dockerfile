# Imagem para transmitir o jogo 24h a partir de um servidor (VPS), sem OBS e sem celular.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium xvfb ffmpeg fonts-dejavu-core fonts-noto-color-emoji ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix \
 && useradd -m -u 10001 live

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
COPY public ./public
COPY stream ./stream
RUN chmod +x stream/stream.sh

USER live
# Dentro de contêiner o Chromium não consegue usar o próprio sandbox; ele só abre a página local do jogo.
ENV CHROME_BIN=/usr/bin/chromium CHROME_NO_SANDBOX=1 NODE_ENV=production
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "stream/stream.sh"]
