/*
 * Cabo de Guerra da Live — jogo 9:16 movido por eventos da live.
 *
 *   comentou AZUL / VERMELHO  -> entra no time e solta um soldado (com a foto e o nome)
 *   curtidas                  -> enchem a barra do time; cheia = SUPER (mais dano e velocidade por 6 s)
 *   presente                  -> tanque (cresce com o valor do presente)
 *   seguiu                    -> herói dourado
 *   compartilhou              -> cura a base do time
 *
 * Os eventos chegam por /events (ver server.js). Com ?debug aparece o FPS e window.__game.emit(...) fica disponível.
 */
(() => {
  'use strict';
  const W = 540, H = 960;
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has('debug');
  // Padrão: 60 fps em 1080x1920 (escala 2 sobre a base 540x960). Em aparelho fraco ou quente: ?fps=30&scale=1.5
  const FPS = Math.min(60, Math.max(10, Number(params.get('fps')) || 60));
  const SCALE = Math.min(2, Math.max(1, Number(params.get('scale')) || 2));
  const MAX_PER_TEAM = 70;
  const BASE_HP = 1000;
  const COOLDOWN = 4;
  const SUPER_SECONDS = 6;
  const WIN_SECONDS = 12;

  const TEAMS = {
    azul: { name: 'AZUL', color: '#3d8bff', dark: '#173f80', dir: -1, spawnY: H - 230, hitY: 165, enemy: 'vermelho' },
    vermelho: { name: 'VERMELHO', color: '#ff5252', dark: '#7d1d1d', dir: +1, spawnY: 230, hitY: H - 165, enemy: 'azul' },
  };
  // Ritmo pensado para live: os dois times se encontram em ~5 s, sem esperar demais pelo primeiro combate.
  const KINDS = {
    normal: { hp: 60, dmg: 8, speed: 48, r: 15 },
    hero: { hp: 190, dmg: 15, speed: 52, r: 20 },
    tank: { hp: 220, dmg: 12, speed: 38, r: 24 },
  };

  const canvas = document.getElementById('c');
  canvas.width = Math.round(W * SCALE);
  canvas.height = Math.round(H * SCALE);
  const ctx = canvas.getContext('2d');

  /* ---------- estado ---------- */
  const state = {
    units: [], particles: [], feed: [], players: new Map(),
    base: { azul: BASE_HP, vermelho: BASE_HP },
    power: { azul: 0, vermelho: 0 },
    superUntil: { azul: 0, vermelho: 0 },
    phase: 'play', phaseUntil: 0, winner: null, mvp: null,
    banner: null, nextId: 1, events: 0, round: 1,
  };
  let now = 0;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- fotos de perfil (só desenha quando carregou; senão círculo com inicial) ---------- */
  const avatars = new Map();
  function avatarFor(url) {
    if (!url) return null;
    let a = avatars.get(url);
    if (!a) {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      a = { img, ok: false };
      img.onload = () => { a.ok = true; };
      img.onerror = () => { a.ok = false; };
      img.src = url;
      avatars.set(url, a);
      if (avatars.size > 300) avatars.delete(avatars.keys().next().value);
    }
    return a.ok ? a.img : null;
  }
  const hue = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };

  /* ---------- regras ---------- */
  const teamCount = (t) => { let n = 0; for (const u of state.units) if (u.team === t && !u.dead) n++; return n; };
  const weakerTeam = () => {
    const a = teamCount('azul'), v = teamCount('vermelho');
    return a === v ? (Math.random() < 0.5 ? 'azul' : 'vermelho') : a < v ? 'azul' : 'vermelho';
  };
  const buffMul = (t) => (now < state.superUntil[t] ? 1.8 : 1);

  function feed(text, team) {
    state.feed.push({ text, color: team ? TEAMS[team].color : '#ffffff', until: now + 4.5 });
    if (state.feed.length > 3) state.feed.shift();
  }
  function banner(text, color, seconds) { state.banner = { text, color: color || '#ffffff', until: now + (seconds || 2.2) }; }

  function playerFor(user) {
    let p = state.players.get(user.id);
    if (!p) {
      p = { id: user.id, name: user.name || user.id, avatar: user.avatar || null, team: null, lastSpawn: -99, kills: 0 };
      state.players.set(user.id, p);
      if (state.players.size > 2000) state.players.delete(state.players.keys().next().value);
    } else {
      if (user.name) p.name = user.name;
      if (user.avatar) p.avatar = user.avatar;
    }
    return p;
  }

  function teamFromText(text) {
    const s = String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const az = /(^|[^a-z0-9])(azul|blue|1)([^a-z0-9]|$)/.test(s);
    const vm = /(^|[^a-z0-9])(vermelho|vermelha|red|2)([^a-z0-9]|$)/.test(s);
    return az === vm ? null : az ? 'azul' : 'vermelho';
  }

  function spawnUnit(p, kind, extra) {
    const t = TEAMS[p.team];
    const mine = state.units.filter((u) => u.team === p.team && !u.dead);
    if (mine.length >= MAX_PER_TEAM) {
      const old = mine.find((u) => u.kind === 'normal');
      if (old) old.dead = true;
    }
    const k = KINDS[kind];
    const mul = 1 + clamp((extra && extra.diamonds) || 0, 0, 200) / 100;
    const hp = k.hp * (kind === 'tank' ? mul : 1);
    state.units.push({
      id: state.nextId++, team: p.team, kind, player: p,
      x: rnd(50, W - 50), y: t.spawnY + rnd(-18, 18), phase: rnd(0, 6.28),
      hp, max: hp, dmg: k.dmg, speed: k.speed * rnd(0.9, 1.1), r: k.r * (kind === 'tank' ? Math.min(1.5, 0.9 + mul * 0.3) : 1),
      cd: rnd(0, 0.5), dead: false, bubble: null, born: now,
    });
    burst(state.units[state.units.length - 1].x, t.spawnY, t.color, 8);
  }

  function onEvent(ev) {
    if (!ev || ev.type === 'hello') return;
    state.events++;
    if (state.phase !== 'play') return;
    const p = playerFor(ev.user);
    const join = (team) => { p.team = team; feed(p.name + ' entrou no ' + TEAMS[team].name, team); };

    if (ev.type === 'chat') {
      const want = teamFromText(ev.text);
      if (!p.team && want) {
        join(want);
        spawnUnit(p, 'normal');
        p.lastSpawn = now;
      } else if (p.team) {
        const mine = state.units.filter((u) => u.player === p && !u.dead);
        if (now - p.lastSpawn >= COOLDOWN && (want === p.team || mine.length === 0)) {
          spawnUnit(p, 'normal');
          p.lastSpawn = now;
        }
        const last = state.units.filter((u) => u.player === p && !u.dead).pop();
        if (last) last.bubble = { text: String(ev.text).slice(0, 40), until: now + 3.5 };
      }
    } else if (ev.type === 'like') {
      const team = p.team || weakerTeam();
      state.power[team] = Math.min(100, state.power[team] + (ev.likes || 1) * (p.team ? 1.2 : 0.5));
    } else if (ev.type === 'gift') {
      if (!p.team) join(weakerTeam());
      const n = clamp(ev.gift.count, 1, 6);
      for (let i = 0; i < n; i++) spawnUnit(p, 'tank', { diamonds: ev.gift.diamonds });
      banner(p.name + ' mandou ' + ev.gift.name + (ev.gift.count > 1 ? ' x' + ev.gift.count : '') + '!', TEAMS[p.team].color);
    } else if (ev.type === 'follow') {
      if (!p.team) join(weakerTeam());
      spawnUnit(p, 'hero');
      feed(p.name + ' seguiu: HERÓI!', p.team);
    } else if (ev.type === 'share') {
      const team = p.team || weakerTeam();
      state.base[team] = Math.min(BASE_HP, state.base[team] + 60);
      feed(p.name + ' curou a base ' + TEAMS[team].name, team);
    }
  }

  /* ---------- simulação ---------- */
  function burst(x, y, color, n) {
    for (let i = 0; i < n && state.particles.length < 220; i++)
      state.particles.push({ x, y, vx: rnd(-90, 90), vy: rnd(-90, 90), life: rnd(0.3, 0.7), max: 0.7, color, size: rnd(2, 5) });
  }

  function startWin(team) {
    state.phase = 'win';
    state.winner = team;
    state.phaseUntil = now + WIN_SECONDS;
    let best = null;
    for (const p of state.players.values()) if (p.team === team && (!best || p.kills > best.kills)) best = p;
    state.mvp = best;
    for (let i = 0; i < 120; i++)
      state.particles.push({ x: rnd(0, W), y: rnd(-40, 200), vx: rnd(-40, 40), vy: rnd(60, 220), life: rnd(1.5, 3), max: 3, color: i % 2 ? TEAMS[team].color : '#ffd34d', size: rnd(3, 7) });
  }

  function resetRound() {
    state.units.length = 0;
    state.players.clear();
    state.base.azul = state.base.vermelho = BASE_HP;
    state.power.azul = state.power.vermelho = 0;
    state.superUntil.azul = state.superUntil.vermelho = 0;
    state.phase = 'play';
    state.winner = state.mvp = null;
    state.round++;
    state.feed.length = 0;
    banner('NOVA RODADA! Comente AZUL ou VERMELHO', '#ffd34d', 3);
  }

  function update(dt) {
    for (const t of ['azul', 'vermelho']) {
      if (state.power[t] >= 100 && now >= state.superUntil[t]) {
        state.superUntil[t] = now + SUPER_SECONDS;
        state.power[t] = 0;
        banner('SUPER ' + TEAMS[t].name + '!', TEAMS[t].color, 2.5);
      }
    }
    if (state.phase === 'win') {
      if (now >= state.phaseUntil) resetRound();
    } else {
      const blue = [], red = [];
      for (const u of state.units) if (!u.dead) (u.team === 'azul' ? blue : red).push(u);
      for (const u of state.units) {
        if (u.dead) continue;
        const T = TEAMS[u.team];
        const foes = u.team === 'azul' ? red : blue;
        u.cd -= dt;
        let target = null, best = 1e9;
        for (const f of foes) {
          const dx = f.x - u.x, dy = f.y - u.y, d = dx * dx + dy * dy;
          if (d < best) { best = d; target = f; }
        }
        const reach = target ? u.r + target.r + 6 : 0;
        if (target && best <= reach * reach) {
          if (u.cd <= 0) {
            u.cd = 0.7;
            target.hp -= u.dmg * buffMul(u.team);
            burst((u.x + target.x) / 2, (u.y + target.y) / 2, '#ffffff', 2);
            if (target.hp <= 0 && !target.dead) { target.dead = true; u.player.kills++; }
          }
          continue;
        }
        const atBase = u.team === 'azul' ? u.y <= T.hitY : u.y >= T.hitY;
        if (atBase) {
          if (u.cd <= 0) {
            u.cd = 0.7;
            const e = T.enemy;
            state.base[e] -= u.dmg * buffMul(u.team) * 0.6;
            burst(u.x, T.hitY, '#ffd34d', 3);
            if (state.base[e] <= 0) { state.base[e] = 0; startWin(u.team); break; }
          }
          continue;
        }
        let vx = 0;
        if (target && best < 170 * 170) vx = clamp(target.x - u.x, -1, 1) * u.speed * 0.6;
        u.x = clamp(u.x + (vx + Math.sin(now * 2 + u.phase) * 6) * dt * buffMul(u.team), 18, W - 18);
        u.y += T.dir * u.speed * dt * (now < state.superUntil[u.team] ? 1.3 : 1);
      }
      let w = 0;
      for (const u of state.units) {
        if (u.dead) burst(u.x, u.y, TEAMS[u.team].color, 6);
        else state.units[w++] = u;
      }
      state.units.length = w;
    }
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const q = state.particles[i];
      q.life -= dt;
      if (q.life <= 0) { state.particles[i] = state.particles[state.particles.length - 1]; state.particles.pop(); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 120 * dt;
    }
    while (state.feed.length && state.feed[0].until < now) state.feed.shift();
    if (state.banner && state.banner.until < now) state.banner = null;
  }

  /* ---------- desenho ---------- */
  const bg = document.createElement('canvas');
  bg.width = canvas.width; bg.height = canvas.height;
  (function paintBackground() {
    const b = bg.getContext('2d');
    b.scale(SCALE, SCALE);
    const g = b.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2a0f1f'); g.addColorStop(0.5, '#15122e'); g.addColorStop(1, '#0d1f3f');
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) { b.fillStyle = 'rgba(255,255,255,' + rnd(0.15, 0.6).toFixed(2) + ')'; b.fillRect(rnd(0, W), rnd(0, H), 2, 2); }
    // ponte de madeira no centro
    b.fillStyle = '#4a3322'; b.fillRect(26, 150, W - 52, H - 300);
    for (let y = 150; y < H - 150; y += 38) { b.fillStyle = (y / 38) % 2 ? '#5b4029' : '#513822'; b.fillRect(30, y + 2, W - 60, 34); b.fillStyle = 'rgba(0,0,0,.25)'; b.fillRect(30, y + 34, W - 60, 2); }
    b.fillStyle = '#2d1f14'; b.fillRect(20, 150, 10, H - 300); b.fillRect(W - 30, 150, 10, H - 300);
    b.fillStyle = 'rgba(255,255,255,.18)'; b.fillRect(0, H / 2 - 1, W, 2);
    // bases
    for (const t of ['azul', 'vermelho']) {
      const top = t === 'vermelho';
      const y0 = top ? 96 : H - 150;
      b.fillStyle = TEAMS[t].dark; b.fillRect(20, y0, W - 40, 54);
      b.fillStyle = TEAMS[t].color;
      for (let x = 20; x < W - 40; x += 36) b.fillRect(x, top ? y0 + 54 : y0 - 12, 22, 12);
      b.fillRect(20, top ? y0 + 46 : y0, W - 40, 8);
    }
  })();

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  function text(s, x, y, size, color, align, stroke) {
    ctx.font = 'bold ' + size + 'px system-ui, sans-serif';
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    if (stroke) { ctx.lineWidth = Math.max(3, size / 5); ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
    ctx.fillStyle = color; ctx.fillText(s, x, y);
  }
  // Reduz o corpo da fonte até o texto caber na largura (nomes e avisos longos não saem da tela).
  function fitSize(s, size, maxW) {
    ctx.font = 'bold ' + size + 'px system-ui, sans-serif';
    const w = ctx.measureText(s).width;
    return w > maxW ? Math.max(10, Math.floor((size * maxW) / w)) : size;
  }
  function bar(x, y, w, h, frac, color, back) {
    ctx.fillStyle = back || 'rgba(0,0,0,.55)'; rr(x, y, w, h, h / 2); ctx.fill();
    if (frac > 0) { ctx.fillStyle = color; rr(x, y, Math.max(h, w * frac), h, h / 2); ctx.fill(); }
  }

  function drawUnit(u, showName) {
    const T = TEAMS[u.team];
    const sup = now < state.superUntil[u.team];
    const age = Math.min(1, (now - u.born) * 4);
    const r = u.r * (0.6 + 0.4 * age);
    if (sup) { ctx.fillStyle = 'rgba(255,230,120,.35)'; ctx.beginPath(); ctx.arc(u.x, u.y, r + 7, 0, 6.2832); ctx.fill(); }
    ctx.fillStyle = u.kind === 'hero' ? '#ffd34d' : T.color;
    ctx.beginPath(); ctx.arc(u.x, u.y, r + 3, 0, 6.2832); ctx.fill();
    const img = avatarFor(u.player.avatar);
    ctx.save();
    ctx.beginPath(); ctx.arc(u.x, u.y, r, 0, 6.2832); ctx.clip();
    if (img) ctx.drawImage(img, u.x - r, u.y - r, r * 2, r * 2);
    else { ctx.fillStyle = 'hsl(' + hue(u.player.id) + ',55%,45%)'; ctx.fillRect(u.x - r, u.y - r, r * 2, r * 2); }
    ctx.restore();
    if (!img) text((u.player.name[0] || '?').toUpperCase(), u.x, u.y + 1, Math.round(r * 1.1), '#ffffff');
    if (u.hp < u.max) bar(u.x - r, u.y + r + 4, r * 2, 4, u.hp / u.max, '#5dff7a');
    if (showName || u.kind !== 'normal') text(u.player.name.slice(0, 12), u.x, u.y - r - 9, 11, '#ffffff', 'center', true);
  }

  function drawBubble(u) {
    if (!u.bubble || u.bubble.until < now) return;
    ctx.font = 'bold 13px system-ui, sans-serif';
    const tw = Math.min(200, ctx.measureText(u.bubble.text).width) + 16;
    const bx = clamp(u.x - tw / 2, 6, W - tw - 6), by = u.y - u.r - 44;
    ctx.fillStyle = 'rgba(255,255,255,.95)'; rr(bx, by, tw, 24, 12); ctx.fill();
    text(u.bubble.text, bx + tw / 2, by + 12, 13, '#111111', 'center');
  }

  let fpsShown = 0;
  function draw() {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.drawImage(bg, 0, 0, W, H);

    const many = state.units.length > 60;
    for (const u of state.units) drawUnit(u, !many);
    for (const u of state.units) drawBubble(u);
    for (const q of state.particles) { ctx.globalAlpha = clamp(q.life / q.max, 0, 1); ctx.fillStyle = q.color; ctx.fillRect(q.x, q.y, q.size, q.size); }
    ctx.globalAlpha = 1;

    // placar: vermelho em cima, azul embaixo
    for (const t of ['vermelho', 'azul']) {
      const T = TEAMS[t], top = t === 'vermelho';
      const y = top ? 14 : H - 62;
      ctx.fillStyle = 'rgba(0,0,0,.45)'; rr(14, y - 4, W - 28, 52, 14); ctx.fill();
      text(T.name + ' · ' + teamCount(t), 28, y + 10, 16, T.color, 'left', true);
      text(Math.max(0, Math.ceil(state.base[t])) + ' / ' + BASE_HP, W - 28, y + 10, 14, '#ffffff', 'right', true);
      bar(28, y + 24, W - 56, 12, state.base[t] / BASE_HP, T.color);
      const sup = now < state.superUntil[t];
      bar(28, y + 40 - 2, W - 56, 5, sup ? 1 : state.power[t] / 100, sup ? '#ffd34d' : '#b8c4ff');
    }
    ctx.fillStyle = 'rgba(0,0,0,.5)'; rr(14, 70, W - 28, 24, 12); ctx.fill();
    const tip = 'COMENTE AZUL ou VERMELHO · CURTA = SUPER · PRESENTE = TANQUE · SEGUIR = HERÓI';
    text(tip, W / 2, 82, fitSize(tip, 11, W - 44), '#ffffff', 'center'); // fontes de servidor (DejaVu) são mais largas

    ctx.globalAlpha = 1;
    state.feed.forEach((f, i) => {
      const y = 108 + i * 22; // sobre a base vermelha: não cobre onde os soldados nascem
      ctx.font = 'bold 12px system-ui, sans-serif';
      const w = Math.min(300, ctx.measureText(f.text).width + 16);
      ctx.globalAlpha = clamp((f.until - now) / 0.6, 0, 1) * 0.9;
      ctx.fillStyle = 'rgba(0,0,0,.55)'; rr(12, y - 10, w, 20, 10); ctx.fill();
      text(f.text, 20, y, 12, f.color, 'left');
    });
    ctx.globalAlpha = 1;

    if (state.phase === 'win') {
      const T = TEAMS[state.winner];
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, H / 2 - 120, W, 240);
      const win = 'TIME ' + T.name + ' VENCEU!';
      text(win, W / 2, H / 2 - 60, fitSize(win, 40, W - 40), T.color, 'center', true);
      if (state.mvp) {
        const mvp = 'MVP: ' + state.mvp.name + ' (' + state.mvp.kills + ' abates)';
        text(mvp, W / 2, H / 2, fitSize(mvp, 24, W - 40), '#ffd34d', 'center', true);
      }
      text('Nova rodada em ' + Math.max(0, Math.ceil(state.phaseUntil - now)) + ' s', W / 2, H / 2 + 60, 20, '#ffffff', 'center', true);
    } else if (state.banner) {
      const k = clamp((state.banner.until - now) / 0.4, 0, 1);
      ctx.globalAlpha = k;
      text(state.banner.text, W / 2, H / 2 - 20, fitSize(state.banner.text, 30, W - 40), state.banner.color, 'center', true);
      ctx.globalAlpha = 1;
    }

    if (!connected && !DEBUG) text('sem conexão com o servidor…', W / 2, H / 2 + 120, 16, '#ff9d9d', 'center', true);
    if (DEBUG) text(fpsShown + ' fps · ' + state.units.length + ' unid · ' + state.events + ' ev', 10, H / 2 + 20, 12, '#9dffb0', 'left', true);
  }

  /* ---------- laço (limitado a FPS quadros por segundo: poupa bateria e esquentamento) ---------- */
  let last = performance.now(), acc = 0, frames = 0, fpsAt = last;
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    acc += dt;
    const step = 1 / FPS;
    if (acc < step - 0.002) return;
    update(acc);
    now += acc;
    acc = 0;
    draw();
    frames++;
    if (t - fpsAt >= 1000) { fpsShown = Math.round((frames * 1000) / (t - fpsAt)); frames = 0; fpsAt = t; }
  }

  /* ---------- eventos da live ---------- */
  let connected = false;
  const es = new EventSource('/events');
  es.onopen = () => { connected = true; };
  es.onerror = () => { connected = false; };
  es.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch (err) { /* evento inválido: ignora */ } };

  if (DEBUG) window.__game = { state, fps: () => fpsShown, size: () => [canvas.width, canvas.height], emit: onEvent, step: (s) => { update(s); now += s; }, reset: resetRound };

  banner('Comente AZUL ou VERMELHO para entrar!', '#ffd34d', 4);
  requestAnimationFrame(frame);
})();
