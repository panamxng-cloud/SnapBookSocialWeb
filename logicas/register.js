// ═══════════════════════════════════════════════════════════
// register.js  —  SnapBook | Crear cuenta
// Ubicación: logicas/register.js
// ═══════════════════════════════════════════════════════════

import { auth } from '../servicios/firebase-config.js';
import {
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    updateProfile,
    GoogleAuthProvider,
    signInWithPopup,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { sincronizarUsuario, tursoQuery } from '../servicios/db.js';
import { uploadAvatar } from '../servicios/supabase-config.js';

// sheetdb-config.js no existe aún — stub silencioso
function logNuevoUsuario() {}

// ═══════════════════════════════════════════════════════════
// SEGURIDAD: Anti-bypass de navegación
// ═══════════════════════════════════════════════════════════
history.pushState(null, '', location.href);
window.addEventListener('popstate', () => history.pushState(null, '', location.href));

// Bloquear DevTools
let devBlocked = false;
setInterval(() => {
    const t = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    if (performance.now() - t > 150 && !devBlocked) {
        devBlocked = true;
        signOut(auth).catch(() => {});
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0a12;color:#ff6584;font-family:sans-serif;font-size:18px;text-align:center;padding:20px;"><div>⚠️<br><br>Sesión bloqueada por seguridad.<br><small style="color:rgba(255,255,255,0.4)">Cierra las herramientas de desarrollador y recarga la página.</small></div></div>';
    }
}, 3000);

// ═══════════════════════════════════════════════════════════
// VALIDACIÓN ESTRICTA DE FOTO
// ═══════════════════════════════════════════════════════════
function fotoValida(url) {
    if (!url || typeof url !== 'string') return false;
    const u = url.trim();
    return u.length > 10 && (u.startsWith('http') || u.startsWith('data:image'));
}

async function saveUserToDB(user, name, photoURL) {
    if (!fotoValida(photoURL)) throw new Error('Foto de perfil inválida');
    await sincronizarUsuario(user);
}

// ── TAB SWITCH ─────────────────────────────────────────────
window.switchRegTab = function(tab) {
    const emailP = document.getElementById('reg-email-panel');
    const phoneP = document.getElementById('reg-phone-panel');
    const tE     = document.getElementById('reg-tab-email');
    const tP     = document.getElementById('reg-tab-phone');
    if (tab === 'email') {
        emailP.classList.remove('hidden');
        phoneP.classList.remove('active');
        tE.classList.add('active');
        tP.classList.remove('active');
    } else {
        emailP.classList.add('hidden');
        phoneP.classList.add('active');
        tE.classList.remove('active');
        tP.classList.add('active');
        initRegRecaptcha();
    }
};

// ── PHONE REGISTER ──────────────────────────────────────────
let regConfirmResult  = null;
let regRecaptcha      = null;
let regResendInterval = null;
let regTermsAccepted  = false;

const regTermsCheck = document.getElementById('terms-check-phone');
regTermsCheck.onclick = () => {
    regTermsAccepted = !regTermsAccepted;
    regTermsCheck.classList.toggle('checked', regTermsAccepted);
};

function initRegRecaptcha() {
    if (regRecaptcha) return;
    regRecaptcha = new RecaptchaVerifier(auth, 'recaptcha-container-reg', {
        size: 'normal',
        'expired-callback': () => { regRecaptcha = null; initRegRecaptcha(); }
    });
    regRecaptcha.render();
}

function startRegTimer() {
    let secs = 60;
    const btn     = document.getElementById('reg-resend-btn');
    const timerEl = document.getElementById('reg-resend-timer');
    btn.disabled  = true;
    clearInterval(regResendInterval);
    regResendInterval = setInterval(() => {
        secs--;
        timerEl.textContent = secs;
        if (secs <= 0) {
            clearInterval(regResendInterval);
            btn.disabled    = false;
            btn.textContent = 'Reenviar código';
        }
    }, 1000);
}

document.getElementById('reg-send-otp-btn').onclick = async () => {
    if (!avatarFile) {
        const r = document.getElementById('avatar-ring');
        r.classList.add('error-ring');
        setTimeout(() => r.classList.remove('error-ring'), 600);
        showError('La foto de perfil es obligatoria antes de continuar.');
        r.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    const name = document.getElementById('phone-fullname').value.trim();
    if (!name || name.length < 3) { showError('Escribe tu nombre completo.'); return; }
    if (!regTermsAccepted)        { showError('Debes aceptar los términos.'); return; }
    const code = document.getElementById('reg-country-code').value;
    const num  = document.getElementById('reg-phone-number').value.trim().replace(/\D/g, '');
    if (!num || num.length < 7 || num.length > 15) {
        showError('Ingresa un número válido (7-15 dígitos).'); return;
    }
    const fullPhone = code + num;
    const btn = document.getElementById('reg-send-otp-btn');
    btn.classList.add('loading'); btn.disabled = true;
    try {
        regConfirmResult = await signInWithPhoneNumber(auth, fullPhone, regRecaptcha);
        document.getElementById('reg-otp-phone-display').textContent = fullPhone;
        document.getElementById('reg-phone-step1').style.display = 'none';
        document.getElementById('reg-phone-step2').classList.add('visible');
        document.getElementById('r1').focus();
        startRegTimer();
    } catch(err) {
        btn.classList.remove('loading'); btn.disabled = false;
        regRecaptcha = null;
        document.getElementById('recaptcha-container-reg').innerHTML = '';
        initRegRecaptcha();
        const msgs = {
            'auth/invalid-phone-number': 'Número inválido.',
            'auth/too-many-requests'   : 'Demasiados intentos. Intenta más tarde.',
        };
        showError(msgs[err.code] || 'Error al enviar SMS.');
    }
};

['r1','r2','r3','r4','r5','r6'].forEach((id, i, arr) => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => {
        el.value = el.value.replace(/\D/g, '').slice(-1);
        if (el.value && i < arr.length - 1) document.getElementById(arr[i + 1]).focus();
    });
    el.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !el.value && i > 0) document.getElementById(arr[i - 1]).focus();
    });
    el.addEventListener('paste', e => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        arr.forEach((aid, ai) => { document.getElementById(aid).value = pasted[ai] || ''; });
        const last = Math.min(pasted.length, arr.length) - 1;
        if (last >= 0) document.getElementById(arr[last]).focus();
    });
});

