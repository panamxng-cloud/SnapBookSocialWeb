// ═══════════════════════════════════════════════════════════════════
// chat.js — SnapBook  (ES Module)
// ═══════════════════════════════════════════════════════════════════

import { auth } from '../servicios/firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
  obtenerMensajes,
  enviarMensaje,
  marcarLeidos,
  contarNoLeidos,
  obtenerSeguidos,
  sincronizarUsuario,
  eliminarMensaje,
  toggleReaccion,
} from '../servicios/db.js';

// ─── ESTADO GLOBAL ────────────────────────────────────────────────
let currentUser   = null;
let currentChatId = null;
let currentPeer   = null;     // { uid, nombre, avatar }
let chats         = [];       // lista de conversaciones
let replyTo       = null;     // mensaje al que se responde
let pendingFile   = null;     // archivo adjunto pendiente
let mediaRecorder = null;
let audioChunks   = [];
let audioTimerInterval = null;
let audioSeconds  = 0;
let msgRefreshInterval = null;
let emojiCategory = 'smileys';

// Firebase Realtime DB para typing y online status
let firebaseDB = null;
try {
  firebaseDB = firebase.database();
} catch {}

// ─── EMOJIS ───────────────────────────────────────────────────────
const EMOJIS = {
  smileys:  ['😀','😂','😍','🥰','😎','🤔','😢','😡','🤯','🥳','😴','🤗','😇','🙄','😏','🤩','😬','🥺','😤','😜'],
  hearts:   ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❣️','💕','💞','💓','💗','💖','💘','💝','🫀','💟','☮️'],
  hands:    ['👋','🤚','🖐️','✋','🤙','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','👈','👉','👆','👇','👍','👎','👏'],
  nature:   ['🌿','🌸','🌺','🌻','🌹','🍀','🌱','🌳','🌲','🌴','🍁','🍂','🌾','🌵','🎋','🎍','☘️','🍃','🌊','⛰️'],
  food:     ['🍕','🍔','🍟','🌮','🌯','🥗','🍜','🍣','🍱','🍛','🍝','🥩','🍗','🥪','🍩','🎂','🧁','🍫','☕','🧃'],
  activity: ['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','⛳','🎯','🎮','🕹️','🎲','🎳','🤿','🎿','🛹','🎭'],
  travel:   ['✈️','🚀','🛸','🚂','🚗','🏎️','🚤','⛵','🏔️','🗺️','🗼','🗽','🏝️','🌋','🏕️','🌃','🌆','🌉','🌁','🧭'],
  objects:  ['💡','📱','💻','⌨️','🖥️','🎧','📷','📸','📹','🎥','📺','📻','🔋','💾','📀','🔑','🔒','🔓','⏰','📦'],
};

// ─── UTILS ────────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
  if (!ts) return '';
  const d   = new Date(Number(ts));
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Hoy';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es', { day: 'numeric', month: 'long' });
}

function chatIdFor(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

function avatarHTML(avatar, nombre, size = 52) {
  if (avatar) return `<img src="${esc(avatar)}" alt="${esc(nombre)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;">`;
  const initials = (nombre || 'U').charAt(0).toUpperCase();
  const colors   = ['#1877f2','#42b72a','#f3425f','#f7b928','#9c27b0'];
  const color    = colors[initials.charCodeAt(0) % colors.length];
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.4)}px;font-weight:700;color:#fff;flex-shrink:0;">${initials}</div>`;
}

// ─── INIT ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) { location.href = 'index.html'; return; }
  currentUser = user;
  window.__snapbookUser = user;
  await sincronizarUsuario(user);
  await cargarChats();
  initUI();
  actualizarBadgeGlobal();
});

// ─── CARGAR LISTA DE CHATS ────────────────────────────────────────
async function cargarChats() {
  try {
    const seguidos = await obtenerSeguidos(currentUser.uid);
    // Para cada seguido, crear objeto de chat con el último mensaje
    const chatPromises = seguidos.map(async s => {
      const cid  = chatIdFor(currentUser.uid, s.uid);
      const msgs = await obtenerMensajes(cid, 1);
      const last = msgs[0] || null;
      const unread = await contarNoLeidos(currentUser.uid);
      return {
        chatId:  cid,
        peer:    s,
        lastMsg: last,
        unread:  unread || 0,
      };
    });

    chats = await Promise.all(chatPromises);
    // Ordenar por último mensaje
    chats.sort((a, b) => (b.lastMsg?.timestamp || 0) - (a.lastMsg?.timestamp || 0));
    renderChatList(chats);
  } catch (e) {
    console.warn('cargarChats:', e);
  }
}

