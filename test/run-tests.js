#!/usr/bin/env node
/*
 * Testes da ponte (HTTP/SSE) e do jogo (navegador headless, se o playwright estiver instalado).
 *   node test/run-tests.js            screenshots vão para $SHOTS_DIR (padrão: pasta temporária do sistema)
 */
'use strict';
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };

function startServer(port, extra, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(port), ...extra], { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, env || {}) });
    p.stdout.on('data', (d) => { if (String(d).includes('Jogo em')) resolve(p); });
    p.on('error', reject);
    setTimeout(() => reject(new Error('servidor não subiu')), 5000);
  });
}
function req(port, method, p, body, type) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: body ? { 'Content-Type': type || 'application/json' } : {} }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', () => resolve({ status: 0, body: '' }));
    if (body) r.write(body);
    r.end();
  });
}
function sse(port, n, ms) {
  return new Promise((resolve) => {
    const got = [];
    const r = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          if (chunk.startsWith('data: ')) got.push(JSON.parse(chunk.slice(6)));
          if (got.length >= n) { r.destroy(); resolve(got); }
        }
      });
    });
    setTimeout(() => { r.destroy(); resolve(got); }, ms || 3000);
  });
}

// A ponte com a biblioteca do TikTok, usando a biblioteca simulada de test/stub (nenhuma rede é usada).
async function liveBridgeTests() {
  const server = await startServer(8795, ['@perfil_teste'], { NODE_PATH: path.join(__dirname, 'stub') });
  const evs = (await sse(8795, 99, 7500)).filter((e) => e.type !== 'hello');
  server.kill();
  const by = (t) => evs.filter((e) => e.type === t);
  ok(by('chat').some((e) => e.text === 'azul' && e.user.id === 'ana' && e.user.name === 'Ana'), 'live: comentário chega com id, nome e texto');
  ok(by('chat').some((e) => e.user.avatar === 'https://cdn.exemplo.test/ana.webp'), 'live: foto de perfil é lida de user.avatarThumb.urlList');
  ok(by('chat').some((e) => e.user.id === 'semfoto' && e.user.avatar === null), 'live: usuário sem foto não quebra (avatar nulo)');
  ok(by('gift').length === 1 && by('gift')[0].gift.count === 3 && by('gift')[0].gift.name === 'Rose', 'live: presente em sequência conta só no fim (1 evento, x3), sem duplicar');
  ok(by('like').some((e) => e.likes === 7), 'live: curtidas chegam com a quantidade');
  ok(by('follow').length === 1 && by('share').length === 1, 'live: seguir e compartilhar chegam');
  ok(by('chat').some((e) => e.user.id === 'voltou'), 'live: depois de desconectar, reconecta sozinho e os eventos voltam');
}

async function apiTests() {
  const demo = await startServer(8792, ['--demo', '--no-sim']);
  const listener = sse(8792, 3); // 'hello' + os dois eventos válidos abaixo
  await new Promise((r) => setTimeout(r, 300));
  ok((await req(8792, 'GET', '/')).status === 200, 'GET / serve a página');
  const trav = await req(8792, 'GET', '/%2e%2e/server.js');
  ok(trav.status !== 200 && !trav.body.includes('startLive'), 'não deixa sair da pasta public/ (path traversal)');
  ok((await req(8792, 'POST', '/emit', '{"type":"chat"}', 'text/plain')).status === 403, '/emit recusa Content-Type que não é JSON');
  ok((await req(8792, 'POST', '/emit', '{nao-e-json')).status === 400, '/emit recusa JSON inválido');
  ok((await req(8792, 'POST', '/emit', JSON.stringify({ type: 'chat', user: { id: 't1', name: 'x' } }))).status === 400, 'chat sem texto é recusado');
  ok((await req(8792, 'POST', '/emit', JSON.stringify({ type: 'hack', user: { id: 't1' } }))).status === 400, 'tipo desconhecido é recusado');
  ok((await req(8792, 'POST', '/emit', JSON.stringify({ type: 'chat', user: { id: 'T-SAN', name: '<img src=x onerror=alert(1)>Ze', avatar: 'http://inseguro/x.png' }, text: 'azul <script>' }))).status === 204, 'chat válido é aceito');
  ok((await req(8792, 'POST', '/emit', JSON.stringify({ type: 'like', user: { id: 'T-LIKE', name: 'l' }, likes: 99999 }))).status === 204, 'like válido é aceito');
  const evs = await listener;
  const san = evs.find((e) => e.user && e.user.id === 'T-SAN');
  ok(san && !/[<>]/.test(san.user.name + san.text), 'nome e texto saem sem < >');
  ok(san && san.user.avatar === null, 'avatar http:// é descartado (só https)');
  const like = evs.find((e) => e.user && e.user.id === 'T-LIKE');
  ok(like && like.likes === 500, 'quantidade de curtidas é limitada a 500');
  demo.kill();

  const live = await startServer(8793, []);
  ok((await req(8793, 'POST', '/emit', JSON.stringify({ type: 'like', user: { id: 'a' } }))).status === 403, '/emit fica desligado fora do modo --demo');
  live.kill();
}

