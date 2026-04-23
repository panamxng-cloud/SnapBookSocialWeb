// ═══════════════════════════════════════════════════════════════════
// Home.js — SnapBook Social  (ES Module)
// ═══════════════════════════════════════════════════════════════════

import { auth } from '../servicios/firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
  obtenerFeedCompleto,
  obtenerHistorias,
  obtenerComentarios,
  agregarComentario,
  toggleLike,
  misLikes,
  sincronizarUsuario,
  obtenerSeguidos,
  seguirUsuario,
  dejarDeSeguir,
  esSeguidor,
  crearHistoria,
  eliminarPost,
} from '../servicios/db.js';
import { uploadPostImage } from '../servicios/supabase-config.js';

// ─── STATE ───────────────────────────────────────────────────────────
let currentUser   = null;
let activePosts   = [];
let activePostId  = null;   // post abierto en el sheet de comentarios
let likedSet      = new Set();

// Story viewer state
let storyGroups   = [];
let storyGroupIdx = 0;
let storyItemIdx  = 0;
let storyTimer    = null;

// ─── UTILIDADES ──────────────────────────────────────────────────────

/** Muestra un toast temporal en la pantalla */
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/** Convierte un timestamp a texto relativo */
function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60_000)    return 'Hace un momento';
  if (d < 3_600_000) return `Hace ${Math.floor(d / 60_000)} min`;
  if (d < 86_400_000)return `Hace ${Math.floor(d / 3_600_000)} h`;
  return new Date(ts).toLocaleDateString('es', { day: '2-digit', month: 'short' });
}

/** Genera HTML de avatar (imagen o iniciales con color) */
function avatarHTML(url, name = '?') {
  if (url) {
    return `<img src="${url}" onerror="this.src=''" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="${name}">`;
  }
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const hue      = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `<div style="width:100%;height:100%;border-radius:50%;background:hsl(${hue},50%,55%);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px">${initials}</div>`;
}

// ─── AUTH ────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) { location.href = 'index.html'; return; }

  currentUser = user;
  window.__snapbookUser = user;   // requerido por db.js para getUID()

  // Actualizar UI de composición
  const composeAv = document.getElementById('composeAvatar');
  composeAv.src = user.photoURL || '';
  if (!user.photoURL) composeAv.style.background = '#e4e6eb';

  document.getElementById('composeName').textContent =
    user.displayName?.split(' ')[0] || 'amigo';

  const commentAv = document.getElementById('commentInputAvatar');
  if (commentAv) commentAv.src = user.photoURL || '';

  // Sincronizar usuario en Turso y cargar contenido
  await sincronizarUsuario(user).catch(() => {});
  await Promise.all([loadStories(), loadFeed()]);
});

// ─── STORIES ─────────────────────────────────────────────────────────
async function loadStories() {
  try {
    const historias = await obtenerHistorias();

    // Agrupar por uid
    const map = {};
    historias.forEach(h => {
      if (!map[h.uid]) map[h.uid] = { uid: h.uid, autor: h.autor, avatar: h.avatar, items: [] };
      map[h.uid].items.push(h);
    });
    storyGroups = Object.values(map);

    const container = document.getElementById('storiesContainer');
    const addBtn    = container.querySelector('.story-add');
    container.innerHTML = '';
    container.appendChild(addBtn);

    storyGroups.forEach((group, gi) => {
      const card     = document.createElement('div');
      card.className = 'story-card';
      const first    = group.items[0];
      const bgSrc    = first.imagen_url || first.video_url || '';

      card.innerHTML = `
        ${bgSrc
          ? `<img class="story-bg" src="${bgSrc}" alt="${group.autor}">`
          : `<div class="story-bg" style="background:linear-gradient(135deg,#667eea,#764ba2);width:100%;height:100%"></div>`
        }
        <div class="story-gradient"></div>
        ${group.avatar
          ? `<img class="story-avatar" src="${group.avatar}" alt="${group.autor}">`
          : `<div class="story-avatar" style="background:#aaa"></div>`
        }
        <div class="story-name">${group.autor}</div>
      `;
      card.addEventListener('click', () => openStory(gi));
      container.appendChild(card);
    });
  } catch (e) {
    console.warn('loadStories:', e);
  }
}