// ─── RENDER LISTA ─────────────────────────────────────────────────
function renderChatList(lista) {
  const container = document.getElementById('chatList');
  if (!lista.length) {
    container.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-2)"><p>Aún no tienes conversaciones.</p><p>Sigue a alguien para chatear.</p></div>`;
    return;
  }

  container.innerHTML = lista.map(c => {
    const lastText = c.lastMsg
      ? (c.lastMsg.tipo === 'image' ? '📷 Foto' : c.lastMsg.tipo === 'audio' ? '🎵 Audio' : c.lastMsg.tipo === 'video' ? '🎥 Video' : esc(c.lastMsg.texto || ''))
      : 'Iniciar conversación';
    const time = c.lastMsg ? formatTime(c.lastMsg.timestamp) : '';
    const unread = c.unread > 0 ? `<span class="chat-unread-badge">${c.unread > 99 ? '99+' : c.unread}</span>` : '';
    const isActive = c.chatId === currentChatId ? 'active' : '';

    return `
    <div class="chat-item ${isActive}" data-chat-id="${c.chatId}" data-peer-uid="${c.peer.uid}">
      <div class="chat-item-avatar-wrap">
        ${avatarHTML(c.peer.avatar, c.peer.nombre, 52)}
        <span class="chat-item-online" id="online-${c.peer.uid}" style="display:none"></span>
      </div>
      <div class="chat-item-body">
        <div class="chat-item-row">
          <span class="chat-item-name">${esc(c.peer.nombre || 'Usuario')}</span>
          <span class="chat-item-time">${time}</span>
        </div>
        <div class="chat-item-preview">
          <span class="chat-item-last ${c.unread > 0 ? 'unread' : ''}">${lastText}</span>
          ${unread}
        </div>
      </div>
    </div>`;
  }).join('');

  // Click en chat item
  container.querySelectorAll('.chat-item').forEach(el => {
    el.addEventListener('click', () => {
      const chatId  = el.dataset.chatId;
      const peerUid = el.dataset.peerUid;
      const chat    = chats.find(c => c.chatId === chatId);
      if (chat) abrirChat(chat.chatId, chat.peer);
    });
  });

  // Online status via Firebase
  observarOnlineStatus();
}

// ─── ABRIR CHAT ────────────────────────────────────────────────────
async function abrirChat(chatId, peer) {
  currentChatId = chatId;
  currentPeer   = peer;

  // Mobile: mostrar panel de conversación
  document.getElementById('chatApp').classList.add('chat-open');

  // Header
  document.getElementById('chatRoomHeader').style.display = 'flex';
  document.getElementById('chatMessages').style.display = 'flex';
  document.getElementById('chatInputArea').style.display = 'block';
  document.getElementById('chatEmptyState').style.display = 'none';

  // Info del header
  const avatarEl = document.getElementById('chatRoomAvatar');
  if (peer.avatar) {
    avatarEl.src = peer.avatar;
    avatarEl.style.display = 'block';
  }
  document.getElementById('chatRoomName').textContent = peer.nombre || 'Usuario';

  // Marcar activo en lista
  document.querySelectorAll('.chat-item').forEach(el => {
    el.classList.toggle('active', el.dataset.chatId === chatId);
  });

  // Limpiar intervalo anterior
  if (msgRefreshInterval) clearInterval(msgRefreshInterval);

  await cargarMensajes();
  await marcarLeidos(chatId, currentUser.uid);

  // Refresh cada 5 segundos
  msgRefreshInterval = setInterval(async () => {
    await cargarMensajes(false);
    await marcarLeidos(chatId, currentUser.uid);
  }, 5000);

  observarOnlineStatus();
  observarTyping();
}

// ─── CARGAR MENSAJES ──────────────────────────────────────────────
async function cargarMensajes(scrollDown = true) {
  try {
    const msgs = await obtenerMensajes(currentChatId, 60);
    renderMensajes(msgs);
    if (scrollDown) scrollToBottom();
  } catch (e) {
    console.warn('cargarMensajes:', e);
  }
}

