import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Solo Auth — base de datos migrada a Turso
const firebaseConfig = {
    apiKey: "AIzaSyAf7wdjLoEuoXrojgPBIuovy4CcNL-SjD8",
    authDomain: "snapbooksocialweb.firebaseapp.com",
    projectId: "snapbooksocialweb",
    storageBucket: "snapbooksocialweb.firebasestorage.app",
    messagingSenderId: "399265666444",
    appId: "1:399265666444:web:2afe030b7200bc1ae372a9",
    measurementId: "G-3WWLENWMZD"
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