// ─── FEED ─────────────────────────────────────────────────────────────
let feedUids      = [];
let feedCursor    = Date.now();
let feedLoading   = false;
let feedExhausted = false;
const FEED_PAGE   = 15;

async function loadFeed() {
  try {
    const seguidos = await obtenerSeguidos(currentUser.uid);
    feedUids       = [currentUser.uid, ...seguidos.map(s => s.uid)];
    feedCursor     = Date.now();
    feedExhausted  = false;
    activePosts    = [];
    likedSet       = new Set();

    document.getElementById('skel1')?.remove();
    document.getElementById('skel2')?.remove();

    const feed = document.getElementById('feedContainer');
    feed.innerHTML = '';

    // Sentinel al fondo PRIMERO
    const sentinel = document.createElement('div');
    sentinel.id    = 'feedSentinel';
    sentinel.style.height = '1px';
    feed.appendChild(sentinel);

    // Primera carga
    await loadMorePosts();

    // Infinite scroll observer
    new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !feedLoading && !feedExhausted) {
        loadMorePosts();
      }
    }, { rootMargin: '300px' }).observe(sentinel);

  } catch (e) {
    console.warn('loadFeed:', e);
    toast('Error al cargar el feed');
    document.getElementById('skel1')?.remove();
    document.getElementById('skel2')?.remove();
  }
}

async function loadMorePosts() {
  if (feedLoading || feedExhausted || !feedUids.length) return;
  feedLoading = true;

  const feed     = document.getElementById('feedContainer');
  const sentinel = document.getElementById('feedSentinel');

  const spinner = document.createElement('div');
  spinner.style.cssText = 'text-align:center;padding:16px;color:var(--text-secondary);font-size:13px';
  spinner.textContent   = 'Cargando…';
  feed.insertBefore(spinner, sentinel);

  try {
    const { posts } = await obtenerFeedCompleto(feedUids, FEED_PAGE, feedCursor, currentUser.uid);
    spinner.remove();

    if (!posts.length) {
      feedExhausted = true;
      if (activePosts.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-feed';
        empty.innerHTML = '<div class="emoji">📭</div><h3>Sin publicaciones</h3><p>Sigue a personas para ver su contenido aquí.</p>';
        feed.insertBefore(empty, sentinel);
      }
      feedLoading = false;
      return;
    }

    // Cursor = timestamp del post más viejo
    feedCursor = Math.min(...posts.map(p => p.timestamp)) - 1;

    // Likes antes de construir cards
    const newLikes = await misLikes(currentUser.uid, posts.map(p => p.id));
    (Array.isArray(newLikes) ? newLikes : [...newLikes]).forEach(id => likedSet.add(id));

    activePosts = [...activePosts, ...posts];
    posts.forEach(p => feed.insertBefore(buildPostCard(p), sentinel));

    if (posts.length < FEED_PAGE) feedExhausted = true;

  } catch (e) {
    console.warn('loadMorePosts:', e);
    spinner.remove();
  }

  feedLoading = false;
}

