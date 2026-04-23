// ═══════════════════════════════════════════════════════════════════
// shorts.js — SnapBook  (ES Module)
// ═══════════════════════════════════════════════════════════════════

import { auth } from '../servicios/firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
  obtenerShorts,
  toggleLikeShort,
  obtenerComentariosShort,
  agregarComentarioShort,
  crearShort,
  seguirUsuario,
  dejarDeSeguir,
  esSeguidor,
} from '../servicios/db.js';
import { uploadShort } from '../servicios/supabase-config.js';

// ─── STATE ───────────────────────────────────────────────────────────
let currentUser   = null;
let shortsData    = [];
let activeShortId = null;
let likedShorts   = new Set();
let followingSet  = new Set();
let uploadVideoFile = null;

// ─── UTILS ───────────────────────────────────────────────────────────
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'sh-toast';
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000)    return 'Hace un momento';
  if (d < 3600000)  return `Hace ${Math.floor(d/60000)} min`;
  if (d < 86400000) return `Hace ${Math.floor(d/3600000)} h`;
  return new Date(ts).toLocaleDateString('es', { day: '2-digit', month: 'short' });
}

function avatarHTML(url, name = '?') {
  if (url) return `<img src="${url}" alt="${name}" style="width:100%;height:100%;object-fit:cover">`;
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const hue      = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `<div style="width:100%;height:100%;background:hsl(${hue},50%,55%);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px">${initials}</div>`;
}

// ─── AUTH ────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) { location.href = 'index.html'; return; }
  currentUser = user;
  window.__snapbookUser = user;

  const av = document.getElementById('commentInputAvatar');
  if (av) av.src = user.photoURL || '';

  await loadShorts();
});

// ─── LOAD SHORTS ─────────────────────────────────────────────────────
async function loadShorts() {
  try {
    shortsData = await obtenerShorts(50);

    // Remove skeleton
    document.getElementById('skel-s1')?.remove();

    const feed = document.getElementById('shortsFeed');

    if (!shortsData.length) {
      feed.innerHTML = `
        <div class="sh-item" style="display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px">
          <svg viewBox="0 0 24 24" style="width:64px;height:64px;fill:rgba(255,255,255,.3)">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
          </svg>
          <p style="color:rgba(255,255,255,.5);font-size:16px">No hay shorts aún</p>
        </div>`;
      return;
    }

    shortsData.forEach(short => feed.appendChild(buildShortItem(short)));
    initIntersectionObserver();
  } catch (e) {
    console.error('loadShorts:', e);
    document.getElementById('skel-s1')?.remove();
    toast('Error al cargar shorts');
  }
}

