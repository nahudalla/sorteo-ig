// Servidor local: sirve la página y hace de intermediario con Instagram usando tu sesión.
import { createServer } from 'node:http';
import { setDefaultResultOrder } from 'node:dns';
import * as net from 'node:net';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InstagramClient,
  InstagramError,
  parseCookieInput,
  shortcodeFromUrl,
  shortcodeToMediaId,
} from './lib/instagram.js';

// Evita que las conexiones queden colgadas en redes con IPv6 roto.
setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily?.(true);

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const SESSION_FILE = join(ROOT, '.ig-session.json');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

let session = null; // { cookies, user }

async function loadSession() {
  const fromEnv = parseCookieInput(process.env.IG_COOKIE || process.env.IG_SESSIONID);
  let cookies = fromEnv;
  if (!cookies && existsSync(SESSION_FILE)) {
    try {
      cookies = JSON.parse(await readFile(SESSION_FILE, 'utf8')).cookies;
    } catch {
      cookies = null;
    }
  }
  if (!cookies) return;
  try {
    const ig = new InstagramClient(cookies);
    ig.me = await ig.currentUser();
    session = { cookies, user: ig.me, client: ig };
    console.log(`  Sesión de Instagram: ${session.user.username ? `@${session.user.username}` : `cuenta ${session.user.id} (sin verificar)`}`);
  } catch (err) {
    session = { cookies, user: null, client: new InstagramClient(cookies) };
    console.log(`  No se pudo validar la sesión guardada: ${err.message}`);
  }
}

function client() {
  if (!session?.cookies) {
    throw new InstagramError('Conectá tu cuenta de Instagram para traer los comentarios.', 401);
  }
  // Un cliente por sesión, para reutilizar lo ya consultado (ids de cuentas, likes del post).
  session.client ??= new InstagramClient(session.cookies);
  return session.client;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const routes = {
  'GET /api/session': async () => ({
    connected: Boolean(session?.user),
    user: session?.user ?? null,
  }),

  'POST /api/session': async (body) => {
    const cookies = parseCookieInput(body.cookie);
    if (!cookies) throw new InstagramError('No encontré la cookie "sessionid" en lo que pegaste.', 400);
    console.log(`Validando sesión de Instagram (usuario ${cookies.ds_user_id ?? 'desconocido'})…`);
    const ig = new InstagramClient(cookies);
    const user = await ig.currentUser();
    ig.me = user;
    session = { cookies, user, client: ig };
    await writeFile(SESSION_FILE, JSON.stringify({ cookies }, null, 2), { mode: 0o600 });
    return { connected: true, user };
  },

  'DELETE /api/session': async () => {
    session = null;
    if (existsSync(SESSION_FILE)) await unlink(SESSION_FILE);
    return { connected: false };
  },

  'POST /api/post': async (body) => {
    const shortcode = shortcodeFromUrl(body.url);
    if (!shortcode) throw new InstagramError('La URL no parece de una publicación de Instagram.', 400);
    return client().mediaInfo(shortcodeToMediaId(shortcode));
  },

  'POST /api/likers': async (body) => client().likers(String(body.mediaId)),

  'POST /api/follows': async (body) => ({
    follows: await client().follows(String(body.username), String(body.account), String(body.userId ?? '')),
  }),
};

/** Descarga de comentarios: responde NDJSON con el progreso y al final la lista completa. */
async function streamComments(req, res) {
  const body = await readBody(req);
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
  const write = (obj) => res.write(`${JSON.stringify(obj)}\n`);
  try {
    const comments = await client().allComments(String(body.mediaId), {
      includeReplies: body.includeReplies !== false,
      onProgress: (p) => write({ type: 'progress', ...p }),
    });
    write({ type: 'done', comments });
  } catch (err) {
    write({ type: 'error', message: err.message, status: err.status ?? 500 });
  }
  res.end();
}

/** Proxy de imágenes del CDN de Instagram (bloquean el hotlinking desde otros orígenes). */
async function proxyImage(url, res) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return sendJson(res, 400, { error: 'URL inválida' });
  }
  if (target.protocol !== 'https:' || !/(\.cdninstagram\.com|\.fbcdn\.net)$/.test(target.hostname)) {
    return sendJson(res, 400, { error: 'Host no permitido' });
  }
  try {
    const upstream = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!upstream.ok) return sendJson(res, upstream.status, { error: 'No se pudo cargar la imagen' });
    res.writeHead(200, {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    sendJson(res, 502, { error: 'No se pudo cargar la imagen' });
  }
}

async function serveStatic(pathname, res) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(PUBLIC_DIR, safe === '/' ? 'index.html' : safe);
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Prohibido' });
  if (!existsSync(file)) file = join(PUBLIC_DIR, 'index.html');
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'No encontrado' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (req.method === 'POST' && url.pathname === '/api/comments') return await streamComments(req, res);
    if (req.method === 'GET' && url.pathname === '/api/img') return await proxyImage(url.searchParams.get('u'), res);
    const handler = routes[`${req.method} ${url.pathname}`];
    if (handler) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      return sendJson(res, 200, await handler(body));
    }
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Ruta desconocida' });
    return await serveStatic(url.pathname, res);
  } catch (err) {
    const status = err instanceof InstagramError ? err.status ?? 500 : 500;
    if (!(err instanceof InstagramError)) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: err.message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Sorteo IG corriendo en http://localhost:${PORT}\n`);
  loadSession();
});