/** Construye el HTML de una tarjeta de post */
function buildPostCard(post) {
  const card    = document.createElement('div');
  card.className = 'post-card';
  card.id       = `post-${post.id}`;

  const liked   = likedSet.has(post.id);
  const isOwner = post.uid === currentUser?.uid;
  const hasLarge = !post.imagen_url && !post.video_url && (post.texto?.length ?? 0) < 120;

  card.innerHTML = `
    <div class="post-header">
      <div class="post-avatar-wrap" onclick="location.href='Profile.html?uid=${post.uid}'">
        ${avatarHTML(post.avatar, post.nombre)}
      </div>
      <div class="post-meta">
        <div class="post-author" onclick="location.href='Profile.html?uid=${post.uid}'">
          ${post.nombre || 'Usuario'}
        </div>
        <div class="post-time">
          <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
          ${timeAgo(post.timestamp)}
        </div>
      </div>
      <button class="post-menu-btn" data-postid="${post.id}" data-owner="${isOwner}">
        <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
      </button>
    </div>

    ${post.texto
      ? `<div class="post-text${hasLarge ? ' large' : ''}">${post.texto}</div>`
      : ''}
    ${post.imagen_url
      ? `<div style="overflow:hidden"><img class="post-image" src="${post.imagen_url}" alt="Imagen" loading="lazy"></div>`
      : ''}
    ${post.video_url
      ? `<video class="post-image" src="${post.video_url}" controls muted playsinline></video>`
      : ''}

    <div class="post-stats">
      <div class="post-reactions">
        <div class="reaction-bubbles">
          <div class="reaction-bubble" style="background:#e8f0fe">👍</div>
          <div class="reaction-bubble" style="background:#fce4ec">❤️</div>
          <div class="reaction-bubble" style="background:#fff3e0">😂</div>
        </div>
        <span class="reactions-count" id="likes-${post.id}">${post.total_likes || 0}</span>
      </div>
      <div class="post-counts">
        <span class="post-count" data-action="open-comments" data-postid="${post.id}">
          ${post.total_comentarios || 0} comentarios
        </span>
        <span class="post-count">0 compartidos</span>
      </div>
    </div>

    <div class="post-actions">
      <button class="post-action${liked ? ' liked' : ''}" id="likeBtn-${post.id}"
              data-action="like" data-postid="${post.id}">
        <svg viewBox="0 0 24 24"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>
        Me&nbsp;gusta
      </button>
      <button class="post-action" data-action="open-comments" data-postid="${post.id}">
        <svg viewBox="0 0 24 24"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg>
        Comentar
      </button>
      <button class="post-action" data-action="share" data-postid="${post.id}">
        <svg viewBox="0 0 24 24"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
        Compartir
      </button>
    </div>
  `;

  // ── Delegar eventos dentro de la tarjeta ──────────────────────────
  card.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, postid } = btn.dataset;
    if (action === 'like')           handleLike(postid);
    if (action === 'open-comments')  openCommentSheet(postid);
    if (action === 'share')          handleShare(postid);
  });

  card.querySelector('.post-menu-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleMenu(post.id, isOwner);
  });

  return card;
}

// ─── LIKE ─────────────────────────────────────────────────────────────
async function handleLike(postId) {
  if (!currentUser) return;
  try {
    const btn      = document.getElementById(`likeBtn-${postId}`);
    const countEl  = document.getElementById(`likes-${postId}`);
    const wasLiked = btn.classList.contains('liked');
    btn.classList.toggle('liked');
    countEl.textContent = Math.max(0, Number(countEl.textContent) + (wasLiked ? -1 : 1));
    await toggleLike(postId, currentUser.uid);
  } catch (e) {
    toast('Error al dar like');
  }
}

