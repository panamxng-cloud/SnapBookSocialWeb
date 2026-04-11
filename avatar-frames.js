/**
 * avatar-frames.js — Aplica marcos/auras/efectos de la tienda en avatares del feed
 */

import { db } from './firebase-config.js';
import { ref, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const _cache   = new Map();
const _pending = new Map();

async function fetchEquipped(uid) {
    if (_cache.has(uid))   return _cache.get(uid);
    if (_pending.has(uid)) return _pending.get(uid);
    const promise = get(ref(db, `usuarios/${uid}/avatarShop`)).then(snap => {
        const val = snap.exists() ? snap.val() : null;
        _cache.set(uid, val); _pending.delete(uid); return val;
    }).catch(() => { _cache.set(uid, null); _pending.delete(uid); return null; });
    _pending.set(uid, promise);
    return promise;
}

export async function precargarFrames(uids) {
    const nuevos = [...new Set(uids)].filter(u => u && !_cache.has(u));
    if (!nuevos.length) return;
    await Promise.all(nuevos.map(uid => fetchEquipped(uid)));
}

export function invalidarCache(uid) { _cache.delete(uid); }

const FRAME_RENDERS = {
    frame_none:     () => '',
    frame_gold:     () => `<circle cx="22" cy="22" r="20" stroke="url(#fGold)" stroke-width="2.5" fill="none"/><defs><linearGradient id="fGold" x1="0" y1="0" x2="44" y2="44" gradientUnits="userSpaceOnUse"><stop stop-color="#f7b731"/><stop offset=".5" stop-color="#ffd700"/><stop offset="1" stop-color="#d4a017"/></linearGradient></defs>`,
    frame_neon:     () => `<circle cx="22" cy="22" r="20" stroke="#00f5ff" stroke-width="2" fill="none" filter="url(#fglow)"/><defs><filter id="fglow"><feGaussianBlur stdDeviation="2" result="cb"/><feMerge><feMergeNode in="cb"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`,
    frame_gradient: () => `<circle cx="22" cy="22" r="20" stroke="url(#fGrad)" stroke-width="2.5" fill="none"/><defs><linearGradient id="fGrad" x1="0" y1="0" x2="44" y2="44" gradientUnits="userSpaceOnUse"><stop stop-color="#6c63ff"/><stop offset="1" stop-color="#ff6584"/></linearGradient></defs>`,
    frame_rainbow:  () => `<circle cx="22" cy="22" r="20" stroke="url(#fRain)" stroke-width="2.5" fill="none" stroke-dasharray="4 3"/><defs><linearGradient id="fRain" x1="0" y1="44" x2="44" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ff0000"/><stop offset="20%" stop-color="#ff9900"/><stop offset="40%" stop-color="#ffee00"/><stop offset="60%" stop-color="#33cc33"/><stop offset="80%" stop-color="#0099ff"/><stop offset="100%" stop-color="#9933ff"/></linearGradient></defs>`,
    frame_fire:     () => `<circle cx="22" cy="22" r="20" stroke="url(#fFire)" stroke-width="2.5" fill="none"/><defs><linearGradient id="fFire" x1="22" y1="0" x2="22" y2="44" gradientUnits="userSpaceOnUse"><stop stop-color="#ff4500"/><stop offset=".5" stop-color="#ff9800"/><stop offset="1" stop-color="#ffeb3b"/></linearGradient></defs>`,
    frame_ice:      () => `<circle cx="22" cy="22" r="20" stroke="url(#fIce)" stroke-width="2.5" fill="none"/><defs><linearGradient id="fIce" x1="22" y1="0" x2="22" y2="44" gradientUnits="userSpaceOnUse"><stop stop-color="#a8edea"/><stop offset="1" stop-color="#48c6ef"/></linearGradient></defs>`,
    frame_stars:    () => `<circle cx="22" cy="22" r="20" stroke="#ffd700" stroke-width="1.5" fill="none" stroke-dasharray="3 2"/>`,
    frame_xmas:     () => `<circle cx="22" cy="22" r="20" stroke="url(#fXmas)" stroke-width="2.5" fill="none" stroke-dasharray="6 4"/><defs><linearGradient id="fXmas" x1="0" y1="0" x2="44" y2="44" gradientUnits="userSpaceOnUse"><stop stop-color="#e74c3c"/><stop offset="1" stop-color="#2ecc71"/></linearGradient></defs>`,
    frame_hallo:    () => `<circle cx="22" cy="22" r="20" stroke="url(#fHallo)" stroke-width="2.5" fill="none"/><defs><linearGradient id="fHallo" x1="0" y1="0" x2="44" y2="44" gradientUnits="userSpaceOnUse"><stop stop-color="#ff6600"/><stop offset="1" stop-color="#1a0033"/></linearGradient></defs>`,
};

const AURA_COLORS = {
    aura_none:    null,
    aura_purple:  'rgba(108,99,255,0.5)',
    aura_pink:    'rgba(255,101,132,0.5)',
    aura_gold:    'rgba(247,183,49,0.55)',
    aura_cyan:    'rgba(0,245,255,0.5)',
    aura_fire:    'rgba(255,69,0,0.55)',
    aura_ice:     'rgba(168,237,234,0.6)',
    aura_rainbow: 'rainbow',
};

const FILTER_MAP = {
    filter_none:    '',
    filter_vintage: 'sepia(0.6) contrast(1.1)',
    filter_bw:      'grayscale(1) contrast(1.1)',
    filter_neon:    'saturate(2) hue-rotate(20deg) brightness(1.1)',
    filter_warm:    'sepia(0.3) saturate(1.4) brightness(1.05)',
    filter_cool:    'hue-rotate(200deg) saturate(1.3)',
    filter_glitch:  'hue-rotate(90deg) saturate(3) contrast(1.3)',
};

const SIZES = {
    post:    { wrap: 44, vb: 44 },
    comment: { wrap: 36, vb: 44 },
    story:   { wrap: 56, vb: 44 },
    search:  { wrap: 44, vb: 44 },
};

const FX_PARTICLES = {
    fx_hearts:   { emojis: ['❤️','💕','💗'], count: 4 },
    fx_stars:    { emojis: ['⭐','✨','💫'], count: 4 },
    fx_fire:     { emojis: ['🔥','✨'],       count: 4 },
    fx_snow:     { emojis: ['❄️','🌨️'],       count: 4 },
    fx_confetti: { emojis: ['🎉','🎊','✨'],  count: 5 },
    fx_crowns:   { emojis: ['👑'],             count: 3 },
    fx_music:    { emojis: ['🎵','🎶'],        count: 4 },
    fx_flowers:  { emojis: ['🌸','🌺','🌼'],  count: 4 },
};

// Inyectar animación av-float una sola vez
(function() {
    if (typeof document === 'undefined' || document.getElementById('av-frame-styles')) return;
    const s = document.createElement('style');
    s.id = 'av-frame-styles';
    s.textContent = '@keyframes av-float{0%{transform:translateY(0) scale(1)}100%{transform:translateY(-5px) scale(1.15)}}';
    document.head.appendChild(s);
})();

function buildFxParticles(fx, wrapSize) {
    const cfg = FX_PARTICLES[fx];
    if (!cfg) return '';
    const r = wrapSize / 2;
    return Array.from({ length: cfg.count }, (_, i) => {
        const angle = (i / cfg.count) * Math.PI * 2;
        const x     = Math.round(r + (r + 4) * Math.cos(angle) - 7);
        const y     = Math.round(r + (r + 4) * Math.sin(angle) - 7);
        const emoji = cfg.emojis[i % cfg.emojis.length];
        const delay = (i * 0.3).toFixed(1);
        return `<span style="position:absolute;left:${x}px;top:${y}px;font-size:11px;line-height:1;animation:av-float 2.4s ease-in-out ${delay}s infinite alternate;pointer-events:none;z-index:3;">${emoji}</span>`;
    }).join('');
}

function _hasEquipped(e) {
    if (!e) return false;
    return (e.frame && e.frame !== 'frame_none') ||
           (e.aura  && e.aura  !== 'aura_none')  ||
           (e.fx    && e.fx    !== 'fx_none')     ||
           (e.filter&& e.filter!== 'filter_none');
}

function _buildWrapper(src, size, equipped, extraClass, clickAttr) {
    const filterCSS = FILTER_MAP[equipped.filter] || '';
    const auraColor = AURA_COLORS[equipped.aura]  || null;
    let boxShadow = '';
    if (auraColor === 'rainbow') {
        boxShadow = '0 0 10px 4px rgba(255,0,0,0.4),0 0 16px 6px rgba(0,255,100,0.3),0 0 22px 8px rgba(0,100,255,0.25)';
    } else if (auraColor) {
        boxShadow = `0 0 10px 5px ${auraColor},0 0 20px 8px ${auraColor.replace(/[\d.]+\)$/, '0.18)')}`;
    }
    const frameSVG = (FRAME_RENDERS[equipped.frame] || (() => ''))();
    const fxHTML   = buildFxParticles(equipped.fx, size.wrap);
    const overflow = fxHTML ? 'visible' : 'hidden';

    return `<div class="av-frame-wrap ${extraClass}" style="position:relative;width:${size.wrap}px;height:${size.wrap}px;flex-shrink:0;overflow:${overflow};cursor:${clickAttr?'pointer':'default'};" ${clickAttr}><img src="${src}" onerror="this.src='default-avatar.png'" style="width:${size.wrap}px;height:${size.wrap}px;border-radius:50%;object-fit:cover;display:block;${filterCSS?`filter:${filterCSS};`:''}${boxShadow?`box-shadow:${boxShadow};`:''}">${frameSVG ? `<svg viewBox="0 0 ${size.vb} ${size.vb}" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;inset:-2px;width:calc(100% + 4px);height:calc(100% + 4px);pointer-events:none;z-index:2;">${frameSVG}</svg>` : ''}${fxHTML}</div>`;
}

export async function getAvatarFrameHTML(uid, avatarSrc, context = 'post', extraClass = '', onclick = '') {
    const src       = avatarSrc || 'default-avatar.png';
    const size      = SIZES[context] || SIZES.post;
    const clickAttr = onclick ? `onclick="${onclick}"` : '';
    if (!uid) return `<img class="post-avatar ${extraClass}" src="${src}" onerror="this.src='default-avatar.png'" style="width:${size.wrap}px;height:${size.wrap}px;border-radius:50%;object-fit:cover;" ${clickAttr}>`;
    const equipped = await fetchEquipped(uid);
    if (!_hasEquipped(equipped)) return `<img class="post-avatar ${extraClass}" src="${src}" onerror="this.src='default-avatar.png'" style="width:${size.wrap}px;height:${size.wrap}px;border-radius:50%;object-fit:cover;" ${clickAttr}>`;
    return _buildWrapper(src, size, equipped, extraClass, clickAttr);
}

export function getAvatarFrameHTMLSync(uid, avatarSrc, context = 'post', extraClass = '', onclick = '') {
    const src       = avatarSrc || 'default-avatar.png';
    const size      = SIZES[context] || SIZES.post;
    const clickAttr = onclick ? `onclick="${onclick}"` : '';

    if (!uid || !_cache.has(uid)) {
        if (uid && !_cache.has(uid)) {
            fetchEquipped(uid).then(() => {
                document.querySelectorAll(`[data-avuid="${uid}"]`).forEach(el => {
                    const tmp = document.createElement('div');
                    tmp.innerHTML = getAvatarFrameHTMLSync(uid, avatarSrc, context, extraClass, onclick);
                    if (tmp.firstChild) el.replaceWith(tmp.firstChild);
                });
            }).catch(() => {});
        }
        return `<img class="post-avatar ${extraClass}" data-avuid="${uid || ''}" src="${src}" onerror="this.src='default-avatar.png'" style="width:${size.wrap}px;height:${size.wrap}px;border-radius:50%;object-fit:cover;" ${clickAttr}>`;
    }

    const equipped = _cache.get(uid);
    if (!_hasEquipped(equipped)) return `<img class="post-avatar ${extraClass}" src="${src}" onerror="this.src='default-avatar.png'" style="width:${size.wrap}px;height:${size.wrap}px;border-radius:50%;object-fit:cover;" ${clickAttr}>`;
    return _buildWrapper(src, size, equipped, extraClass, clickAttr);
}