// ─── RENDER MENSAJES ──────────────────────────────────────────────
function renderMensajes(msgs) {
  const container = document.getElementById('chatMessages');
  if (!msgs.length) {
    container.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-2);font-size:14px">Di hola 👋</div>`;
    return;
  }

  let html     = '';
  let lastDate = '';
  let lastUid  = '';
  let groupOpen = false;

  msgs.forEach((msg, i) => {
    const isMe    = msg.sender_uid === currentUser.uid;
    const dir     = isMe ? 'outgoing' : 'incoming';
    const date    = formatDate(msg.timestamp);
    const nextMsg = msgs[i + 1];
    const sameNext = nextMsg && nextMsg.sender_uid === msg.sender_uid;

    // Separador de fecha
    if (date !== lastDate) {
      if (groupOpen) { html += '</div>'; groupOpen = false; }
      html += `<div class="msg-date-sep"><span>${date}</span></div>`;
      lastDate = date;
      lastUid  = '';
    }

    // Nuevo grupo
    if (msg.sender_uid !== lastUid) {
      if (groupOpen) html += '</div>';
      html += `<div class="msg-group ${dir}" data-uid="${esc(msg.sender_uid)}">`;
      groupOpen = true;
    }

    lastUid = msg.sender_uid;

    // Reply preview
    let replyHTML = '';
    if (msg.reply_to_id && msg.reply_preview) {
      replyHTML = `
        <div class="msg-reply-preview">
          <span class="msg-reply-preview-name">${esc(msg.reply_preview.nombre || '')}</span>
          <span class="msg-reply-preview-text">${esc(msg.reply_preview.texto || '')}</span>
        </div>`;
    }

    // Contenido del mensaje
    let contentHTML = '';
    if (msg.tipo === 'image' && msg.media_url) {
      contentHTML = `<img class="msg-image" src="${esc(msg.media_url)}" alt="Imagen" loading="lazy" onclick="abrirLightbox('${esc(msg.media_url)}')" />`;
    } else if (msg.tipo === 'video' && msg.media_url) {
      contentHTML = `<video class="msg-video" src="${esc(msg.media_url)}" controls playsinline></video>`;
    } else if (msg.tipo === 'audio' && msg.media_url) {
      contentHTML = `
        <div class="msg-audio">
          <button class="msg-audio-btn" onclick="toggleAudioMsg(this, '${esc(msg.media_url)}')">
            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <div class="msg-audio-bar"><div class="msg-audio-progress"></div></div>
          <span class="msg-audio-dur">0:00</span>
        </div>`;
    } else {
      contentHTML = replyHTML + esc(msg.texto || '');
      replyHTML   = '';
    }

    // Reacciones
    let reactHTML = '';
    if (msg.reacciones) {
      try {
        const reacciones = typeof msg.reacciones === 'string' ? JSON.parse(msg.reacciones) : msg.reacciones;
        const grouped    = {};
        Object.entries(reacciones).forEach(([uid, emoji]) => {
          grouped[emoji] = (grouped[emoji] || 0) + 1;
        });
        if (Object.keys(grouped).length) {
          reactHTML = '<div class="msg-reactions">' +
            Object.entries(grouped).map(([emoji, count]) =>
              `<div class="msg-reaction-pill" onclick="reaccionar('${esc(msg.id)}','${emoji}')">${emoji} <span>${count}</span></div>`
            ).join('') + '</div>';
        }
      } catch {}
    }

    // Status (solo en mensajes propios)
    const statusHTML = isMe ? `
      <div class="msg-status ${msg.leido ? 'read' : ''}">
        <svg viewBox="0 0 24 24"><path d="${msg.leido
          ? 'M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z'
          : 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'}"/></svg>
      </div>` : '';

    // Avatar solo en el último del grupo
    const showAvatar = !sameNext && !isMe;

    html += `
      <div class="msg-row" data-msg-id="${esc(msg.id)}" data-msg-uid="${esc(msg.sender_uid)}">
        ${showAvatar ? `<div class="msg-avatar">${avatarHTML(currentPeer?.avatar, currentPeer?.nombre, 28)}</div>` : '<div style="width:28px;flex-shrink:0"></div>'}
        <div class="msg-bubble" oncontextmenu="showMsgMenu(event,'${esc(msg.id)}','${isMe}')">
          ${replyHTML}${contentHTML}
        </div>
      </div>
      <div class="msg-meta" style="padding-left:${isMe ? '0' : '46px'}; ${isMe ? 'justify-content:flex-end' : ''}">
        <span class="msg-time">${formatTime(msg.timestamp)}</span>
        ${statusHTML}
      </div>
      ${reactHTML}`;
  });

  if (groupOpen) html += '</div>';
  container.innerHTML = html;

  // Long press para menú contextual
  container.querySelectorAll('.msg-row').forEach(el => {
    let timer;
    el.addEventListener('touchstart', () => {
      timer = setTimeout(() => {
        const rect = el.getBoundingClientRect();
        showMsgMenu({ clientX: rect.left + rect.width/2, clientY: rect.top }, el.dataset.msgId, el.dataset.msgUid === currentUser.uid);
      }, 500);
    });
    el.addEventListener('touchend', () => clearTimeout(timer));
  });
}

