// Motor de reglas del sorteo. Funciones puras: se usan en el navegador y en los tests.

/** Minúsculas y sin tildes, para comparar texto sin importar acentos ni mayúsculas. */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function normalizeUsername(name) {
  return String(name ?? '').trim().replace(/^@/, '').toLowerCase();
}

const MENTION_RE = /@([a-zA-Z0-9._]{1,30})/g;

/** Usuarios mencionados en un comentario (sin repetir, en minúsculas). */
export function extractMentions(text) {
  const found = new Set();
  for (const match of String(text ?? '').matchAll(MENTION_RE)) {
    const name = match[1].replace(/\.+$/, '').toLowerCase();
    if (name) found.add(name);
  }
  return [...found];
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Separa "comic, cómic / comics" en alternativas normalizadas. */
export function parseKeywordAlternatives(input) {
  return [...new Set(
    String(input ?? '')
      .split(/[,/|]/)
      .map((s) => normalize(s).trim().replace(/\s+/g, ' '))
      .filter(Boolean),
  )];
}

/**
 * ¿El comentario contiene alguna de las palabras como palabra completa?
 * Las menciones se quitan antes, para que "@comicstore" no cuente como "comic".
 */
export function matchesKeyword(text, alternatives) {
  if (!alternatives || alternatives.length === 0) return true;
  const clean = normalize(text).replace(MENTION_RE, ' ');
  return alternatives.some((alt) => {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(alt)}($|[^a-z0-9])`);
    return re.test(clean);
  });
}

/** Texto canónico para detectar comentarios repetidos. */
function canonicalText(text) {
  return normalize(text).replace(/\s+/g, ' ').trim();
}

export const DEFAULT_CONFIG = {
  mode: 'separate', // 'separate': un sorteo por palabra · 'single': un solo sorteo
  draws: [
    { keywords: 'comic', prize: 'Premio cómic', winners: 1, alternates: 2 },
    { keywords: 'manga', prize: 'Premio manga', winners: 1, alternates: 2 },
  ],
  single: { keywords: '', prize: 'Premio', winners: 1, alternates: 2 },
  minMentions: 1,
  multipleEntries: true,
  ignoreDuplicates: true,
  includeReplies: false,
  excludeOwner: true,
  excludeSelfMention: true,
  blacklist: '',
  requireLike: false,
  requireFollow: true,
  followAccounts: '',
  uniqueWinners: false,
};

/** Lista de sorteos a ejecutar según el modo elegido. */
export function getDraws(config) {
  const list = config.mode === 'single' ? [config.single] : config.draws;
  return list
    .map((d, index) => ({
      index,
      prize: d.prize?.trim() || `Sorteo ${index + 1}`,
      keywordsInput: d.keywords ?? '',
      keywords: parseKeywordAlternatives(d.keywords),
      winners: Math.max(1, Number(d.winners) || 1),
      alternates: Math.max(0, Number(d.alternates) || 0),
    }))
    .filter((d) => config.mode === 'single' || d.keywords.length > 0);
}

export function parseUserList(input) {
  return [...new Set(
    String(input ?? '')
      .split(/[\s,;]+/)
      .map(normalizeUsername)
      .filter(Boolean),
  )];
}

/**
 * Arma las participaciones de un sorteo.
 *
 * Reglas:
 * - Sólo cuentan comentarios que contienen alguna de las palabras del sorteo.
 * - Un comentario con el mismo texto que otro anterior del mismo usuario no cuenta.
 * - Las menciones se suman entre todos los comentarios del usuario, sin repetir personas:
 *   con mínimo 2, dos comentarios que etiquetan a una persona distinta cada uno suman una chance.
 * - Si se permiten varias participaciones, cada vez que el usuario vuelve a juntar el mínimo de
 *   personas nuevas suma otra chance (como máximo una por comentario). Con mínimo 0, cada
 *   comentario extra suma una chance si etiqueta al menos a una persona nueva.
 *
 * Devuelve { entries, rejected, skipped, users } donde cada entrada es una "chance".
 */
export function buildEntries(comments, draw, config, owner = '') {
  const ownerName = normalizeUsername(owner);
  const blacklist = new Set(parseUserList(config.blacklist));
  const minMentions = Math.max(0, Number(config.minMentions) || 0);

  const sorted = [...comments].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const entries = [];
  const rejected = [];
  let skipped = 0;

  const seenTexts = new Map(); // usuario -> Set de textos
  const usedMentions = new Map(); // usuario -> Set de personas ya etiquetadas
  const pending = new Map(); // usuario -> { comments, mentions } que todavía no suman una chance
  const entryCount = new Map(); // usuario -> cantidad de participaciones

  const reject = (comment, reason) => rejected.push({ comment, reason });

  for (const comment of sorted) {
    if (comment.isReply && !config.includeReplies) {
      skipped++;
      continue;
    }
    if (!matchesKeyword(comment.text, draw.keywords)) {
      skipped++;
      continue;
    }

    const user = normalizeUsername(comment.username);
    if (!user) continue;

    if (config.excludeOwner && ownerName && user === ownerName) {
      reject(comment, 'Es la cuenta que organiza el sorteo');
      continue;
    }
    if (blacklist.has(user)) {
      reject(comment, 'Cuenta excluida');
      continue;
    }

    const text = canonicalText(comment.text);
    const texts = seenTexts.get(user) ?? new Set();
    seenTexts.set(user, texts);
    if (config.ignoreDuplicates && texts.has(text)) {
      reject(comment, 'Comentario repetido');
      continue;
    }
    texts.add(text);

    const previous = entryCount.get(user) ?? 0;
    if (previous > 0 && !config.multipleEntries) {
      reject(comment, 'El usuario ya participa con otro comentario');
      continue;
    }

    let mentions = extractMentions(comment.text);
    if (config.excludeSelfMention) mentions = mentions.filter((m) => m !== user);
    if (ownerName) mentions = mentions.filter((m) => m !== ownerName);

    const used = usedMentions.get(user) ?? new Set();
    usedMentions.set(user, used);
    const fresh = mentions.filter((m) => !used.has(m));
    const need = previous > 0 ? Math.max(1, minMentions) : minMentions;

    if (need > 0 && fresh.length === 0) {
      reject(comment, mentions.length ? 'No etiqueta a nadie nuevo' : 'No etiqueta a nadie');
      continue;
    }

    fresh.forEach((m) => used.add(m));
    const acc = pending.get(user) ?? { comments: [], mentions: [] };
    acc.comments.push(comment);
    acc.mentions.push(...fresh);

    if (acc.mentions.length < need) {
      pending.set(user, acc);
      continue;
    }

    pending.delete(user);
    entryCount.set(user, previous + 1);
    entries.push({
      username: user,
      displayUsername: comment.username,
      userId: comment.userId ?? '',
      profilePic: comment.profilePic ?? '',
      commentId: comment.id,
      text: comment.text,
      comments: acc.comments.map((c) => c.text),
      createdAt: comment.createdAt,
      mentions: acc.mentions,
    });
  }

  // Comentarios que no llegaron a juntar el mínimo de personas etiquetadas.
  for (const [user, acc] of pending) {
    const total = acc.mentions.length;
    const reason = entryCount.get(user)
      ? `Sólo suma ${total} persona(s) nueva(s) más (mínimo ${minMentions})`
      : `Etiqueta ${total} persona(s) en total (mínimo ${minMentions})`;
    acc.comments.forEach((c) => reject(c, reason));
  }

  return { entries, rejected, skipped, users: entryCount };
}

/** Entero aleatorio uniforme en [0, max) usando crypto. */
export function secureRandomInt(max) {
  if (max <= 0) throw new Error('max debe ser positivo');
  const cryptoObj = globalThis.crypto;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let value;
  do {
    cryptoObj.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % max;
}

/**
 * Elige una participación al azar entre las que no son de usuarios excluidos.
 * Cada participación es una chance, así que quien comentó más veces (válidamente) tiene más chances.
 */
export function pickEntry(entries, excludedUsers = new Set(), rng = secureRandomInt) {
  const pool = entries.filter((e) => !excludedUsers.has(e.username));
  if (pool.length === 0) return null;
  return pool[rng(pool.length)];
}
