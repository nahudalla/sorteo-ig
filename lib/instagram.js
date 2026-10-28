// Cliente mínimo de la API web de Instagram, usando la sesión (cookies) de una cuenta logueada.

const APP_ID = '936619743392459';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export class InstagramError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => min + Math.random() * (max - min);

/** Extrae el shortcode de una URL de post/reel. */
export function shortcodeFromUrl(url) {
  const match = String(url).match(/instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  if (/^[A-Za-z0-9_-]{8,}$/.test(String(url).trim())) return String(url).trim();
  return null;
}

/** Convierte un shortcode al id numérico del media. */
export function shortcodeToMediaId(shortcode) {
  // Los posts de cuentas privadas tienen un sufijo extra: el id está en los primeros 11 caracteres.
  const code = shortcode.length > 11 ? shortcode.slice(0, 11) : shortcode;
  let id = 0n;
  for (const ch of code) {
    const value = SHORTCODE_ALPHABET.indexOf(ch);
    if (value < 0) throw new InstagramError('Shortcode inválido', 400);
    id = id * 64n + BigInt(value);
  }
  return id.toString();
}

/** Acepta el valor de la cookie `sessionid` o el header Cookie completo. */
export function parseCookieInput(input) {
  const raw = String(input ?? '').trim().replace(/^cookie:\s*/i, '');
  if (!raw) return null;
  const cookies = {};
  if (raw.includes('=')) {
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) cookies[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
  } else {
    cookies.sessionid = raw;
  }
  if (!cookies.sessionid) return null;
  if (!cookies.ds_user_id) {
    const userId = decodeURIComponent(cookies.sessionid).split(':')[0];
    if (/^\d+$/.test(userId)) cookies.ds_user_id = userId;
  }
  return cookies;
}

const simplifyUser = (u = {}) => ({
  id: String(u.pk ?? u.pk_id ?? u.id ?? ''),
  username: u.username ?? '',
  fullName: u.full_name ?? '',
  profilePic: u.profile_pic_url ?? '',
});

const simplifyComment = (c, parentId = null) => ({
  id: String(c.pk ?? c.id),
  username: c.user?.username ?? '',
  profilePic: c.user?.profile_pic_url ?? '',
  text: c.text ?? '',
  createdAt: c.created_at ?? c.created_at_utc ?? 0,
  isReply: Boolean(parentId),
  parentId,
  childCount: c.child_comment_count ?? 0,
});

export class InstagramClient {
  constructor(cookies, { baseUrl = process.env.IG_BASE_URL || 'https://www.instagram.com', throttle = 1 } = {}) {
    this.cookies = cookies;
    this.baseUrl = baseUrl;
    this.throttle = throttle; // multiplica las pausas entre consultas (0 en los tests)
    this.userIdCache = new Map();
  }

  pause(min, max) {
    return sleep(jitter(min, max) * this.throttle);
  }

  get cookieHeader() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  async request(path, { retries = 3 } = {}) {
    const url = `${this.baseUrl}${path}`;
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(url, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: '*/*',
            'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
            'X-IG-App-ID': APP_ID,
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRFToken': this.cookies.csrftoken ?? '',
            Referer: 'https://www.instagram.com/',
            Cookie: this.cookieHeader,
          },
          redirect: 'manual',
        });
      } catch (err) {
        if (attempt < retries) {
          await this.pause(2000 * 2 ** attempt, 2000 * 2 ** attempt);
          continue;
        }
        throw new InstagramError(`No se pudo conectar con Instagram: ${err.message}`, 502);
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await this.pause(5000 * 2 ** attempt, 8000 * 2 ** attempt);
          continue;
        }
        throw new InstagramError(
          res.status === 429
            ? 'Instagram está limitando las consultas (429). Esperá unos minutos y volvé a intentar.'
            : `Instagram respondió con error ${res.status}.`,
          res.status,
        );
      }
      if (res.status >= 300 && res.status < 400) {
        throw new InstagramError(
          'Instagram redirigió la consulta (probablemente al login). Revisá que la sesión siga activa.',
          401,
        );
      }

      const body = await res.text();
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        throw new InstagramError(
          'Instagram no devolvió datos válidos. La sesión puede haber expirado o pedir verificación.',
          401,
        );
      }
      if (!res.ok || data.status === 'fail') {
        const msg = data.message || data.error_title || `Error ${res.status}`;
        if (res.status === 401 || res.status === 403 || /login|checkpoint|challenge/i.test(msg)) {
          throw new InstagramError(`Sesión inválida o bloqueada por Instagram (${msg}).`, 401);
        }
        if (res.status === 404) throw new InstagramError('No se encontró la publicación o la cuenta.', 404);
        throw new InstagramError(`Instagram: ${msg}`, res.status);
      }
      return data;
    }
  }

  async currentUser() {
    const id = this.cookies.ds_user_id;
    if (!id) throw new InstagramError('No se pudo identificar la cuenta de la sesión.', 400);
    const data = await this.request(`/api/v1/users/${id}/info/`);
    return simplifyUser(data.user);
  }

  async mediaInfo(mediaId) {
    const data = await this.request(`/api/v1/media/${mediaId}/info/`);
    const item = data.items?.[0];
    if (!item) throw new InstagramError('No se encontró la publicación.', 404);
    const media = item.carousel_media?.[0] ?? item;
    return {
      id: String(item.pk ?? mediaId),
      code: item.code,
      owner: simplifyUser(item.user),
      caption: item.caption?.text ?? '',
      commentCount: item.comment_count ?? 0,
      likeCount: item.like_count ?? 0,
      takenAt: item.taken_at ?? 0,
      image: media.image_versions2?.candidates?.[0]?.url ?? '',
    };
  }

  /** Trae todos los comentarios (y respuestas). `onProgress` recibe la cantidad acumulada. */
  async allComments(mediaId, { includeReplies = true, onProgress = () => {} } = {}) {
    const comments = [];
    const seen = new Set();
    const seenCursors = new Set();
    let cursorParam = '';

    for (;;) {
      const data = await this.request(
        `/api/v1/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false${cursorParam}`,
      );
      let added = 0;
      for (const raw of data.comments ?? []) {
        const comment = simplifyComment(raw);
        if (seen.has(comment.id)) continue;
        seen.add(comment.id);
        comments.push(comment);
        added++;
        for (const child of raw.preview_child_comments ?? []) {
          const reply = simplifyComment(child, comment.id);
          if (!seen.has(reply.id)) {
            seen.add(reply.id);
            comments.push(reply);
          }
        }
      }
      onProgress({ comments: comments.length, total: data.comment_count });

      let next = '';
      if (data.next_min_id) next = `&min_id=${encodeURIComponent(data.next_min_id)}`;
      else if (data.next_max_id) next = `&max_id=${encodeURIComponent(data.next_max_id)}`;
      if (!next || added === 0 || seenCursors.has(next)) break;
      seenCursors.add(next);
      cursorParam = next;
      await this.pause(700, 1400);
    }

    if (includeReplies) {
      const parents = comments.filter((c) => !c.isReply && c.childCount > 0);
      for (const parent of parents) {
        const known = comments.filter((c) => c.parentId === parent.id).length;
        if (known >= parent.childCount) continue;
        await this.pause(600, 1200);
        for (const reply of await this.childComments(mediaId, parent.id)) {
          if (seen.has(reply.id)) continue;
          seen.add(reply.id);
          comments.push(reply);
        }
        onProgress({ comments: comments.length });
      }
    }
    return comments;
  }

  async childComments(mediaId, commentId) {
    const replies = [];
    let cursor = '';
    for (let page = 0; page < 50; page++) {
      const data = await this.request(
        `/api/v1/media/${mediaId}/comments/${commentId}/child_comments/${cursor ? `?max_id=${encodeURIComponent(cursor)}` : ''}`,
      );
      replies.push(...(data.child_comments ?? []).map((c) => simplifyComment(c, commentId)));
      if (!data.has_more_tail_child_comments || !data.next_max_child_cursor) break;
      cursor = data.next_max_child_cursor;
      await this.pause(600, 1200);
    }
    return replies;
  }

  /** Usuarios que dieron me gusta (Instagram puede devolver una lista parcial en posts grandes). */
  async likers(mediaId) {
    const data = await this.request(`/api/v1/media/${mediaId}/likers/`);
    return {
      usernames: (data.users ?? []).map((u) => u.username.toLowerCase()),
      total: data.user_count ?? (data.users ?? []).length,
    };
  }

  async userId(username) {
    const key = username.toLowerCase();
    if (this.userIdCache.has(key)) return this.userIdCache.get(key);
    const data = await this.request(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(key)}`);
    const id = data.data?.user?.id;
    if (!id) throw new InstagramError(`No se encontró la cuenta @${username}.`, 404);
    this.userIdCache.set(key, id);
    return id;
  }

  /** ¿`username` sigue a `account`? Busca dentro de la lista de seguidores de la cuenta. */
  async follows(username, account) {
    const accountId = await this.userId(account);
    const query = encodeURIComponent(username.toLowerCase());
    const data = await this.request(
      `/api/v1/friendships/${accountId}/followers/?count=12&search_surface=follow_list_page&query=${query}`,
    );
    return (data.users ?? []).some((u) => u.username.toLowerCase() === username.toLowerCase());
  }
}
