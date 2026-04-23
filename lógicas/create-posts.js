// ═══════════════════════════════════════════════════════════════════
// create-posts.js — SnapBook  (ES Module)
// ═══════════════════════════════════════════════════════════════════

import { auth } from '../servicios/firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
  crearPost,
  crearEncuesta,
  crearPostVoz,
  crearShort,
} from '../servicios/db.js';
import {
  uploadPostImage,
  uploadPostAudio,
} from '../servicios/supabase-config.js';
import {
  uploadPostVideo,
  uploadShort,
} from '../servicios/cloudinary-config.js';

// ─── STATE ───────────────────────────────────────────────────────────
let currentUser   = null;
let activeType    = 'text';     // text | photo | video | audio | poll
let photoFiles    = [];         // Array<File>
let videoFile     = null;
let shortFile     = null;       // File para short
let videoSubType  = null;       // 'normal' | 'short'
let audioBlob     = null;       // grabado con MediaRecorder
let audioFileObj  = null;       // subido desde archivo
let mediaRecorder = null;
let audioChunks   = [];
let recordTimer   = null;
let recSeconds    = 0;
let pollDays      = 1;

// ─── UTILS ───────────────────────────────────────────────────────────
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'cp-toast';
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function setProgress(pct) {
  const bar = document.getElementById('progressBar');
  bar.style.display = pct > 0 ? 'block' : 'none';
  document.getElementById('progressFill').style.width = `${pct}%`;
}

function setPublishEnabled() {
  const btn = document.getElementById('publishBtn');
  let ok = false;
  if (activeType === 'text') {
    ok = document.getElementById('textInput').value.trim().length > 0 ||
         photoFiles.length > 0;
  } else if (activeType === 'photo') {
    ok = photoFiles.length > 0;
  } else if (activeType === 'video') {
    if (videoSubType === 'normal') ok = !!videoFile;
    else if (videoSubType === 'short') ok = !!shortFile;
    else ok = false;
  } else if (activeType === 'audio') {
    ok = !!audioBlob || !!audioFileObj;
  } else if (activeType === 'poll') {
    const q = document.getElementById('pollQuestion').value.trim();
    const opts = [...document.querySelectorAll('.cp-poll-input')]
      .map(i => i.value.trim()).filter(Boolean);
    ok = q.length > 0 && opts.length >= 2;
  }
  btn.disabled = !ok;
}

