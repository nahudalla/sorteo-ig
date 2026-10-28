import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { InstagramClient } from '../lib/instagram.js';

// Servidor que imita las respuestas de la API web de Instagram.
const comment = (pk, username, text, extra = {}) => ({ pk, text, created_at: pk, user: { pk: `u${username}`, username }, ...extra });
const pages = {
  '': { comments: [comment(1, 'ana', 'comic @a'), comment(2, 'beto', 'manga @b', { child_comment_count: 2 })], next_min_id: '{"cursor":"p2"}', comment_count: 5 },
  '{"cursor":"p2"}': { comments: [comment(3, 'caro', 'comic @c')], comment_count: 5 },
};
let server;
let baseUrl;
let throttled = false;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (!/sessionid=(ok|limitada)/.test(req.headers.cookie ?? '')) return json(401, { status: 'fail', message: 'login_required' });
    if (url.pathname === '/api/v1/media/99/comments/') {
      // Como pasa hoy: la web devuelve el HTML de la página; sólo i.instagram.com responde JSON.
      if (req.headers['sec-fetch-site'] === 'same-origin') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html><title>Instagram</title></html>');
      }
      if (!throttled) {
        throttled = true;
        return json(429, { status: 'fail' });
      }
      return json(200, pages[url.searchParams.get('min_id') ?? '']);
    }
    if (url.pathname === '/api/v1/media/99/comments/2/child_comments/') {
      return url.searchParams.get('max_id')
        ? json(200, { child_comments: [comment(5, 'eli', 'comic @e')] })
        : json(200, { child_comments: [comment(4, 'dani', 'manga @d')], has_more_tail_child_comments: true, next_max_child_cursor: 'c2' });
    }
    if (url.pathname === '/api/v1/media/98/comments/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html><title>Instagram</title></html>');
    }
    if (url.pathname === '/graphql/query/') {
      const vars = JSON.parse(url.searchParams.get('variables'));
      const node = (id, username, text, extra = {}) => ({ id, text, created_at: Number(id), owner: { username }, ...extra });
      const media = vars.after
        ? { count: 3, page_info: { has_next_page: false }, edges: [{ node: node('3', 'caro', 'comic @c') }] }
        : {
            count: 3,
            page_info: { has_next_page: true, end_cursor: 'g2' },
            edges: [{ node: node('1', 'ana', 'comic @a', { edge_threaded_comments: { count: 1, edges: [{ node: node('2', 'beto', 'manga @b') }] } }) }],
          };
      return json(200, { data: { shortcode_media: { edge_media_to_parent_comment: media } } });
    }
    if (url.pathname === '/api/v1/media/99/info/') {
      return json(200, { items: [{ pk: 99, code: 'X', user: { pk: 1, username: 'tienda' }, comment_count: 5, like_count: 3 }] });
    }
    if (url.pathname === '/api/v1/accounts/edit/web_form_data/') {
      if (req.headers.cookie.includes('limitada')) return json(429, { status: 'fail', message: 'Please wait a few minutes' });
      return json(200, { form_data: { username: 'tienda', first_name: 'Tienda' } });
    }
    // Likers exige el token CSRF (cookie y header iguales); el 403 entrega uno en Set-Cookie.
    if (url.pathname === '/api/v1/media/97/likers/' || url.pathname === '/api/v1/media/96/likers/') {
      const token = req.headers.cookie.match(/csrftoken=([^;]+)/)?.[1];
      if (token && token === req.headers['x-csrftoken']) return json(200, { users: [{ username: 'ana' }], user_count: 1 });
      if (url.pathname.includes('/97/')) res.setHeader('Set-Cookie', 'csrftoken=tok123; Path=/; Secure');
      return json(403, { message: 'CSRF token missing or incorrect', status: 'fail' });
    }
    // Como pasa hoy: likers da 403 en la web y web_profile_info da 429.
    const web = req.headers['sec-fetch-site'] === 'same-origin';
    if (url.pathname === '/api/v1/media/99/likers/') {
      return web ? json(403, { status: 'fail', message: 'forbidden' }) : json(200, { users: [{ username: 'Ana' }], user_count: 1 });
    }
    if (url.pathname === '/api/v1/media/98/likers/') return json(403, { status: 'fail', message: 'forbidden' });
    if (url.pathname === '/api/v1/users/web_profile_info/') return json(429, { status: 'fail', message: 'wait' });
    if (url.pathname === '/api/v1/users/tienda/usernameinfo/') return json(200, { user: { pk: 1 } });
    if (url.pathname.startsWith('/api/v1/friendships/show/')) {
      return json(200, { followed_by: url.pathname.includes('/111/'), following: false });
    }
    if (url.pathname === '/api/v1/friendships/1/followers/') {
      const q = url.searchParams.get('query');
      return json(200, { users: q === 'ana' ? [{ username: 'ana' }] : [{ username: `${q}_fake` }] });
    }
    json(404, { status: 'fail', message: 'not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const client = (sessionid = 'ok') => new InstagramClient({ sessionid }, { baseUrl, apiBaseUrl: baseUrl, throttle: 0 });

test('trae todos los comentarios paginando, con reintento y respuestas', async () => {
  const progress = [];
  const comments = await client().allComments('99', { onProgress: (p) => progress.push(p.comments) });
  assert.deepEqual(comments.map((c) => c.username), ['ana', 'beto', 'caro', 'dani', 'eli']);
  assert.deepEqual(comments.filter((c) => c.isReply).map((c) => c.parentId), ['2', '2']);
  assert.ok(progress.length >= 2);
});

test('info del post, likes y seguidores', async () => {
  const info = await client().mediaInfo('99');
  assert.equal(info.owner.username, 'tienda');
  assert.deepEqual((await client().likers('99')).usernames, ['ana']);
  assert.equal(await client().follows('ana', 'tienda'), true);
  assert.equal(await client().follows('beto', 'tienda'), false);
});

test('likes: si la web da 403 usa i.instagram.com; si ambos fallan, error (confirmación manual)', async () => {
  assert.deepEqual(await client().likers('99'), { usernames: ['ana'], total: 1 });
  await assert.rejects(client().likers('98'), /403/);
});

test('likes: usa el csrftoken que entrega Instagram y avisa si no hay', async () => {
  const ig = client();
  const saved = [];
  ig.onCookiesChange = (c) => saved.push(c.csrftoken);
  assert.deepEqual((await ig.likers('97')).usernames, ['ana']);
  assert.deepEqual(saved, ['tok123']);
  await assert.rejects(client().likers('96'), /Cookie completo/);
});

test('seguir: relación directa si es la cuenta conectada, si no lista de seguidores', async () => {
  const ig = client();
  ig.me = { username: 'Tienda' };
  assert.equal(await ig.follows('ana', 'tienda', '111'), true);
  assert.equal(await ig.follows('beto', 'tienda', '222'), false);
  // otra cuenta (o sin id del usuario): web_profile_info limitado -> usernameinfo -> seguidores
  assert.equal(await client().follows('ana', 'tienda'), true);
});

test('una respuesta no JSON explica qué devolvió Instagram', async () => {
  await assert.rejects(client().request('/api/v1/media/98/comments/'), /HTTP 200, text\/html\): Instagram/);
});

test('si la API REST no responde, usa GraphQL', async () => {
  const comments = await client().allComments('98');
  assert.deepEqual(comments.map((c) => [c.username, c.isReply]), [['ana', false], ['beto', true], ['caro', false]]);
});

test('sesión inválida da un error claro', async () => {
  await assert.rejects(client('mala').mediaInfo('99'), /Sesión inválida/);
});

test('conectar la cuenta: verifica, o la acepta sin verificar si Instagram limita', async () => {
  assert.equal((await client().currentUser()).username, 'tienda');
  const limited = await client('limitada').currentUser();
  assert.equal(limited.verified, false);
  await assert.rejects(client('mala').currentUser(), /Sesión inválida/);
});
