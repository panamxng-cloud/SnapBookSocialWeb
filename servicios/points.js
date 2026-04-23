/**
 * points.js — Sistema de puntos de actividad de SnapBook
 * ════════════════════════════════════════════════════════
 * Importar en cualquier página:
 *   import { otorgarPuntos, obtenerPuntos, ACCIONES } from './points.js';
 *
 * Uso:
 *   await otorgarPuntos(uid, ACCIONES.CREAR_POST);
 *   await otorgarPuntos(uid, ACCIONES.RECIBIR_LIKE);
 *   const total = await obtenerPuntos(uid);
 */

import { db } from './firebase-config.js';
import { ref, get, set, update, runTransaction, push } from
    "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ── Tabla de acciones y sus puntos ─────────────────────────────────────────
export const ACCIONES = {
    // Contenido
    CREAR_POST:        { key: 'crear_post',        pts: 10,  label: '📝 Post publicado',       limite: 5,  periodo: 'dia'  },
    CREAR_SHORT:       { key: 'crear_short',       pts: 20,  label: '⚡ Short publicado',       limite: 3,  periodo: 'dia'  },
    CREAR_HISTORIA:    { key: 'crear_historia',    pts: 8,   label: '📖 Historia publicada',    limite: 3,  periodo: 'dia'  },
    CREAR_ENCUESTA:    { key: 'crear_encuesta',    pts: 12,  label: '📊 Encuesta publicada',    limite: 2,  periodo: 'dia'  },

    // Interacción
    DAR_LIKE:          { key: 'dar_like',          pts: 2,   label: '❤️ Like dado',             limite: 20, periodo: 'dia'  },
    RECIBIR_LIKE:      { key: 'recibir_like',      pts: 5,   label: '👍 Like recibido',         limite: 50, periodo: 'dia'  },
    COMENTAR:          { key: 'comentar',          pts: 5,   label: '💬 Comentario enviado',    limite: 10, periodo: 'dia'  },
    RECIBIR_COMENTARIO:{ key: 'recibir_comentario',pts: 3,   label: '💬 Comentario recibido',   limite: 30, periodo: 'dia'  },

    // Social
    SEGUIR_USUARIO:    { key: 'seguir_usuario',    pts: 3,   label: '➕ Seguiste a alguien',    limite: 10, periodo: 'dia'  },
    NUEVO_SEGUIDOR:    { key: 'nuevo_seguidor',    pts: 8,   label: '🔔 Nuevo seguidor',        limite: 20, periodo: 'dia'  },

    // Chat
    ENVIAR_MENSAJE:    { key: 'enviar_mensaje',    pts: 1,   label: '✉️ Mensaje enviado',       limite: 30, periodo: 'dia'  },

    // Racha diaria
    LOGIN_DIARIO:      { key: 'login_diario',      pts: 15,  label: '🔥 Conexión diaria',       limite: 1,  periodo: 'dia'  },
    RACHA_3DIAS:       { key: 'racha_3dias',       pts: 30,  label: '🔥🔥 Racha de 3 días',     limite: 1,  periodo: 'semana'},
    RACHA_7DIAS:       { key: 'racha_7dias',       pts: 100, label: '🏆 Racha de 7 días',       limite: 1,  periodo: 'semana'},
};

// ── Niveles (para mostrar en perfil) ───────────────────────────────────────
export const NIVELES = [
    { nivel: 1,  nombre: 'Nuevo',       min: 0,    icono: '🌱' },
    { nivel: 2,  nombre: 'Activo',      min: 100,  icono: '⚡' },
    { nivel: 3,  nombre: 'Social',      min: 300,  icono: '🌟' },
    { nivel: 4,  nombre: 'Popular',     min: 600,  icono: '🔥' },
    { nivel: 5,  nombre: 'Influyente',  min: 1000, icono: '💎' },
    { nivel: 6,  nombre: 'Estrella',    min: 2000, icono: '🏆' },
    { nivel: 7,  nombre: 'Leyenda',     min: 5000, icono: '👑' },
];

export function getNivel(puntos) {
    let nivel = NIVELES[0];
    for (const n of NIVELES) {
        if (puntos >= n.min) nivel = n;
    }
    const idx = NIVELES.indexOf(nivel);
    const siguiente = NIVELES[idx + 1] || null;
    const progreso = siguiente
        ? Math.round(((puntos - nivel.min) / (siguiente.min - nivel.min)) * 100)
        : 100;
    return { ...nivel, siguiente, progreso };
}

// ── Clave de período ────────────────────────────────────────────────────────
function getPeriodoKey(periodo) {
    const now = new Date();
    if (periodo === 'dia') {
        return `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`;
    }
    // semana: lunes de la semana actual
    const day = now.getDay() || 7;
    const lunes = new Date(now); lunes.setDate(now.getDate() - day + 1);
    return `${lunes.getFullYear()}-${lunes.getMonth()+1}-${lunes.getDate()}`;
}

// ── Verificar límite de uso ─────────────────────────────────────────────────
async function puedeOtorgar(uid, accion) {
    if (!accion.limite) return true;
    const periodoKey = getPeriodoKey(accion.periodo);
    const limiteRef = ref(db, `puntos_limite/${uid}/${accion.key}/${periodoKey}`);
    const snap = await get(limiteRef);
    const veces = snap.exists() ? Number(snap.val()) : 0;
    return veces < accion.limite;
}

