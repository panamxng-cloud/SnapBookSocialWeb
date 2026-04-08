-- ============================================================
--  SnapBook — Turso Schema
--  Ejecutar una vez al crear la base de datos
-- ============================================================

-- ── USUARIOS (espejo ligero de Firebase Auth) ──────────────
CREATE TABLE IF NOT EXISTS usuarios (
    uid         TEXT PRIMARY KEY,
    nombre      TEXT NOT NULL,
    email       TEXT,
    avatar      TEXT,
    bio         TEXT,
    created_at  INTEGER DEFAULT (strftime('%s','now') * 1000)
);

-- ── PUBLICACIONES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS publicaciones (
    id           TEXT PRIMARY KEY,          -- nanoid / uuid generado en cliente
    uid          TEXT NOT NULL,             -- Firebase UID del autor
    nombre       TEXT NOT NULL,             -- nombre del autor (snapshot)
    avatar       TEXT,                      -- foto del autor (snapshot)
    texto        TEXT,
    imagen_url   TEXT,                      -- URL de Cloudinary
    video_url    TEXT,                      -- URL de Cloudinary
    es_anonimo   INTEGER DEFAULT 0,         -- 0 = no, 1 = sí
    timestamp    INTEGER NOT NULL,
    FOREIGN KEY (uid) REFERENCES usuarios(uid)
);

CREATE INDEX IF NOT EXISTS idx_pub_uid       ON publicaciones(uid);
CREATE INDEX IF NOT EXISTS idx_pub_timestamp ON publicaciones(timestamp DESC);

-- ── LIKES ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS likes (
    post_id     TEXT NOT NULL,
    uid         TEXT NOT NULL,
    timestamp   INTEGER DEFAULT (strftime('%s','now') * 1000),
    PRIMARY KEY (post_id, uid),
    FOREIGN KEY (post_id) REFERENCES publicaciones(id)
);

-- ── COMENTARIOS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comentarios (
    id          TEXT PRIMARY KEY,
    post_id     TEXT NOT NULL,
    uid         TEXT NOT NULL,
    nombre      TEXT NOT NULL,
    avatar      TEXT,
    texto       TEXT NOT NULL,
    timestamp   INTEGER NOT NULL,
    FOREIGN KEY (post_id) REFERENCES publicaciones(id)
);

CREATE INDEX IF NOT EXISTS idx_com_post ON comentarios(post_id, timestamp);

-- ── CHATS (metadata) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS chats (
    id              TEXT PRIMARY KEY,
    nombre          TEXT,
    avatar          TEXT,
    es_grupo        INTEGER DEFAULT 0,
    creado_por      TEXT,
    ultimo_mensaje  TEXT,
    ultimo_ts       INTEGER,
    created_at      INTEGER DEFAULT (strftime('%s','now') * 1000)
);

-- ── PARTICIPANTES DE CHAT ──────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_participantes (
    chat_id     TEXT NOT NULL,
    uid         TEXT NOT NULL,
    es_admin    INTEGER DEFAULT 0,
    PRIMARY KEY (chat_id, uid),
    FOREIGN KEY (chat_id) REFERENCES chats(id)
);

CREATE INDEX IF NOT EXISTS idx_cp_uid ON chat_participantes(uid);

-- ── MENSAJES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mensajes (
    id              TEXT PRIMARY KEY,
    chat_id         TEXT NOT NULL,
    sender_uid      TEXT NOT NULL,
    sender_nombre   TEXT NOT NULL,
    sender_avatar   TEXT,
    tipo            TEXT DEFAULT 'text',    -- text | image | video | audio | sticker | system
    texto           TEXT,
    media_url       TEXT,                   -- Cloudinary URL si hay adjunto
    reply_to_id     TEXT,                   -- ID del mensaje al que responde
    forwarded       INTEGER DEFAULT 0,
    leido           INTEGER DEFAULT 0,
    timestamp       INTEGER NOT NULL,
    FOREIGN KEY (chat_id) REFERENCES chats(id)
);

CREATE INDEX IF NOT EXISTS idx_msg_chat_ts ON mensajes(chat_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_msg_sender  ON mensajes(sender_uid);

-- ── REACCIONES A MENSAJES ──────────────────────────────────
CREATE TABLE IF NOT EXISTS mensaje_reacciones (
    mensaje_id  TEXT NOT NULL,
    uid         TEXT NOT NULL,
    emoji       TEXT NOT NULL,
    PRIMARY KEY (mensaje_id, uid),
    FOREIGN KEY (mensaje_id) REFERENCES mensajes(id)
);
