import {
  DEFAULT_CONFIG,
  buildEntries,
  getDraws,
  normalizeUsername,
  parseUserList,
  pickEntry,
  secureRandomInt,
} from './lib/rules.js';
import { parseImport } from './lib/importer.js';
import { demoData } from './lib/demo.js';
import { burst } from './lib/confetti.js';

// ---------------------------------------------------------------- helpers

const $ = (sel, root = document) => root.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n ?? 0).toLocaleString('es-AR');
const profileUrl = (u) => `https://www.instagram.com/${encodeURIComponent(u)}/`;

const CONFIG_KEY = 'sorteo-ig:config';

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY));
    if (saved) return { ...structuredClone(DEFAULT_CONFIG), ...saved };
  } catch {
    /* config por defecto */
  }
  return structuredClone(DEFAULT_CONFIG);
}

function saveConfig() {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
  } catch {
    /* sin almacenamiento local */
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function toast(message, ms = 3200) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), ms);
}

function avatar(username, pic, cls = '') {
  const initial = esc((username || '?').replace(/[^a-z0-9]/gi, '').slice(0, 1) || '?');
  if (pic) {
    const src = pic.startsWith('http') ? `/api/img?u=${encodeURIComponent(pic)}` : pic;
    return `<span class="avatar ring ${cls}"><img src="${esc(src)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${initial}'}))"></span>`;
  }
  return `<span class="avatar ring ${cls}"><span>${initial}</span></span>`;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

function download(filename, content, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿', content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// ---------------------------------------------------------------- state

const state = {
  view: 'home', // home | loading | rules | draw | results
  session: { connected: false, user: null },
  source: null, // instagram | import | demo
  post: null,
  comments: [],
  progress: null,
  error: null,
  pendingUrl: null,
  config: loadConfig(),
  demoChecks: null,
  likers: null,
  drawStates: [],
  drawConfigKey: null,
  activeDraw: 0,
  modal: null,
};

const accountName = (user) => (user.username ? `@${user.username}` : 'Cuenta conectada');

const owner = () => state.post?.owner?.username ?? '';

function computeDraws() {
  return getDraws(state.config).map((draw) => ({
    draw,
    result: buildEntries(state.comments, draw, state.config, owner()),
  }));
}

function followAccounts() {
  const list = parseUserList(state.config.followAccounts);
  return list.length ? list : owner() ? [normalizeUsername(owner())] : [];
}

// ---------------------------------------------------------------- render: shell

const STEPS = [
  { id: 'post', label: 'Publicación', views: ['home', 'loading'] },
  { id: 'rules', label: 'Reglas', views: ['rules'] },
  { id: 'draw', label: 'Sorteo', views: ['draw'] },
  { id: 'results', label: 'Resultados', views: ['results'] },
];

function renderSteps() {
  const current = STEPS.findIndex((s) => s.views.includes(state.view));
  $('#steps').innerHTML = STEPS.map((s, i) => {
    const cls = i === current ? 'active' : i < current ? 'done' : '';
    const sep = i ? '<span class="step-sep"></span>' : '';
    return `${sep}<span class="step ${cls}"><span class="num">${i < current ? '✓' : i + 1}</span>${s.label}</span>`;
  }).join('');
}

function renderAccount() {
  const { connected, user } = state.session;
  $('#account').innerHTML = connected
    ? `<button class="account-chip" data-action="open-session">${avatar(user.username, user.profilePic)}<span>${esc(accountName(user))}</span><span class="status"></span></button>`
    : `<button class="account-btn" data-action="open-session">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/></svg>
        Conectar Instagram</button>`;
}

function render() {
  renderSteps();
  renderAccount();
  const views = { home: viewHome, loading: viewLoading, rules: viewRules, draw: viewDraw, results: viewResults };
  $('#app').innerHTML = views[state.view]();
  if (state.view === 'rules') updatePreview();
  window.scrollTo({ top: 0 });
}

function go(view) {
  state.view = view;
  render();
}

// ---------------------------------------------------------------- view: home

function viewHome() {
  return `
  <section class="hero">
    <span class="badge">🎁 Sorteos de Instagram · 100% local</span>
    <h1>Sorteá en Instagram<br><span>de forma justa y transparente</span></h1>
    <p class="lead">Pegá el link de tu publicación, definí las reglas y elegí a los ganadores al azar entre los comentarios que las cumplen.</p>
    <form class="url-form" data-form="url">
      <span class="ig-icon">
        <svg width="26" height="26" viewBox="0 0 24 24"><defs><linearGradient id="igg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#feda75"/><stop offset=".35" stop-color="#fa7e1e"/><stop offset=".6" stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke="url(#igg)" stroke-width="2"/><circle cx="12" cy="12" r="4.3" fill="none" stroke="url(#igg)" stroke-width="2"/><circle cx="17.4" cy="6.6" r="1.2" fill="#d62976"/></svg>
      </span>
      <input name="url" type="text" placeholder="https://www.instagram.com/p/..." value="${esc(state.pendingUrl ?? '')}" autocomplete="off" required>
      <button class="btn btn-primary" type="submit">Comenzar</button>
    </form>
    ${state.error ? `<div class="error-box">⚠️ ${esc(state.error)}</div>` : ''}
    <div class="hero-links">
      <span>¿Sin conexión a Instagram?</span>
      <button class="btn-link" data-action="open-import">Importar comentarios</button>
      <span>·</span>
      <button class="btn-link" data-action="demo">Probar con datos de ejemplo</button>
    </div>
  </section>

  <section class="features">
    <div class="feature"><div class="icon">💬</div><h3>Palabras clave</h3><p>Filtrá por palabras. Cada palabra puede ser un sorteo aparte con su propio premio.</p></div>
    <div class="feature"><div class="icon">👥</div><h3>Menciones</h3><p>Exigí una cantidad de amigos etiquetados. Los comentarios extra sólo cuentan si etiquetan gente nueva.</p></div>
    <div class="feature"><div class="icon">🚫</div><h3>Sin trampas</h3><p>Los comentarios repetidos no cuentan y podés excluir cuentas. Cada participación válida es una chance.</p></div>
    <div class="feature"><div class="icon">✅</div><h3>Verificación</h3><p>Al ganador se le verifica que siga la cuenta y le haya dado me gusta. Si no cumple, se sortea otro.</p></div>
  </section>`;
}

// ---------------------------------------------------------------- view: loading

function postCard() {
  const p = state.post;
  if (!p) return '';
  const img = p.image
    ? `<img src="/api/img?u=${encodeURIComponent(p.image)}" alt="">`
    : '<span class="placeholder">🎁</span>';
  const sourceLabel = { instagram: 'Comentarios traídos de Instagram', import: 'Comentarios importados', demo: 'Datos de ejemplo' }[state.source];
  return `
  <div class="card post-card">
    <div class="post-head">
      ${avatar(p.owner.username, p.owner.profilePic)}
      <div><div class="name">${esc(p.owner.username || 'Publicación')}</div><div class="full">${esc(p.owner.fullName ?? '')}</div></div>
    </div>
    <div class="post-img">${img}</div>
    <div class="post-stats"><span>❤️ ${fmt(p.likeCount)}</span><span>💬 ${fmt(state.comments.length || p.commentCount)}</span></div>
    ${p.caption ? `<div class="post-caption">${esc(p.caption)}</div>` : ''}
    <div class="post-source">${sourceLabel ?? ''}${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener">ver post</a>` : ''}</div>
  </div>`;
}

function viewLoading() {
  const pr = state.progress ?? {};
  const total = pr.total || state.post?.commentCount || 0;
  const pct = total ? Math.min(100, Math.round(((pr.comments ?? 0) / total) * 100)) : 0;
  return `
  <div class="grid-2">
    <div>${postCard()}</div>
    <div class="card loading-card" id="loading">
      <div class="spinner"></div>
      <h2>${state.post ? 'Cargando comentarios…' : 'Buscando la publicación…'}</h2>
      <p class="sub" id="loading-text">${state.post ? `${fmt(pr.comments ?? 0)}${total ? ` de ~${fmt(total)}` : ''} comentarios` : 'Conectando con Instagram'}</p>
      <div class="progress ${total ? '' : 'indeterminate'}"><div style="width:${pct}%"></div></div>
      <p class="hint">Vamos despacio a propósito para que Instagram no bloquee la cuenta. En posts con miles de comentarios puede tardar unos minutos.</p>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- view: rules

function toggle(path, label, hint = '') {
  const checked = getPath(state.config, path) ? 'checked' : '';
  return `<label class="toggle"><input type="checkbox" data-bind="${path}" ${checked}><span class="switch"></span>
    <span class="t-label">${label}${hint ? `<span class="t-hint">${hint}</span>` : ''}</span></label>`;
}

function stepper(path, min = 0, max = 99) {
  return `<div class="stepper"><button type="button" data-action="step" data-path="${path}" data-delta="-1" data-min="${min}" data-max="${max}">−</button>
    <span data-show="${path}">${getPath(state.config, path)}</span>
    <button type="button" data-action="step" data-path="${path}" data-delta="1" data-min="${min}" data-max="${max}">+</button></div>`;
}

function drawRow(d, path, removable) {
  return `<div class="draw-row ${removable ? '' : 'single'}">
    <div class="field"><label>${removable ? 'Palabra(s)' : 'Palabra(s) (opcional)'}</label>
      <input data-bind="${path}.keywords" value="${esc(d.keywords)}" placeholder="${removable ? 'comic, cómic, comics' : 'vacío = todos los comentarios'}"></div>
    <div class="field"><label>Premio</label><input data-bind="${path}.prize" value="${esc(d.prize)}" placeholder="Nombre del premio"></div>
    <div class="field"><label>Ganadores</label><input type="number" min="1" data-bind="${path}.winners" value="${esc(d.winners)}"></div>
    <div class="field"><label>Suplentes</label><input type="number" min="0" data-bind="${path}.alternates" value="${esc(d.alternates)}"></div>
    ${removable ? `<button class="icon-btn" data-action="remove-draw" data-index="${path.split('.')[1]}" title="Quitar">×</button>` : ''}
  </div>`;
}

function viewRules() {
  const c = state.config;
  const separate = c.mode === 'separate';
  return `
  <div class="grid-2">
    <div class="sticky">
      ${postCard()}
      <div class="card">
        <div class="row-between"><h2>Participantes</h2><button class="btn-link" data-action="open-participants">Ver detalle</button></div>
        <p class="sub">Se actualiza a medida que cambiás las reglas.</p>
        <div class="preview-list" id="preview"></div>
      </div>
    </div>

    <div class="card">
      <h2>Reglas del sorteo</h2>
      <p class="sub">Sólo participan los comentarios que cumplen todas las reglas.</p>

      <div class="section">
        <div class="section-title"><span class="ico">💬</span>Palabras clave y premios</div>
        <div class="segmented">
          <button type="button" class="${separate ? 'on' : ''}" data-action="mode" data-mode="separate">Un sorteo por palabra</button>
          <button type="button" class="${separate ? '' : 'on'}" data-action="mode" data-mode="single">Un solo sorteo</button>
        </div>
        <p class="hint">${separate
          ? 'Cada palabra es un sorteo aparte: quienes comentan esa palabra compiten entre sí por su premio. Un mismo usuario puede participar en varios. Separá variantes con coma (ej: <code>comic, cómic</code>). No importan tildes ni mayúsculas.'
          : 'Un único sorteo. Si ponés palabras, el comentario tiene que incluir al menos una (separadas por coma).'}</p>
        <div class="draw-rows">
          ${separate ? c.draws.map((d, i) => drawRow(d, `draws.${i}`, true)).join('') : drawRow(c.single, 'single', false)}
        </div>
        ${separate ? '<div style="margin-top:10px"><button class="btn btn-ghost btn-sm" data-action="add-draw">+ Agregar palabra</button></div>' : ''}
      </div>

      <div class="section">
        <div class="section-title"><span class="ico">👥</span>Menciones</div>
        <p class="hint">Cantidad mínima de personas distintas que cada usuario tiene que etiquetar. Se suman entre todos sus comentarios: con mínimo 2, dos comentarios con una persona distinta cada uno ya cuentan. No vale etiquetarse a uno mismo ni a la cuenta organizadora.</p>
        ${stepper('minMentions', 0, 20)}
        <div style="margin-top:10px">
          ${toggle('multipleEntries', 'Permitir varias participaciones por usuario', 'Cada vez que vuelve a juntar el mínimo de personas nuevas (que no había etiquetado antes) suma otra chance, como máximo una por comentario.')}
        </div>
      </div>

      <div class="section">
        <div class="section-title"><span class="ico">🧹</span>Filtros</div>
        ${toggle('ignoreDuplicates', 'Ignorar comentarios repetidos', 'Si un usuario comenta el mismo texto más de una vez, cuenta sólo el primero.')}
        ${toggle('includeReplies', 'Incluir respuestas a otros comentarios', 'Por defecto sólo cuentan los comentarios principales.')}
        ${toggle('excludeOwner', 'Excluir a la cuenta organizadora')}
        <div class="field" style="margin-top:8px"><label>Excluir cuentas</label>
          <textarea rows="2" data-bind="blacklist" placeholder="@cuenta1, @cuenta2">${esc(c.blacklist)}</textarea></div>
      </div>

      <div class="section">
        <div class="section-title"><span class="ico">✅</span>Requisitos que se verifican al ganador</div>
        <p class="hint">Se chequean sólo sobre quien sale sorteado. Si no cumple, queda descalificado y se sortea otro.${
          state.source === 'import' ? ' <b>Como los comentarios no vienen de Instagram, vas a tener que confirmarlo a mano.</b>' : ''}</p>
        ${toggle('requireFollow', 'Debe seguir a la cuenta')}
        <div class="field" style="margin:0 0 8px 54px" ${c.requireFollow ? '' : 'hidden'} id="follow-field"><label>Cuentas a seguir</label>
          <input data-bind="followAccounts" value="${esc(c.followAccounts)}" placeholder="@${esc(owner() || 'cuenta')}"></div>
        ${toggle('requireLike', 'Debe darle me gusta a la publicación')}
        ${toggle('uniqueWinners', 'Un usuario no puede ganar más de un sorteo', 'Si ya ganó un premio, se lo saltea en los demás sorteos.')}
      </div>

      <div class="actions">
        <button class="btn btn-ghost" data-action="home">← Cambiar publicación</button>
        <button class="btn btn-primary btn-lg" data-action="to-draw">Ir al sorteo 🎲</button>
      </div>
    </div>
  </div>`;
}

function updatePreview() {
  const el = $('#preview');
  if (!el) return;
  const draws = computeDraws();
  el.innerHTML = draws.length
    ? draws.map(({ draw, result }) => `
      <div class="preview-item">
        <div class="prize"><span>🏆 ${esc(draw.prize)}</span><span class="pill">${draw.winners} ganador${draw.winners > 1 ? 'es' : ''}</span></div>
        <div class="kw">${draw.keywords.length ? `Palabra: ${esc(draw.keywords.join(' / '))}` : 'Todos los comentarios'}</div>
        <div class="nums">
          <div><b>${fmt(result.users.size)}</b><small>participantes</small></div>
          <div><b>${fmt(result.entries.length)}</b><small>chances</small></div>
          <div><b>${fmt(result.rejected.length)}</b><small>descartados</small></div>
        </div>
      </div>`).join('')
    : '<div class="empty">Agregá al menos una palabra clave.</div>';
}

// ---------------------------------------------------------------- view: draw

function prepareDraws() {
  const key = JSON.stringify({ c: state.config, n: state.comments.length, p: state.post?.id });
  const hasPicks = state.drawStates.some((d) => d.picks.length);
  if (hasPicks && key === state.drawConfigKey) return true;
  if (hasPicks && !confirm('Cambiaste las reglas. Se van a borrar los ganadores ya sorteados. ¿Continuar?')) return false;
  state.drawConfigKey = key;
  state.drawStates = computeDraws().map(({ draw, result }) => ({ draw, result, picks: [], busy: false }));
  state.activeDraw = 0;
  return true;
}

const validPicks = (ds, role) => ds.picks.filter((p) => p.status === 'valid' && (!role || p.role === role));

function nextRole(ds) {
  if (validPicks(ds, 'winner').length < ds.draw.winners) return 'winner';
  if (validPicks(ds, 'alternate').length < ds.draw.alternates) return 'alternate';
  return null;
}

function roleLabel(role, n) {
  return role === 'winner' ? `Ganador${n ? ` ${n}` : ''}` : `Suplente${n ? ` ${n}` : ''}`;
}

function excludedFor(ds) {
  const excluded = new Set(ds.picks.map((p) => p.entry.username));
  if (state.config.uniqueWinners) {
    for (const other of state.drawStates) {
      if (other !== ds) validPicks(other, 'winner').forEach((p) => excluded.add(p.entry.username));
    }
  }
  return excluded;
}

function remainingUsers(ds) {
  const excluded = excludedFor(ds);
  return new Set(ds.result.entries.filter((e) => !excluded.has(e.username)).map((e) => e.username)).size;
}

function checkBadge(check) {
  const icon = { ok: '✓', fail: '✕', unknown: '?', pending: '<span class="mini-spin"></span>' }[check.status];
  return `<span class="check ${check.status}">${icon} ${esc(check.label)}</span>`;
}

function pickCard(pick, dsIndex, pickIndex) {
  const e = pick.entry;
  const cls = pick.status === 'disqualified' ? 'disqualified' : pick.role === 'winner' && pick.status === 'valid' ? 'winner' : '';
  const roleText = pick.status === 'disqualified' ? 'Descalificado' : roleLabel(pick.role, pick.n);
  return `
  <div class="pick ${cls}">
    <div class="pick-top">
      ${avatar(e.username, e.profilePic)}
      <div style="min-width:0">
        <div class="pick-role">${pick.role === 'winner' && pick.status === 'valid' ? '🏆 ' : ''}${roleText}</div>
        <div class="pick-user"><a href="${profileUrl(e.displayUsername || e.username)}" target="_blank" rel="noopener">@${esc(e.displayUsername || e.username)}</a></div>
      </div>
    </div>
    ${(e.comments?.length ? e.comments : [e.text]).map((t) => `<div class="pick-comment">${esc(t)}</div>`).join('')}
    ${pick.checks.length ? `<div class="checks">${pick.checks.map(checkBadge).join('')}</div>` : ''}
    ${pick.reason ? `<div class="reason">${esc(pick.reason)}</div>` : ''}
    ${pick.status === 'manual' ? `
      <div class="manual">No se pudo verificar automáticamente${
        pick.checks.some((c) => c.error) ? ` (${esc(pick.checks.find((c) => c.error).error)})` : ''}. Revisá el <a href="${profileUrl(e.username)}" target="_blank" rel="noopener">perfil</a> y confirmá si cumple.
        <div class="row">
          <button class="btn btn-dark btn-sm" data-action="manual-ok" data-ds="${dsIndex}" data-pick="${pickIndex}">✓ Cumple</button>
          <button class="btn btn-ghost btn-sm" data-action="manual-fail" data-ds="${dsIndex}" data-pick="${pickIndex}">✕ No cumple</button>
        </div>
      </div>` : ''}
  </div>`;
}

function stageButton(ds, index) {
  const role = nextRole(ds);
  const waiting = ds.picks.some((p) => p.status === 'verifying' || p.status === 'manual');
  if (!role) {
    const next = state.drawStates.findIndex((d, i) => i > index && nextRole(d));
    return `<div class="actions" style="justify-content:center">
      <span class="pill" style="align-self:center">Sorteo completo ✓</span></div>
      <div class="actions" style="max-width:460px;margin-left:auto;margin-right:auto">
      ${next >= 0 ? `<button class="btn btn-primary btn-lg" data-action="select-draw" data-index="${next}">Siguiente sorteo →</button>` : ''}
      <button class="btn ${next >= 0 ? 'btn-ghost' : 'btn-primary btn-lg'}" data-action="to-results">Ver resultados</button></div>`;
  }
  const n = validPicks(ds, role).length + 1;
  const left = remainingUsers(ds);
  const disabled = ds.busy || waiting || left === 0;
  return `<button class="btn btn-primary btn-lg" data-action="draw" data-index="${index}" ${disabled ? 'disabled' : ''}>
    🎲 Sortear ${roleLabel(role, n).toLowerCase()}</button>
    ${left === 0 && !ds.busy ? '<p class="hint" style="margin-top:12px">No quedan participantes para sortear.</p>' : ''}`;
}

function viewDraw() {
  const ds = state.drawStates[state.activeDraw];
  if (!ds) return '<div class="card empty">No hay sorteos configurados.</div>';
  const last = ds.picks[ds.picks.length - 1];
  return `
  <div class="draw-header">
    <h1>🎲 Sorteo en vivo</h1>
    <div class="actions" style="margin:0">
      <button class="btn btn-ghost btn-sm" data-action="to-rules">← Reglas</button>
      <button class="btn btn-dark btn-sm" data-action="to-results">Resultados</button>
    </div>
  </div>
  ${state.drawStates.length > 1 ? `<div class="draw-tabs">${state.drawStates.map((d, i) => `
    <button class="draw-tab ${i === state.activeDraw ? 'on' : ''}" data-action="select-draw" data-index="${i}">
      ${nextRole(d) ? '' : '✓ '}${esc(d.draw.prize)}</button>`).join('')}</div>` : ''}
  <div class="card stage" id="stage">
    <div class="prize-name">🏆 ${esc(ds.draw.prize)}</div>
    <h2>${ds.draw.keywords.length ? `Comentaron “${esc(ds.draw.keywords[0])}”` : 'Todos los comentarios'}</h2>
    <div class="meta">${ds.draw.winners} ganador${ds.draw.winners > 1 ? 'es' : ''} y ${ds.draw.alternates} suplente${ds.draw.alternates === 1 ? '' : 's'}</div>
    <div class="roller" id="roller"><span class="roller-name">${last ? `@${esc(last.entry.displayUsername || last.entry.username)}` : '<span class="placeholder">¿Quién será? 🤞</span>'}</span></div>
    <div id="stage-button">${stageButton(ds, state.activeDraw)}</div>
  </div>
  <div class="picks" id="picks">${ds.picks.map((p, i) => pickCard(p, state.activeDraw, i)).join('')}</div>`;
}

function refreshDrawParts(dsIndex) {
  if (state.view !== 'draw' || dsIndex !== state.activeDraw) return;
  const ds = state.drawStates[dsIndex];
  $('#picks').innerHTML = ds.picks.map((p, i) => pickCard(p, dsIndex, i)).join('');
  $('#stage-button').innerHTML = stageButton(ds, dsIndex);
}

async function spin(ds, final) {
  const roller = $('#roller');
  const nameEl = roller.querySelector('.roller-name');
  const names = [...new Set(ds.result.entries.map((e) => e.displayUsername || e.username))];
  roller.classList.add('spinning');
  let delay = 35;
  const end = performance.now() + 3200;
  while (performance.now() < end) {
    nameEl.textContent = `@${names[secureRandomInt(names.length)]}`;
    await sleep(delay);
    delay *= 1.07;
  }
  roller.classList.remove('spinning');
  nameEl.textContent = `@${final.displayUsername || final.username}`;
}

async function runDraw(dsIndex) {
  const ds = state.drawStates[dsIndex];
  const role = nextRole(ds);
  if (!role || ds.busy) return;
  const entry = pickEntry(ds.result.entries, excludedFor(ds));
  if (!entry) {
    toast('No quedan participantes para sortear.');
    refreshDrawParts(dsIndex);
    return;
  }
  ds.busy = true;
  refreshDrawParts(dsIndex);
  if (state.view === 'draw' && state.activeDraw === dsIndex) await spin(ds, entry);

  const pick = { entry, role, n: validPicks(ds, role).length + 1, checks: [], status: 'verifying', reason: '' };
  if (state.config.requireFollow) {
    for (const account of followAccounts()) pick.checks.push({ type: 'follow', account, label: `Sigue a @${account}`, status: 'pending' });
  }
  if (state.config.requireLike) pick.checks.push({ type: 'like', label: 'Le dio me gusta', status: 'pending' });
  ds.picks.push(pick);
  ds.busy = false;
  refreshDrawParts(dsIndex);

  for (const check of pick.checks) {
    check.status = await runCheck(check, entry);
    refreshDrawParts(dsIndex);
  }

  const failed = pick.checks.filter((c) => c.status === 'fail');
  if (failed.length) {
    pick.status = 'disqualified';
    pick.reason = `No cumple: ${failed.map((c) => (c.type === 'like' ? 'no le dio me gusta' : `no sigue a @${c.account}`)).join(', ')}. Se sortea otro.`;
    refreshDrawParts(dsIndex);
    toast(`@${entry.username} quedó descalificado. Sorteando de nuevo…`);
    await sleep(1800);
    return runDraw(dsIndex);
  }
  if (pick.checks.some((c) => c.status === 'unknown')) {
    pick.status = 'manual';
    refreshDrawParts(dsIndex);
    return;
  }
  validate(pick, dsIndex);
}

function validate(pick, dsIndex) {
  pick.status = 'valid';
  refreshDrawParts(dsIndex);
  if (pick.role === 'winner') burst();
}

async function runCheck(check, entry) {
  const { username } = entry;
  if (state.source === 'demo') {
    const set = check.type === 'like' ? state.demoChecks.like : state.demoChecks.follow;
    await sleep(500);
    return set.has(username) ? 'ok' : 'fail';
  }
  if (state.source !== 'instagram' || !state.session.connected) return 'unknown';
  try {
    if (check.type === 'follow') {
      const { follows } = await api('/api/follows', {
        method: 'POST',
        body: { username, userId: entry.userId, account: check.account },
      });
      return follows ? 'ok' : 'fail';
    }
    if (!state.likers) {
      const data = await api('/api/likers', { method: 'POST', body: { mediaId: state.post.id } });
      state.likers = { set: new Set(data.usernames), total: data.total };
    }
    if (state.likers.set.has(username)) return 'ok';
    // Instagram puede devolver una lista parcial de likes: si está incompleta, no descalificamos.
    return state.likers.set.size >= state.likers.total ? 'fail' : 'unknown';
  } catch (err) {
    console.warn(err);
    check.error = err.message;
    return 'unknown';
  }
}

// ---------------------------------------------------------------- view: results

function announcement() {
  const lines = ['🎉 ¡Tenemos ganadores! 🎉', ''];
  for (const ds of state.drawStates) {
    const winners = validPicks(ds, 'winner');
    const alternates = validPicks(ds, 'alternate');
    lines.push(`🏆 ${ds.draw.prize}${ds.draw.keywords.length ? ` (“${ds.draw.keywords[0]}”)` : ''}`);
    lines.push(winners.length ? winners.map((p) => `@${p.entry.displayUsername || p.entry.username}`).join(', ') : '—');
    if (alternates.length) lines.push(`Suplentes: ${alternates.map((p) => `@${p.entry.displayUsername || p.entry.username}`).join(', ')}`);
    lines.push('');
  }
  lines.push('¡Gracias a todos por participar! Los ganadores tienen 48 hs para escribirnos por mensaje privado 💌');
  return lines.join('\n');
}

function viewResults() {
  const total = state.drawStates.reduce((acc, d) => acc + validPicks(d, 'winner').length, 0);
  return `
  <div class="results-hero">
    <span class="badge">🎉 ${total} ganador${total === 1 ? '' : 'es'}</span>
    <h1>Resultados del sorteo</h1>
    <p class="muted">${state.post?.owner?.username ? `@${esc(state.post.owner.username)} · ` : ''}${new Date().toLocaleString('es-AR')}</p>
  </div>
  <div class="grid-2">
    <div>
      ${state.drawStates.map((ds) => `
        <div class="card result-block">
          <h3>🏆 ${esc(ds.draw.prize)}</h3>
          <p class="sub">${ds.draw.keywords.length ? `Palabra “${esc(ds.draw.keywords.join(' / '))}” · ` : ''}${fmt(ds.result.users.size)} participantes · ${fmt(ds.result.entries.length)} chances</p>
          ${validPicks(ds).length ? validPicks(ds).map((p) => `
            <div class="result-row">${avatar(p.entry.username, p.entry.profilePic)}
              <div style="min-width:0"><b>@${esc(p.entry.displayUsername || p.entry.username)}</b><div class="muted" style="font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.entry.text)}</div></div>
              <span class="role">${roleLabel(p.role, p.n)}</span></div>`).join('') : '<div class="empty">Todavía no se sorteó.</div>'}
          ${ds.picks.some((p) => p.status === 'disqualified') ? `<p class="hint">Descalificados: ${ds.picks.filter((p) => p.status === 'disqualified').map((p) => `@${esc(p.entry.username)}`).join(', ')}</p>` : ''}
        </div>`).join('')}
    </div>
    <div class="card">
      <h2>Anuncio</h2>
      <p class="sub">Listo para copiar y pegar en Instagram.</p>
      <textarea class="announce" id="announce">${esc(announcement())}</textarea>
      <div class="actions">
        <button class="btn btn-primary" data-action="copy-announce">Copiar texto</button>
        <button class="btn btn-ghost" data-action="export-csv">Descargar CSV</button>
      </div>
      <div class="actions">
        <button class="btn btn-ghost" data-action="to-draw-back">← Volver al sorteo</button>
        <button class="btn btn-ghost" data-action="home">Nuevo sorteo</button>
      </div>
    </div>
  </div>`;
}

function exportCsv() {
  const draws = state.drawStates.length ? state.drawStates : computeDraws();
  const rows = [['sorteo', 'estado', 'usuario', 'comentario', 'menciones_contadas', 'motivo', 'resultado']];
  for (const ds of draws) {
    const result = new Map();
    for (const p of ds.picks ?? []) {
      result.set(p.entry.commentId, p.status === 'valid' ? roleLabel(p.role, p.n) : p.status === 'disqualified' ? 'Descalificado' : '');
    }
    for (const e of ds.result.entries) {
      rows.push([ds.draw.prize, 'válido', e.username, e.text, e.mentions.join(' '), '', result.get(e.commentId) ?? '']);
    }
    for (const r of ds.result.rejected) {
      rows.push([ds.draw.prize, 'descartado', r.comment.username, r.comment.text, '', r.reason, '']);
    }
  }
  download(`sorteo-${state.post?.code ?? 'instagram'}.csv`, rows.map((r) => r.map(csvCell).join(',')).join('\n'));
}

// ---------------------------------------------------------------- modals

function openModal(name, data = {}) {
  state.modal = { name, ...data };
  renderModal();
  $('#modal').hidden = false;
}

function closeModal() {
  state.modal = null;
  $('#modal').hidden = true;
}

function renderModal() {
  const m = state.modal;
  if (!m) return;
  const body = { session: modalSession, import: modalImport, participants: modalParticipants }[m.name]();
  $('#modal-body').innerHTML = body;
}

function modalSession() {
  const { connected, user } = state.session;
  if (connected) {
    return `<h2>Cuenta conectada</h2>
      <div class="pick-top" style="margin:16px 0">${avatar(user.username, user.profilePic, 'lg')}
        <div><div class="pick-user">${esc(accountName(user))}</div><div class="muted">${esc(user.fullName)}</div></div></div>
      ${user.verified === false ? '<div class="warning">Instagram no dejó verificar la cuenta en este momento (puede estar limitando consultas). La sesión quedó guardada y se va a validar al cargar el post.</div>' : ''}
      <p class="hint">La sesión se guarda sólo en tu compu, en el archivo <code>.ig-session.json</code> del proyecto.</p>
      <div class="actions"><button class="btn btn-ghost" data-action="logout">Desconectar</button><button class="btn btn-dark" data-action="close-modal">Listo</button></div>`;
  }
  return `<h2>Conectar Instagram</h2>
    <p class="sub">${state.modal.reason ?? 'Para leer los comentarios, likes y seguidores, la página usa la sesión de tu cuenta de Instagram (la misma que el navegador).'}</p>
    <ol class="steps-list">
      <li>Abrí <a href="https://www.instagram.com" target="_blank" rel="noopener">instagram.com</a> en tu navegador con la sesión iniciada.</li>
      <li>Abrí las herramientas de desarrollador (<code>F12</code> o <code>Cmd+Opt+I</code>).</li>
      <li>Andá a <b>Application</b> (Chrome) o <b>Almacenamiento</b> (Firefox) → <b>Cookies</b> → <code>https://www.instagram.com</code>.</li>
      <li>Copiá el valor de la cookie <code>sessionid</code> y pegalo acá abajo.<br><span class="muted">También podés pegar el header <code>Cookie</code> completo de cualquier request en la pestaña Network.</span></li>
    </ol>
    <div class="warning">🔒 La sesión da acceso a tu cuenta: no la compartas. Se guarda sólo en tu compu. Instagram puede limitar cuentas que hacen muchas consultas; la página va despacio para evitarlo.</div>
    <form data-form="session">
      <div class="field"><label>sessionid o Cookie</label><textarea name="cookie" rows="3" required placeholder="1234567890%3AAbCdEf..."></textarea></div>
      ${m_error()}
      <div class="actions"><button class="btn btn-primary" type="submit">Conectar</button></div>
    </form>`;
}

const m_error = () => (state.modal?.error ? `<div class="error-box" style="margin:12px 0 0">⚠️ ${esc(state.modal.error)}</div>` : '');

function modalImport() {
  return `<h2>Importar comentarios</h2>
    <p class="sub">Si no querés conectar tu cuenta, podés pegar o subir los comentarios exportados con otra herramienta.</p>
    <form data-form="import">
      <div class="field"><label>Archivo (.json, .csv, .txt)</label><input type="file" name="file" accept=".json,.csv,.txt,application/json,text/csv,text/plain"></div>
      <div class="field" style="margin-top:10px"><label>…o pegá los comentarios</label>
        <textarea name="text" rows="8" placeholder='[{"username": "ana", "text": "comic @juan"}]&#10;o CSV: usuario,comentario&#10;o una línea por comentario: ana: comic @juan'></textarea></div>
      <div class="draw-row single" style="grid-template-columns:1fr 1fr;margin-top:10px">
        <div class="field"><label>Cuenta organizadora</label><input name="owner" placeholder="@tucuenta"></div>
        <div class="field"><label>URL del post (opcional)</label><input name="url" placeholder="https://www.instagram.com/p/..."></div>
      </div>
      <p class="hint" style="margin-top:10px">Formatos: JSON con campos <code>username</code>/<code>ownerUsername</code> y <code>text</code> (sirve el export de Apify y similares), CSV con columnas usuario y comentario, o líneas <code>usuario: comentario</code>.</p>
      ${m_error()}
      <div class="actions"><button class="btn btn-primary" type="submit">Usar estos comentarios</button></div>
    </form>`;
}

function modalParticipants() {
  const m = state.modal;
  const draws = state.view === 'draw' || state.view === 'results' ? state.drawStates : computeDraws();
  const ds = draws[m.draw ?? 0];
  if (!ds) return '<h2>Participantes</h2><div class="empty">No hay sorteos configurados.</div>';
  const q = (m.q ?? '').toLowerCase();
  const tab = m.tab ?? 'valid';
  const match = (u, t) => !q || u.toLowerCase().includes(q) || t.toLowerCase().includes(q);
  const rows = tab === 'valid'
    ? ds.result.entries.filter((e) => match(e.username, e.text)).map((e) => `
      <tr><td class="user">@${esc(e.displayUsername || e.username)}</td><td>${esc(e.text)}</td><td>${e.mentions.map((x) => `@${esc(x)}`).join(' ')}</td></tr>`)
    : ds.result.rejected.filter((r) => match(r.comment.username, r.comment.text)).map((r) => `
      <tr><td class="user">@${esc(r.comment.username)}</td><td>${esc(r.comment.text)}</td><td class="reason-cell">${esc(r.reason)}</td></tr>`);
  return `<h2>Participantes</h2>
    <p class="sub">Cada fila válida es una chance en el sorteo.</p>
    ${draws.length > 1 ? `<div class="segmented">${draws.map((d, i) => `<button type="button" class="${i === (m.draw ?? 0) ? 'on' : ''}" data-action="p-draw" data-index="${i}">${esc(d.draw.prize)}</button>`).join('')}</div>` : ''}
    <div class="table-tools">
      <div class="segmented" style="margin:0">
        <button type="button" class="${tab === 'valid' ? 'on' : ''}" data-action="p-tab" data-tab="valid">Válidos (${fmt(ds.result.entries.length)})</button>
        <button type="button" class="${tab === 'rejected' ? 'on' : ''}" data-action="p-tab" data-tab="rejected">Descartados (${fmt(ds.result.rejected.length)})</button>
      </div>
      <input class="input" data-input="p-search" placeholder="Buscar usuario o texto…" value="${esc(m.q ?? '')}">
      <button class="btn btn-ghost btn-sm" data-action="export-csv">CSV</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Usuario</th><th>Comentario</th><th>${tab === 'valid' ? 'Menciones que cuentan' : 'Motivo'}</th></tr></thead>
      <tbody>${rows.join('') || '<tr><td colspan="3" class="empty">Nada por acá.</td></tr>'}</tbody>
    </table></div>
    <p class="hint" style="margin-top:10px">${fmt(ds.result.skipped)} comentarios no aplican a este sorteo (no incluyen la palabra o son respuestas).</p>`;
}

// ---------------------------------------------------------------- flows

function setPostDefaults() {
  state.config.followAccounts = owner() ? `@${owner()}` : '';
  state.likers = null;
  state.drawStates = [];
  state.drawConfigKey = null;
  saveConfig();
}

async function startFromUrl(url) {
  state.error = null;
  state.pendingUrl = url;
  if (!state.session.connected) {
    openModal('session', { reason: 'Para traer los comentarios de la publicación necesitás conectar una cuenta de Instagram.' });
    return;
  }
  state.source = 'instagram';
  state.post = null;
  state.comments = [];
  state.progress = null;
  go('loading');
  try {
    state.post = { ...(await api('/api/post', { method: 'POST', body: { url } })), url };
    render();
    state.comments = await fetchComments(state.post.id);
    setPostDefaults();
    state.pendingUrl = null;
    go('rules');
  } catch (err) {
    state.error = err.message;
    go('home');
  }
}

async function fetchComments(mediaId) {
  const res = await fetch('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaId, includeReplies: true }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'progress') {
        state.progress = { comments: msg.comments, total: msg.total ?? state.progress?.total };
        updateLoading();
      } else if (msg.type === 'done') return msg.comments;
      else if (msg.type === 'error') throw new Error(msg.message);
    }
  }
  throw new Error('La descarga de comentarios se cortó.');
}

