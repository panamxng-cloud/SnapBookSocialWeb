import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDN89D9cljm0e8OzrPtloYOUcOY7XSXBqg",
    authDomain: "socialtest-3d114.firebaseapp.com",
    databaseURL: "https://socialtest-3d114-default-rtdb.firebaseio.com",
    projectId: "socialtest-3d114",
    storageBucket: "socialtest-3d114.firebasestorage.app",
    messagingSenderId: "779140232754",
    appId: "1:779140232754:android:8b1d492ce1970d98e26e2b"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
