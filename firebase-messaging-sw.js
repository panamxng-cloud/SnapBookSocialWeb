// SnapBook Pro — Firebase Cloud Messaging Service Worker
// Coloca este archivo en la RAÍZ de tu proyecto (mismo nivel que index.html)

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey:            "AIzaSyDN89D9cljm0e8OzrPtloYOUcOY7XSXBqg",
    authDomain:        "socialtest-3d114.firebaseapp.com",
    databaseURL:       "https://socialtest-3d114-default-rtdb.firebaseio.com",
    projectId:         "socialtest-3d114",
    storageBucket:     "socialtest-3d114.firebasestorage.app",
    messagingSenderId: "779140232754",
    appId:             "1:779140232754:android:8b1d492ce1970d98e26e2b"
});

const messaging = firebase.messaging();

// Manejar notificaciones en background (app cerrada o en otro tab)
messaging.onBackgroundMessage(payload => {
    console.log('[SW] Notificación recibida en background:', payload);

    const { title, body, icon, data } = payload.notification || {};
    const notifTitle = title || 'SnapBook Pro';
    const notifBody  = body  || 'Tienes una nueva notificación';

    self.registration.showNotification(notifTitle, {
        body:    notifBody,
        icon:    icon || '/icon-192.png',
        badge:   '/icon-192.png',
        data:    data || {},
        vibrate: [200, 100, 200],
        actions: [
            { action: 'open',    title: 'Ver' },
            { action: 'dismiss', title: 'Cerrar' }
        ]
    });
});

// Al hacer click en la notificación, abrir la app
self.addEventListener('notificationclick', event => {
    event.notification.close();
    if (event.action === 'dismiss') return;

    const url = event.notification.data?.url || '/Home.html';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.navigate(url);
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});