async function registrarUso(uid, accion) {
    const periodoKey = getPeriodoKey(accion.periodo);
    const limiteRef = ref(db, `puntos_limite/${uid}/${accion.key}/${periodoKey}`);
    const snap = await get(limiteRef);
    const veces = snap.exists() ? Number(snap.val()) : 0;
    await set(limiteRef, veces + 1);
}

// ── Función principal ───────────────────────────────────────────────────────
/**
 * Otorga puntos a un usuario por una acción.
 * @param {string} uid - UID del usuario que recibe los puntos
 * @param {object} accion - Una de las ACCIONES exportadas
 * @param {object} [opts] - Opciones adicionales { silencioso: true }
 * @returns {Promise<{ok: boolean, puntos: number, ganados: number}>}
 */
export async function otorgarPuntos(uid, accion, opts = {}) {
    if (!uid || !accion) return { ok: false, puntos: 0, ganados: 0 };

    try {
        const puede = await puedeOtorgar(uid, accion);
        if (!puede) return { ok: false, puntos: 0, ganados: 0 };

        // Transacción atómica en Firebase
        const puntosRef = ref(db, `usuarios/${uid}/puntos`);
        let nuevoTotal = 0;

        await runTransaction(puntosRef, (current) => {
            nuevoTotal = (current || 0) + accion.pts;
            return nuevoTotal;
        });

        await registrarUso(uid, accion);

        // Historial (últimas 50 entradas)
        await push(ref(db, `puntos_historial/${uid}`), {
            accion: accion.key,
            label:  accion.label,
            pts:    accion.pts,
            ts:     Date.now(),
        });

        // Toast visual si no es silencioso
        if (!opts.silencioso) mostrarToastPuntos(accion.label, accion.pts);

        return { ok: true, puntos: nuevoTotal, ganados: accion.pts };
    } catch (e) {
        console.warn('points.js otorgarPuntos:', e);
        return { ok: false, puntos: 0, ganados: 0 };
    }
}

// ── Obtener puntos actuales ─────────────────────────────────────────────────
export async function obtenerPuntos(uid) {
    if (!uid) return 0;
    try {
        const snap = await get(ref(db, `usuarios/${uid}/puntos`));
        return snap.exists() ? Number(snap.val()) : 0;
    } catch { return 0; }
}

// ── Obtener historial (últimas N) ───────────────────────────────────────────
export async function obtenerHistorial(uid, limite = 20) {
    if (!uid) return [];
    try {
        const snap = await get(ref(db, `puntos_historial/${uid}`));
        if (!snap.exists()) return [];
        const entries = [];
        snap.forEach(c => entries.push(c.val()));
        return entries.sort((a, b) => b.ts - a.ts).slice(0, limite);
    } catch { return []; }
}

// ── Login diario / racha ────────────────────────────────────────────────────
/**
 * Llama esto en onAuthStateChanged de cualquier página.
 * Otorga LOGIN_DIARIO una vez por día y detecta rachas.
 */
export async function checkLoginDiario(uid) {
    if (!uid) return;
    try {
        const hoyKey = getPeriodoKey('dia');
        const rachaRef = ref(db, `puntos_racha/${uid}`);
        const snap = await get(rachaRef);
        const data = snap.exists() ? snap.val() : {};

        const ultimoDia  = data.ultimoDia  || '';
        const diasSeguidos = data.diasSeguidos || 0;

        if (ultimoDia === hoyKey) return; // ya se registró hoy

        // Calcular si la racha continúa (ayer)
        const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
        const ayerKey = `${ayer.getFullYear()}-${ayer.getMonth()+1}-${ayer.getDate()}`;
        const continua = ultimoDia === ayerKey;

        const nuevosD = continua ? diasSeguidos + 1 : 1;

        await update(rachaRef, { ultimoDia: hoyKey, diasSeguidos: nuevosD });
        await otorgarPuntos(uid, ACCIONES.LOGIN_DIARIO);

        // Bonus de racha
        if (nuevosD >= 7 && nuevosD % 7 === 0) {
            await otorgarPuntos(uid, ACCIONES.RACHA_7DIAS);
        } else if (nuevosD >= 3 && nuevosD % 3 === 0) {
            await otorgarPuntos(uid, ACCIONES.RACHA_3DIAS);
        }
    } catch(e) { console.warn('checkLoginDiario:', e); }
}

// ── Toast visual ────────────────────────────────────────────────────────────
function mostrarToastPuntos(label, pts) {
    // Reutiliza el toast existente si está en el DOM, si no crea uno propio
    let t = document.getElementById('toast-puntos');
    if (!t) {
        t = document.createElement('div');
        t.id = 'toast-puntos';
        t.style.cssText = [
            'position:fixed', 'bottom:110px', 'left:50%',
            'transform:translateX(-50%) translateY(20px)',
            'background:linear-gradient(135deg,#6c63ff,#ff6584)',
            'color:#fff', 'border-radius:30px',
            'padding:10px 20px', 'font-size:13px', 'font-weight:700',
            'z-index:99999', 'box-shadow:0 4px 20px rgba(108,99,255,0.4)',
            'opacity:0', 'transition:all 0.3s', 'pointer-events:none',
            'white-space:nowrap', 'font-family:inherit',
        ].join(';');
        document.body.appendChild(t);
    }
    t.textContent = `${label}  +${pts} ⭐`;
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateX(-50%) translateY(20px)';
    }, 2500);
}
