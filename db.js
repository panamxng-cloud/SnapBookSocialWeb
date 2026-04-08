// ═══════════════════════════════════════════════════════════════════
// db.js — Turso HTTP API  (sin @libsql/client, usa fetch nativo)
// Exporta TODAS las funciones que los HTML necesitan.
// ═══════════════════════════════════════════════════════════════════

const TURSO_URL   = "https://snapbooksocialweb-panamxng-cloud.aws-us-east-1.turso.io";
const TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzU2NTU0MjIsImlkIjoiMDE5ZDY2OTctNTkwMS03NjNiLWIxODAtOWYwMDlhYTI4MzYxIiwicmlkIjoiYmU0ZWU4YmItYWQwMi00MzIwLTk5ZDgtNWExY2M0MzhjYzM5In0.VUBTIxuDo_4csLtlt-vdle6DpPgQ46l75ZJVDvWe9ReCXvu_ihvvULVwV3TpOl_dpYiTcLt8vQCNNRZaZITzBA";

// ─────────────────────────────────────────────────────────────────
// UTILIDADES INTERNAS
// ─────────────────────────────────────────────────────────────────

function toValue(v) {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "number")         return { type: "integer", value: String(Math.trunc(v)) };
  if (typeof v === "boolean")        return { type: "integer", value: v ? "1" : "0" };
  return { type: "text", value: String(v) };
}

function rowsFromResult(result) {
  if (!result) return [];
  const cols = result.cols?.map(c => c.name) ?? [];
  return (result.rows ?? []).map(row =>
    Object.fromEntries(cols.map((col, i) => [col, row[i]?.value ?? null]))
  );
}

async function exec(sql, args = []) {
  const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method : "POST",
    headers: { "Authorization": `Bearer ${TURSO_TOKEN}`, "Content-Type": "application/json" },
    body   : JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql, args: args.map(toValue) } },
        { type: "close" },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Turso HTTP ${res.status}: ${await res.text()}`);
  const data   = await res.json();
  const result = data.results?.[0];
  if (result?.type === "error") throw new Error(result.error?.message ?? "Turso error");
  return rowsFromResult(result?.response?.result);
}

async function batch(statements) {
  const requests = [
    ...statements.map(({ sql, args = [] }) => ({
      type: "execute",
      stmt: { sql, args: args.map(toValue) },
    })),
    { type: "close" },
  ];
  const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method : "POST",
    headers: { "Authorization": `Bearer ${TURSO_TOKEN}`, "Content-Type": "application/json" },
    body   : JSON.stringify({ requests }),
  });
  if (!res.ok) throw new Error(`Turso batch HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────