function scrollToBottom() {
  const c = document.getElementById('chatMessages');
  c.scrollTop = c.scrollHeight;
}


// ─── UPLOAD MEDIA AL CHAT ─────────────────────────────────────────
async function uploadChatMedia(file, uid) {
  // Intenta importar de supabase-config, si falla usa la función inline
  try {
    const mod = await import('../servicios/supabase-config.js');
    if (mod.uploadChatMedia) return await mod.uploadChatMedia(file, uid);
    if (mod.uploadPostImage) return await mod.uploadPostImage(file, uid);
  } catch {}

  // Fallback: Cloudinary
  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', 'snapbook_unsigned');
    const ext = file.type.startsWith('audio') ? 'video' : 'image';
    const res = await fetch(`https://api.cloudinary.com/v1_1/snapbook//${ext}/upload`, { method: 'POST', body: fd });
    const data = await res.json();
    return data.secure_url;
  } catch(e) {
    throw new Error('No se pudo subir el archivo: ' + e.message);
  }
}

// ─── ENVIAR MENSAJE ────────────────────────────────────────────────
async function enviar() {
  if (!currentChatId || !currentUser) return;

  const field   = document.getElementById('chatInputField');
  const texto   = field.innerText.trim();
  const hasFile = !!pendingFile;

  if (!texto && !hasFile) return;
  if (texto.length > 2000) return toast('Mensaje muy largo (máx 2000 caracteres)');

  field.innerText = '';
  toggleSendAudio();
  cerrarEmojiPicker();

  try {
    let tipo     = 'text';
    let mediaUrl = null;

    if (hasFile) {
      // Subir archivo a Supabase
      const { uploadChatMedia } = await import('../servicios/supabase-config.js');
      mediaUrl = await uploadChatMedia(pendingFile, currentUser.uid);
      tipo     = pendingFile.type.startsWith('image/') ? 'image' : 'video';
      limpiarFilePreview();
    }

    await enviarMensaje(currentChatId, currentUser, {
      texto:     texto || null,
      tipo,
      mediaUrl,
      replyToId: replyTo?.id || null,
    });

    replyTo = null;
    document.getElementById('replyPreview').style.display = 'none';

    await cargarMensajes(true);
    // Actualizar lista
    await cargarChats();
    notifyTyping(false);
  } catch (e) {
    console.warn('enviar:', e);
    toast('Error al enviar el mensaje');
  }
}

// ─── TYPING INDICATOR ─────────────────────────────────────────────
let typingTimeout = null;

function notifyTyping(isTyping) {
  if (!firebaseDB || !currentChatId || !currentUser) return;
  try {
    firebaseDB.ref(`typing/${currentChatId}/${currentUser.uid}`).set(isTyping ? true : null);
  } catch {}
}

function observarTyping() {
  if (!firebaseDB || !currentChatId || !currentPeer) return;
  try {
    firebaseDB.ref(`typing/${currentChatId}/${currentPeer.uid}`).on('value', snap => {
      const typing = snap.val();
      const ti     = document.getElementById('typingIndicator');
      if (typing) {
        const img = document.getElementById('typingAvatar');
        if (img && currentPeer.avatar) img.src = currentPeer.avatar;
        ti.style.display = 'flex';
        scrollToBottom();
      } else {
        ti.style.display = 'none';
      }
    });
  } catch {}
}