function updateLoading() {
  const el = $('#loading');
  if (!el) return;
  const pr = state.progress;
  const total = pr.total || state.post?.commentCount || 0;
  $('#loading-text').textContent = `${fmt(pr.comments)}${total ? ` de ~${fmt(total)}` : ''} comentarios`;
  const bar = el.querySelector('.progress');
  bar.classList.toggle('indeterminate', !total);
  bar.firstElementChild.style.width = `${total ? Math.min(100, (pr.comments / total) * 100) : 0}%`;
}

function startDemo() {
  const demo = demoData();
  state.source = 'demo';
  state.post = demo.post;
  state.comments = demo.comments;
  state.demoChecks = demo.checks;
  state.error = null;
  setPostDefaults();
  go('rules');
  toast('Cargamos 1 post de ejemplo con comentarios inventados.');
}

async function handleImport(form) {
  const file = form.file.files[0];
  const text = file ? await file.text() : form.text.value;
  let comments;
  try {
    comments = parseImport(text);
  } catch (err) {
    state.modal.error = `No pude leer los datos: ${err.message}`;
    return renderModal();
  }
  if (!comments.length) {
    state.modal.error = 'No encontré comentarios en lo que cargaste. Revisá el formato.';
    return renderModal();
  }
  const ownerName = normalizeUsername(form.owner.value);
  state.source = 'import';
  state.comments = comments;
  state.post = {
    id: 'import',
    code: 'importado',
    owner: { username: ownerName, fullName: '', profilePic: '' },
    caption: '',
    commentCount: comments.length,
    likeCount: 0,
    image: '',
    url: form.url.value.trim(),
  };
  state.error = null;
  setPostDefaults();
  closeModal();
  go('rules');
  toast(`Importamos ${fmt(comments.length)} comentarios.`);
}

