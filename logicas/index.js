// ═══════════════════════════════════════════════════════════
// index.js  —  SnapBook | Iniciar sesión
// type="module"  →  importado desde index.html
// ═══════════════════════════════════════════════════════════

import { auth } from '../servicios/firebase-config.js';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    GoogleAuthProvider,
    signInWithPopup,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { sincronizarUsuario } from '../servicios/db.js';

// ═══════════════════════════════════════════════════════════
// SEGURIDAD: Anti-bypass de navegación
// ═══════════════════════════════════════════════════════════
history.pushState(null, '', location.href);
window.addEventListener('popstate', () => history.pushState(null, '', location.href));

// Bloquear apertura de DevTools (dificulta manipulación)
let devBlocked = false;
setInterval(() => {
    const t = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    if (performance.now() - t > 150 && !devBlocked) {
        devBlocked = true;
        signOut(auth).catch(() => {});
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0a12;color:#ff6584;font-family:sans-serif;font-size:18px;text-align:center;padding:20px;"><div><i style="font-size:48px">⚠️</i><br><br>Sesión bloqueada por seguridad.<br><small style="color:rgba(255,255,255,0.4)">Cierra las herramientas de desarrollador y recarga la página.</small></div></div>';
    }
}, 3000);

// ═══════════════════════════════════════════════════════════
// RATE LIMITING: máx 5 intentos → bloqueo 5 min
// ═══════════════════════════════════════════════════════════
const MAX_ATTEMPTS = 5;
const BLOCK_MS     = 5 * 60 * 1000;

function getAttempts() {
    try { return JSON.parse(sessionStorage.getItem('_sb_la') || '{"c":0,"b":0}'); }
    catch { return { c: 0, b: 0 }; }
}
function saveAttempts(d)  { try { sessionStorage.setItem('_sb_la', JSON.stringify(d)); } catch {} }
function resetAttempts()  { sessionStorage.removeItem('_sb_la'); }

function registerFail() {
    const d = getAttempts();
    d.c++;
    if (d.c >= MAX_ATTEMPTS) d.b = Date.now() + BLOCK_MS;
    saveAttempts(d);
    return d;
}
function checkBlocked() {
    const d = getAttempts();
    if (d.b && Date.now() < d.b) {
        const mins = Math.ceil((d.b - Date.now()) / 60000);
        return `Demasiados intentos fallidos. Espera ${mins} min antes de intentar de nuevo.`;
    }
    if (d.b && Date.now() >= d.b) resetAttempts();
    return false;
}
function attemptsLeft() {
    const d = getAttempts();
    return Math.max(0, MAX_ATTEMPTS - d.c);
}

// ═══════════════════════════════════════════════════════════
// VALIDACIÓN ESTRICTA DE PERFIL
// Doble verificación: token Firebase + foto en DB
// ═══════════════════════════════════════════════════════════
async function perfilValido(user) {
    if (!user) return false;
    try {
        await user.getIdToken(true);
        const rows = await sincronizarUsuario(user).then(() =>
            fetch('').catch(() => null)
        ).catch(() => null);
        const r = await import('./db.js').then(m =>
            m.tursoQuery('SELECT avatar FROM usuarios WHERE uid = ?', [user.uid])
        ).catch(() => []);
        const foto = (r[0]?.avatar || user.photoURL || '').trim();
        return foto.length > 10 && (foto.startsWith('http') || foto.startsWith('data:'));
    } catch { return !!user.photoURL; }
}

async function redirectSeguro(user) {
    if (!user) { location.replace('index.html'); return; }
    const valido = await perfilValido(user);
    if (valido) {
        location.replace('Home.html');
    } else {
        location.replace('register.html?completar=1');
    }
}

// ── TAB SWITCH ────────────────────────────────────────────
window.switchTab = function(tab) {
    const emailPanel = document.getElementById('email-panel');
    const phonePanel = document.getElementById('phone-panel');
    const tabEmail   = document.getElementById('tab-email');
    const tabPhone   = document.getElementById('tab-phone');
    if (tab === 'email') {
        emailPanel.classList.remove('hidden');
        phonePanel.classList.remove('active');
        tabEmail.classList.add('active');
        tabPhone.classList.remove('active');
    } else {
        emailPanel.classList.add('hidden');
        phonePanel.classList.add('active');
        tabEmail.classList.remove('active');
        tabPhone.classList.add('active');
        initRecaptcha();
    }
};

// ── PHONE AUTH ─────────────────────────────────────────────
let confirmationResult = null;
let recaptchaVerifier  = null;
let resendInterval     = null;

