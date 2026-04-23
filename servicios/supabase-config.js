// ============================================================
//  supabase-config.js  –  Storage de SnapBook
//  Usado por: register, Profile, create-posts, chats, Home
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL  = 'https://ihefracdvmyuqgzzqjpf.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloZWZyYWNkdm15dXFnenpxanBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MjIyNTAsImV4cCI6MjA5MTA5ODI1MH0.iVczrV0sCrYoUE-kGuvtRiguCiQI13m_wLYZn1kS5C8';
const BUCKET        = 'Avatares';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Helper interno ──────────────────────────────────────────
async function _upload(path, file, onProgress) {
    if (onProgress) onProgress(20);
    const { data, error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true });
    if (error) throw new Error('Supabase Storage: ' + error.message);
    if (onProgress) onProgress(100);
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
    return urlData.publicUrl;
}

// ── Avatares ────────────────────────────────────────────────
export async function uploadAvatar(uid, file) {
    const ext = file.name.split('.').pop();
    return _upload(`avatars/${uid}/profile.${ext}`, file);
}

// ── Portada de perfil ────────────────────────────────────────
export async function uploadCover(uid, file) {
    const ext = file.name.split('.').pop();
    return _upload(`covers/${uid}/cover.${ext}`, file);
}

// ── Publicaciones ────────────────────────────────────────────
export async function uploadPostImage(uid, file, onProgress) {
    const ext = file.name.split('.').pop();
    return _upload(`posts/${uid}/img_${Date.now()}.${ext}`, file, onProgress);
}
export async function uploadPostVideo(uid, file, onProgress) {
    const ext = file.name.split('.').pop();
    return _upload(`posts/${uid}/vid_${Date.now()}.${ext}`, file, onProgress);
}
export async function uploadPostAudio(uid, file, onProgress) {
    const ext = file.name?.split('.').pop() || 'webm';
    return _upload(`posts/${uid}/audio_${Date.now()}.${ext}`, file, onProgress);
}

// ── Shorts ───────────────────────────────────────────────────
export async function uploadShort(uid, file, onProgress) {
    const ext = file.name.split('.').pop();
    return _upload(`shorts/${uid}/short_${Date.now()}.${ext}`, file, onProgress);
}

// ── Chats (fotos, videos, audios) ────────────────────────────
export async function uploadChatMedia(chatId, file) {
    const ext = file.name.split('.').pop();
    return _upload(`chats/${chatId}/media_${Date.now()}.${ext}`, file);
}
export async function uploadChatAudio(chatId, blob) {
    const file = new File([blob], 'audio.webm', { type: 'audio/webm' });
    return _upload(`chats/${chatId}/audio_${Date.now()}.webm`, file);
}
