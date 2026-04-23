// ============================================================
//  turso-config.js
//  Importa este archivo donde necesites acceso a Turso
// ============================================================

// ── CREDENCIALES ───────────────────────────────────────────
const TURSO_URL   = "https://snapbooksocialweb-panamxng-cloud.aws-us-east-1.turso.io";
const TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzU1OTAzMjEsImlkIjoiMDE5ZDY2OTctNTkwMS03NjNiLWIxODAtOWYwMDlhYTI4MzYxIiwicmlkIjoiYmU0ZWU4YmItYWQwMi00MzIwLTk5ZDgtNWExY2M0MzhjYzM5In0.2Glf-5mG_71gLT59ubbYJXk9ChAR6od6XaSDhijJ92BXpQt_Jutk1FCHcLjnRDic3KI7NgAXAk1wpJi2xBd2Dw";

// ── CLIENTE HTTP (sin SDK, compatible con HTML puro) ────────
async function tursoQuery(sql, args = []) {
    const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${TURSO_TOKEN}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            requests: [
                { type: "execute", stmt: { sql, args: args.map(toTursoArg) } },
                { type: "close" }
            ]
        })
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Turso error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const result = data.results?.[0];

    if (result?.type === "error") {
        throw new Error(`Turso query error: ${result.error?.message}`);
    }

    const cols = result?.response?.result?.cols?.map(c => c.name) ?? [];
    const rows = result?.response?.result?.rows ?? [];

    return rows.map(row =>
        Object.fromEntries(row.map((cell, i) => [cols[i], cell?.value ?? null]))
    );
}

// Convierte valores JS al formato que espera Turso
function toTursoArg(val) {
    if (val === null || val === undefined) return { type: "null" };
    if (typeof val === "number")           return { type: Number.isInteger(val) ? "integer" : "float", value: String(val) };
    if (typeof val === "boolean")          return { type: "integer", value: val ? "1" : "0" };
    return { type: "text", value: String(val) };
}

// Batch: ejecuta varias queries en una sola request
async function tursoBatch(statements) {
    const requests = [
        ...statements.map(({ sql, args = [] }) => ({
            type: "execute",
            stmt: { sql, args: args.map(toTursoArg) }
        })),
        { type: "close" }
    ];

    const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${TURSO_TOKEN}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ requests })
    });

    if (!res.ok) throw new Error(`Turso batch error ${res.status}`);
    const data = await res.json();
    return data.results;
}

// ── FUNCIONES DE LA APP ─────────────────────────────────────

async function sincronizarUsuario(user) {
    await tursoQuery(`
        INSERT INTO users (id, username, email, avatar_url, bio, created_at)
        VALUES (?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(id) DO UPDATE SET
            username   = excluded.username,
            avatar_url = excluded.avatar_url
    `, [
        user.uid,
        user.displayName || user.email?.split('@')[0] || 'usuario',
        user.email || '',
        user.photoURL || null,
        null
    ]);
}

async function crearPost(uid, texto, imagenUrl = null, videoUrl = null, bookTitle = null) {
    const id = crypto.randomUUID();
    await tursoQuery(`
        INSERT INTO posts (id, user_id, content, image_url, book_title, created_at)
        VALUES (?, ?, ?, ?, ?, unixepoch())
    `, [id, uid, texto, imagenUrl, bookTitle]);
    return id;
}

async function obtenerFeed(uids, limite = 20, antes = null) {
    const placeholders = uids.map(() => '?').join(',');
    const args = [...uids, limite];
    const sql = `
        SELECT p.id, p.user_id as uid, u.username as nombre, u.avatar_url as avatar,
               p.content as texto, p.image_url as imagen_url, p.book_title,
               p.created_at as timestamp
        FROM posts p
        JOIN users u ON u.id = p.user_id
        WHERE p.user_id IN (${placeholders})
        ORDER BY p.created_at DESC
        LIMIT ?
    `;
    return await tursoQuery(sql, args);
}

async function misLikes(uid, postIds) {
    // Retorna Set vacío si no hay posts
    if (!postIds.length) return new Set();
    return new Set(); // Implementar cuando se agregue tabla de likes
}

export { tursoQuery, tursoBatch, sincronizarUsuario, crearPost, obtenerFeed, misLikes };
