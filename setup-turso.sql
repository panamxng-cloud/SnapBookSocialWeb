-- setup-turso.sql
-- Ejecuta este SQL en el dashboard de Turso → tu base de datos → Editor SQL

CREATE TABLE IF NOT EXISTS mensajes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     TEXT NOT NULL,        -- UID1_UID2 (ordenados alfabéticamente)
  uid         TEXT NOT NULL,        -- UID del remitente (Firebase Auth)
  nombre      TEXT,                 -- displayName del remitente
  foto        TEXT,                 -- photoURL del remitente
  texto       TEXT,                 -- contenido del mensaje
  tipo        TEXT DEFAULT 'texto', -- texto | imagen | voz | video
  url_media   TEXT,                 -- URL de Firebase Storage si aplica
  leido       INTEGER DEFAULT 0,    -- 0 = no leído, 1 = leído
  eliminado   INTEGER DEFAULT 0,    -- 0 = activo, 1 = eliminado
  timestamp   INTEGER NOT NULL      -- Date.now()
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_chat_id ON mensajes(chat_id);
CREATE INDEX IF NOT EXISTS idx_timestamp ON mensajes(timestamp);
CREATE INDEX IF NOT EXISTS idx_uid ON mensajes(uid);