// ─── ONLINE STATUS ────────────────────────────────────────────────
function observarOnlineStatus() {
  if (!firebaseDB) return;
  chats.forEach(c => {
    try {
      firebaseDB.ref(`online/${c.peer.uid}`).on('value', snap => {
        const isOnline = snap.val() === true;
        const dot = document.getElementById(`online-${c.peer.uid}`);
        if (dot) dot.style.display = isOnline ? 'block' : 'none';
        // Si es el chat activo
        if (c.peer.uid === currentPeer?.uid) {
          const d2     = document.getElementById('chatOnlineDot');
          const status = document.getElementById('chatRoomStatus');
          if (d2)     d2.classList.toggle('visible', isOnline);
          if (status) { status.textContent = isOnline ? 'en línea' : 'sin conexión'; status.className = 'chat-room-status' + (isOnline ? ' online' : ''); }
        }
      });
    } catch {}
  });

  // Marcar propio usuario como online
  if (currentUser) {
    try {
      const ref = firebaseDB.ref(`online/${currentUser.uid}`);
      ref.set(true);
      ref.onDisconnect().remove();
    } catch {}
  }
}

// ─── MENÚ CONTEXTUAL ──────────────────────────────────────────────
function showMsgMenu(e, msgId, isOwner) {
  e.preventDefault();
  cerrarMenus();

  const menu = document.createElement('div');
  menu.className   = 'msg-context-menu';
  menu.id          = 'msgContextMenu';
  menu.style.left  = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  menu.style.top   = Math.min(e.clientY, window.innerHeight - 250) + 'px';

  const items = [
    { icon: '<path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>', label: 'Responder', action: () => setReply(msgId) },
    { icon: '<path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>', label: 'Copiar', action: () => copiarMsg(msgId) },
    { icon: '<path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>', label: 'Reaccionar', action: () => showReactionPicker(e, msgId) },
  ];

  if (isOwner === true || isOwner === 'true') {
    items.push({ icon: '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>', label: 'Eliminar', action: () => borrarMsg(msgId), danger: true });
  }

  menu.innerHTML = items.map(it => `
    <div class="msg-context-item ${it.danger ? 'danger' : ''}" data-action="${it.label}">
      <svg viewBox="0 0 24 24">${it.icon}</svg>
      ${it.label}
    </div>`).join('');

  document.body.appendChild(menu);

  menu.querySelectorAll('.msg-context-item').forEach((el, i) => {
    el.addEventListener('click', () => { cerrarMenus(); items[i].action(); });
  });

  setTimeout(() => document.addEventListener('click', cerrarMenus, { once: true }), 50);
}

function cerrarMenus() {
  document.getElementById('msgContextMenu')?.remove();
  document.getElementById('reactionPickerEl')?.remove();
}

// ─── ACCIONES DE MENSAJES ─────────────────────────────────────────
function setReply(msgId) {
  const row = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!row) return;
  const bubble = row.querySelector('.msg-bubble');
  const texto  = bubble?.innerText?.slice(0, 80) || '';
  const uid    = row.dataset.msgUid;
  const nombre = uid === currentUser.uid ? 'Tú' : currentPeer?.nombre || 'Usuario';

  replyTo = { id: msgId, texto, nombre };

  document.getElementById('replyPreviewName').textContent = nombre;
  document.getElementById('replyPreviewText').textContent = texto;
  document.getElementById('replyPreview').style.display   = 'flex';
  document.getElementById('chatInputField').focus();
}

async function copiarMsg(msgId) {
  const row    = document.querySelector(`[data-msg-id="${msgId}"]`);
  const bubble = row?.querySelector('.msg-bubble');
  if (!bubble) return;
  try {
    await navigator.clipboard.writeText(bubble.innerText);
    toast('Mensaje copiado');
  } catch {
    toast('No se pudo copiar');
  }
}

async function borrarMsg(msgId) {
  try {
    await eliminarMensaje(msgId, currentUser.uid);
    await cargarMensajes(false);
    toast('Mensaje eliminado');
  } catch (e) {
    toast('No se pudo eliminar');
  }
}

// ─── REACCIONES ───────────────────────────────────────────────────
function showReactionPicker(e, msgId) {
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  picker.id        = 'reactionPickerEl';
  picker.style.left = Math.min(e.clientX, window.innerWidth - 280) + 'px';
  picker.style.top  = (e.clientY - 60) + 'px';

  const emojis = ['❤️','😂','😮','😢','😡','👍'];
  picker.innerHTML = emojis.map(em =>
    `<button class="reaction-picker-btn" data-emoji="${em}">${em}</button>`
  ).join('');

  document.body.appendChild(picker);

  picker.querySelectorAll('.reaction-picker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      reaccionar(msgId, btn.dataset.emoji);
      cerrarMenus();
    });
  });

  setTimeout(() => document.addEventListener('click', cerrarMenus, { once: true }), 50);
}

