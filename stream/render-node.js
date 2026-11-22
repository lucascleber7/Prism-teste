#!/usr/bin/env node
/*
 * Roda o MESMO public/game.js do navegador, só que dentro do Node (sem Chromium), e escreve os quadros
 * brutos (RGBA) na saída padrão, a FPS quadros por segundo. Feito para aparelhos fracos (ex.: celular no
 * Termux): o ffmpeg lê da saída e codifica.  Uso:  node stream/render-node.js | ffmpeg -f rawvideo ...
 *
 * Variáveis: WIDTH (720), HEIGHT (1280), FPS (30), PORT (8787, onde roda o server.js com os eventos).
 * Precisa de: npm install @napi-rs/canvas
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { createCanvas, Image: NapiImage, GlobalFonts } = require('@napi-rs/canvas');

const WIDTH = Number(process.env.WIDTH || 720);
const HEIGHT = Number(process.env.HEIGHT || 1280);
const FPS = Number(process.env.FPS || 30);
const PORT = Number(process.env.PORT || 8787);
const SCALE = WIDTH / 540;
const log = (...a) => process.stderr.write('[render] ' + a.join(' ') + '\n');

for (const dir of ['/system/fonts', '/data/data/com.termux/files/usr/share/fonts']) {
  try { if (fs.existsSync(dir)) GlobalFonts.loadFontsFromDir(dir); } catch (e) { /* segue com as fontes que houver */ }
}

/* ---------- o que o game.js espera do navegador ---------- */
const mainCanvas = createCanvas(WIDTH, HEIGHT);
const realGetContext = mainCanvas.getContext.bind(mainCanvas);
let mainCtx = null;
mainCanvas.getContext = (kind) => {
  if (!mainCtx) {
    mainCtx = realGetContext(kind);
    const draw = mainCtx.drawImage;
    // As fotos de perfil chegam como ShimImage; a biblioteca precisa da imagem real que está dentro.
    mainCtx.drawImage = function (img, ...rest) { return draw.call(this, img && img._img ? img._img : img, ...rest); };
  }
  return mainCtx;
};

class ShimImage {
  constructor() { this._img = null; this.onload = null; this.onerror = null; this.referrerPolicy = ''; }
  set src(url) {
    fetch(url, { signal: AbortSignal.timeout(10000) })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((buf) => {
        const im = new NapiImage();
        im.onload = () => { this._img = im; if (this.onload) this.onload(); };
        im.onerror = (e) => { if (this.onerror) this.onerror(e); };
        im.src = Buffer.from(buf);
      })
      .catch((e) => { if (this.onerror) this.onerror(e); });
  }
}

// EventSource mínimo (Server-Sent Events) para receber os eventos do server.js.
class ShimEventSource {
  constructor(url) {
    this.url = new URL(url, 'http://127.0.0.1:' + PORT).href;
    this.onopen = this.onmessage = this.onerror = null;
    this.connect();
  }
  connect() {
    const req = http.get(this.url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return this.retry(); }
      if (this.onopen) this.onopen();
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          if (data && this.onmessage) this.onmessage({ data });
        }
      });
      res.on('end', () => this.retry());
    });
    req.on('error', () => this.retry());
  }
  retry() {
    if (this.onerror) this.onerror();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), 2000);
  }
}

const sandbox = {
  document: {
    getElementById: () => mainCanvas,
    createElement: (tag) => (tag === 'canvas' ? createCanvas(1, 1) : {}),
  },
  location: { search: '?fps=' + FPS + '&scale=' + SCALE },
  URLSearchParams, URL, performance, console, setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), Math.max(4, 500 / FPS)),
  Image: ShimImage,
  EventSource: ShimEventSource,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'game.js'), 'utf8'), sandbox, { filename: 'game.js' });

if (mainCanvas.width !== WIDTH || mainCanvas.height !== HEIGHT)
  log('aviso: o jogo criou', mainCanvas.width + 'x' + mainCanvas.height, 'em vez de', WIDTH + 'x' + HEIGHT);

/* ---------- saída: quadro bruto a cada 1/FPS s; se o ffmpeg atrasar, pula quadro (não acumula memória) ---------- */
let sent = 0, skipped = 0, waiting = false;
process.stdout.on('drain', () => { waiting = false; });
process.stdout.on('error', (e) => { log('saída fechada:', e.code || e.message); process.exit(0); });
const frameMs = 1000 / FPS;
let next = performance.now();
function pump() {
  const now = performance.now();
  if (now >= next) {
    next += frameMs;
    if (now - next > 1000) next = now + frameMs; // atraso grande (aparelho travou): recomeça o ritmo
    if (waiting) skipped++;
    else { waiting = !process.stdout.write(Buffer.from(mainCanvas.data())); sent++; } // cópia: o próximo desenho não altera este quadro
  }
  setTimeout(pump, Math.max(1, next - performance.now()));
}
pump();
setInterval(() => { log('quadros enviados', sent, 'pulados', skipped); }, 60000).unref();