function avatarHTML(url, name = '?') {
  if (url) return `<img src="${url}" alt="${name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const hue      = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `<div style="width:100%;height:100%;border-radius:50%;background:hsl(${hue},50%,55%);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:16px">${initials}</div>`;
}

// ─── AUTH ────────────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (!user) { location.href = 'index.html'; return; }
  currentUser = user;
  window.__snapbookUser = user;

  document.getElementById('authorName').textContent = user.displayName || 'Usuario';
  document.getElementById('authorAvatar').innerHTML = avatarHTML(user.photoURL, user.displayName || 'U');
});

// ─── TABS ────────────────────────────────────────────────────────────
document.querySelectorAll('.cp-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cp-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.cp-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const prev = activeType;
    activeType = btn.dataset.type;
    if (prev === 'video' && activeType !== 'video') resetVideoSubpanels();
    document.getElementById(`panel-${activeType}`).classList.add('active');
    setPublishEnabled();
  });
});

// ─── TEXT PANEL ──────────────────────────────────────────────────────
const textInput = document.getElementById('textInput');
textInput.addEventListener('input', () => {
  document.getElementById('charCount').textContent = textInput.value.length;
  setPublishEnabled();
});

// Inline images from text panel
document.getElementById('inlineImageInput').addEventListener('change', e => {
  handlePhotoFiles([...e.target.files]);
});

function handlePhotoFiles(files) {
  photoFiles.push(...files);
  renderImagePreviews();
  setPublishEnabled();
}

function renderImagePreviews() {
  const container = activeType === 'text'
    ? document.getElementById('imagePreviews')
    : document.getElementById('photoGrid');
  container.innerHTML = '';
  photoFiles.forEach((file, i) => {
    const url  = URL.createObjectURL(file);
    const wrap = document.createElement('div');
    wrap.className = 'cp-img-thumb';
    wrap.innerHTML = `
      <img src="${url}" alt="preview">
      <button class="cp-img-thumb-remove" data-i="${i}">✕</button>
    `;
    wrap.querySelector('button').addEventListener('click', () => {
      photoFiles.splice(i, 1);
      renderImagePreviews();
      setPublishEnabled();
    });
    container.appendChild(wrap);
  });
}

// ─── PHOTO PANEL ─────────────────────────────────────────────────────
const photoInput    = document.getElementById('photoInput');
const photoDropzone = document.getElementById('photoDropzone');

photoDropzone.addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', e => {
  handlePhotoFiles([...e.target.files]);
  renderImagePreviews();
});

// Drag & drop
photoDropzone.addEventListener('dragover', e => { e.preventDefault(); photoDropzone.classList.add('dragover'); });
photoDropzone.addEventListener('dragleave', () => photoDropzone.classList.remove('dragover'));
photoDropzone.addEventListener('drop', e => {
  e.preventDefault(); photoDropzone.classList.remove('dragover');
  handlePhotoFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('image/')));
  renderImagePreviews();
});

// ─── VIDEO PANEL — bottom sheet tipo ─────────────────────────────────

// Abrir sheet al pulsar el placeholder o "Cambiar"
document.getElementById('openVideoTypeSheet').addEventListener('click', () => {
  document.getElementById('videoTypeSheet').classList.add('open');
});
document.getElementById('changeVideoTypeBtn').addEventListener('click', () => {
  document.getElementById('videoTypeSheet').classList.add('open');
});

// Cerrar sheet al tocar fuera
document.getElementById('videoTypeSheet').addEventListener('click', e => {
  if (e.target === document.getElementById('videoTypeSheet'))
    document.getElementById('videoTypeSheet').classList.remove('open');
});

function activateVideoSubtype(type) {
  videoSubType = type;
  document.getElementById('videoTypeSheet').classList.remove('open');
  document.getElementById('videoTypeChooserPlaceholder').style.display = 'none';
  document.getElementById('videoTypeBadge').style.display               = 'flex';
  document.getElementById('subpanel-video-normal').style.display        = type === 'normal' ? 'block' : 'none';
  document.getElementById('subpanel-video-short').style.display         = type === 'short'  ? 'block' : 'none';
  document.getElementById('videoTypeBadgeText').textContent             =
    type === 'normal' ? '🎬 Video Normal · Cloudinary' : '⚡ Short · Cloudinary';
  setPublishEnabled();
}

document.getElementById('chooseVideoNormal').addEventListener('click', () => activateVideoSubtype('normal'));
document.getElementById('chooseVideoShort').addEventListener('click',  () => activateVideoSubtype('short'));

// Reset cuando se cambia de subtype
function resetVideoSubpanels() {
  videoFile = null; shortFile = null; videoSubType = null;
  document.getElementById('videoTypeChooserPlaceholder').style.display = 'block';
  document.getElementById('videoTypeBadge').style.display               = 'none';
  document.getElementById('subpanel-video-normal').style.display        = 'none';
  document.getElementById('subpanel-video-short').style.display         = 'none';
}

// ── Video Normal ──────────────────────────────────────────────────────
const videoInput    = document.getElementById('videoInput');
const videoDropzone = document.getElementById('videoDropzone');

videoDropzone.addEventListener('click', () => videoInput.click());
videoInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  videoFile = file;
  const url = URL.createObjectURL(file);
  document.getElementById('videoPlayer').src           = url;
  document.getElementById('videoDropzone').style.display = 'none';
  document.getElementById('videoPreview').style.display  = 'block';
  setPublishEnabled();
});

document.getElementById('removeVideo').addEventListener('click', () => {
  videoFile = null;
  document.getElementById('videoPlayer').src             = '';
  document.getElementById('videoDropzone').style.display = '';
  document.getElementById('videoPreview').style.display  = 'none';
  setPublishEnabled();
});

videoDropzone.addEventListener('dragover', e => { e.preventDefault(); videoDropzone.classList.add('dragover'); });
videoDropzone.addEventListener('dragleave', () => videoDropzone.classList.remove('dragover'));
videoDropzone.addEventListener('drop', e => {
  e.preventDefault(); videoDropzone.classList.remove('dragover');
  const file = [...e.dataTransfer.files].find(f => f.type.startsWith('video/'));
  if (file) { videoInput.files = e.dataTransfer.files; videoInput.dispatchEvent(new Event('change')); }
});

// ── Short ─────────────────────────────────────────────────────────────
const shortVideoInput = document.getElementById('shortVideoInput');
const shortDropzone   = document.getElementById('shortDropzone');

shortDropzone.addEventListener('click', () => shortVideoInput.click());
shortVideoInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  shortFile = file;
  const url = URL.createObjectURL(file);
  document.getElementById('shortPlayer').src           = url;
  document.getElementById('shortDropzone').style.display = 'none';
  document.getElementById('shortPreview').style.display  = 'block';
  setPublishEnabled();
});

document.getElementById('removeShort').addEventListener('click', () => {
  shortFile = null;
  document.getElementById('shortPlayer').src             = '';
  document.getElementById('shortDropzone').style.display = '';
  document.getElementById('shortPreview').style.display  = 'none';
  setPublishEnabled();
});

// ─── AUDIO PANEL ─────────────────────────────────────────────────────
const recordBtn     = document.getElementById('recordBtn');
const stopBtn       = document.getElementById('stopBtn');
const audioCircle   = document.getElementById('audioCircle');
const audioTimerEl  = document.getElementById('audioTimer');
const audioPlayback = document.getElementById('audioPlayback');

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

recordBtn.addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getUserMedia) { toast('Tu dispositivo no soporta grabación'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks  = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
      audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const url = URL.createObjectURL(audioBlob);
      document.getElementById('audioPlayer').src = url;
      audioPlayback.style.display = 'flex';
      stream.getTracks().forEach(t => t.stop());
      setPublishEnabled();
    };
    mediaRecorder.start();
    recSeconds = 0;
    audioCircle.classList.add('recording');
    recordBtn.style.display = 'none';
    stopBtn.style.display   = 'flex';
    recordTimer = setInterval(() => {
      recSeconds++;
      audioTimerEl.textContent = formatTime(recSeconds);
    }, 1000);
  } catch (e) {
    toast('No se pudo acceder al micrófono');
  }
});

stopBtn.addEventListener('click', () => {
  clearInterval(recordTimer);
  mediaRecorder?.stop();
  audioCircle.classList.remove('recording');
  stopBtn.style.display   = 'none';
  recordBtn.style.display = 'flex';
});

document.getElementById('removeAudio').addEventListener('click', () => {
  audioBlob = null; audioChunks = [];
  document.getElementById('audioPlayer').src = '';
  audioPlayback.style.display = 'none';
  audioTimerEl.textContent = '00:00';
  setPublishEnabled();
});

// Upload audio file
document.getElementById('audioFileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  audioFileObj = file;
  const url = URL.createObjectURL(file);
  document.getElementById('audioPlayer').src = url;
  audioPlayback.style.display = 'flex';
  setPublishEnabled();
});

// ─── POLL PANEL ──────────────────────────────────────────────────────
document.getElementById('pollQuestion').addEventListener('input', setPublishEnabled);

document.getElementById('addOptionBtn').addEventListener('click', () => {
  const opts = document.querySelectorAll('.cp-poll-input');
  if (opts.length >= 6) { toast('Máximo 6 opciones'); return; }
  const idx  = opts.length;
  const div  = document.createElement('div');
  div.className = 'cp-poll-option';
  div.innerHTML = `
    <input class="cp-poll-input" type="text" placeholder="Opción ${idx + 1}" data-idx="${idx}" maxlength="80"/>
    <button class="cp-poll-remove" title="Eliminar">✕</button>
  `;
  div.querySelector('input').addEventListener('input', setPublishEnabled);
  div.querySelector('button').addEventListener('click', () => {
    div.remove(); setPublishEnabled();
  });
  document.getElementById('pollOptions').appendChild(div);
  setPublishEnabled();
});

// Init existing inputs
document.querySelectorAll('.cp-poll-input').forEach(i => {
  i.addEventListener('input', setPublishEnabled);
});

// Duration buttons
document.querySelectorAll('.cp-dur-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cp-dur-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    pollDays = Number(btn.dataset.days);
  });
});

// ─── BACK ────────────────────────────────────────────────────────────
document.getElementById('backBtn').addEventListener('click', () => history.back());

// ─── PUBLISH ─────────────────────────────────────────────────────────
document.getElementById('publishBtn').addEventListener('click', handlePublish);

async function handlePublish() {
  if (!currentUser) return;
  const btn = document.getElementById('publishBtn');
  btn.disabled = true;

  try {
    if (activeType === 'text')   await publishText();
    if (activeType === 'photo')  await publishPhoto();
    if (activeType === 'video')  {
      if (videoSubType === 'normal') await publishVideo();
      else if (videoSubType === 'short') await publishShortVideo();
      else { toast('Elige el tipo de video'); btn.disabled = false; return; }
    }
    if (activeType === 'audio')  await publishAudio();
    if (activeType === 'poll')   await publishPoll();

    toast('✓ Publicación creada');
    setTimeout(() => location.href = 'Home.html', 1200);
  } catch (e) {
    console.error(e);
    toast('Error al publicar: ' + e.message);
    btn.disabled = false;
    setProgress(0);
  }
}

async function publishText() {
  const texto    = document.getElementById('textInput').value.trim();
  const esAnon   = document.getElementById('anonToggle').checked;
  let   imagenUrl = null;

  if (photoFiles.length > 0) {
    setProgress(20);
    imagenUrl = await uploadPostImage(currentUser.uid, photoFiles[0], p => setProgress(20 + p * 0.6));
    setProgress(80);
  }

  await crearPost(currentUser, { texto, imagenUrl, esAnonimo: esAnon });
  setProgress(100);
}

async function publishPhoto() {
  if (!photoFiles.length) return;
  setProgress(10);
  const caption = document.getElementById('photoCaption').value.trim();
  let imagenUrl = null;

  imagenUrl = await uploadPostImage(currentUser.uid, photoFiles[0], p => setProgress(10 + p * 0.7));
  setProgress(80);
  await crearPost(currentUser, { texto: caption, imagenUrl });
  setProgress(100);
}

async function publishVideo() {
  if (!videoFile) return;
  setProgress(10);
  const caption  = document.getElementById('videoCaption').value.trim();
  // Cloudinary via cloudinary-config.js
  const videoUrl = await uploadPostVideo(currentUser.uid, videoFile, p => setProgress(10 + p * 0.75));
  setProgress(85);
  await crearPost(currentUser, { texto: caption, videoUrl });
  setProgress(100);
}

async function publishShortVideo() {
  if (!shortFile) return;
  setProgress(10);
  const descripcion = document.getElementById('shortCaption').value.trim();
  // Cloudinary via cloudinary-config.js
  const videoUrl = await uploadShort(currentUser.uid, shortFile, p => setProgress(10 + p * 0.75));
  setProgress(85);
  await crearShort(currentUser, { videoUrl, descripcion });
  setProgress(100);
}

async function publishAudio() {
  setProgress(10);
  const caption   = document.getElementById('audioCaption').value.trim();
  const audioSrc  = audioBlob
    ? new File([audioBlob], 'voice.webm', { type: 'audio/webm' })
    : audioFileObj;
  if (!audioSrc) return;
  const audioUrl  = await uploadPostAudio(currentUser.uid, audioSrc, p => setProgress(10 + p * 0.75));
  setProgress(85);
  await crearPostVoz(currentUser, {
    texto:      caption,
    audioUrl,
    duracionSeg: recSeconds,
  });
  setProgress(100);
}

async function publishPoll() {
  setProgress(20);
  const pregunta = document.getElementById('pollQuestion').value.trim();
  const opciones = [...document.querySelectorAll('.cp-poll-input')]
    .map(i => i.value.trim()).filter(Boolean);

  // Create base post first (texto = pregunta)
  const postId = await crearPost(currentUser, { texto: pregunta });
  setProgress(60);
  await crearEncuesta(postId, currentUser.uid, { pregunta, opciones, duracionDias: pollDays });
  setProgress(100);
}