async function reaccionar(msgId, emoji) {
  try {
    await toggleReaccion(msgId, currentUser.uid, emoji);
    await cargarMensajes(false);
  } catch (e) {
    console.warn('reaccionar:', e);
  }
}

// ─── ARCHIVO ADJUNTO ──────────────────────────────────────────────
function handleFile(file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) return toast('Archivo muy grande (máx 50MB)');

  pendingFile = file;
  const preview = document.getElementById('imagePreview');
  const img     = document.getElementById('imagePreviewImg');

  if (file.type.startsWith('image/')) {
    const url   = URL.createObjectURL(file);
    img.src     = url;
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
    toast(`Archivo: ${file.name}`);
  }
}

function limpiarFilePreview() {
  pendingFile = null;
  document.getElementById('imagePreview').style.display = 'none';
  document.getElementById('imagePreviewImg').src = '';
}

// ─── LIGHTBOX ─────────────────────────────────────────────────────
window.abrirLightbox = function(url) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `
    <img src="${esc(url)}" alt="Imagen" />
    <button class="lightbox-close">
      <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </button>`;
  document.body.appendChild(lb);
  lb.querySelector('.lightbox-close').addEventListener('click', () => lb.remove());
  lb.addEventListener('click', e => { if (e.target === lb) lb.remove(); });
};

// ─── AUDIO PLAYBACK ───────────────────────────────────────────────
window.toggleAudioMsg = function(btn, url) {
  const row   = btn.closest('.msg-audio');
  const prog  = row.querySelector('.msg-audio-progress');
  const dur   = row.querySelector('.msg-audio-dur');

  // Si ya hay un audio reproduciéndose
  if (window._currentAudio && !window._currentAudio.paused) {
    window._currentAudio.pause();
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    return;
  }

  const audio = new Audio(url);
  window._currentAudio = audio;

  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      prog.style.width = (audio.currentTime / audio.duration * 100) + '%';
      const s = Math.floor(audio.currentTime);
      dur.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
    }
  });

  audio.addEventListener('ended', () => {
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    prog.style.width = '0%';
  });

  audio.play();
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
};

// ─── GRABACIÓN DE AUDIO ───────────────────────────────────────────
async function iniciarGrabacion() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks   = [];
    audioSeconds  = 0;

    mediaRecorder.addEventListener('dataavailable', e => audioChunks.push(e.data));
    mediaRecorder.start();

    document.getElementById('audioModal').style.display = 'flex';

    audioTimerInterval = setInterval(() => {
      audioSeconds++;
      const m = Math.floor(audioSeconds / 60);
      const s = audioSeconds % 60;
      document.getElementById('audioTimer').textContent = `${m}:${String(s).padStart(2,'0')}`;
    }, 1000);

  } catch {
    toast('No se pudo acceder al micrófono');
  }
}

function detenerGrabacion() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  clearInterval(audioTimerInterval);
  document.getElementById('audioModal').style.display = 'none';
}

async function enviarAudio() {
  detenerGrabacion();
  await new Promise(r => setTimeout(r, 200));

  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const file = new File([blob], `audio_${Date.now()}.webm`, { type: 'audio/webm' });

  try {
    const mediaUrl = await uploadChatMedia(file, currentUser.uid);
    await enviarMensaje(currentChatId, currentUser, {
      texto: null, tipo: 'audio', mediaUrl,
      replyToId: replyTo?.id || null,
    });
    await cargarMensajes(true);
  } catch (e) {
    toast('Error al enviar audio');
    console.warn(e);
  }
}

// ─── EMOJI PICKER ─────────────────────────────────────────────────
function toggleEmojiPicker() {
  const picker = document.getElementById('emojiPicker');
  const open   = picker.style.display !== 'none';
  picker.style.display = open ? 'none' : 'block';
  if (!open) renderEmojis(emojiCategory);
}

function cerrarEmojiPicker() {
  document.getElementById('emojiPicker').style.display = 'none';
}

function renderEmojis(cat) {
  emojiCategory = cat;
  const grid    = document.getElementById('emojiGrid');
  grid.innerHTML = (EMOJIS[cat] || []).map(e =>
    `<button class="emoji-btn" data-emoji="${e}">${e}</button>`
  ).join('');

  grid.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = document.getElementById('chatInputField');
      field.focus();
      document.execCommand('insertText', false, btn.dataset.emoji);
      toggleSendAudio();
    });
  });
}