// ─── BUILD SHORT ITEM ─────────────────────────────────────────────────
function buildShortItem(short) {
  const item = document.createElement('div');
  item.className = 'sh-item';
  item.id        = `short-${short.id}`;

  const isLiked    = likedShorts.has(short.id);
  const isFollowing = followingSet.has(short.uid);

  item.innerHTML = `
    <!-- VIDEO -->
    <video class="sh-video" src="${short.video_url}" loop muted playsinline preload="metadata"></video>

    <!-- OVERLAYS -->
    <div class="sh-overlay-top"></div>
    <div class="sh-overlay-bottom"></div>

    <!-- TAP INDICATOR -->
    <div class="sh-play-indicator" id="pi-${short.id}">
      <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
    </div>

    <!-- INFO (left) -->
    <div class="sh-info">
      <div class="sh-author-row">
        <div class="sh-author-avatar"
             onclick="location.href='Profile.html?uid=${short.uid}'"
             style="cursor:pointer">
          ${avatarHTML(short.avatar, short.autor)}
        </div>
        <span class="sh-author-name"
              onclick="location.href='Profile.html?uid=${short.uid}'"
              style="cursor:pointer">${short.autor}</span>
        ${short.uid !== currentUser?.uid ? `
          <button class="sh-follow-btn${isFollowing ? ' following' : ''}"
                  data-action="follow" data-uid="${short.uid}" data-shortid="${short.id}">
            ${isFollowing ? 'Siguiendo' : '+ Seguir'}
          </button>` : ''}
      </div>
      <div class="sh-desc" id="desc-${short.id}">${short.descripcion || ''}</div>
      ${(short.descripcion?.length ?? 0) > 80
        ? `<button class="sh-desc-more" data-action="expand-desc" data-id="${short.id}">Ver más</button>`
        : ''}
    </div>

    <!-- ACTIONS (right) -->
    <div class="sh-actions">

      <!-- Like -->
      <div class="sh-action">
        <button class="sh-action-btn${isLiked ? ' liked' : ''}"
                data-action="like" data-shortid="${short.id}">
          <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        </button>
        <span class="sh-action-count" id="likes-${short.id}">${short.total_likes || 0}</span>
      </div>

      <!-- Comment -->
      <div class="sh-action">
        <button class="sh-action-btn" data-action="comment" data-shortid="${short.id}">
          <svg viewBox="0 0 24 24"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg>
        </button>
        <span class="sh-action-count" id="comments-${short.id}">${short.total_comentarios || 0}</span>
      </div>

      <!-- Share -->
      <div class="sh-action">
        <button class="sh-action-btn" data-action="share" data-shortid="${short.id}">
          <svg viewBox="0 0 24 24"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
        </button>
      </div>

      <!-- Sound disk -->
      <div class="sh-action">
        <div class="sh-sound-icon">
          ${short.avatar
            ? `<img src="${short.avatar}" alt="">`
            : `<div style="width:100%;height:100%;background:linear-gradient(135deg,#667eea,#764ba2)"></div>`}
        </div>
      </div>

      <!-- Mute button -->
      <div class="sh-action">
        <button class="sh-mute-btn" data-action="mute" style="background:rgba(0,0,0,.5);border:none;border-radius:50%;width:44px;height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
          <svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:#fff">
            <path class="sh-mute-icon" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
          </svg>
        </button>
        <span style="color:#fff;font-size:11px;margin-top:4px">Sonido</span>
      </div>

    </div>

    <!-- PROGRESS -->
    <div class="sh-progress">
      <div class="sh-progress-fill" id="prog-${short.id}" style="width:0%"></div>
    </div>
  `;

  // ── Tap to play/pause ──────────────────────────────────────────────
  const video = item.querySelector('.sh-video');
  const pi    = item.querySelector('.sh-play-indicator');

  // ── Mute/Unmute ────────────────────────────────────────────────────
  const muteBtn = item.querySelector('.sh-mute-btn');
  if (muteBtn) {
    muteBtn.addEventListener('click', e => {
      e.stopPropagation();
      video.muted = !video.muted;
      const path = muteBtn.querySelector('.sh-mute-icon');
      if (video.muted) {
        path.setAttribute('d', 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z');
      } else {
        path.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM18.5 12c0-2.77-1.5-5.18-3.76-6.5v13c2.26-1.32 3.76-3.73 3.76-6.5z');
      }
    });
  }

  item.addEventListener('click', e => {
    // Don't toggle play when clicking action buttons
    if (e.target.closest('[data-action]') || e.target.closest('.sh-author-name') ||
        e.target.closest('.sh-author-avatar')) return;
    if (video.paused) {
      video.play();
      pi.querySelector('svg path').setAttribute('d', 'M6 19h4V5H6v14zm8-14v14h4V5h-4z');
    } else {
      video.pause();
      pi.querySelector('svg path').setAttribute('d', 'M8 5v14l11-7z');
    }
    pi.classList.add('show');
    setTimeout(() => pi.classList.remove('show'), 600);
  });

  // Progress bar
  video.addEventListener('timeupdate', () => {
    if (!video.duration) return;
    const pct = (video.currentTime / video.duration) * 100;
    document.getElementById(`prog-${short.id}`)?.style.setProperty('width', `${pct}%`);
  });

  // ── Delegate actions ──────────────────────────────────────────────
  item.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, shortid, uid } = btn.dataset;

    if (action === 'like')        await handleLike(shortid, btn);
    if (action === 'comment')     openCommentSheet(shortid);
    if (action === 'share')       handleShare(shortid);
    if (action === 'follow')      await handleFollow(uid, shortid, btn);
    if (action === 'expand-desc') {
      const desc = document.getElementById(`desc-${btn.dataset.id}`);
      desc?.classList.add('expanded');
      btn.remove();
    }
  });

  return item;
}

// ─── INTERSECTION OBSERVER (autoplay) ────────────────────────────────
function initIntersectionObserver() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const video = entry.target.querySelector('.sh-video');
      if (!video) return;
      if (entry.isIntersecting) {
        video.play().catch(() => {});
      } else {
        video.pause();
        video.currentTime = 0;
      }
    });
  }, { threshold: 0.6 });

  document.querySelectorAll('.sh-item').forEach(item => observer.observe(item));
}

// ─── LIKE ─────────────────────────────────────────────────────────────
async function handleLike(shortId, btn) {
  if (!currentUser) return;
  const wasLiked = btn.classList.contains('liked');
  btn.classList.toggle('liked');
  const countEl = document.getElementById(`likes-${shortId}`);
  countEl.textContent = Math.max(0, Number(countEl.textContent) + (wasLiked ? -1 : 1));
  if (wasLiked) likedShorts.delete(shortId);
  else          likedShorts.add(shortId);
  try {
    await toggleLikeShort(shortId, currentUser.uid);
  } catch { toast('Error al dar like'); }
}

// ─── SHARE ────────────────────────────────────────────────────────────
function handleShare(shortId) {
  const url = `${location.origin}${location.pathname.replace('shorts.html','short.html')}?id=${shortId}`;
  if (navigator.share) navigator.share({ title: 'SnapBook Short', url }).catch(() => {});
  else navigator.clipboard.writeText(url).then(() => toast('Enlace copiado ✓')).catch(() => {});
}

// ─── FOLLOW ───────────────────────────────────────────────────────────
async function handleFollow(uid, shortId, btn) {
  if (!currentUser || uid === currentUser.uid) return;
  const isNowFollowing = followingSet.has(uid);
  try {
    if (isNowFollowing) {
      await dejarDeSeguir(uid, currentUser.uid);
      followingSet.delete(uid);
      btn.textContent = '+ Seguir';
      btn.classList.remove('following');
    } else {
      await seguirUsuario(uid, currentUser.uid);
      followingSet.add(uid);
      btn.textContent = 'Siguiendo';
      btn.classList.add('following');
    }
  } catch { toast('Error'); }
}