async function handleSession(form) {
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  button.textContent = 'Conectando con Instagram…';
  try {
    state.session = await api('/api/session', { method: 'POST', body: { cookie: form.cookie.value } });
    closeModal();
    renderAccount();
    toast(state.session.user.username ? `Conectado como @${state.session.user.username}` : 'Sesión guardada (sin verificar todavía)');
    if (state.pendingUrl && state.view === 'home') startFromUrl(state.pendingUrl);
  } catch (err) {
    state.modal.error = err.message;
    renderModal();
  }
}

// ---------------------------------------------------------------- events

const actions = {
  home: () => {
    state.error = null;
    go('home');
  },
  demo: startDemo,
  'open-session': () => openModal('session'),
  'open-import': () => openModal('import'),
  'open-participants': () => openModal('participants', { draw: state.view === 'draw' ? state.activeDraw : 0 }),
  'close-modal': closeModal,
  logout: async () => {
    state.session = await api('/api/session', { method: 'DELETE' });
    closeModal();
    renderAccount();
  },
  mode: (el) => {
    state.config.mode = el.dataset.mode;
    saveConfig();
    render();
  },
  'add-draw': () => {
    state.config.draws.push({ keywords: '', prize: `Premio ${state.config.draws.length + 1}`, winners: 1, alternates: 2 });
    saveConfig();
    render();
  },
  'remove-draw': (el) => {
    state.config.draws.splice(Number(el.dataset.index), 1);
    saveConfig();
    render();
  },
  step: (el) => {
    const { path } = el.dataset;
    const value = Math.min(Number(el.dataset.max), Math.max(Number(el.dataset.min), getPath(state.config, path) + Number(el.dataset.delta)));
    setPath(state.config, path, value);
    $(`[data-show="${path}"]`).textContent = value;
    saveConfig();
    updatePreview();
  },
  'to-rules': () => go('rules'),
  'to-draw': () => {
    if (!getDraws(state.config).length) return toast('Agregá al menos una palabra clave.');
    if (prepareDraws()) go('draw');
  },
  'to-draw-back': () => go('draw'),
  'to-results': () => go('results'),
  'select-draw': (el) => {
    state.activeDraw = Number(el.dataset.index);
    go('draw');
  },
  draw: (el) => runDraw(Number(el.dataset.index)),
  'manual-ok': (el) => validate(state.drawStates[el.dataset.ds].picks[el.dataset.pick], Number(el.dataset.ds)),
  'manual-fail': (el) => {
    const dsIndex = Number(el.dataset.ds);
    const pick = state.drawStates[dsIndex].picks[el.dataset.pick];
    pick.status = 'disqualified';
    pick.reason = 'Descalificado: no cumple los requisitos.';
    refreshDrawParts(dsIndex);
  },
  'copy-announce': async () => {
    await navigator.clipboard.writeText($('#announce').value);
    toast('Texto copiado ✓');
  },
  'export-csv': exportCsv,
  'p-tab': (el) => {
    state.modal.tab = el.dataset.tab;
    renderModal();
  },
  'p-draw': (el) => {
    state.modal.draw = Number(el.dataset.index);
    renderModal();
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  ev.preventDefault();
  fn(el);
});

document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('[data-form]');
  if (!form) return;
  ev.preventDefault();
  const handlers = {
    url: () => startFromUrl(form.url.value.trim()),
    session: () => handleSession(form),
    import: () => handleImport(form),
  };
  handlers[form.dataset.form]?.();
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset.input === 'p-search') {
    state.modal.q = el.value;
    const pos = el.selectionStart;
    renderModal();
    const search = $('[data-input="p-search"]');
    search.focus();
    search.setSelectionRange(pos, pos);
    return;
  }
  const path = el.dataset.bind;
  if (!path) return;
  let value = el.value;
  if (el.type === 'checkbox') value = el.checked;
  else if (el.type === 'number') value = Number(el.value);
  setPath(state.config, path, value);
  saveConfig();
  if (path === 'requireFollow') $('#follow-field').hidden = !value;
  updatePreview();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && state.modal) closeModal();
});

// ---------------------------------------------------------------- init

render();
api('/api/session')
  .then((s) => {
    state.session = s;
    renderAccount();
  })
  .catch(() => toast('No se pudo hablar con el servidor local. ¿Está corriendo `npm start`?'));