// ─── TOGGLE SEND/AUDIO BUTTON ─────────────────────────────────────
function toggleSendAudio() {
  const field = document.getElementById('chatInputField');
  const send  = document.getElementById('sendBtn');
  const audio = document.getElementById('audioBtn');
  const hasText = field.innerText.trim().length > 0 || pendingFile;
  send.style.display  = hasText ? 'flex' : 'none';
  audio.style.display = hasText ? 'none' : 'flex';
}

// ─── BÚSQUEDA DE CHATS ────────────────────────────────────────────
function buscarChats(query) {
  const q = query.toLowerCase().trim();
  if (!q) { renderChatList(chats); return; }
  const filtered = chats.filter(c => (c.peer.nombre || '').toLowerCase().includes(q));
  renderChatList(filtered);
}

// ─── BÚSQUEDA DE USUARIOS (modal nuevo chat) ──────────────────────
async function buscarUsuarios(query) {
  const container = document.getElementById('userSearchResults');
  if (!query.trim()) {
    container.innerHTML = '<p class="modal-hint">Busca a alguien para chatear</p>';
    return;
  }

  try {
    const seguidos = await obtenerSeguidos(currentUser.uid);
    const filtered = seguidos.filter(u =>
      (u.nombre || '').toLowerCase().includes(query.toLowerCase())
    );

    if (!filtered.length) {
      container.innerHTML = '<p class="modal-hint">No se encontraron resultados</p>';
      return;
    }

    container.innerHTML = filtered.map(u => `
      <div class="user-result-item" data-uid="${esc(u.uid)}">
        ${avatarHTML(u.avatar, u.nombre, 44)}
        <div>
          <div class="user-result-name">${esc(u.nombre || 'Usuario')}</div>
        </div>
      </div>`).join('');

    container.querySelectorAll('.user-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const peer = seguidos.find(u => u.uid === el.dataset.uid);
        if (peer) {
          document.getElementById('newChatModal').style.display = 'none';
          const cid = chatIdFor(currentUser.uid, peer.uid);
          abrirChat(cid, peer);
        }
      });
    });
  } catch (e) {
    container.innerHTML = '<p class="modal-hint">Error al buscar</p>';
  }
}

// ─── BADGE GLOBAL ─────────────────────────────────────────────────
async function actualizarBadgeGlobal() {
  try {
    const total = await contarNoLeidos(currentUser.uid);
    const badge = document.getElementById('chatsBadge');
    if (badge) {
      badge.textContent = total > 99 ? '99+' : total;
      badge.style.display = total > 0 ? 'flex' : 'none';
    }
  } catch {}
}

// ─── INFO DEL CHAT ────────────────────────────────────────────────
function mostrarInfoChat() {
  if (!currentPeer) return;
  const modal = document.getElementById('chatInfoModal');
  const body  = document.getElementById('chatInfoBody');

  body.innerHTML = `
    <div class="chat-info-profile">
      ${avatarHTML(currentPeer.avatar, currentPeer.nombre, 80)}
      <div class="chat-info-name">${esc(currentPeer.nombre || 'Usuario')}</div>
      <div class="chat-info-status" id="infoStatus">sin conexión</div>
      <div class="chat-info-actions">
        <div class="chat-info-action" onclick="document.getElementById('chatInfoModal').style.display='none'; document.getElementById('callVoiceBtn').click()">
          <div class="chat-info-action-icon"><svg viewBox="0 0 24 24"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg></div>
          <span>Llamar</span>
        </div>
        <div class="chat-info-action" onclick="location.href='Profile.html?uid=${esc(currentPeer.uid)}'">
          <div class="chat-info-action-icon"><svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></div>
          <span>Perfil</span>
        </div>
      </div>
    </div>
    <div class="chat-info-section">
      <div class="chat-info-section-title">Opciones</div>
      <div class="chat-info-option" onclick="silenciarChat()">
        <svg viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
        Silenciar notificaciones
      </div>
      <div class="chat-info-option danger" onclick="confirmarBorrarChat()">
        <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        Eliminar conversación
      </div>
    </div>`;

  modal.style.display = 'flex';
}

