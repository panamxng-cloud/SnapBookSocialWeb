// ============================================================
//  cloudinary-config.js  –  Videos y audios de SnapBook
//  25GB gratis — usado por: create-posts, chats, Home
// ============================================================

const CLOUD_NAME   = 'defhc9kz6';
const UPLOAD_PRESET = 'snapbook';
const UPLOAD_URL   = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`;

// ── Helper interno ──────────────────────────────────────────
async function _upload(file, resourceType, onProgress) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    formData.append('resource_type', resourceType);

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`);

        if (onProgress) {
            xhr.upload.onprogress = e => {
                if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
            };
        }

        xhr.onload = () => {
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                resolve(data.secure_url);
            } else {
                reject(new Error('Cloudinary error: ' + xhr.responseText));
            }
        };
        xhr.onerror = () => reject(new Error('Error de red al subir a Cloudinary'));
        xhr.send(formData);
    });
}

// ── Videos de publicaciones ─────────────────────────────────
export async function uploadPostVideo(uid, file, onProgress) {
    return _upload(file, 'video', onProgress);
}

// ── Shorts (videos cortos) ──────────────────────────────────
export async function uploadShort(uid, file, onProgress) {
    return _upload(file, 'video', onProgress);
}

// ── Audios de publicaciones ─────────────────────────────────
export async function uploadPostAudio(uid, file, onProgress) {
    return _upload(file, 'video', onProgress); // Cloudinary acepta audio como video
}

// ── Chats: fotos, videos, audios ────────────────────────────
export async function uploadChatMedia(chatId, file) {
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');
    const type = (isVideo || isAudio) ? 'video' : 'image';
    return _upload(file, type, null);
}

export async function uploadChatAudio(chatId, blob) {
    const file = new File([blob], 'audio.webm', { type: 'audio/webm' });
    return _upload(file, 'video', null);
}

// ── Historias (stories) ─────────────────────────────────────
export async function uploadStoryMedia(uid, file, onProgress) {
    const isVideo = file.type.startsWith('video/');
    const type = isVideo ? 'video' : 'image';
    return _upload(file, type, onProgress);
}
