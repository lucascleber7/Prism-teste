#!/usr/bin/env node
/*
 * Ponte entre a live do TikTok e o jogo de navegador.
 *
 *   node server.js --demo                 viewers simulados (não conecta em nada externo)
 *   node server.js --demo --no-sim        sem simulação automática (eventos só via POST /emit; usado nos testes)
 *   node server.js @seuperfil             conecta na live (precisa de: npm install)
 *
 * O jogo (public/) abre em http://127.0.0.1:8787 e recebe os eventos por Server-Sent Events (/events).
 * Por padrão só escuta em 127.0.0.1. Use --host 0.0.0.0 apenas se outro aparelho da sua rede precisar abrir o jogo.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const VALUE_FLAGS = ['--port', '--host', '--key'];
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PORT = Number(opt('--port', process.env.PORT || 8787));
const HOST = opt('--host', '127.0.0.1');
const DEMO = flag('--demo');
const SIGN_KEY = opt('--key', process.env.EULER_API_KEY || '');
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1]));
const USERNAME = (positional[0] || '').replace(/^@/, '');

const ROOT = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/* ---------- normalização: tudo que chega ao jogo passa por aqui ---------- */
const clean = (s, n) =>
  String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
const num = (v, lo, hi, d) => {
  v = Number(v);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
};
const safeUrl = (u) => {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' ? x.href.slice(0, 500) : null;
  } catch (e) {
    return null;
  }
};
const TYPES_OK = ['chat', 'gift', 'like', 'follow', 'share'];

function normalize(ev) {
  if (!ev || !TYPES_OK.includes(ev.type)) return null;
  const u = ev.user || {};
  const id = clean(u.id || u.name, 40);
  if (!id) return null;
  const out = { type: ev.type, user: { id, name: clean(u.name || id, 24), avatar: safeUrl(u.avatar) }, ts: Date.now() };
  if (ev.type === 'chat') {
    out.text = clean(ev.text, 80);
    if (!out.text) return null;
  }
  if (ev.type === 'gift') {
    const g = ev.gift || {};
    out.gift = { name: clean(g.name || 'Presente', 24), count: num(g.count, 1, 99, 1), diamonds: num(g.diamonds, 0, 100000, 1) };
  }
  if (ev.type === 'like') out.likes = num(ev.likes, 1, 500, 1);
  return out;
}

/* ---------- Server-Sent Events, com limite de eventos por segundo (proteção do celular) ---------- */
const clients = new Set();
let bucket = 80;
setInterval(() => {
  bucket = 80;
}, 1000).unref();
let dropped = 0;

function broadcast(raw) {
  const ev = normalize(raw);
  if (!ev) return false;
  if (bucket <= 0) {
    dropped++;
    return false;
  }
  bucket--;
  const line = 'data: ' + JSON.stringify(ev) + '\n\n';
  for (const res of clients) res.write(line);
  return true;
}

/* ---------- HTTP ---------- */
function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('403');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('404');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    res.write('data: ' + JSON.stringify({ type: 'hello', mode: DEMO ? 'demo' : 'live', user: USERNAME || null }) + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/emit') {
    // Só no modo demo: serve para testar o jogo sem live. Exige JSON para não aceitar formulário de outro site.
    if (!DEMO || !String(req.headers['content-type'] || '').startsWith('application/json')) {
      res.writeHead(403).end('somente no modo --demo com application/json');
      return;
    }
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => {
      try {
        res.writeHead(broadcast(JSON.parse(body)) ? 204 : 400).end();
      } catch (e) {
        res.writeHead(400).end();
      }
    });
    return;
  }
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405).end();
});
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 15000).unref();

/* ---------- modo demo ---------- */
function startDemo() {
  const names = ['ana', 'leo', 'bia', 'rafa', 'duda', 'tiago', 'nina', 'caio', 'lia', 'davi', 'maria', 'joao', 'bruna', 'pedro', 'gabi', 'lucas', 'sofia', 'enzo', 'laura', 'miguel', 'alice', 'theo', 'helena', 'nando', 'clara', 'igor', 'vivi', 'otto', 'jade', 'kaue'];
  const viewers = names.map((n, i) => ({ id: 'demo' + i, name: n + '_' + (10 + i), avatar: null }));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const comments = ['azul', 'vermelho', 'AZUL!', 'vermelho 🔥', 'bora', 'vai azul', 'time vermelho', 'kkk', '1', '2', 'quem ganha?', 'vamos vermelho!'];
  const tick = () => {
    const r = Math.random();
    const v = pick(viewers);
    if (r < 0.55) broadcast({ type: 'chat', user: v, text: pick(comments) });
    else if (r < 0.85) broadcast({ type: 'like', user: v, likes: 1 + Math.floor(Math.random() * 12) });
    else if (r < 0.94) broadcast({ type: 'gift', user: v, gift: { name: 'Rosa', count: 1 + Math.floor(Math.random() * 3), diamonds: 1 } });
    else broadcast({ type: 'follow', user: v });
    setTimeout(tick, 250 + Math.random() * 900);
  };
  tick();
  console.log('[demo] viewers simulados ativos (nenhuma conexão externa).');
}

