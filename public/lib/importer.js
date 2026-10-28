// Importación manual de comentarios (por si no querés o no podés conectar la cuenta).
// Acepta JSON (exportaciones típicas de scrapers), CSV "usuario,comentario" o líneas "usuario: comentario".

const pick = (obj, ...keys) => {
  for (const key of keys) {
    const value = key.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
    if (value != null && value !== '') return value;
  }
  return undefined;
};

function toTimestamp(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'number') return value > 1e12 ? Math.floor(value / 1000) : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : Math.floor(parsed / 1000);
}

function fromJson(data) {
  const list = Array.isArray(data) ? data : data.comments ?? data.data ?? data.items ?? [];
  const out = [];
  list.forEach((item, i) => {
    const username = pick(item, 'username', 'ownerUsername', 'user.username', 'owner.username', 'author');
    const text = pick(item, 'text', 'comment', 'content', 'body');
    if (!username || text == null) return;
    out.push({
      id: String(pick(item, 'id', 'pk') ?? `import-${i}`),
      username: String(username).replace(/^@/, ''),
      text: String(text),
      createdAt: toTimestamp(pick(item, 'createdAt', 'created_at', 'timestamp', 'date'), i),
      profilePic: pick(item, 'profilePic', 'ownerProfilePicUrl', 'user.profile_pic_url') ?? '',
      isReply: Boolean(pick(item, 'isReply', 'parentId', 'parent_id')),
    });
    for (const reply of item.replies ?? item.child_comments ?? []) {
      const parsed = fromJson([reply])[0];
      if (parsed) out.push({ ...parsed, id: `${parsed.id}-r${out.length}`, isReply: true });
    }
  });
  return out;
}

function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' || ch === '\t') {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function fromLines(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = parseCsvLine(lines[0] ?? '').map((h) => h.toLowerCase());
  const userCol = header.findIndex((h) => /user|usuario|owner|author/.test(h));
  const textCol = header.findIndex((h) => /text|coment|comment/.test(h));
  const out = [];

  if (userCol >= 0 && textCol >= 0) {
    lines.slice(1).forEach((line, i) => {
      const cells = parseCsvLine(line);
      if (cells[userCol] && cells[textCol] != null) {
        out.push({ id: `import-${i}`, username: cells[userCol].replace(/^@/, ''), text: cells[textCol], createdAt: i });
      }
    });
    return out;
  }

  lines.forEach((line, i) => {
    const m = line.match(/^@?([a-zA-Z0-9._]{1,30})\s*[:\-–—,\t]\s*(.+)$/);
    if (m) out.push({ id: `import-${i}`, username: m[1], text: m[2], createdAt: i });
  });
  return out;
}

export function parseImport(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return fromJson(JSON.parse(trimmed));
  }
  return fromLines(trimmed);
}