// INICIALIZAR TABLAS
// ─────────────────────────────────────────────────────────────────
async function initTables() {
  await batch([
    { sql: `CREATE TABLE IF NOT EXISTS usuarios (uid TEXT PRIMARY KEY, nombre TEXT, avatar TEXT, email TEXT, updated_at INTEGER)` },
    { sql: `CREATE TABLE IF NOT EXISTS mensajes (
              id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, sender_uid TEXT NOT NULL,
              sender_nombre TEXT, sender_avatar TEXT, texto TEXT, tipo TEXT DEFAULT 'text',
              media_url TEXT, leido INTEGER DEFAULT 0, eliminado INTEGER DEFAULT 0,
              forwarded INTEGER DEFAULT 0, reply_to_id INTEGER, reply_nombre TEXT, reply_texto TEXT,
              reactions TEXT DEFAULT '{}', timestamp INTEGER NOT NULL, firebase_id TEXT UNIQUE)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_msg_chat ON mensajes(chat_id)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_msg_ts   ON mensajes(timestamp)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_msg_uid  ON mensajes(sender_uid)` },
    { sql: `CREATE TABLE IF NOT EXISTS posts (
              id TEXT PRIMARY KEY, uid TEXT NOT NULL, nombre TEXT, avatar TEXT, texto TEXT,
              imagen_url TEXT, video_url TEXT, audio_url TEXT, es_anonimo INTEGER DEFAULT 0,
              timestamp INTEGER NOT NULL, total_likes INTEGER DEFAULT 0,
              total_comentarios INTEGER DEFAULT 0, firebase_id TEXT UNIQUE)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_posts_uid ON posts(uid)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_posts_ts  ON posts(timestamp)` },
    { sql: `CREATE TABLE IF NOT EXISTS likes (post_id TEXT NOT NULL, uid TEXT NOT NULL, PRIMARY KEY (post_id, uid))` },
    { sql: `CREATE TABLE IF NOT EXISTS comentarios (
              id TEXT PRIMARY KEY, post_id TEXT NOT NULL, uid TEXT NOT NULL,
              nombre TEXT, avatar TEXT, texto TEXT, timestamp INTEGER NOT NULL)` },
    { sql: `CREATE TABLE IF NOT EXISTS shorts (
              id TEXT PRIMARY KEY, uid TEXT NOT NULL, autor TEXT, avatar TEXT,
              video_url TEXT NOT NULL, descripcion TEXT, timestamp INTEGER NOT NULL,
              total_likes INTEGER DEFAULT 0, total_comentarios INTEGER DEFAULT 0, firebase_id TEXT UNIQUE)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_shorts_uid ON shorts(uid)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_shorts_ts  ON shorts(timestamp)` },
    { sql: `CREATE TABLE IF NOT EXISTS likes_shorts (short_id TEXT NOT NULL, uid TEXT NOT NULL, PRIMARY KEY (short_id, uid))` },
    { sql: `CREATE TABLE IF NOT EXISTS comentarios_shorts (
              id TEXT PRIMARY KEY, short_id TEXT NOT NULL, uid TEXT NOT NULL,
              nombre TEXT, avatar TEXT, texto TEXT, timestamp INTEGER NOT NULL)` },
    { sql: `CREATE TABLE IF NOT EXISTS historias (
              id TEXT PRIMARY KEY, uid TEXT NOT NULL, autor TEXT, avatar TEXT,
              imagen_url TEXT, video_url TEXT, texto_historia TEXT, bg_gradient TEXT,
              timestamp INTEGER NOT NULL, expira INTEGER NOT NULL)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_historias_uid    ON historias(uid)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_historias_expira ON historias(expira)` },
    { sql: `CREATE TABLE IF NOT EXISTS seguidores (uid TEXT NOT NULL, seguidor_uid TEXT NOT NULL, timestamp INTEGER NOT NULL, PRIMARY KEY (uid, seguidor_uid))` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_seg_uid      ON seguidores(uid)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_seg_seguidor ON seguidores(seguidor_uid)` },
    { sql: `CREATE TABLE IF NOT EXISTS visitas_perfil (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, visitor_uid TEXT NOT NULL, timestamp INTEGER NOT NULL)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_vis_uid ON visitas_perfil(uid)` },
  ]);
  console.log("✅ Turso: tablas listas");
}
initTables().catch(e => console.error("❌ Turso initTables:", e));

// ═══════════════════════════════════════════════════════════════════
// HELPER PÚBLICO
// ═══════════════════════════════════════════════════════════════════
export async function tursoQuery(sql, args = []) { return exec(sql, args); }

// ═══════════════════════════════════════════════════════════════════
// USUARIOS
// ═══════════════════════════════════════════════════════════════════
export async function sincronizarUsuario(user) {
  await exec(
    `INSERT INTO usuarios (uid, nombre, avatar, email, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET nombre=excluded.nombre, avatar=excluded.avatar, email=excluded.email, updated_at=excluded.updated_at`,
    [user.uid, user.displayName ?? "Usuario", user.photoURL ?? "", user.email ?? "", Date.now()]
  );
}

// ═══════════════════════════════════════════════════════════════════
// MENSAJES DE CHAT
// ═══════════════════════════════════════════════════════════════════
export async function enviarMensaje(chatId, user, { texto, tipo = "text", mediaUrl = null, replyToId = null, firebaseId = null }) {
  let replyNombre = null, replyTexto = null;
  if (replyToId) {
    try {
      const r = await exec("SELECT sender_nombre, texto FROM mensajes WHERE id = ?", [replyToId]);
      if (r.length) { replyNombre = r[0].sender_nombre; replyTexto = r[0].texto; }
    } catch (_) {}
  }
  await exec(
    `INSERT OR IGNORE INTO mensajes
       (chat_id, sender_uid, sender_nombre, sender_avatar, texto, tipo, media_url,
        timestamp, reply_to_id, reply_nombre, reply_texto, firebase_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [chatId, user.uid, user.displayName ?? "Usuario", user.photoURL ?? "",
     texto ?? "", tipo, mediaUrl, Date.now(), replyToId, replyNombre, replyTexto, firebaseId]
  );
}

export async function obtenerMensajes(chatId, limite = 60) {
  return exec("SELECT * FROM mensajes WHERE chat_id = ? AND eliminado = 0 ORDER BY timestamp ASC LIMIT ?", [chatId, limite]);
}

export async function marcarLeidos(chatId, miUid) {
  await exec("UPDATE mensajes SET leido = 1 WHERE chat_id = ? AND sender_uid != ? AND leido = 0", [chatId, miUid]);
}

export async function contarNoLeidos(miUid) {
  const r = await exec("SELECT COUNT(*) as total FROM mensajes WHERE sender_uid != ? AND leido = 0 AND eliminado = 0 AND chat_id LIKE ?", [miUid, `%${miUid}%`]);
  return Number(r[0]?.total ?? 0);
}

export async function toggleReaccion(msgId, uid, emoji) {
  const r = await exec("SELECT reactions FROM mensajes WHERE id = ?", [msgId]);
  if (!r.length) return;
  let reacts = {};
  try { reacts = JSON.parse(r[0].reactions ?? "{}"); } catch (_) {}
  if (reacts[uid] === emoji) delete reacts[uid]; else reacts[uid] = emoji;
  await exec("UPDATE mensajes SET reactions = ? WHERE id = ?", [JSON.stringify(reacts), msgId]);
  return reacts;
}

export async function eliminarMensaje(msgId, uid) {
  await exec("UPDATE mensajes SET eliminado = 1 WHERE id = ? AND sender_uid = ?", [msgId, uid]);
}

// ═══════════════════════════════════════════════════════════════════
// POSTS
// ═══════════════════════════════════════════════════════════════════

/**
 * Guarda un post en Turso.
 * Comprueba firebase_id ANTES de insertar para evitar errores
 * de UNIQUE constraint cuando se reintenta una publicación.
 */
export async function crearPost(user, { texto, imagenUrl = null, videoUrl = null, audioUrl = null, esAnonimo = false, firebaseId = null }) {
  const uid = user?.uid;
  if (!uid) throw new Error("crearPost: user.uid es undefined");

  // Deduplicación: si ya existe este firebase_id, retorna el id existente sin error
  if (firebaseId) {
    const existe = await exec("SELECT id FROM posts WHERE firebase_id = ?", [firebaseId]);
    if (existe.length) {
      console.warn("⚠️ crearPost: duplicado detectado, omitiendo:", firebaseId);
      return existe[0].id;
    }
  }

  const id = crypto.randomUUID();
  console.log("📝 crearPost →", { id, uid, texto: (texto ?? "").slice(0, 40), imagenUrl, videoUrl, audioUrl, firebaseId });

  await exec(
    `INSERT INTO posts (id, uid, nombre, avatar, texto, imagen_url, video_url, audio_url, es_anonimo, timestamp, firebase_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, uid, user.displayName ?? "Usuario", user.photoURL ?? "",
     texto ?? "", imagenUrl, videoUrl, audioUrl, esAnonimo ? 1 : 0, Date.now(), firebaseId]
  );

  console.log("✅ crearPost guardado:", id, "| imagen:", imagenUrl ?? "—", "| video:", videoUrl ?? "—");
  return id;
}

export async function obtenerFeed(uids, limite = 20, beforeTs = null) {
  if (!uids?.length) return [];
  const ph = uids.map(() => "?").join(",");
  const ts = beforeTs ?? Date.now() + 1;
  return exec(`SELECT * FROM posts WHERE uid IN (${ph}) AND timestamp < ? ORDER BY timestamp DESC LIMIT ?`, [...uids, ts, limite]);
}

export async function obtenerTodosLosPosts(limite = 50, beforeTs = null) {
  const ts = beforeTs ?? Date.now() + 1;
  return exec("SELECT * FROM posts WHERE timestamp < ? ORDER BY timestamp DESC LIMIT ?", [ts, limite]);
}

export async function obtenerPostsPorUid(uid) {
  return exec("SELECT * FROM posts WHERE uid = ? ORDER BY timestamp DESC", [uid]);
}

export async function eliminarPost(postId, uid) {
  await exec("DELETE FROM posts       WHERE id = ? AND uid = ?", [postId, uid]);
  await exec("DELETE FROM likes       WHERE post_id = ?",        [postId]);
  await exec("DELETE FROM comentarios WHERE post_id = ?",        [postId]);
}

// Likes de posts
export async function toggleLike(postId, uid) {
  const existe = await exec("SELECT 1 FROM likes WHERE post_id = ? AND uid = ?", [postId, uid]);
  if (existe.length) {
    await exec("DELETE FROM likes WHERE post_id = ? AND uid = ?",               [postId, uid]);
    await exec("UPDATE posts SET total_likes = MAX(0, total_likes - 1) WHERE id = ?", [postId]);
    return false;
  } else {
    await exec("INSERT INTO likes (post_id, uid) VALUES (?, ?)",                [postId, uid]);
    await exec("UPDATE posts SET total_likes = total_likes + 1 WHERE id = ?",  [postId]);
    return true;
  }
}

export async function misLikes(uid, postIds) {
  if (!postIds?.length) return new Set();
  const ph = postIds.map(() => "?").join(",");
  const r  = await exec(`SELECT post_id FROM likes WHERE uid = ? AND post_id IN (${ph})`, [uid, ...postIds]);
  return new Set(r.map(row => row.post_id));
}

// Comentarios de posts
export async function agregarComentario(postId, user, texto) {
  const id = crypto.randomUUID();
  await exec(
    `INSERT INTO comentarios (id, post_id, uid, nombre, avatar, texto, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, postId, user.uid, user.displayName ?? "Usuario", user.photoURL ?? "", texto, Date.now()]
  );
  await exec("UPDATE posts SET total_comentarios = total_comentarios + 1 WHERE id = ?", [postId]);
  return id;
}

export async function obtenerComentarios(postId, limite = 50) {
  return exec("SELECT * FROM comentarios WHERE post_id = ? ORDER BY timestamp ASC LIMIT ?", [postId, limite]);
}

export async function eliminarComentario(commentId, uid) {
  const r = await exec("SELECT post_id FROM comentarios WHERE id = ? AND uid = ?", [commentId, uid]);
  if (!r.length) return;
  await exec("DELETE FROM comentarios WHERE id = ?",                                            [commentId]);
  await exec("UPDATE posts SET total_comentarios = MAX(0, total_comentarios - 1) WHERE id = ?", [r[0].post_id]);
}

// ═══════════════════════════════════════════════════════════════════
// SHORTS
// ═══════════════════════════════════════════════════════════════════

/**
 * Guarda un short en Turso.
 * Misma estrategia de deduplicación que crearPost.
 */
export async function crearShort(user, { videoUrl, descripcion = "", firebaseId = null }) {
  const uid = user?.uid;
  if (!uid) throw new Error("crearShort: user.uid es undefined");

  if (firebaseId) {
    const existe = await exec("SELECT id FROM shorts WHERE firebase_id = ?", [firebaseId]);
    if (existe.length) {
      console.warn("⚠️ crearShort: duplicado detectado, omitiendo:", firebaseId);
      return existe[0].id;
    }
  }

  const id = crypto.randomUUID();
  console.log("🎬 crearShort →", { id, uid, firebaseId });

  await exec(
    `INSERT INTO shorts (id, uid, autor, avatar, video_url, descripcion, timestamp, firebase_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, uid, user.displayName ?? "Usuario", user.photoURL ?? "", videoUrl, descripcion, Date.now(), firebaseId]
  );

  console.log("✅ crearShort guardado:", id);
  return id;
}

export async function obtenerShorts(limite = 50) {
  return exec("SELECT * FROM shorts ORDER BY timestamp DESC LIMIT ?", [limite]);
}

export async function obtenerShortsPorUid(uid) {
  return exec("SELECT * FROM shorts WHERE uid = ? ORDER BY timestamp DESC", [uid]);
}

export async function toggleLikeShort(shortId, uid) {
  const existe = await exec("SELECT 1 FROM likes_shorts WHERE short_id = ? AND uid = ?", [shortId, uid]);
  if (existe.length) {
    await exec("DELETE FROM likes_shorts WHERE short_id = ? AND uid = ?",                  [shortId, uid]);
    await exec("UPDATE shorts SET total_likes = MAX(0, total_likes - 1) WHERE id = ?",     [shortId]);
    return false;
  } else {
    await exec("INSERT INTO likes_shorts (short_id, uid) VALUES (?, ?)",   [shortId, uid]);
    await exec("UPDATE shorts SET total_likes = total_likes + 1 WHERE id = ?",             [shortId]);
    return true;
  }
}

export async function agregarComentarioShort(shortId, user, texto) {
  const id = crypto.randomUUID();
  await exec(
    `INSERT INTO comentarios_shorts (id, short_id, uid, nombre, avatar, texto, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, shortId, user.uid, user.displayName ?? "Usuario", user.photoURL ?? "", texto, Date.now()]
  );
  await exec("UPDATE shorts SET total_comentarios = total_comentarios + 1 WHERE id = ?", [shortId]);
  return id;
}

export async function obtenerComentariosShort(shortId, limite = 50) {
  return exec("SELECT * FROM comentarios_shorts WHERE short_id = ? ORDER BY timestamp ASC LIMIT ?", [shortId, limite]);
}

// ═══════════════════════════════════════════════════════════════════
// HISTORIAS
// ═══════════════════════════════════════════════════════════════════
export async function crearHistoria(user, { imagenUrl = null, videoUrl = null, textoHistoria = null, bgGradient = null, timestamp, expira }) {
  const id    = crypto.randomUUID();
  const ahora = timestamp ?? Date.now();
  const exp   = expira    ?? (ahora + 24 * 60 * 60 * 1000);
  await exec(
    `INSERT INTO historias (id, uid, autor, avatar, imagen_url, video_url, texto_historia, bg_gradient, timestamp, expira)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, user.uid, user.displayName ?? "Usuario", user.photoURL ?? "",
     imagenUrl, videoUrl, textoHistoria, bgGradient, ahora, exp]
  );
  return id;
}

export async function obtenerHistorias() {
  return exec("SELECT * FROM historias WHERE expira > ? ORDER BY timestamp DESC", [Date.now()]);
}

export async function eliminarHistoriasExpiradas() {
  await exec("DELETE FROM historias WHERE expira <= ?", [Date.now()]);
}

// ═══════════════════════════════════════════════════════════════════
// SEGUIDORES
// ═══════════════════════════════════════════════════════════════════
export async function seguirUsuario(uid, seguidorUid) {
  await exec("INSERT OR IGNORE INTO seguidores (uid, seguidor_uid, timestamp) VALUES (?, ?, ?)", [uid, seguidorUid, Date.now()]);
}

export async function dejarDeSeguir(uid, seguidorUid) {
  await exec("DELETE FROM seguidores WHERE uid = ? AND seguidor_uid = ?", [uid, seguidorUid]);
}

export async function contarSeguidores(uid) {
  const r = await exec("SELECT COUNT(*) as total FROM seguidores WHERE uid = ?", [uid]);
  return Number(r[0]?.total ?? 0);
}

export async function contarSiguiendo(uid) {
  const r = await exec("SELECT COUNT(*) as total FROM seguidores WHERE seguidor_uid = ?", [uid]);
  return Number(r[0]?.total ?? 0);
}

export async function esSeguidor(uid, seguidorUid) {
  const r = await exec("SELECT 1 FROM seguidores WHERE uid = ? AND seguidor_uid = ?", [uid, seguidorUid]);
  return r.length > 0;
}

// ═══════════════════════════════════════════════════════════════════
// VISITAS DE PERFIL
// ═══════════════════════════════════════════════════════════════════
export async function registrarVisita(uid, visitorUid) {
  await exec("INSERT INTO visitas_perfil (uid, visitor_uid, timestamp) VALUES (?, ?, ?)", [uid, visitorUid, Date.now()]);
}

export async function contarVisitas30Dias(uid) {
  const desde = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const r = await exec("SELECT COUNT(*) as total FROM visitas_perfil WHERE uid = ? AND timestamp >= ?", [uid, desde]);
  return Number(r[0]?.total ?? 0);
}
