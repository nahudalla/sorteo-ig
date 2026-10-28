import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImport } from '../public/lib/importer.js';
import { shortcodeFromUrl, shortcodeToMediaId, parseCookieInput } from '../lib/instagram.js';

test('importa JSON con distintos nombres de campo', () => {
  const result = parseImport(JSON.stringify([
    { ownerUsername: 'ana', text: 'comic @x', timestamp: '2024-01-01T00:00:00Z' },
    { user: { username: 'beto' }, text: 'manga @y' },
  ]));
  assert.deepEqual(result.map((c) => c.username), ['ana', 'beto']);
});

test('importa CSV con encabezado', () => {
  const result = parseImport('usuario,comentario\nana,"comic, @x"\n@beto,manga @y');
  assert.deepEqual(result.map((c) => [c.username, c.text]), [['ana', 'comic, @x'], ['beto', 'manga @y']]);
});

test('importa líneas "usuario: comentario"', () => {
  const result = parseImport('ana: comic @x\n@beto - manga @y\nbasura');
  assert.equal(result.length, 2);
});

test('shortcodes de URLs', () => {
  assert.equal(shortcodeFromUrl('https://www.instagram.com/p/DAbc123_-xY/?img_index=1'), 'DAbc123_-xY');
  assert.equal(shortcodeFromUrl('https://www.instagram.com/reel/C1234567890/'), 'C1234567890');
  assert.equal(shortcodeFromUrl('https://www.instagram.com/tienda/p/C1234567890/'), 'C1234567890');
  assert.equal(shortcodeFromUrl('https://google.com'), null);
  // Valor conocido: shortcode "B" -> 1, "BA" -> 64
  assert.equal(shortcodeToMediaId('BA'), '64');
});

test('cookies: acepta sessionid suelto o header completo', () => {
  assert.equal(parseCookieInput('123%3Aabc%3A1').ds_user_id, '123');
  const full = parseCookieInput('Cookie: csrftoken=t; sessionid=9%3Ax; ds_user_id=9');
  assert.equal(full.csrftoken, 't');
  assert.equal(parseCookieInput('foo=bar'), null);
});
