// db.js — Turso HTTP API (compatible con browser/GitHub Pages)
// Reemplaza @libsql/client (Node.js only) con fetch directo a la REST API de Turso.

const TURSO_URL   = "https://snapbooksocialweb-panamxng-cloud.aws-us-east-1.turso.io";
const TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzU1ODg4NDQsImlkIjoiMDE5ZDY2OTctNTkwMS03NjNiLWIxODAtOWYwMDlhYTI4MzYxIiwicmlkIjoiYmU0ZWU4YmItYWQwMi00MzIwLTk5ZDgtNWExY2M0MzhjYzM5In0.68c2X35glT339UkwE0DmmN2fTImnr0U5OzoMuEv93MdcqErIQM5_QuhNDpbndTc2PE-ALwBUIphuWaLPjDsKAw";

async function sql(query, args = []) {
  const mapArg = v => {
    if (v === null || v === undefined) return { type: "null" };
    if (typeof v === "number") return { type: "integer", value: String(Math.trunc(v)) };
    return { type: "text", value: String(v) };
  };
  const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${TURSO_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql: query, args: args.map(mapArg) } },
        { type: "close" }
      ]
    })
  });
  if (!res.ok) throw new Error(`Turso HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const result = data.results?.[0];
  if (result?.type === "error") throw new Error(result.error?.message || "Turso error");
  const cols = result?.response?.result?.cols?.map(c => c.name) || [];
  const rows = result?.response?.result?.rows || [];
  return {
    rows: rows.map(row => Object.fromEntries(cols.map((col, i) => [col, row[i]?.value ?? null]))),
    lastInsertRowid: result?.response?.result?.last_insert_rowid ?? null,
  };
}

async function batch(statements) {
  const mapArg = v => {
    if (v === null || v === undefined) return { type: "null" };
    if (typeof v === "number") return { type: "integer", value: String(Math.trunc(v)) };
    return { type: "text", value: String(v) };
  };
  const requests = [
    ...statements.map(s => typeof s === "string"
      ? { type: "execute", stmt: { sql: s } }
      : { type: "execute", stmt: { sql: s.sql, args: (s.args || []).map(mapArg) } }
    ),
    { type: "close" }
  ];
  const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${TURSO_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests })
  });
  if (!res.ok) throw new Error(`Turso batch HTTP ${res.status}`);
}

// ── Inicializar todas las tablas ──────────────────────────────────────────────
async function initDB() {
  await batch([
    `CREATE TABLE IF NOT EXISTS usuarios (uid TEXT PRIMARY KEY, nombre TEXT, avatar TEXT, email TEXT, updated_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS mensajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, sender_uid TEXT NOT NULL,
      sender_nombre TEXT, sender_avatar TEXT, texto TEXT, tipo TEXT DEFAULT 'text',
      media_url TEXT, leido INTEGER DEFAULT 0, eliminado INTEGER DEFAULT 0,
      forwarded INTEGER DEFAULT 0, reply_to_id INTEGER, reply_nombre TEXT, reply_texto TEXT,
      reactions TEXT DEFAULT '{}', timestamp INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_msg_chat ON mensajes(chat_id)`,
    `CREATE INDEX IF NOT EXISTS idx_msg_ts   ON mensajes(timestamp)`,
    `CREATE INDEX IF NOT EXISTS idx_msg_uid  ON mensajes(sender_uid)`,
    `CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, uid TEXT NOT NULL, nombre TEXT, avatar TEXT, texto TEXT,
      imagen_url TEXT, video_url TEXT, audio_url TEXT, es_anonimo INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL, total_likes INTEGER DEFAULT 0, total_comentarios INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS likes (post_id TEXT NOT NULL, uid TEXT NOT NULL, PRIMARY KEY (post_id, uid))`,
    `CREATE TABLE IF NOT EXISTS comentarios (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, uid TEXT NOT NULL,
      nombre TEXT, avatar TEXT, texto TEXT, timestamp INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_uid ON posts(uid)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_ts  ON posts(timestamp)`,
    `CREATE TABLE IF NOT EXISTS historias (
      id TEXT PRIMARY KEY, uid TEXT NOT NULL, autor TEXT, avatar TEXT,
      imagen_url TEXT, video_url TEXT, texto_historia TEXT, bg_gradient TEXT,
      timestamp INTEGER NOT NULL, expira INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_historias_uid    ON historias(uid)`,
    `CREATE INDEX IF NOT EXISTS idx_historias_expira ON historias(expira)`,
  ]);
}
initDB().catch(e => console.warn("Turso initDB:", e));

// ── USUARIOS ──────────────────────────────────────────────────────────────────
export async function sincronizarUsuario(user) {
  await sql(
    `INSERT INTO usuarios (uid, nombre, avatar, email, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET nombre=excluded.nombre, avatar=excluded.avatar,
     email=excluded.email, updated_at=excluded.updated_at`,
    [user.uid, user.displayName || "Usuario", user.photoURL || "", user.email || "", Date.now()]
  );
}

// ── MENSAJES ──────────────────────────────────────────────────────────────────
export async function enviarMensaje(chatId, user, { texto, tipo = "text", mediaUrl = null, replyToId = null }) {
  let replyNombre = null, replyTexto = null;
  if (replyToId) {
    try {
      const r = await sql("SELECT sender_nombre, texto FROM mensajes WHERE id = ?", [replyToId]);
      if (r.rows.length) { replyNombre = r.rows[0].sender_nombre; replyTexto = r.rows[0].texto; }
    } catch(e) {}
  }
  const result = await sql(
    `INSERT INTO mensajes (chat_id, sender_uid, sender_nombre, sender_avatar, texto, tipo, media_url, timestamp, reply_to_id, reply_nombre, reply_texto)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [chatId, user.uid, user.displayName || "Usuario", user.photoURL || "",
     texto || "", tipo, mediaUrl, Date.now(), replyToId, replyNombre, replyTexto]
  );
  return result.lastInsertRowid;
}

export async function obtenerMensajes(chatId, limite = 60) {
  const r = await sql(
    `SELECT * FROM mensajes WHERE chat_id = ? AND eliminado = 0 ORDER BY timestamp ASC LIMIT ?`,
    [chatId, limite]
  );
  return r.rows;
}

export async function marcarLeidos(chatId, miUid) {
  await sql(
    `UPDATE mensajes SET leido = 1 WHERE chat_id = ? AND sender_uid != ? AND leido = 0`,
    [chatId, miUid]
  );
}

export async function contarNoLeidos(miUid) {
  const r = await sql(
    `SELECT COUNT(*) as total FROM mensajes WHERE sender_uid != ? AND leido = 0 AND eliminado = 0 AND chat_id LIKE ?`,
    [miUid, `%${miUid}%`]
  );
  return Number(r.rows[0]?.total ?? 0);
}

export async function toggleReaccion(msgId, uid, emoji) {
  const r = await sql("SELECT reactions FROM mensajes WHERE id = ?", [msgId]);
  if (!r.rows.length) return;
  let reacts = {};
  try { reacts = JSON.parse(r.rows[0].reactions || "{}"); } catch(e) {}
  if (reacts[uid] === emoji) delete reacts[uid]; else reacts[uid] = emoji;
  await sql("UPDATE mensajes SET reactions = ? WHERE id = ?", [JSON.stringify(reacts), msgId]);
  return reacts;
}

export async function eliminarMensaje(msgId, uid) {
  await sql("UPDATE mensajes SET eliminado = 1 WHERE id = ? AND sender_uid = ?", [msgId, uid]);
}

// ── POSTS ─────────────────────────────────────────────────────────────────────
export async function crearPost(user, { id, texto, imagenUrl, videoUrl, audioUrl, esAnonimo, timestamp }) {
  const postId = id || crypto.randomUUID();
  const ts = timestamp || Date.now();
  await sql(
    `INSERT OR IGNORE INTO posts (id, uid, nombre, avatar, texto, imagen_url, video_url, audio_url, es_anonimo, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [postId, user.uid, user.displayName || "Usuario", user.photoURL || "",
     texto || "", imagenUrl || null, videoUrl || null, audioUrl || null, esAnonimo ? 1 : 0, ts]
  );
  return postId;
}

export async function obtenerFeed(uids, limite = 20, beforeTs = null) {
  if (!uids || uids.length === 0) return [];
  const placeholders = uids.map(() => "?").join(",");
  const ts = beforeTs || Date.now() + 1;
  const r = await sql(
    `SELECT * FROM posts WHERE uid IN (${placeholders}) AND timestamp < ? ORDER BY timestamp DESC LIMIT ?`,
    [...uids, ts, limite]
  );
  return r.rows;
}

export async function toggleLike(postId, uid) {
  const exists = await sql("SELECT 1 FROM likes WHERE post_id = ? AND uid = ?", [postId, uid]);
  if (exists.rows.length) {
    await sql("DELETE FROM likes WHERE post_id = ? AND uid = ?", [postId, uid]);
    await sql("UPDATE posts SET total_likes = MAX(0, total_likes - 1) WHERE id = ?", [postId]);
  } else {
    await sql("INSERT OR IGNORE INTO likes (post_id, uid) VALUES (?, ?)", [postId, uid]);
    await sql("UPDATE posts SET total_likes = total_likes + 1 WHERE id = ?", [postId]);
  }
}

export async function misLikes(uid, postIds) {
  if (!postIds || postIds.length === 0) return new Set();
  const placeholders = postIds.map(() => "?").join(",");
  const r = await sql(
    `SELECT post_id FROM likes WHERE uid = ? AND post_id IN (${placeholders})`,
    [uid, ...postIds]
  );
  return new Set(r.rows.map(row => row.post_id));
}

export async function agregarComentario(postId, user, texto) {
  const id = crypto.randomUUID();
  await sql(
    `INSERT INTO comentarios (id, post_id, uid, nombre, avatar, texto, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, postId, user.uid, user.displayName || "Usuario", user.photoURL || "", texto, Date.now()]
  );
  await sql("UPDATE posts SET total_comentarios = total_comentarios + 1 WHERE id = ?", [postId]);
  return id;
}

export async function obtenerComentarios(postId, limite = 50) {
  const r = await sql(
    "SELECT * FROM comentarios WHERE post_id = ? ORDER BY timestamp ASC LIMIT ?",
    [postId, limite]
  );
  return r.rows;
}

export async function eliminarComentario(commentId, uid) {
  const r = await sql("SELECT post_id FROM comentarios WHERE id = ? AND uid = ?", [commentId, uid]);
  if (!r.rows.length) return;
  const postId = r.rows[0].post_id;
  await sql("DELETE FROM comentarios WHERE id = ?", [commentId]);
  await sql("UPDATE posts SET total_comentarios = MAX(0, total_comentarios - 1) WHERE id = ?", [postId]);
}

export async function eliminarPost(postId, uid) {
  await sql("DELETE FROM posts WHERE id = ? AND uid = ?", [postId, uid]);
  await sql("DELETE FROM likes WHERE post_id = ?", [postId]);
  await sql("DELETE FROM comentarios WHERE post_id = ?", [postId]);
}

// ── HISTORIAS ─────────────────────────────────────────────────────────────────
export async function crearHistoria(user, { imagenUrl, videoUrl, textoHistoria, bgGradient, timestamp, expira }) {
  const id    = crypto.randomUUID();
  const ahora = timestamp || Date.now();
  const exp   = expira || (ahora + 24 * 60 * 60 * 1000);
  await sql(
    `INSERT OR IGNORE INTO historias (id, uid, autor, avatar, imagen_url, video_url, texto_historia, bg_gradient, timestamp, expira)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, user.uid, user.displayName || "Usuario", user.photoURL || "",
     imagenUrl || null, videoUrl || null, textoHistoria || null, bgGradient || null, ahora, exp]
  );
  return id;
}

export async function obtenerHistorias() {
  const r = await sql(
    "SELECT * FROM historias WHERE expira > ? ORDER BY timestamp DESC",
    [Date.now()]
  );
  return r.rows;
}

export async function eliminarHistoriasExpiradas() {
  await sql("DELETE FROM historias WHERE expira <= ?", [Date.now()]);
}