// ─── SHARE ────────────────────────────────────────────────────────────
function handleShare(postId) {
  const url = `${location.origin}${location.pathname.replace('Home.html', 'post.html')}?id=${postId}`;
  if (navigator.share) {
    navigator.share({ title: 'SnapBook', url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url)
      .then(() => toast('Enlace copiado ✓'))
      .catch(() => {});
  }
}

// ─── MENU CONTEXTUAL ──────────────────────────────────────────────────
function toggleMenu(postId, isOwner) {
  document.querySelectorAll('.post-dropdown').forEach(d => d.remove());

  const card     = document.getElementById(`post-${postId}`);
  const dropdown = document.createElement('div');
  dropdown.className = 'post-dropdown';

  dropdown.innerHTML = isOwner ? `
    <div class="post-dropdown-item" data-menu="delete" data-postid="${postId}">
      <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      Eliminar publicación
    </div>
    <div class="post-dropdown-item" data-menu="close">
      <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      Cancelar
    </div>
  ` : `
    <div class="post-dropdown-item" data-menu="follow" data-postid="${postId}">
      <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      Seguir
    </div>
    <div class="post-dropdown-item" data-menu="close">
      <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      Cancelar
    </div>
  `;

  dropdown.addEventListener('click', e => {
    const item = e.target.closest('[data-menu]');
    if (!item) return;
    const { menu, postid } = item.dataset;
    if (menu === 'delete')  deletePostItem(postid);
    if (menu === 'follow')  handleFollow(postid);
    if (menu === 'close')   dropdown.remove();
  });

  card.appendChild(dropdown);
  setTimeout(() => document.addEventListener('click', () => dropdown.remove(), { once: true }), 10);
}

async function deletePostItem(postId) {
  document.querySelectorAll('.post-dropdown').forEach(d => d.remove());
  const post = activePosts.find(p => p.id === postId);
  if (!post || post.uid !== currentUser.uid) return;
  try {
    await eliminarPost(postId, currentUser.uid);
    document.getElementById(`post-${postId}`)?.remove();
    toast('Publicación eliminada');
  } catch (e) {
    toast('Error al eliminar');
  }
}

async function handleFollow(postId) {
  document.querySelectorAll('.post-dropdown').forEach(d => d.remove());
  const post = activePosts.find(p => p.id === postId);
  if (!post) return;
  try {
    const siguiendo = await esSeguidor(post.uid, currentUser.uid);
    if (siguiendo) {
      await dejarDeSeguir(post.uid, currentUser.uid);
      toast(`Dejaste de seguir a ${post.nombre}`);
    } else {
      await seguirUsuario(post.uid, currentUser.uid);
      toast(`Ahora sigues a ${post.nombre}`);
    }
  } catch (e) {
    toast('Error');
  }
}

// ─── COMMENT SHEET ───────────────────────────────────────────────────
async function openCommentSheet(postId) {
  activePostId = postId;
  document.getElementById('commentSheet').classList.add('open');
  document.getElementById('commentList').innerHTML =
    '<div style="text-align:center;color:var(--text-secondary);padding:24px;font-size:14px">Cargando…</div>';
  try {
    const comments = await obtenerComentarios(postId, 50);
    renderComments(comments);
  } catch (e) {
    document.getElementById('commentList').innerHTML =
      '<div style="text-align:center;padding:24px">Error al cargar</div>';
  }
}

function renderComments(comments) {
  const list = document.getElementById('commentList');
  if (!comments.length) {
    list.innerHTML =
      '<div style="text-align:center;color:var(--text-secondary);padding:24px;font-size:14px">Sin comentarios aún. ¡Sé el primero!</div>';
    return;
  }
  list.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="comment-item-avatar" style="overflow:hidden">
        ${avatarHTML(c.avatar, c.nombre)}
      </div>
      <div class="comment-item-body">
        <div class="comment-item-bubble">
          <div class="comment-item-author">${c.nombre || 'Usuario'}</div>
          <div class="comment-item-text">${c.texto}</div>
        </div>
        <div class="comment-meta">
          <span class="comment-meta-time">${timeAgo(c.timestamp)}</span>
          <button class="comment-meta-btn">Me&nbsp;gusta</button>
          <button class="comment-meta-btn">Responder</button>
        </div>
      </div>
    </div>
  `).join('');
}

function closeCommentSheet(e) {
  if (e.target === document.getElementById('commentSheet'))
    document.getElementById('commentSheet').classList.remove('open');
}

async function sendComment() {
  if (!activePostId || !currentUser) return;
  const input = document.getElementById('commentInput');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';
  try {
    await agregarComentario(activePostId, currentUser, text);
    // Actualizar contador optimistamente
    const countSpan = document.querySelector(`#post-${activePostId} [data-action="open-comments"].post-count`);
    if (countSpan) {
      const cur = parseInt(countSpan.textContent) || 0;
      countSpan.textContent = `${cur + 1} comentarios`;
    }
    const comments = await obtenerComentarios(activePostId, 50);
    renderComments(comments);
  } catch (e) {
    toast('Error al comentar');
  }
}

// ─── STORY VIEWER ────────────────────────────────────────────────────
function openStory(groupIdx) {
  storyGroupIdx = groupIdx;
  storyItemIdx  = 0;
  document.getElementById('storyOverlay').classList.add('open');
  renderStoryItem();
}

function closeStory() {
  clearTimeout(storyTimer);
  document.getElementById('storyOverlay').classList.remove('open');
}

