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
    if (!req.headers.cookie?.includes('sessionid=ok')) return json(401, { status: 'fail', message: 'login_required' });
    if (url.pathname === '/api/v1/media/99/comments/') {
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
    if (url.pathname === '/api/v1/media/99/info/') {
      return json(200, { items: [{ pk: 99, code: 'X', user: { pk: 1, username: 'tienda' }, comment_count: 5, like_count: 3 }] });
    }
    if (url.pathname === '/api/v1/media/99/likers/') return json(200, { users: [{ username: 'Ana' }], user_count: 1 });
    if (url.pathname === '/api/v1/users/web_profile_info/') return json(200, { data: { user: { id: '1' } } });
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

const client = (sessionid = 'ok') => new InstagramClient({ sessionid }, { baseUrl, throttle: 0 });

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

test('sesión inválida da un error claro', async () => {
  await assert.rejects(client('mala').mediaInfo('99'), /Sesión inválida/);
});