function initRecaptcha() {
    if (recaptchaVerifier) return;
    recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size    : 'normal',
        callback: () => { document.getElementById('send-otp-btn').disabled = false; },
        'expired-callback': () => { recaptchaVerifier = null; initRecaptcha(); }
    });
    recaptchaVerifier.render();
}

function startResendTimer() {
    let secs = 60;
    const btn     = document.getElementById('resend-btn');
    const timerEl = document.getElementById('resend-timer');
    btn.disabled = true;
    clearInterval(resendInterval);
    resendInterval = setInterval(() => {
        secs--;
        timerEl.textContent = secs;
        if (secs <= 0) {
            clearInterval(resendInterval);
            btn.disabled = false;
            btn.textContent = 'Reenviar código';
        }
    }, 1000);
}

// Send OTP
document.getElementById('send-otp-btn').onclick = async () => {
    hideError();
    const blocked = checkBlocked();
    if (blocked) { showError(blocked); return; }
    const code      = document.getElementById('country-code').value;
    const num       = document.getElementById('phone-number').value.trim().replace(/\D/g, '');
    if (!num || num.length < 7 || num.length > 15) {
        showError('Ingresa un número válido (7-15 dígitos).'); return;
    }
    const fullPhone = code + num;
    const btn = document.getElementById('send-otp-btn');
    btn.classList.add('loading'); btn.disabled = true;
    try {
        confirmationResult = await signInWithPhoneNumber(auth, fullPhone, recaptchaVerifier);
        document.getElementById('otp-phone-display').textContent = fullPhone;
        document.getElementById('phone-step1').style.display = 'none';
        document.getElementById('phone-step2').classList.add('visible');
        document.getElementById('o1').focus();
        startResendTimer();
    } catch(err) {
        registerFail();
        btn.classList.remove('loading'); btn.disabled = false;
        recaptchaVerifier = null; initRecaptcha();
        const msgs = {
            'auth/invalid-phone-number': 'Número de teléfono inválido.',
            'auth/too-many-requests'   : 'Demasiados intentos. Intenta más tarde.',
            'auth/quota-exceeded'      : 'Límite de SMS alcanzado. Intenta más tarde.',
        };
        showError(msgs[err.code] || 'Error al enviar SMS. Verifica el número.');
    }
};

// OTP inputs: solo dígitos, auto-advance, soporte paste
['o1','o2','o3','o4','o5','o6'].forEach((id, i, arr) => {
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
        arr.forEach((aid, ai) => {
            document.getElementById(aid).value = pasted[ai] || '';
        });
        const last = Math.min(pasted.length, arr.length) - 1;
        if (last >= 0) document.getElementById(arr[last]).focus();
    });
});

// Verify OTP
document.getElementById('verify-otp-btn').onclick = async () => {
    hideError();
    const blocked = checkBlocked();
    if (blocked) { showError(blocked); return; }
    const code = ['o1','o2','o3','o4','o5','o6'].map(id => document.getElementById(id).value).join('');
    if (code.length < 6 || !/^\d{6}$/.test(code)) {
        showError('Ingresa los 6 dígitos del código.'); return;
    }
    const btn = document.getElementById('verify-otp-btn');
    btn.classList.add('loading'); btn.disabled = true;
    try {
        const result = await confirmationResult.confirm(code);
        try { await sincronizarUsuario(result.user); } catch {}
        resetAttempts();
        await redirectSeguro(result.user);
    } catch(err) {
        registerFail();
        btn.classList.remove('loading'); btn.disabled = false;
        const left = attemptsLeft();
        showError(left > 0
            ? `Código incorrecto o expirado. Intentos restantes: ${left}`
            : 'Cuenta bloqueada temporalmente por seguridad. Espera 5 min.');
    }
};

// Resend
document.getElementById('resend-btn').onclick = async () => {
    document.getElementById('phone-step2').classList.remove('visible');
    document.getElementById('phone-step1').style.display = 'block';
    recaptchaVerifier = null;
    document.getElementById('recaptcha-container').innerHTML = '';
    initRecaptcha();
};

// ── GUARDA PERFIL GOOGLE ───────────────────────────────────
async function saveGoogleUserToDB(user) {
    try { await sincronizarUsuario(user); } catch {}
}

// ── LISTENER AUTH ─────────────────────────────────────────
let authReady = false;
onAuthStateChanged(auth, async user => {
    if (!authReady) { authReady = true; return; }
    if (user) await redirectSeguro(user);
});

