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
      firebase_id   TEXT UNIQUE,
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

  // ── Migración: agregar columnas faltantes en mensajes ──
  const msgMigrations = [
    `ALTER TABLE mensajes ADD COLUMN firebase_id TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_firebase ON mensajes(firebase_id)`,
  ];
  for (const sql of msgMigrations) {
    try { await turso.execute(sql); } catch(e) { /* ya existe */ }
  }
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
export async function enviarMensaje(chatId, user, { texto, tipo = "text", mediaUrl = null, replyToId = null, firebaseId = null }) {
  // Si ya existe ese mensaje de Firebase, no duplicar
  if (firebaseId) {
    try {
      const chk = await turso.execute({ sql: "SELECT id FROM mensajes WHERE firebase_id = ?", args: [firebaseId] });
      if (chk.rows.length) return chk.rows[0].id;
    } catch(e) {}
  }

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
    sql: `INSERT OR IGNORE INTO mensajes
            (firebase_id, chat_id, sender_uid, sender_nombre, sender_avatar,
             texto, tipo, media_url, timestamp,
             reply_to_id, reply_nombre, reply_texto)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      firebaseId       || null,
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
  // Crear tablas si no existen
  await turso.batch([
    `CREATE TABLE IF NOT EXISTS posts (
      id         TEXT PRIMARY KEY,
      uid        TEXT,
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

  // ── Migración: agregar columnas faltantes si la tabla ya existía sin ellas ──
  const migrations = [
    `ALTER TABLE posts ADD COLUMN uid        TEXT`,
    `ALTER TABLE posts ADD COLUMN nombre     TEXT`,
    `ALTER TABLE posts ADD COLUMN avatar     TEXT`,
    `ALTER TABLE posts ADD COLUMN texto      TEXT`,
    `ALTER TABLE posts ADD COLUMN imagen_url TEXT`,
    `ALTER TABLE posts ADD COLUMN video_url  TEXT`,
    `ALTER TABLE posts ADD COLUMN audio_url  TEXT`,
    `ALTER TABLE posts ADD COLUMN es_anonimo INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN total_likes INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN total_comentarios INTEGER DEFAULT 0`,
  ];
  for (const sql of migrations) {
    try { await turso.execute(sql); } catch(e) { /* columna ya existe, ignorar */ }
  }
}
initPostDB().catch(e => console.warn("initPostDB:", e));

// ── crearPost ────────────────────────────────────────────────────────────────
export async function crearPost(user, { texto, imagenUrl, videoUrl, audioUrl, esAnonimo, firebaseId }) {
  // Si viene firebaseId de Firebase, lo usamos como ID para evitar duplicados
  const id = firebaseId || crypto.randomUUID();
  await turso.execute({
    sql: `INSERT OR IGNORE INTO posts (id, uid, nombre, avatar, texto, imagen_url, video_url, audio_url, es_anonimo, timestamp)
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
// ── SHORTS (videos) ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function initShortsDB() {
  await turso.batch([
    `CREATE TABLE IF NOT EXISTS shorts (
      id          TEXT    PRIMARY KEY,
      uid         TEXT    NOT NULL,
      autor       TEXT,
      avatar      TEXT,
      video_url   TEXT    NOT NULL,
      descripcion TEXT,
      timestamp   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      total_likes INTEGER DEFAULT 0,
      total_comentarios INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS likes_shorts (
      short_id TEXT NOT NULL,
      uid      TEXT NOT NULL,
      PRIMARY KEY (short_id, uid)
    )`,
    `CREATE TABLE IF NOT EXISTS comentarios_shorts (
      id        TEXT    PRIMARY KEY,
      short_id  TEXT    NOT NULL,
      uid       TEXT    NOT NULL,
      nombre    TEXT,
      avatar    TEXT,
      texto     TEXT,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_shorts_uid ON shorts(uid)`,
    `CREATE INDEX IF NOT EXISTS idx_shorts_ts  ON shorts(timestamp)`,
  ], "write");
}
initShortsDB().catch(e => console.warn("initShortsDB:", e));

// ── crearShort ────────────────────────────────────────────────────────────────
export async function crearShort(user, { videoUrl, descripcion }) {
  const id = crypto.randomUUID();
  await turso.execute({
    sql: `INSERT INTO shorts (id, uid, autor, avatar, video_url, descripcion, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, user.uid,
      user.displayName || "Usuario",
      user.photoURL    || "",
      videoUrl,
      descripcion      || "",
      Date.now(),
    ],
  });
  return id;
}

// ── obtenerShorts ─────────────────────────────────────────────────────────────
export async function obtenerShorts(limite = 50) {
  const result = await turso.execute({
    sql: "SELECT * FROM shorts ORDER BY timestamp DESC LIMIT ?",
    args: [limite],
  });
  return result.rows;
}

// ── obtenerShortsPorUid ───────────────────────────────────────────────────────
export async function obtenerShortsPorUid(uid) {
  const result = await turso.execute({
    sql: "SELECT * FROM shorts WHERE uid = ? ORDER BY timestamp DESC",
    args: [uid],
  });
  return result.rows;
}

// ── toggleLikeShort ───────────────────────────────────────────────────────────
export async function toggleLikeShort(shortId, uid) {
  const exists = await turso.execute({
    sql: "SELECT 1 FROM likes_shorts WHERE short_id = ? AND uid = ?",
    args: [shortId, uid],
  });
  if (exists.rows.length) {
    await turso.execute({ sql: "DELETE FROM likes_shorts WHERE short_id = ? AND uid = ?", args: [shortId, uid] });
    await turso.execute({ sql: "UPDATE shorts SET total_likes = MAX(0, total_likes - 1) WHERE id = ?", args: [shortId] });
    return false;
  } else {
    await turso.execute({ sql: "INSERT INTO likes_shorts (short_id, uid) VALUES (?, ?)", args: [shortId, uid] });
    await turso.execute({ sql: "UPDATE shorts SET total_likes = total_likes + 1 WHERE id = ?", args: [shortId] });
    return true;
  }
}

// ── agregarComentarioShort ────────────────────────────────────────────────────
export async function agregarComentarioShort(shortId, user, texto) {
  const id = crypto.randomUUID();
  await turso.execute({
    sql: `INSERT INTO comentarios_shorts (id, short_id, uid, nombre, avatar, texto, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, shortId, user.uid, user.displayName || "Usuario", user.photoURL || "", texto, Date.now()],
  });
  await turso.execute({
    sql: "UPDATE shorts SET total_comentarios = total_comentarios + 1 WHERE id = ?",
    args: [shortId],
  });
  return id;
}

// ── obtenerComentariosShort ───────────────────────────────────────────────────
export async function obtenerComentariosShort(shortId, limite = 50) {
  const result = await turso.execute({
    sql: "SELECT * FROM comentarios_shorts WHERE short_id = ? ORDER BY timestamp ASC LIMIT ?",
    args: [shortId, limite],
  });
  return result.rows;
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
  const expira = ahora + 24 * 60 * 60 * 1000;
  await turso.execute({
    sql: `INSERT INTO historias
            (id, uid, autor, avatar, imagen_url, video_url, texto_historia, bg_gradient, timestamp, expira)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, user.uid, user.displayName || "Usuario", user.photoURL || "",
           imagenUrl || null, videoUrl || null, textoHistoria || null, bgGradient || null, ahora, expira],
  });
  return id;
}

// ── obtenerHistorias ──────────────────────────────────────────────────────────
export async function obtenerHistorias() {
  const result = await turso.execute({
    sql: "SELECT * FROM historias WHERE expira > ? ORDER BY timestamp DESC",
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

// ═══════════════════════════════════════════════════════════════════════════════
// ── PERFIL / SEGUIDORES ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function initPerfilDB() {
  await turso.batch([
    `CREATE TABLE IF NOT EXISTS seguidores (
      uid         TEXT NOT NULL,
      seguidor_uid TEXT NOT NULL,
      timestamp   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (uid, seguidor_uid)
    )`,
    `CREATE TABLE IF NOT EXISTS visitas_perfil (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      uid         TEXT    NOT NULL,
      visitor_uid TEXT    NOT NULL,
      timestamp   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_seg_uid      ON seguidores(uid)`,
    `CREATE INDEX IF NOT EXISTS idx_seg_seguidor ON seguidores(seguidor_uid)`,
    `CREATE INDEX IF NOT EXISTS idx_vis_uid      ON visitas_perfil(uid)`,
  ], "write");
}
initPerfilDB().catch(e => console.warn("initPerfilDB:", e));

// ── seguirUsuario ─────────────────────────────────────────────────────────────
export async function seguirUsuario(uid, seguidorUid) {
  await turso.execute({
    sql: `INSERT OR IGNORE INTO seguidores (uid, seguidor_uid, timestamp) VALUES (?, ?, ?)`,
    args: [uid, seguidorUid, Date.now()],
  });
}

// ── dejarDeSeguir ─────────────────────────────────────────────────────────────
export async function dejarDeSeguir(uid, seguidorUid) {
  await turso.execute({
    sql: "DELETE FROM seguidores WHERE uid = ? AND seguidor_uid = ?",
    args: [uid, seguidorUid],
  });
}

// ── contarSeguidores ──────────────────────────────────────────────────────────
export async function contarSeguidores(uid) {
  const r = await turso.execute({
    sql: "SELECT COUNT(*) as total FROM seguidores WHERE uid = ?",
    args: [uid],
  });
  return Number(r.rows[0]?.total ?? 0);
}

// ── contarSiguiendo ───────────────────────────────────────────────────────────
export async function contarSiguiendo(uid) {
  const r = await turso.execute({
    sql: "SELECT COUNT(*) as total FROM seguidores WHERE seguidor_uid = ?",
    args: [uid],
  });
  return Number(r.rows[0]?.total ?? 0);
}

// ── registrarVisita ───────────────────────────────────────────────────────────
export async function registrarVisita(uid, visitorUid) {
  await turso.execute({
    sql: "INSERT INTO visitas_perfil (uid, visitor_uid, timestamp) VALUES (?, ?, ?)",
    args: [uid, visitorUid, Date.now()],
  });
}

// ── contarVisitas30Dias ───────────────────────────────────────────────────────
export async function contarVisitas30Dias(uid) {
  const desde = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const r = await turso.execute({
    sql: "SELECT COUNT(*) as total FROM visitas_perfil WHERE uid = ? AND timestamp >= ?",
    args: [uid, desde],
  });
  return Number(r.rows[0]?.total ?? 0);
}

// ── obtenerPostsPorUid ────────────────────────────────────────────────────────
export async function obtenerPostsPorUid(uid) {
  const result = await turso.execute({
    sql: "SELECT * FROM posts WHERE uid = ? ORDER BY timestamp DESC",
    args: [uid],
  });
  return result.rows;
}