document.getElementById('reg-verify-otp-btn').onclick = async () => {
    if (!avatarFile) { showError('La foto de perfil es obligatoria.'); return; }
    const code = ['r1','r2','r3','r4','r5','r6'].map(id => document.getElementById(id).value).join('');
    if (code.length < 6 || !/^\d{6}$/.test(code)) { showError('Ingresa los 6 dígitos.'); return; }
    const btn = document.getElementById('reg-verify-otp-btn');
    btn.classList.add('loading'); btn.disabled = true;
    try {
        const result  = await regConfirmResult.confirm(code);
        const user    = result.user;
        const name    = document.getElementById('phone-fullname').value.trim();
        let photoURL  = '';
        try { photoURL = await uploadAvatar(user.uid, avatarFile); } catch(e) {}
        if (!fotoValida(photoURL)) {
            await user.delete().catch(() => {});
            throw new Error('No se pudo subir la foto. Intenta de nuevo.');
        }
        await updateProfile(user, { displayName: name, photoURL });
        await saveUserToDB(user, name, photoURL);
        showSuccess('¡Cuenta creada! Redirigiendo...');
        setTimeout(() => location.replace('Home.html'), 1200);
    } catch(err) {
        btn.classList.remove('loading'); btn.disabled = false;
        showError(err.message === 'No se pudo subir la foto. Intenta de nuevo.'
            ? err.message
            : 'Código incorrecto o expirado.');
    }
};

document.getElementById('reg-resend-btn').onclick = () => {
    document.getElementById('reg-phone-step2').classList.remove('visible');
    document.getElementById('reg-phone-step1').style.display = 'block';
    regRecaptcha = null;
    document.getElementById('recaptcha-container-reg').innerHTML = '';
    initRegRecaptcha();
};

// ── ESTADO ──────────────────────────────────────────────────
let registrando = false;
const modoCompletar = new URLSearchParams(location.search).get('completar') === '1';

const _authTimeout = setTimeout(() => {
    document.getElementById('_auth_guard_overlay').style.display = 'none';
}, 6000);

auth.authStateReady().then(async () => {
    clearTimeout(_authTimeout);
    document.getElementById('_auth_guard_overlay').style.display = 'none';
    const user = auth.currentUser;
    if (user && !registrando && !modoCompletar) {
        const snapRows = await tursoQuery(
            'SELECT avatar, nombre FROM usuarios WHERE uid = ?', [user.uid]
        ).catch(() => []);
        if (snapRows.length > 0) {
            const val = snapRows[0];
            if (fotoValida(val.photoURL || val.avatar || '')) {
                location.replace('Home.html');
                return;
            }
        }
    }
});

