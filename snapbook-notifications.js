// snapbook-notifications.js
// Coloca este archivo en la raíz de tu proyecto junto a firebase-config.js
// Importa desde cualquier página con: import { initPush, sendPushNotif } from './snapbook-notifications.js';

import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";
import { ref, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const VAPID_KEY = "BNBo_z8LDmkfqMleBAl7sh-n86o29YQQq0y1-GDJ4vu2aoZE-j6Rx_PgX4eFgDDCYG1VEqhPT5hWxXg0G7Klea8";

/**
 * Inicializa push notifications para el usuario actual.
 * Llama esto después de que el usuario esté autenticado.
 * @param {object} app - Firebase App instance
 * @param {object} db  - Firebase Database instance
 * @param {string} uid - UID del usuario autenticado
 */
export async function initPush(app, db, uid) {
    try {
        // Registrar service worker
        const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        const messaging = getMessaging(app);

        // Pedir permiso — con timeout para evitar que se congele si el navegador no responde
        const permission = await Promise.race([
            Notification.requestPermission(),
            new Promise(resolve => setTimeout(() => resolve('timeout'), 5000))
        ]);
        if (permission !== 'granted') {
            console.log('Permiso de notificaciones denegado o sin respuesta:', permission);
            return null;
        }

        // Obtener FCM token — con timeout por si el SW no responde
        const token = await Promise.race([
            getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('getToken timeout')), 8000))
        ]);

        if (token) {
            // Guardar token en Firebase para poder enviar notifs a este dispositivo
            await update(ref(db, `fcm_tokens/${uid}`), {
                [token.substring(0, 50)]: { token, updatedAt: Date.now() }
            });
            console.log('FCM token registrado ✅');
        }

        // Manejar notificaciones con app en primer plano (foreground)
        onMessage(messaging, payload => {
            const { title, body } = payload.notification || {};
            showInAppNotif(title || 'SnapBook', body || 'Nueva notificación');
        });

        return token;
    } catch (err) {
        console.warn('Push notifications no disponibles:', err.message);
        return null;
    }
}

/**
 * Muestra un banner de notificación dentro de la app (foreground).
 */
function showInAppNotif(title, body) {
    let banner = document.getElementById('sb-push-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'sb-push-banner';
        banner.style.cssText = `
            position: fixed; top: 76px; left: 12px; right: 12px; z-index: 9998;
            background: var(--surface, #fff); border: 1px solid var(--border, #dde1e7);
            border-radius: 18px; padding: 12px 16px; display: flex; gap: 12px;
            align-items: center; box-shadow: 0 8px 32px rgba(0,0,0,0.18);
            transform: translateY(-120%); transition: transform 0.4s cubic-bezier(.4,0,.2,1);
            cursor: pointer; font-family: 'Plus Jakarta Sans', sans-serif;`;
        banner.innerHTML = `
            <img src="/icon-192.png" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'">
            <div style="flex:1;min-width:0">
                <div id="sb-pbn-title" style="font-size:14px;font-weight:700;color:var(--text,#050505)"></div>
                <div id="sb-pbn-body"  style="font-size:13px;color:var(--text-muted,#65676b);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
            </div>
            <i class="fa-solid fa-xmark" style="color:var(--text-muted,#65676b);font-size:16px;flex-shrink:0"></i>`;
        banner.onclick = () => hideBanner();
        document.body.appendChild(banner);
    }

    document.getElementById('sb-pbn-title').textContent = title;
    document.getElementById('sb-pbn-body').textContent  = body;

    // Mostrar
    requestAnimationFrame(() => { banner.style.transform = 'translateY(0)'; });

    // Auto-ocultar tras 4 seg
    clearTimeout(banner._t);
    banner._t = setTimeout(hideBanner, 4000);

    function hideBanner() {
        banner.style.transform = 'translateY(-120%)';
    }
}

/**
 * Envía una notificación push a un usuario específico vía Firebase Function (cloud).
 * Requiere que tengas una Cloud Function deployada. Esta función solo guarda
 * la notificación en DB; la Cloud Function la procesa y envía el FCM.
 * 
 * @param {object} db
 * @param {string} toUid    - UID del destinatario
 * @param {string} fromName - Nombre del emisor
 * @param {string} type     - 'like' | 'comment' | 'follow' | 'message'
 * @param {object} extra    - datos adicionales (preview, postId, etc.)
 */
export async function sendPushNotif(db, toUid, fromName, type, extra = {}) {
    if (!toUid) return;
    const messages = {
        like:    `${fromName} le dio Me gusta a tu publicación`,
        comment: `${fromName} comentó en tu publicación`,
        follow:  `${fromName} comenzó a seguirte`,
        message: `${fromName} te envió un mensaje`
    };
    try {
        await update(ref(db, `push_queue/${toUid}/${Date.now()}`), {
            type, fromName, message: messages[type] || `${fromName} interactuó contigo`,
            timestamp: Date.now(), processed: false, ...extra
        });
    } catch (e) {
        console.warn('No se pudo encolar notificación push:', e.message);
    }
}