async function browserTests() {
  let pw;
  try { pw = require('playwright'); } catch (e) { console.log('SKIP testes de navegador (playwright não instalado)'); return; }
  const server = await startServer(8794, ['--demo', '--no-sim']);
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:8794/?debug&fps=30');
  await page.waitForFunction(() => window.__game);
  const G = (fn, arg) => page.evaluate(fn, arg);
  await G(() => { window.__game.state.units.length = 0; window.__game.state.players.clear(); });

  const user = (i, n) => ({ id: 'u' + i, name: n, avatar: null });
  await G(() => {
    const g = window.__game;
    ['ana', 'leo', 'bia', 'rafa', 'duda', 'tiago'].forEach((n, i) => g.emit({ type: 'chat', user: { id: 'a' + i, name: n }, text: i % 2 ? 'AZUL!' : 'vou de azul' }));
    ['nina', 'caio', 'lia', 'davi'].forEach((n, i) => g.emit({ type: 'chat', user: { id: 'v' + i, name: n }, text: 'vermelho 🔥' }));
  });
  let s = await G(() => ({ units: window.__game.state.units.length, azul: window.__game.state.units.filter((u) => u.team === 'azul').length }));
  ok(s.units === 10 && s.azul === 6, 'comentários AZUL/VERMELHO entram no time e soltam um soldado cada (10 unidades: 6 azul, 4 vermelho)');

  await G(() => {
    const g = window.__game;
    g.emit({ type: 'chat', user: { id: 'a0', name: 'ana' }, text: 'ola pessoal' }); // balão no soldado da ana
    g.emit({ type: 'gift', user: { id: 'g1', name: 'gabi' }, gift: { name: 'Rosa', count: 3, diamonds: 1 } });
    g.emit({ type: 'follow', user: { id: 'f1', name: 'enzo' } });
    g.emit({ type: 'share', user: { id: 'a1', name: 'leo' } });
  });
  s = await G(() => {
    const st = window.__game.state;
    return { tanks: st.units.filter((u) => u.kind === 'tank').length, heroes: st.units.filter((u) => u.kind === 'hero').length, bubble: st.units.some((u) => u.bubble && u.bubble.text === 'ola pessoal') };
  });
  ok(s.tanks === 3, 'presente Rosa x3 vira 3 tanques');
  ok(s.heroes === 1, 'seguidor vira herói');
  ok(s.bubble === true, 'comentário comum aparece em balão sobre o soldado de quem comentou');

  const ids = await G(() => window.__game.state.units.length);
  await G(() => { for (let i = 0; i < 12; i++) window.__game.emit({ type: 'chat', user: { id: 'a0', name: 'ana' }, text: 'azul' }); });
  ok((await G(() => window.__game.state.units.length)) === ids, 'repetir AZUL em sequência respeita o intervalo de 4 s (sem spam de soldados)');

  await G(() => { for (let i = 0; i < 3; i++) window.__game.emit({ type: 'like', user: { id: 'a0', name: 'ana' }, likes: 40 }); });
  await G(() => window.__game.step(0.1));
  ok((await G(() => window.__game.state.superUntil.azul > 0)) === true, 'curtidas suficientes disparam o SUPER do time');

  await G(() => { for (let i = 0; i < 100; i++) window.__game.step(0.1); }); // 10 s de batalha (o primeiro contato leva ~5 s)
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, 'tlg_batalha.png') });
  s = await G(() => ({ units: window.__game.state.units.length, kills: [...window.__game.state.players.values()].reduce((a, p) => a + p.kills, 0), hp: window.__game.state.base }));
  ok(s.kills > 0 || s.hp.azul < 1000 || s.hp.vermelho < 1000, 'a batalha anda: houve abates ou dano nas bases');

  // Os soldados da batalha anterior podem ter se eliminado: solta reforços novos do azul e deixa a base vermelha quase zerada.
  await G(() => {
    window.__game.state.base.vermelho = 3;
    for (let i = 0; i < 6; i++) window.__game.emit({ type: 'chat', user: { id: 'w' + i, name: 'reforco' + i }, text: 'azul' });
  });
  await G(() => { for (let i = 0; i < 600 && window.__game.state.phase === 'play'; i++) window.__game.step(0.1); });
  s = await G(() => ({ phase: window.__game.state.phase, winner: window.__game.state.winner }));
  ok(s.phase === 'win' && !!s.winner, 'base zerada encerra a rodada com vencedor (' + s.winner + ')');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, 'tlg_vitoria.png') });

  await G(() => window.__game.step(13));
  await page.waitForFunction(() => window.__game.state.phase === 'play', null, { timeout: 3000 }).catch(() => {});
  s = await G(() => ({ phase: window.__game.state.phase, units: window.__game.state.units.length, round: window.__game.state.round, hp: window.__game.state.base.azul }));
  ok(s.phase === 'play' && s.units === 0 && s.round === 2 && s.hp === 1000, 'depois da vitória começa nova rodada limpa');

  // O caminho real: evento chega pelo servidor (SSE) e vira soldado na tela.
  const before = await G(() => window.__game.state.events);
  await new Promise((r) => {
    const rq = http.request({ host: '127.0.0.1', port: 8794, method: 'POST', path: '/emit', headers: { 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', r); });
    rq.write(JSON.stringify({ type: 'chat', user: { id: 'sse1', name: 'via_servidor' }, text: 'vermelho' })); rq.end();
  });
  await page.waitForFunction(() => window.__game.state.players.has('sse1'), null, { timeout: 3000 }).catch(() => {});
  ok(await G(() => window.__game.state.players.has('sse1')), 'evento enviado ao servidor chega ao jogo pelo SSE');
  void before;

  // Carga: 200 eventos de uma vez não podem estourar o limite de unidades por time (70) nem dar erro.
  await G(() => { for (let i = 0; i < 200; i++) window.__game.emit({ type: 'chat', user: { id: 'm' + i, name: 'm' + i }, text: i % 2 ? 'azul' : 'vermelho' }); });
  await G(() => window.__game.step(0.1)); // remove as unidades marcadas como substituídas
  s = await G(() => ({ a: window.__game.state.units.filter((u) => u.team === 'azul').length, v: window.__game.state.units.filter((u) => u.team === 'vermelho').length }));
  ok(s.a <= 70 && s.v <= 70, 'limite de 70 unidades por time respeitado sob carga de 200 eventos (azul ' + s.a + ', vermelho ' + s.v + ')');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'tlg_carga.png') });
  const fps = await G(() => document.title && window.__game && 0);
  void fps;
  await page.waitForTimeout(3000);
  ok(errors.length === 0, 'nenhum erro no console/página' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  server.kill();
}

// O transmissor 24h não pode subir sem destino: tem que parar avisando o que falta.
function streamScriptTests() {
  const { spawnSync } = require('child_process');
  const env = Object.assign({}, process.env);
  delete env.STREAM_URL;
  const r = spawnSync('bash', [path.join(ROOT, 'stream', 'stream.sh')], { env, encoding: 'utf8', timeout: 10000 });
  ok(r.status !== 0 && /defina STREAM_URL/.test(r.stderr), 'stream.sh sem STREAM_URL para na hora e diz o que falta');
  const syntax = spawnSync('bash', ['-n', path.join(ROOT, 'stream', 'stream.sh')], { encoding: 'utf8' });
  ok(syntax.status === 0, 'stream.sh sem erro de sintaxe');
}

(async () => {
  try {
    streamScriptTests();
    await apiTests();
    await liveBridgeTests();
    await browserTests();
  } catch (e) {
    console.error('ERRO NO TESTE', e);
    failures++;
  }
  console.log(failures ? failures + ' FALHA(S)' : 'TUDO OK');
  process.exit(failures ? 1 : 0);
})();