function renderStoryItem() {
  clearTimeout(storyTimer);
  const group = storyGroups[storyGroupIdx];
  if (!group) { closeStory(); return; }
  const item = group.items[storyItemIdx];
  if (!item)  { closeStory(); return; }

  // Barras de progreso
  const prog = document.getElementById('storyProgress');
  prog.innerHTML = group.items.map((_, i) => `
    <div class="story-prog-bar">
      <div class="story-prog-bar-fill${i < storyItemIdx ? ' done' : ''}" id="spf-${i}"></div>
    </div>
  `).join('');

  document.getElementById('storyUserAvatar').src            = group.avatar || '';
  document.getElementById('storyUserName').textContent      = group.autor;
  document.getElementById('storyUserTime').textContent      = timeAgo(item.timestamp);

  const media = document.getElementById('storyMedia');
  if (item.imagen_url) {
    media.innerHTML = `<img src="${item.imagen_url}" alt="Story" style="max-width:100%;max-height:100%;object-fit:contain">`;
  } else if (item.video_url) {
    media.innerHTML = `<video src="${item.video_url}" autoplay muted playsinline style="max-width:100%;max-height:100%"></video>`;
  } else if (item.texto_historia) {
    media.innerHTML = `
      <div style="background:${item.bg_gradient || 'linear-gradient(135deg,#667eea,#764ba2)'};
                  width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:32px">
        <p style="color:#fff;font-size:24px;font-weight:600;text-align:center;line-height:1.4">
          ${item.texto_historia}
        </p>
      </div>`;
  }

  // Animación de la barra actual
  const fill = document.getElementById(`spf-${storyItemIdx}`);
  if (fill) {
    fill.style.transition = 'none';
    fill.style.width = '0%';
    requestAnimationFrame(() => {
      fill.style.transition = 'width 5s linear';
      fill.style.width = '100%';
    });
  }
  storyTimer = setTimeout(() => nextStoryItem(), 5000);
}

function nextStoryItem() {
  const group = storyGroups[storyGroupIdx];
  if (storyItemIdx < group.items.length - 1) {
    storyItemIdx++;
    renderStoryItem();
  } else if (storyGroupIdx < storyGroups.length - 1) {
    storyGroupIdx++; storyItemIdx = 0;
    renderStoryItem();
  } else {
    closeStory();
  }
}

function prevStoryItem() {
  if (storyItemIdx > 0) {
    storyItemIdx--;
    renderStoryItem();
  } else if (storyGroupIdx > 0) {
    storyGroupIdx--; storyItemIdx = 0;
    renderStoryItem();
  }
}

// ─── ADD STORY ────────────────────────────────────────────────────────
function openAddStorySheet() {
  const input   = document.createElement('input');
  input.type    = 'file';
  input.accept  = 'image/*,video/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file || !currentUser) return;
    toast('Subiendo historia…');
    try {
      const url   = await uploadPostImage(currentUser.uid, file);
      const isVid = file.type.startsWith('video');
      const ahora = Date.now();
      await crearHistoria(currentUser, {
        imagenUrl: isVid ? null : url,
        videoUrl:  isVid ? url  : null,
        timestamp: ahora,
        expira:    ahora + 86_400_000,
      });
      toast('Historia publicada ✓');
      await loadStories();
    } catch (e) {
      toast('Error al subir historia');
    }
  };
  input.click();
}

// ─── EVENT LISTENERS GLOBALES ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Comment sheet — cerrar al hacer clic fuera
  document.getElementById('commentSheet')
    .addEventListener('click', closeCommentSheet);

  // Comment sheet — enviar con Enter
  document.getElementById('commentInput')
    .addEventListener('keydown', e => { if (e.key === 'Enter') sendComment(); });

  // Comment sheet — botón enviar
  document.getElementById('commentSendBtn')
    .addEventListener('click', sendComment);

  // Story viewer — botones
  document.getElementById('storyCloseBtn')
    .addEventListener('click', closeStory);
  document.getElementById('storyTapPrev')
    .addEventListener('click', prevStoryItem);
  document.getElementById('storyTapNext')
    .addEventListener('click', nextStoryItem);

  // Add story
  document.getElementById('addStoryBtn')
    .addEventListener('click', openAddStorySheet);

  // Compose input → ir a crear publicación
  document.getElementById('composeInput')
    .addEventListener('click', () => location.href = 'create-posts.html');
});