// ── AUTH TIMEOUT ─────────────────────────────────────────
const _authTimeout = setTimeout(() => {
    document.getElementById('_auth_guard_overlay').style.display = 'none';
}, 6000);

auth.authStateReady().then(async () => {
    clearTimeout(_authTimeout);
    document.getElementById('_auth_guard_overlay').style.display = 'none';
    const user = auth.currentUser;
    if (user) await redirectSeguro(user);
});

// ── SHOW / HIDE PASSWORD ───────────────────────────────────
const passInput = document.getElementById('password');
const eyeIcon   = document.getElementById('eye-icon');
document.getElementById('eye-btn').onclick = () => {
    const show = passInput.type === 'password';
    passInput.type = show ? 'text' : 'password';
    eyeIcon.className = show ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
};

// ── ERROR ──────────────────────────────────────────────────
function showError(msg) {
    const el = document.getElementById('error-msg');
    document.getElementById('error-text').textContent = msg;
    el.classList.add('visible');
}
function hideError() { document.getElementById('error-msg').classList.remove('visible'); }

function getErrorMsg(code) {
    const map = {
        'auth/user-not-found'        : 'No existe una cuenta con ese correo.',
        'auth/wrong-password'        : 'Contraseña incorrecta.',
        'auth/invalid-email'         : 'El correo no es válido.',
        'auth/too-many-requests'     : 'Demasiados intentos. Intenta más tarde.',
        'auth/invalid-credential'    : 'Correo o contraseña incorrectos.',
        'auth/network-request-failed': 'Sin conexión a internet.',
        'auth/user-disabled'         : 'Esta cuenta ha sido deshabilitada.',
    };
    return map[code] || 'Error al iniciar sesión. Intenta de nuevo.';
}

// ── TURNSTILE ──────────────────────────────────────────────
function getTurnstileToken() {
    return window.turnstile?.getResponse(document.getElementById('turnstile-login')) || '';
}
function resetTurnstile() {
    try { window.turnstile?.reset(document.getElementById('turnstile-login')); } catch {}
}

// ── LOGIN EMAIL ────────────────────────────────────────────
const loginBtn = document.getElementById('login-btn');
loginBtn.onclick = async () => {
    hideError();

    const blocked = checkBlocked();
    if (blocked) { showError(blocked); return; }

    const tsToken = getTurnstileToken();
    if (!tsToken) { showError('Completa la verificación de seguridad.'); return; }

    const email    = document.getElementById('email').value.trim().toLowerCase();
    const password = document.getElementById('password').value;

    if (!email || !password) { showError('Completa todos los campos.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError('El correo no tiene un formato válido.'); return;
    }
    if (password.length < 6) {
        showError('La contraseña debe tener al menos 6 caracteres.'); return;
    }

    loginBtn.classList.add('loading');
    loginBtn.disabled = true;

    try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        resetAttempts();
        await redirectSeguro(cred.user);
    } catch (err) {
        registerFail();
        resetTurnstile();
        loginBtn.classList.remove('loading');
        loginBtn.disabled = false;
        const left = attemptsLeft();
        showError(left > 0
            ? `${getErrorMsg(err.code)} (${left} intentos restantes)`
            : 'Cuenta bloqueada temporalmente. Espera 5 min.');
    }
};

// Enter key solo cuando el panel de correo está visible
document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const emailPanelVisible = !document.getElementById('email-panel').classList.contains('hidden');
    if (emailPanelVisible) loginBtn.click();
});

// ── FORGOT PASSWORD ────────────────────────────────────────
document.getElementById('forgot-btn').onclick = async () => {
    const email = document.getElementById('email').value.trim().toLowerCase();
    if (!email) { showError('Escribe tu correo primero para restablecer la contraseña.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError('El correo no tiene un formato válido.'); return;
    }
    try {
        await sendPasswordResetEmail(auth, email);
        hideError();
        alert('✅ Correo de restablecimiento enviado. Revisa tu bandeja de entrada.');
    } catch(err) {
        showError(getErrorMsg(err.code));
    }
};

// ── GOOGLE SIGN IN ─────────────────────────────────────────
document.getElementById('google-btn').onclick = async () => {
    hideError();
    const blocked = checkBlocked();
    if (blocked) { showError(blocked); return; }
    try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const result = await signInWithPopup(auth, provider);
        await saveGoogleUserToDB(result.user);
        resetAttempts();
        await redirectSeguro(result.user);
    } catch(err) {
        if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
            registerFail();
            showError(getErrorMsg(err.code));
        }
    }
};
