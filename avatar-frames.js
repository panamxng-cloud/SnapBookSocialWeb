/**
 * avatar-frames.js — Marcos, auras y partículas en avatares
 * FIXED: replaceWith seguro para evitar romper el DOM y colgar la página
 */

import { db } from './firebase-config.js';
import { ref, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ─── Cache ────────────────────────────────────────────────────────
const _cache   = new Map();
const _pending = new Map();

async function fetchEquipped(uid) {
    if (_cache.has(uid))   return _cache.get(uid);
    if (_pending.has(uid)) return _pending.get(uid);
    const p = get(ref(db, `usuarios/${uid}/avatarShop`))
        .then(s => { const v = s.exists() ? s.val() : null; _cache.set(uid,v); _pending.delete(uid); return v; })
        .catch(()=> { _cache.set(uid,null); _pending.delete(uid); return null; });
    _pending.set(uid, p);
    return p;
}

export async function precargarFrames(uids) {
    const n = [...new Set(uids)].filter(u => u && !_cache.has(u));
    if (!n.length) return;
    await Promise.all(n.map(fetchEquipped));
}
export function invalidarCache(uid) { _cache.delete(uid); }

// ─── Tamaños ──────────────────────────────────────────────────────
const SIZES = { post:44, comment:36, story:56, search:44 };

// ─── Marco SVG ────────────────────────────────────────────────────
function buildFrame(frame, size) {
    const sw = +(3 / size).toFixed(4);
    const r  = 0.47;

    const grads = {
        frame_gold:     `<linearGradient id="fg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f7b731"/><stop offset=".5" stop-color="#ffd700"/><stop offset="1" stop-color="#d4a017"/></linearGradient>`,
        frame_neon:     `<linearGradient id="fg"><stop stop-color="#00f5ff"/></linearGradient>`,
        frame_gradient: `<linearGradient id="fg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#6c63ff"/><stop offset="1" stop-color="#ff6584"/></linearGradient>`,
        frame_rainbow:  `<linearGradient id="fg" x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stop-color="#ff0000"/><stop offset="20%" stop-color="#ff9900"/><stop offset="40%" stop-color="#ffee00"/><stop offset="60%" stop-color="#33cc33"/><stop offset="80%" stop-color="#0099ff"/><stop offset="100%" stop-color="#9933ff"/></linearGradient>`,
        frame_fire:     `<linearGradient id="fg" x1=".5" y1="0" x2=".5" y2="1"><stop stop-color="#ff4500"/><stop offset=".5" stop-color="#ff9800"/><stop offset="1" stop-color="#ffeb3b"/></linearGradient>`,
        frame_ice:      `<linearGradient id="fg" x1=".5" y1="0" x2=".5" y2="1"><stop stop-color="#a8edea"/><stop offset="1" stop-color="#48c6ef"/></linearGradient>`,
        frame_stars:    `<linearGradient id="fg"><stop stop-color="#ffd700"/></linearGradient>`,
        frame_xmas:     `<linearGradient id="fg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e74c3c"/><stop offset="1" stop-color="#2ecc71"/></linearGradient>`,
        frame_hallo:    `<linearGradient id="fg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff6600"/><stop offset="1" stop-color="#1a0033"/></linearGradient>`,
    };
    if (!grads[frame]) return '';

    const dash = {
        frame_rainbow: `stroke-dasharray="${(0.06).toFixed(3)} ${(0.04).toFixed(3)}"`,
        frame_stars:   `stroke-dasharray="${(0.05).toFixed(3)} ${(0.03).toFixed(3)}"`,
        frame_xmas:    `stroke-dasharray="${(0.09).toFixed(3)} ${(0.06).toFixed(3)}"`,
    }[frame] || '';

    const glow = frame === 'frame_neon'
        ? `<filter id="glow"><feGaussianBlur stdDeviation="0.05" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
        : '';
    const filt = frame === 'frame_neon' ? `filter="url(#glow)"` : '';

    return `<svg viewBox="0 0 1 1" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;overflow:visible;"><defs>${grads[frame]}${glow}</defs><circle cx=".5" cy=".5" r="${r}" stroke="url(#fg)" stroke-width="${sw}" ${dash} ${filt}/></svg>`;
}

// ─── Aura ─────────────────────────────────────────────────────────
const AURAS = {
    aura_purple:  'rgba(108,99,255,.6)',
    aura_pink:    'rgba(255,101,132,.6)',
    aura_gold:    'rgba(247,183,49,.65)',
    aura_cyan:    'rgba(0,245,255,.6)',
    aura_fire:    'rgba(255,69,0,.65)',
    aura_ice:     'rgba(168,237,234,.7)',
    aura_rainbow: 'rainbow',
};
function auraStyle(aura) {
    const c = AURAS[aura];
    if (!c) return '';
    if (c === 'rainbow') return 'box-shadow:0 0 8px 3px rgba(255,0,0,.5),0 0 16px 6px rgba(0,255,100,.35),0 0 24px 9px rgba(0,100,255,.3)';
    return `box-shadow:0 0 10px 4px ${c},0 0 22px 8px ${c.replace(/[\d.]+\)$/,'0.2)')}`;
}

// ─── Filtros ──────────────────────────────────────────────────────
const FILTERS = {
    filter_vintage: 'sepia(.6) contrast(1.1)',
    filter_bw:      'grayscale(1) contrast(1.1)',
    filter_neon:    'saturate(2) hue-rotate(20deg) brightness(1.1)',
    filter_warm:    'sepia(.3) saturate(1.4) brightness(1.05)',
    filter_cool:    'hue-rotate(200deg) saturate(1.3)',
    filter_glitch:  'hue-rotate(90deg) saturate(3) contrast(1.3)',
};

// ─── Partículas ───────────────────────────────────────────────────
const FX = {
    fx_hearts:   { e:['❤️','💕','💗'], n:5 },
    fx_stars:    { e:['⭐','✨','💫'], n:5 },
    fx_fire:     { e:['🔥','✨'],       n:5 },
    fx_snow:     { e:['❄️','🌨️'],       n:5 },
    fx_confetti: { e:['🎉','🎊','✨'],  n:6 },
    fx_crowns:   { e:['👑'],             n:3 },
    fx_music:    { e:['🎵','🎶'],        n:5 },
    fx_flowers:  { e:['🌸','🌺','🌼'],  n:5 },
};

// Inyecta keyframes una sola vez
(function(){
    if (typeof document==='undefined'||document.getElementById('avfs')) return;
    const s=document.createElement('style'); s.id='avfs';
    s.textContent=`@keyframes avF{0%{transform:translateY(0) scale(1) rotate(-4deg);opacity:.85}50%{transform:translateY(-4px) scale(1.2) rotate(5deg);opacity:1}100%{transform:translateY(-7px) scale(.95) rotate(-2deg);opacity:.9}}`;
    document.head.appendChild(s);
})();

function buildParticles(fx, size) {
    const cfg = FX[fx];
    if (!cfg) return '';
    const cx     = size / 2;
    const cy     = size / 2;
    const orbitR = size / 2 + 6;
    const ep     = Math.round(size * 0.25);
    return Array.from({length: cfg.n}, (_,i) => {
        const angle = (2*Math.PI*i/cfg.n) - Math.PI/2;
        const left  = Math.round(cx + orbitR*Math.cos(angle) - ep/2);
        const top   = Math.round(cy + orbitR*Math.sin(angle) - ep/2);
        const emoji = cfg.e[i % cfg.e.length];
        const delay = (i*(2/cfg.n)).toFixed(2);
        return `<span style="position:absolute;left:${left}px;top:${top}px;width:${ep}px;height:${ep}px;font-size:${ep}px;line-height:1;text-align:center;animation:avF 2s ease-in-out ${delay}s infinite alternate;pointer-events:none;z-index:4;user-select:none;">${emoji}</span>`;
    }).join('');
}

// ─── Helpers ──────────────────────────────────────────────────────
function _has(e) {
    if (!e) return false;
    return (e.frame &&e.frame!=='frame_none')||
           (e.aura  &&e.aura !=='aura_none') ||
           (e.fx    &&e.fx   !=='fx_none')   ||
           (e.filter&&e.filter!=='filter_none');
}

function _build(src, size, eq, cls, ca) {
    const imgS = [
        'width:100%','height:100%',
        'border-radius:50%',
        'object-fit:cover',
        'display:block',
        'border:none',
        eq.filter&&eq.filter!=='filter_none' ? `filter:${FILTERS[eq.filter]}` : '',
        eq.aura  &&eq.aura  !=='aura_none'   ? auraStyle(eq.aura) : '',
    ].filter(Boolean).join(';');

    const frame  = (eq.frame&&eq.frame!=='frame_none') ? buildFrame(eq.frame,size) : '';
    const parts  = (eq.fx   &&eq.fx   !=='fx_none')    ? buildParticles(eq.fx,size) : '';

    return `<div class="av-frame-wrap ${cls}" style="position:relative;width:${size}px;height:${size}px;flex-shrink:0;overflow:visible;cursor:${ca?'pointer':'default'};" ${ca}><img src="${src}" onerror="this.src='default-avatar.png'" style="${imgS}">${frame}${parts}</div>`;
}

function _plain(src, size, cls, ca) {
    return `<img class="post-avatar ${cls}" src="${src}" onerror="this.src='default-avatar.png'" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;" ${ca}>`;
}

// ─── API pública ──────────────────────────────────────────────────
export async function getAvatarFrameHTML(uid, avatarSrc, context='post', extraClass='', onclick='') {
    const src=avatarSrc||'default-avatar.png', size=SIZES[context]??44, ca=onclick?`onclick="${onclick}"`:'';;
    if (!uid) return _plain(src,size,extraClass,ca);
    const eq=await fetchEquipped(uid);
    return _has(eq) ? _build(src,size,eq,extraClass,ca) : _plain(src,size,extraClass,ca);
}

export function getAvatarFrameHTMLSync(uid, avatarSrc, context='post', extraClass='', onclick='') {
    const src = avatarSrc || 'default-avatar.png';
    const size = SIZES[context] ?? 44;
    const ca = onclick ? `onclick="${onclick}"` : '';

    // Si ya está en cache, responder inmediatamente
    if (uid && _cache.has(uid)) {
        const eq = _cache.get(uid);
        return _has(eq) ? _build(src, size, eq, extraClass, ca) : _plain(src, size, extraClass, ca);
    }

    // No está en cache: devolver imagen simple con data-avuid para actualizar después
    // FIX: el replaceWith se hace de forma segura comprobando que el elemento
    // sigue en el DOM antes de reemplazar, evitando romper el layout de la página.
    if (uid && !_cache.has(uid)) {
        fetchEquipped(uid).then(() => {
            try {
                document.querySelectorAll(`[data-avuid="${uid}"]`).forEach(el => {
                    // Solo reemplazar si el elemento sigue en el DOM
                    if (!el.isConnected) return;
                    // Usar el src actual del elemento (puede haber cambiado)
                    const currentSrc = el.src || src;
                    const eq = _cache.get(uid);
                    const newHTML = _has(eq)
                        ? _build(currentSrc, size, eq, extraClass, ca)
                        : _plain(currentSrc, size, extraClass, ca);
                    const t = document.createElement('div');
                    t.innerHTML = newHTML;
                    const newEl = t.firstChild;
                    if (newEl && el.parentNode) {
                        el.parentNode.replaceChild(newEl, el);
                    }
                });
            } catch(e) {
                // Silenciar errores de DOM para no bloquear la página
                console.warn('avatar-frames replaceWith:', e);
            }
        }).catch(() => {});
    }

    return `<img class="post-avatar ${extraClass}" data-avuid="${uid||''}" src="${src}" onerror="this.src='default-avatar.png'" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;" ${ca}>`;
}