function silenciarChat() {
  toast('Notificaciones silenciadas');
  document.getElementById('chatInfoModal').style.display = 'none';
}

function confirmarBorrarChat() {
  if (confirm('¿Eliminar esta conversación?')) {
    toast('Conversación eliminada');
    document.getElementById('chatInfoModal').style.display = 'none';
  }
}

// ─── TABS DE LISTA ────────────────────────────────────────────────
function filtrarTab(tab) {
  if (tab === 'all')    renderChatList(chats);
  if (tab === 'unread') renderChatList(chats.filter(c => c.unread > 0));
  if (tab === 'groups') renderChatList([]); // grupos no implementados aún
}

// ─── INIT UI ──────────────────────────────────────────────────────
function initUI() {
  // Botones principales
  document.getElementById('newChatBtn').addEventListener('click', () => {
    document.getElementById('newChatModal').style.display = 'flex';
    document.getElementById('userSearchInput').focus();
  });

  document.getElementById('startChatBtn').addEventListener('click', () => {
    document.getElementById('newChatModal').style.display = 'flex';
  });

  document.getElementById('newChatModalClose').addEventListener('click', () => {
    document.getElementById('newChatModal').style.display = 'none';
  });

  document.getElementById('chatInfoModalClose').addEventListener('click', () => {
    document.getElementById('chatInfoModal').style.display = 'none';
  });

  document.getElementById('chatBackBtn').addEventListener('click', () => {
    document.getElementById('chatApp').classList.remove('chat-open');
    currentChatId = null;
    currentPeer   = null;
    if (msgRefreshInterval) clearInterval(msgRefreshInterval);
  });

  document.getElementById('chatInfoBtn').addEventListener('click', mostrarInfoChat);

  // Enviar mensaje
  document.getElementById('sendBtn').addEventListener('click', enviar);

  document.getElementById('chatInputField').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
  });

  document.getElementById('chatInputField').addEventListener('input', () => {
    toggleSendAudio();
    notifyTyping(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => notifyTyping(false), 2000);
  });

  // Adjuntar archivo
  document.getElementById('attachBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });

  document.getElementById('fileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    e.target.value = '';
  });

  // Cerrar preview de imagen
  document.getElementById('imagePreviewClose').addEventListener('click', limpiarFilePreview);

  // Emoji
  document.getElementById('emojiBtn').addEventListener('click', toggleEmojiPicker);

  document.querySelectorAll('.emoji-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.emoji-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderEmojis(btn.dataset.cat);
    });
  });

  // Audio
  document.getElementById('audioBtn').addEventListener('click', iniciarGrabacion);
  document.getElementById('audioCancelBtn').addEventListener('click', detenerGrabacion);
  document.getElementById('audioSendBtn').addEventListener('click', enviarAudio);

  // Reply preview close
  document.getElementById('replyPreviewClose').addEventListener('click', () => {
    replyTo = null;
    document.getElementById('replyPreview').style.display = 'none';
  });

  // Búsqueda en lista
  document.getElementById('chatSearchInput').addEventListener('input', e => {
    buscarChats(e.target.value);
  });

  // Búsqueda de usuarios
  let userSearchTimeout;
  document.getElementById('userSearchInput').addEventListener('input', e => {
    clearTimeout(userSearchTimeout);
    userSearchTimeout = setTimeout(() => buscarUsuarios(e.target.value), 300);
  });

  // Tabs
  document.querySelectorAll('.chat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      filtrarTab(tab.dataset.tab);
    });
  });

  // Llamadas
  document.getElementById('callVoiceBtn').addEventListener('click', () => {
    if (currentPeer) location.href = `chats.html?uid=${currentPeer.uid}&tipo=voz`;
    else toast('Selecciona un chat primero');
  });

  document.getElementById('callVideoBtn').addEventListener('click', () => {
    if (currentPeer) location.href = `chats.html?uid=${currentPeer.uid}&tipo=video`;
    else toast('Selecciona un chat primero');
  });

  // Drag & Drop para archivos
  const msgArea = document.getElementById('chatMessages');
  msgArea.addEventListener('dragover', e => { e.preventDefault(); });
  msgArea.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // Cerrar modales al click afuera
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.style.display = 'none';
    });
  });

  // Estado inicial del botón send/audio
  toggleSendAudio();
}

// Exponer funciones globales necesarias
window.reaccionar    = reaccionar;
window.showMsgMenu   = showMsgMenu;
