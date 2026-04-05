// ── theme.js — Pegar en todas las páginas dentro de <head> ──
// <script src="theme.js"></script>

(function () {
    const COLORS = [
        { name: 'Morado',  light: '#6c63ff', dark: '#6c63ff' },
        { name: 'Azul',    light: '#1877f2', dark: '#4da3ff' },
        { name: 'Rosa',    light: '#e91e8c', dark: '#ff6eb4' },
        { name: 'Verde',   light: '#2ecc71', dark: '#43ef7b' },
        { name: 'Naranja', light: '#f39c12', dark: '#ffb347' },
        { name: 'Rojo',    light: '#e74c3c', dark: '#ff6b6b' },
        { name: 'Cyan',    light: '#00bcd4', dark: '#26d9f0' },
        { name: 'Dorado',  light: '#d4a017', dark: '#ffd700' },
    ];

    // Aplicar tema oscuro/claro
    const theme = localStorage.getItem('snapbook-theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);

    // Aplicar color de acento
    const savedName = localStorage.getItem('snapbook-accent') || 'Morado';
    const color = COLORS.find(c => c.name === savedName) || COLORS[0];
    const isDark = theme === 'dark';
    const val = isDark ? color.dark : color.light;
    document.documentElement.style.setProperty('--accent', val);
    document.documentElement.style.setProperty('--accent-light', color.light);
    document.documentElement.style.setProperty('--accent-dark', color.dark);
})();