onAuthStateChanged(auth, async u => {
    if (u) window.__snapbookUser = u;
    if (u && !registrando && !modoCompletar) {
        const snapRows2 = await tursoQuery(
            'SELECT avatar, nombre FROM usuarios WHERE uid = ?', [u.uid]
        ).catch(() => []);
        if (snapRows2.length > 0) {
            const val = snapRows2[0];
            if (fotoValida(val.photoURL || val.avatar || '')) {
                location.replace('Home.html');
                return;
            }
        }
    }
    if (u && modoCompletar) {
        document.getElementById('fullname').value    = u.displayName || '';
        document.getElementById('fullname').readOnly = true;
        document.querySelectorAll('.campo-registro').forEach(el => el.style.display = 'none');
        document.getElementById('card-title').textContent = 'Agrega tu foto de perfil';
        document.getElementById('card-sub').textContent   = 'Es obligatorio para continuar usando SnapBook';
        document.getElementById('register-btn').querySelector('.btn-text').textContent = 'Guardar y continuar';
        document.getElementById('footer-link').style.display    = 'none';
        document.getElementById('google-section').style.display = 'none';
    }
});

// ── AVATAR PREVIEW ─────────────────────────────────────────
let avatarFile = null;
const ring      = document.getElementById('avatar-ring');
const preview   = document.getElementById('avatar-preview');
const fileInput = document.getElementById('avatar-file');

ring.onclick = () => fileInput.click();
fileInput.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
        showError('Solo se permiten imágenes JPG, PNG, WEBP o GIF.');
        fileInput.value = ''; return;
    }
    if (file.size > 5 * 1024 * 1024) {
        showError('La imagen no puede superar los 5 MB.');
        fileInput.value = ''; return;
    }
    avatarFile = file;
    const reader = new FileReader();
    reader.onload = ev => {
        preview.src = ev.target.result;
        ring.classList.add('has-img');
        ring.classList.remove('error-ring');
        const hint = document.getElementById('avatar-hint');
        hint.textContent = '✓ Foto agregada';
        hint.classList.add('ok');
    };
    reader.readAsDataURL(file);
};

function setupEye(btnId, inputId, iconId) {
    document.getElementById(btnId).onclick = () => {
        const inp  = document.getElementById(inputId);
        const show = inp.type === 'password';
        inp.type   = show ? 'text' : 'password';
        document.getElementById(iconId).className =
            show ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
    };
}
setupEye('eye-btn',  'password',         'eye-icon');
setupEye('eye-btn2', 'confirm-password', 'eye-icon2');

const passInput = document.getElementById('password');
passInput.addEventListener('input', () => {
    const val = passInput.value;
    let score = 0;
    if (val.length >= 6)                          score++;
    if (val.length >= 10)                         score++;
    if (/[A-Z]/.test(val) && /[0-9]/.test(val))  score++;
    if (/[^A-Za-z0-9]/.test(val))                score++;
    const colors = ['#e74c3c', '#f39c12', '#1877f2', '#43e97b'];
    const labels = ['', 'Débil', 'Media', 'Fuerte', 'Muy fuerte'];
    for (let i = 1; i <= 4; i++) {
        const seg = document.getElementById('s' + i);
        seg.style.background = i <= score ? colors[score - 1] : 'rgba(255,255,255,0.1)';
    }
    document.getElementById('strength-label').textContent =
        val ? (labels[score] || 'Débil') : '';
    document.getElementById('strength-label').style.color =
        val ? colors[Math.max(0, score - 1)] : 'rgba(255,255,255,0.3)';
});

let termsAccepted = false;
const termsCheck  = document.getElementById('terms-check');
termsCheck.onclick = () => {
    termsAccepted = !termsAccepted;
    termsCheck.classList.toggle('checked', termsAccepted);
};

function showError(msg) {
    const el = document.getElementById('error-msg');
    document.getElementById('error-text').textContent = msg;
    el.classList.add('visible');
    document.getElementById('success-msg').classList.remove('visible');
}
function showSuccess(msg) {
    const el = document.getElementById('success-msg');
    document.getElementById('success-text').textContent = msg;
    el.classList.add('visible');
    document.getElementById('error-msg').classList.remove('visible');
}
function hideMessages() {
    document.getElementById('error-msg').classList.remove('visible');
    document.getElementById('success-msg').classList.remove('visible');
}

