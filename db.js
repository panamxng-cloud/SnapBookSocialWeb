// db.js — Turso: historial de mensajes para SnapBook Pro
// chats.html importa exactamente estas funciones:
//   sincronizarUsuario, enviarMensaje, obtenerMensajes,
//   marcarLeidos, contarNoLeidos, toggleReaccion, eliminarMensaje

import { createClient } from "https://esm.sh/@libsql/client@0.14.0/web";

// ── Cliente Turso ─────────────────────────────────────────────────────────────
const turso = createClient({
  url: "libsql://snapbooksocialweb-panamxng-cloud.aws-us-east-1.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzU1ODg4NDQsImlkIjoiMDE5ZDY2OTctNTkwMS03NjNiLWIxODAtOWYwMDlhYTI4MzYxIiwicmlkIjoiYmU0ZWU4YmItYWQwMi00MzIwLTk5ZDgtNWExY2M0MzhjYzM5In0.68c2X35glT339UkwE0DmmN2fTImnr0U5OzoMuEv93MdcqErIQM5_QuhNDpbndTc2PE-ALwBUIphuWaLPjDsKAw",
});

// ── Inicializar tablas (se llama al arrancar) ─────────────────────────────────
async function initDB() {
  await turso.batch([
    // Tabla de usuarios sincronizados
    `CREATE TABLE IF NOT EXISTS usuarios (
      uid           TEXT PRIMARY KEY,
      nombre        TEXT,
      avatar        TEXT,
      email         TEXT,
      updated_at    INTEGER
    )`,
    // Tabla de mensajes
    `CREATE TABLE IF NOT EXISTS mensajes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id       TEXT NOT NULL,
      sender_uid    TEXT NOT NULL,
      sender_nombre TEXT,
      sender_avatar TEXT,
      texto         TEXT,
      tipo          TEXT DEFAULT 'text',
      media_url     TEXT,
      leido         INTEGER DEFAULT 0,
      eliminado     INTEGER DEFAULT 0,
      forwarded     INTEGER DEFAULT 0,
      reply_to_id   INTEGER,
      reply_nombre  TEXT,
      reply_texto   TEXT,
      reactions     TEXT DEFAULT '{}',
      timestamp     INTEGER NOT NULL
    )`,
    // Índices para búsquedas rápidas
    `CREATE INDEX IF NOT EXISTS idx_msg_chat  ON mensajes(chat_id)`,
    `CREATE INDEX IF NOT EXISTS idx_msg_ts    ON mensajes(timestamp)`,
    `CREATE INDEX IF NOT EXISTS idx_msg_uid   ON mensajes(sender_uid)`,
  ], "write");
}

// Inicializar al cargar el módulo
initDB().catch(e => console.warn("Turso initDB:", e));

// ── 1. sincronizarUsuario ────────────────────────────────────────────────────
// Guarda / actualiza el perfil del usuario autenticado en Turso
export async function sincronizarUsuario(user) {
  await turso.execute({
    sql: `INSERT INTO usuarios (uid, nombre, avatar, email, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(uid) DO UPDATE SET
            nombre     = excluded.nombre,
            avatar     = excluded.avatar,
            email      = excluded.email,
            updated_at = excluded.updated_at`,
    args: [
      user.uid,
      user.displayName || "Usuario",
      user.photoURL    || "",
      user.email       || "",
      Date.now(),
    ],
  });
}