// ─── COMMENT SHEET ───────────────────────────────────────────────────
function openCommentSheet(shortId) {
  activeShortId = shortId;
  document.getElementById('commentSheet').classList.add('open');
  document.getElementById('commentList').innerHTML =
    '<div class="sh-sheet-empty">Cargando…</div>';
  obtenerComentariosShort(shortId, 50)
    .then(renderComments)
    .catch(() => {
      document.getElementById('commentList').innerHTML =
        '<div class="sh-sheet-empty">Error al cargar</div>';
    });
}

function renderComments(comments) {
  const list = document.getElementById('commentList');
  if (!comments.length) {
    list.innerHTML = '<div class="sh-sheet-empty">Sin comentarios aún. ¡Sé el primero!</div>';
    return;
  }
  list.innerHTML = comments.map(c => `
    <div class="sh-comment-item">
      <div class="sh-comment-item-avatar">${avatarHTML(c.avatar, c.nombre)}</div>
      <div>
        <div class="sh-comment-bubble">
          <div class="sh-comment-bubble-author">${c.nombre || 'Usuario'}</div>
          <div class="sh-comment-bubble-text">${c.texto}</div>
        </div>
        <div class="sh-comment-meta">
          <span>${timeAgo(c.timestamp)}</span>
          <button>Me gusta</button>
          <button>Responder</button>
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('commentSheet').addEventListener('click', e => {
  if (e.target === document.getElementById('commentSheet'))
    document.getElementById('commentSheet').classList.remove('open');
});

document.getElementById('commentInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendComment();
});

document.getElementById('commentSendBtn').addEventListener('click', sendComment);

async function sendComment() {
  if (!activeShortId || !currentUser) return;
  const input = document.getElementById('commentInput');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';
  try {
    await agregarComentarioShort(activeShortId, currentUser, text);
    const countEl = document.getElementById(`comments-${activeShortId}`);
    if (countEl) countEl.textContent = Number(countEl.textContent) + 1;
    const comments = await obtenerComentariosShort(activeShortId, 50);
    renderComments(comments);
  } catch { toast('Error al comentar'); }
}

// ─── UPLOAD SHORT ─────────────────────────────────────────────────────
document.getElementById('uploadShortBtn').addEventListener('click', () => {
  document.getElementById('uploadSheet').classList.add('open');
});

document.getElementById('uploadSheet').addEventListener('click', e => {
  if (e.target === document.getElementById('uploadSheet'))
    document.getElementById('uploadSheet').classList.remove('open');
});

// Select video
document.getElementById('shortDropzone').addEventListener('click', () => {
  document.getElementById('shortVideoInput').click();
});

document.getElementById('shortVideoInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  uploadVideoFile = file;
  const url = URL.createObjectURL(file);
  document.getElementById('shortPreviewVideo').src = url;
  document.getElementById('shortDropzone').style.display    = 'none';
  document.getElementById('shortPreviewWrap').style.display = 'block';
  document.getElementById('shortPublishBtn').disabled       = false;
  document.getElementById('shortPublishBtn').style.opacity  = '1';
});

document.getElementById('shortPublishBtn').addEventListener('click', async () => {
  if (!uploadVideoFile || !currentUser) return;
  const btn = document.getElementById('shortPublishBtn');
  btn.disabled = true; btn.textContent = 'Subiendo…';
  const progWrap = document.getElementById('shortProgress');
  const progFill = document.getElementById('shortProgressFill');
  progWrap.style.display = 'block';

  try {
    const desc   = document.getElementById('shortDescription').value.trim();
    const url    = await uploadShort(currentUser.uid, uploadVideoFile, p => {
      progFill.style.width = `${p}%`;
    });
    progFill.style.width = '80%';
    await crearShort(currentUser, { videoUrl: url, descripcion: desc });
    progFill.style.width = '100%';
    toast('✓ Short publicado');

    // Reset upload sheet
    uploadVideoFile = null;
    document.getElementById('shortVideoInput').value        = '';
    document.getElementById('shortPreviewVideo').src        = '';
    document.getElementById('shortDropzone').style.display  = '';
    document.getElementById('shortPreviewWrap').style.display = 'none';
    document.getElementById('shortDescription').value       = '';
    document.getElementById('uploadSheet').classList.remove('open');

    // Reload feed
    document.getElementById('shortsFeed').innerHTML = `
      <div class="sh-skeleton" id="skel-s1">
        <div class="sh-skel-bg"></div>
        <div class="sh-skel-info">
          <div class="sh-skel-line" style="width:60%"></div>
          <div class="sh-skel-line" style="width:40%"></div>
        </div>
      </div>`;
    await loadShorts();
  } catch (e) {
    toast('Error al subir: ' + e.message);
    btn.disabled = false; btn.textContent = 'Publicar Short';
    progWrap.style.display = 'none';
  }
});