function getErrorMsg(code) {
    const map = {
        'auth/email-already-in-use'  : 'Ese correo ya está registrado.',
        'auth/invalid-email'         : 'El correo no es válido.',
        'auth/weak-password'         : 'La contraseña es demasiado débil (mínimo 6 caracteres).',
        'auth/network-request-failed': 'Sin conexión a internet.',
    };
    return map[code] || 'Error al registrar. Intenta de nuevo.';
}

const registerBtn = document.getElementById('register-btn');
registerBtn.onclick = async () => {
    hideMessages();

    if (!avatarFile) {
        const r = document.getElementById('avatar-ring');
        r.classList.add('error-ring');
        setTimeout(() => r.classList.remove('error-ring'), 600);
        showError('La foto de perfil es obligatoria.');
        r.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    if (modoCompletar) {
        const user = auth.currentUser;
        if (!user) { location.replace('index.html'); return; }
        registerBtn.classList.add('loading');
        registerBtn.disabled = true;
        registrando = true;
        try {
            const photoURL = await uploadAvatar(user.uid, avatarFile);
            if (!fotoValida(photoURL)) throw new Error('Foto inválida');
            await updateProfile(user, { photoURL });
            await tursoQuery(
                'UPDATE usuarios SET avatar = ? WHERE uid = ?', [photoURL, user.uid]
            ).catch(() => {});
            showSuccess('¡Foto guardada! Redirigiendo...');
            setTimeout(() => location.replace('Home.html'), 1200);
        } catch(e) {
            registrando = false;
            registerBtn.classList.remove('loading');
            registerBtn.disabled = false;
            showError('Error al guardar la foto. Intenta de nuevo.');
        }
        return;
    }

    // Verificar Turnstile
    const tsToken = window.turnstile?.getResponse(document.getElementById('turnstile-register')) || '';
    if (!tsToken) { showError('Completa la verificación de seguridad.'); return; }

    const name     = document.getElementById('fullname').value.trim();
    const email    = document.getElementById('email').value.trim().toLowerCase();
    const password = document.getElementById('password').value;
    const confirm  = document.getElementById('confirm-password').value;

    if (!name || name.length < 3)  { showError('Escribe tu nombre completo (mínimo 3 caracteres).'); return; }
    if (!email)                    { showError('Escribe tu correo electrónico.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('El correo no tiene un formato válido.'); return; }
    if (!password)                 { showError('Escribe una contraseña.'); return; }
    if (password.length < 6)       { showError('La contraseña debe tener al menos 6 caracteres.'); return; }
    if (password !== confirm)      { showError('Las contraseñas no coinciden.'); return; }
    if (!termsAccepted) {
        const row = document.getElementById('terms-check').closest('.terms-row');
        row.classList.add('error');
        setTimeout(() => row.classList.remove('error'), 600);
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showError('Debes aceptar los términos para continuar.');
        return;
    }

    registerBtn.classList.add('loading');
    registerBtn.disabled = true;
    registrando = true;

    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        let photoURL = '';
        try { photoURL = await uploadAvatar(cred.user.uid, avatarFile); } catch(e) {}
        if (!fotoValida(photoURL)) {
            await cred.user.delete().catch(() => {});
            throw new Error('No se pudo subir la foto. La cuenta no fue creada. Intenta de nuevo.');
        }
        await updateProfile(cred.user, { displayName: name, photoURL });
        await saveUserToDB(cred.user, name, photoURL);
        logNuevoUsuario(cred.user.uid, name, email);
        showSuccess('¡Cuenta creada! Redirigiendo...');
        setTimeout(() => location.replace('Home.html'), 1200);
    } catch (err) {
        registrando = false;
        registerBtn.classList.remove('loading');
        registerBtn.disabled = false;
        showError(err.message.includes('foto') ? err.message : getErrorMsg(err.code));
    }
};

document.getElementById('google-btn').onclick = async () => {
    hideMessages();
    try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const result = await signInWithPopup(auth, provider);
        const user   = result.user;
        const photo  = user.photoURL || '';
        await sincronizarUsuario(user);
        if (!fotoValida(photo)) {
            location.replace('register.html?completar=1');
        } else {
            location.replace('Home.html');
        }
    } catch(err) {
        if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
            showError(getErrorMsg(err.code));
        }
    }
};