/* ---------- live de verdade (TikTok Live Connector 2.x, não oficial) ---------- */
function firstUrl(img) {
  const l = img && (img.urlList || img.url_list);
  return Array.isArray(l) && l.length ? l[0] : img && img.url ? img.url : null;
}
function userOf(d) {
  const u = (d && d.user) || {};
  return {
    id: u.uniqueId || u.nickname || String(u.userId || ''),
    name: u.nickname || u.uniqueId,
    avatar: firstUrl(u.avatarThumb) || firstUrl(u.avatarMedium) || firstUrl(u.avatarLarge),
  };
}

function startLive(username) {
  if (!/^[A-Za-z0-9_.]{2,24}$/.test(username)) {
    console.error('Perfil inválido. Use algo como: node server.js @seuperfil');
    process.exit(2);
  }
  let lib;
  try {
    lib = require('tiktok-live-connector');
  } catch (e) {
    console.error('Falta instalar a biblioteca:  npm install   (depois: node server.js @' + username + ')');
    process.exit(2);
  }
  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = lib;
  let delay = 5000;
  let timer = null;

  const connect = () => {
    const conn = new TikTokLiveConnection(username, SIGN_KEY ? { signApiKey: SIGN_KEY } : {});
    const safe = (fn) => (d) => {
      try {
        fn(d);
      } catch (e) {
        console.warn('[live] evento ignorado:', e.message);
      }
    };
    conn.on(WebcastEvent.CHAT, safe((d) => broadcast({ type: 'chat', user: userOf(d), text: d.comment })));
    conn.on(WebcastEvent.GIFT, safe((d) => {
      const g = d.giftDetails || {};
      if (g.giftType === 1 && !d.repeatEnd) return; // sequência ainda em andamento: conta só no fim
      broadcast({ type: 'gift', user: userOf(d), gift: { name: g.giftName, count: d.repeatCount || 1, diamonds: g.diamondCount || 1 } });
    }));
    conn.on(WebcastEvent.LIKE, safe((d) => broadcast({ type: 'like', user: userOf(d), likes: d.likeCount || 1 })));
    conn.on(WebcastEvent.FOLLOW, safe((d) => broadcast({ type: 'follow', user: userOf(d) })));
    conn.on(WebcastEvent.SHARE, safe((d) => broadcast({ type: 'share', user: userOf(d) })));
    conn.on(ControlEvent.ERROR, (e) => console.warn('[live] erro:', (e && e.message) || e));
    conn.on(ControlEvent.DISCONNECTED, () => {
      console.warn('[live] desconectado; tentando de novo em ' + Math.round(delay / 1000) + ' s');
      clearTimeout(timer);
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 60000);
    });
    conn
      .connect()
      .then((st) => {
        delay = 5000;
        console.log('[live] conectado à sala', st && st.roomId);
      })
      .catch((e) => {
        console.warn('[live] não conectou (a pessoa precisa estar AO VIVO agora):', (e && e.message) || e);
        clearTimeout(timer);
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 60000);
      });
  };
  connect();
}

server.listen(PORT, HOST, () => {
  console.log('Jogo em  http://' + (HOST === '0.0.0.0' ? '127.0.0.1' : HOST) + ':' + PORT + (DEMO ? '   (modo demo)' : ''));
  if (DEMO && !flag('--no-sim')) startDemo(); // --no-sim: só /emit manual (usado nos testes)
  else if (DEMO) console.log('[demo] sem simulação automática: use POST /emit.');
  else if (USERNAME) startLive(USERNAME);
  else console.log('Sem perfil: o jogo abre, mas nenhum evento chega. Use --demo para testar ou: node server.js @seuperfil');
});
