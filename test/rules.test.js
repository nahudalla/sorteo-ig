import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEntries,
  DEFAULT_CONFIG,
  extractMentions,
  getDraws,
  matchesKeyword,
  parseKeywordAlternatives,
  pickEntry,
} from '../public/lib/rules.js';

let nextId = 1;
const c = (username, text, extra = {}) => ({
  id: String(nextId),
  username,
  text,
  createdAt: nextId++,
  ...extra,
});

const config = (overrides = {}) => ({ ...DEFAULT_CONFIG, ...overrides });
const draw = (keywords) => getDraws(config({ mode: 'single', single: { keywords } }))[0];

test('extrae menciones sin repetir y en minúsculas', () => {
  assert.deepEqual(extractMentions('Hola @Ana y @juan.perez. y @ana'), ['ana', 'juan.perez']);
});

test('las palabras clave ignoran tildes, mayúsculas y menciones', () => {
  const alts = parseKeywordAlternatives('Cómic');
  assert.ok(matchesKeyword('Quiero el COMIC! @x', alts));
  assert.ok(matchesKeyword('cómic', alts));
  assert.ok(!matchesKeyword('comics', alts));
  assert.ok(!matchesKeyword('@comic_store manga', alts));
  assert.ok(matchesKeyword('comics', parseKeywordAlternatives('comic, comics')));
});

test('cada palabra es un sorteo aparte y un usuario puede estar en ambos', () => {
  const comments = [c('ana', 'comic @a'), c('ana', 'manga @b'), c('beto', 'manga @c')];
  const [comic, manga] = getDraws(config());
  assert.deepEqual(buildEntries(comments, comic, config()).entries.map((e) => e.username), ['ana']);
  assert.deepEqual(buildEntries(comments, manga, config()).entries.map((e) => e.username), ['ana', 'beto']);
});

test('comentarios repetidos no cuentan', () => {
  const comments = [c('ana', 'comic @a'), c('ana', 'Comic  @A')];
  const result = buildEntries(comments, draw('comic'), config());
  assert.equal(result.entries.length, 1);
  assert.equal(result.rejected[0].reason, 'Comentario repetido');
});

test('las menciones se suman entre comentarios del mismo usuario', () => {
  const comments = [c('ana', 'comic @a'), c('ana', 'comic @b'), c('beto', 'comic @x')];
  const result = buildEntries(comments, draw('comic'), config({ minMentions: 2 }));
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.entries[0].mentions, ['a', 'b']);
  assert.deepEqual(result.entries[0].comments, ['comic @a', 'comic @b']);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].comment.username, 'beto');
});

test('cada vez que junta el mínimo de gente nueva suma otra chance', () => {
  const comments = [
    c('ana', 'comic @a @b'), // chance 1
    c('ana', 'comic @c @d'), // chance 2
    c('ana', 'comic @a @e'), // sólo @e es nueva: queda pendiente
    c('ana', 'comic @b @a!'), // nadie nuevo: no cuenta
    c('ana', 'comic @e @f'), // @f + @e pendiente: chance 3
  ];
  const result = buildEntries(comments, draw('comic'), config({ minMentions: 2 }));
  assert.equal(result.entries.length, 3);
  assert.deepEqual(result.entries[2].mentions, ['e', 'f']);
  assert.equal(result.rejected.length, 1);
});

test('con mínimo 0, los comentarios extra necesitan alguien nuevo', () => {
  const comments = [c('ana', 'comic'), c('ana', 'comic!'), c('ana', 'comic @x')];
  const result = buildEntries(comments, draw('comic'), config({ minMentions: 0 }));
  assert.equal(result.entries.length, 2);
});

test('sin participaciones múltiples cuenta sólo el primer comentario', () => {
  const comments = [c('ana', 'comic @a'), c('ana', 'comic @b')];
  const result = buildEntries(comments, draw('comic'), config({ multipleEntries: false }));
  assert.equal(result.entries.length, 1);
});

test('no cuentan auto-menciones, mención al organizador ni el organizador', () => {
  const comments = [c('ana', 'comic @ana @org'), c('org', 'comic @x'), c('beto', 'comic @x')];
  const result = buildEntries(comments, draw('comic'), config({ minMentions: 1 }), 'org');
  assert.deepEqual(result.entries.map((e) => e.username), ['beto']);
  assert.equal(result.rejected.length, 2);
});

test('cuentas excluidas y respuestas', () => {
  const comments = [c('ana', 'comic @x'), c('beto', 'comic @y', { isReply: true })];
  const base = config({ blacklist: '@ana' });
  assert.equal(buildEntries(comments, draw('comic'), base).entries.length, 0);
  assert.equal(buildEntries(comments, draw('comic'), { ...base, includeReplies: true }).entries.length, 1);
});

test('sorteo sin palabra clave incluye todos los comentarios', () => {
  const comments = [c('ana', 'hola @x'), c('beto', 'chau @y')];
  assert.equal(buildEntries(comments, draw(''), config()).entries.length, 2);
});

test('pickEntry respeta exclusiones', () => {
  const entries = [{ username: 'a' }, { username: 'b' }];
  for (let i = 0; i < 20; i++) assert.equal(pickEntry(entries, new Set(['a'])).username, 'b');
  assert.equal(pickEntry(entries, new Set(['a', 'b'])), null);
});
