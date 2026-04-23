// ============================================================
//  sheetdb-config.js  –  Registro de eventos en Google Sheets
//  Usado por: register, create-posts, chats
//
//  PASO 1: Ve a https://sheetdb.io → crea una cuenta gratis
//  PASO 2: Conecta tu Google Sheet → copia tu API URL
//  PASO 3: Reemplaza TU_SHEETDB_API_URL con tu URL real
//
//  Ejemplo URL: https://sheetdb.io/api/v1/abc123xyz
// ============================================================

const SHEETDB_URL = 'TU_SHEETDB_API_URL'; // ← pon tu URL aquí

// ── Helper interno ──────────────────────────────────────────
async function _log(datos) {
    if (!SHEETDB_URL || SHEETDB_URL === 'TU_SHEETDB_API_URL') {
        console.warn('SheetDB: configura tu URL en sheetdb-config.js');
        return;
    }
    try {
        await fetch(SHEETDB_URL, {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({ data: [datos] })
        });
    } catch (e) {
        console.warn('SheetDB log falló (no crítico):', e.message);
    }
}

// ── Registro de nuevo usuario ───────────────────────────────
// Columnas sugeridas en tu Sheet: fecha, uid, nombre, email
export async function logNuevoUsuario(uid, nombre, email) {
    await _log({
        fecha : new Date().toLocaleString('es-MX'),
        uid,
        nombre: nombre || 'Usuario',
        email : email  || '',
        evento: 'nuevo_registro'
    });
}

// ── Registro de nueva publicación ───────────────────────────
// Columnas sugeridas: fecha, uid, autor, tipo, descripcion, mediaUrl
export async function logNuevaPublicacion(uid, autor, tipo, descripcion, mediaUrl) {
    await _log({
        fecha      : new Date().toLocaleString('es-MX'),
        uid,
        autor      : autor       || 'Usuario',
        tipo       : tipo        || 'post',
        descripcion: descripcion || '',
        mediaUrl   : mediaUrl    || '',
        evento     : 'nueva_publicacion'
    });
}

// ── Registro de evento genérico (chats, etc.) ───────────────
// Columnas sugeridas: fecha, uid, tipo, detalle
export async function logEvento(uid, tipo, detalle = '') {
    await _log({
        fecha  : new Date().toLocaleString('es-MX'),
        uid    : uid    || '',
        tipo   : tipo   || 'evento',
        detalle: detalle,
        evento : tipo
    });
}