// ── 2. enviarMensaje ─────────────────────────────────────────────────────────
// Persiste un mensaje en Turso. Firebase sigue siendo el canal realtime.
export async function enviarMensaje(chatId, user, { texto, tipo = "text", mediaUrl = null, replyToId = null }) {
  // Si es un reply, buscar datos del mensaje original
  let replyNombre = null;
  let replyTexto  = null;
  if (replyToId) {
    try {
      const r = await turso.execute({
        sql: "SELECT sender_nombre, texto FROM mensajes WHERE id = ?",
        args: [replyToId],
      });
      if (r.rows.length) {
        replyNombre = r.rows[0].sender_nombre;
        replyTexto  = r.rows[0].texto;
      }
    } catch(e) { /* ignorar */ }
  }

  const result = await turso.execute({
    sql: `INSERT INTO mensajes
            (chat_id, sender_uid, sender_nombre, sender_avatar,
             texto, tipo, media_url, timestamp,
             reply_to_id, reply_nombre, reply_texto)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      chatId,
      user.uid,
      user.displayName || "Usuario",
      user.photoURL    || "",
      texto            || "",
      tipo,
      mediaUrl,
      Date.now(),
      replyToId,
      replyNombre,
      replyTexto,
    ],
  });
  return result.lastInsertRowid;
}

// ── 3. obtenerMensajes ───────────────────────────────────────────────────────
// Historial de un chat (los últimos N mensajes no eliminados)
export async function obtenerMensajes(chatId, limite = 60) {
  const result = await turso.execute({
    sql: `SELECT * FROM mensajes
          WHERE chat_id = ? AND eliminado = 0
          ORDER BY timestamp ASC
          LIMIT ?`,
    args: [chatId, limite],
  });
  return result.rows;
}

// ── 4. marcarLeidos ──────────────────────────────────────────────────────────
// Marca como leídos todos los mensajes que NO son míos en ese chat
export async function marcarLeidos(chatId, miUid) {
  await turso.execute({
    sql: `UPDATE mensajes SET leido = 1
          WHERE chat_id = ? AND sender_uid != ? AND leido = 0`,
    args: [chatId, miUid],
  });
}

// ── 5. contarNoLeidos ────────────────────────────────────────────────────────
// Devuelve el total de mensajes no leídos para el usuario en TODOS los chats
export async function contarNoLeidos(miUid) {
  const result = await turso.execute({
    sql: `SELECT COUNT(*) as total FROM mensajes
          WHERE sender_uid != ? AND leido = 0 AND eliminado = 0
          AND chat_id LIKE ?`,
    args: [miUid, `%${miUid}%`],
  });
  return Number(result.rows[0]?.total ?? 0);
}

// ── 6. toggleReaccion ────────────────────────────────────────────────────────
// Alterna una reacción emoji de un usuario en un mensaje
export async function toggleReaccion(msgId, uid, emoji) {
  // Leer reacciones actuales
  const r = await turso.execute({
    sql: "SELECT reactions FROM mensajes WHERE id = ?",
    args: [msgId],
  });
  if (!r.rows.length) return;

  let reacts = {};
  try { reacts = JSON.parse(r.rows[0].reactions || "{}"); } catch(e) {}

  // Toggle: si ya tiene esa reacción la quita, si no la agrega
  if (reacts[uid] === emoji) {
    delete reacts[uid];
  } else {
    reacts[uid] = emoji;
  }

  await turso.execute({
    sql: "UPDATE mensajes SET reactions = ? WHERE id = ?",
    args: [JSON.stringify(reacts), msgId],
  });
  return reacts;
}

// ── 7. eliminarMensaje ───────────────────────────────────────────────────────
// Soft-delete: solo el dueño puede eliminar su mensaje
export async function eliminarMensaje(msgId, uid) {
  await turso.execute({
    sql: "UPDATE mensajes SET eliminado = 1 WHERE id = ? AND sender_uid = ?",
    args: [msgId, uid],
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── POSTS, LIKES Y COMENTARIOS ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function initPostDB() {
  await turso.batch([
    `CREATE TABLE IF NOT EXISTS posts (
      id         TEXT PRIMARY KEY,
      uid        TEXT NOT NULL,
      nombre     TEXT,
      avatar     TEXT,
      texto      TEXT,
      imagen_url TEXT,
      video_url  TEXT,
      audio_url  TEXT,
      es_anonimo INTEGER DEFAULT 0,
      timestamp  INTEGER NOT NULL,
      total_likes       INTEGER DEFAULT 0,
      total_comentarios INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS likes (
      post_id TEXT NOT NULL,
      uid     TEXT NOT NULL,
      PRIMARY KEY (post_id, uid)
    )`,
    `CREATE TABLE IF NOT EXISTS comentarios (
      id        TEXT PRIMARY KEY,
      post_id   TEXT NOT NULL,
      uid       TEXT NOT NULL,
      nombre    TEXT,
      avatar    TEXT,
      texto     TEXT,
      timestamp INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_posts_uid ON posts(uid)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_ts  ON posts(timestamp)`,
  ], "write");
}
initPostDB().catch(e => console.warn("initPostDB:", e));

// ── crearPost ────────────────────────────────────────────────────────────────
export async function crearPost(user, { texto, imagenUrl, videoUrl, audioUrl, esAnonimo }) {
  const id = crypto.randomUUID();
  await turso.execute({
    sql: `INSERT INTO posts (id, uid, nombre, avatar, texto, imagen_url, video_url, audio_url, es_anonimo, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, user.uid,
      user.displayName || "Usuario",
      user.photoURL    || "",
      texto     || "",
      imagenUrl || null,
      videoUrl  || null,
      audioUrl  || null,
      esAnonimo ? 1 : 0,
      Date.now(),
    ],
  });
  return id;
}

// ── obtenerFeed ──────────────────────────────────────────────────────────────
export async function obtenerFeed(uids, limite = 20, beforeTs = null) {
  if (!uids || uids.length === 0) return [];
  const placeholders = uids.map(() => "?").join(",");
  const ts = beforeTs || Date.now() + 1;
  const result = await turso.execute({
    sql: `SELECT * FROM posts
          WHERE uid IN (${placeholders}) AND timestamp < ?
          ORDER BY timestamp DESC
          LIMIT ?`,
    args: [...uids, ts, limite],
  });
  return result.rows;
}

// ── toggleLike ───────────────────────────────────────────────────────────────
export async function toggleLike(postId, uid) {
  const exists = await turso.execute({
    sql: "SELECT 1 FROM likes WHERE post_id = ? AND uid = ?",
    args: [postId, uid],
  });
  if (exists.rows.length) {
    await turso.execute({ sql: "DELETE FROM likes WHERE post_id = ? AND uid = ?", args: [postId, uid] });
    await turso.execute({ sql: "UPDATE posts SET total_likes = total_likes - 1 WHERE id = ?", args: [postId] });
  } else {
    await turso.execute({ sql: "INSERT INTO likes (post_id, uid) VALUES (?, ?)", args: [postId, uid] });
    await turso.execute({ sql: "UPDATE posts SET total_likes = total_likes + 1 WHERE id = ?", args: [postId] });
  }
}

// ── misLikes ─────────────────────────────────────────────────────────────────
export async function misLikes(uid, postIds) {
  if (!postIds || postIds.length === 0) return new Set();
  const placeholders = postIds.map(() => "?").join(",");
  const result = await turso.execute({
    sql: `SELECT post_id FROM likes WHERE uid = ? AND post_id IN (${placeholders})`,
    args: [uid, ...postIds],
  });
  return new Set(result.rows.map(r => r.post_id));
}

// ── agregarComentario ────────────────────────────────────────────────────────
export async function agregarComentario(postId, user, texto) {
  const id = crypto.randomUUID();
  await turso.execute({
    sql: `INSERT INTO comentarios (id, post_id, uid, nombre, avatar, texto, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, postId, user.uid, user.displayName || "Usuario", user.photoURL || "", texto, Date.now()],
  });
  await turso.execute({
    sql: "UPDATE posts SET total_comentarios = total_comentarios + 1 WHERE id = ?",
    args: [postId],
  });
  return id;
}

// ── obtenerComentarios ───────────────────────────────────────────────────────
export async function obtenerComentarios(postId, limite = 50) {
  const result = await turso.execute({
    sql: "SELECT * FROM comentarios WHERE post_id = ? ORDER BY timestamp ASC LIMIT ?",
    args: [postId, limite],
  });
  return result.rows;
}

// ── eliminarComentario ───────────────────────────────────────────────────────
export async function eliminarComentario(commentId, uid) {
  const r = await turso.execute({
    sql: "SELECT post_id FROM comentarios WHERE id = ? AND uid = ?",
    args: [commentId, uid],
  });
  if (!r.rows.length) return;
  const postId = r.rows[0].post_id;
  await turso.execute({ sql: "DELETE FROM comentarios WHERE id = ?", args: [commentId] });
  await turso.execute({
    sql: "UPDATE posts SET total_comentarios = MAX(0, total_comentarios - 1) WHERE id = ?",
    args: [postId],
  });
}

// ── eliminarPost ─────────────────────────────────────────────────────────────
export async function eliminarPost(postId, uid) {
  await turso.execute({
    sql: "DELETE FROM posts WHERE id = ? AND uid = ?",
    args: [postId, uid],
  });
  await turso.execute({ sql: "DELETE FROM likes WHERE post_id = ?", args: [postId] });
  await turso.execute({ sql: "DELETE FROM comentarios WHERE post_id = ?", args: [postId] });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── HISTORIAS ──────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function initHistoriasDB() {
  await turso.batch([
    `CREATE TABLE IF NOT EXISTS historias (
      id             TEXT    PRIMARY KEY,
      uid            TEXT    NOT NULL,
      autor          TEXT,
      avatar         TEXT,
      imagen_url     TEXT,
      video_url      TEXT,
      texto_historia TEXT,
      bg_gradient    TEXT,
      timestamp      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      expira         INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_historias_uid    ON historias(uid)`,
    `CREATE INDEX IF NOT EXISTS idx_historias_expira ON historias(expira)`,
  ], "write");
}
initHistoriasDB().catch(e => console.warn("initHistoriasDB:", e));

// ── crearHistoria ─────────────────────────────────────────────────────────────
export async function crearHistoria(user, { imagenUrl, videoUrl, textoHistoria, bgGradient }) {
  const id     = crypto.randomUUID();
  const ahora  = Date.now();
  const expira = ahora + 24 * 60 * 60 * 1000; // 24 horas
  await turso.execute({
    sql: `INSERT INTO historias
            (id, uid, autor, avatar, imagen_url, video_url, texto_historia, bg_gradient, timestamp, expira)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      user.uid,
      user.displayName || "Usuario",
      user.photoURL    || "",
      imagenUrl        || null,
      videoUrl         || null,
      textoHistoria    || null,
      bgGradient       || null,
      ahora,
      expira,
    ],
  });
  return id;
}

// ── obtenerHistorias ──────────────────────────────────────────────────────────
// Devuelve todas las historias vigentes (no expiradas), más recientes primero
export async function obtenerHistorias() {
  const result = await turso.execute({
    sql: `SELECT * FROM historias
          WHERE expira > ?
          ORDER BY timestamp DESC`,
    args: [Date.now()],
  });
  return result.rows;
}

// ── eliminarHistoriasExpiradas ────────────────────────────────────────────────
export async function eliminarHistoriasExpiradas() {
  await turso.execute({
    sql: "DELETE FROM historias WHERE expira <= ?",
    args: [Date.now()],
  });
}
