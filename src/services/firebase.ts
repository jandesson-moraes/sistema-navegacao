import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, memoryLocalCache } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Configuração da sua frota NAV-PRO
const firebaseConfig = {
  apiKey: "AIzaSyD43nyoKrMr-NcgYosODsjojAdIWWDH340",
  authDomain: "sistema-navegacao.firebaseapp.com",
  projectId: "sistema-navegacao",
  storageBucket: "sistema-navegacao.firebasestorage.app",
  messagingSenderId: "105733878321",
  appId: "1:105733878321:web:b1771e07d889357e74db10",
};

// ⚓️ Inicialização do App (Segura para Web)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// 💾 Firestore (Configurado para rodar no Navegador)
// Usamos memoryLocalCache para evitar erros de permissão de disco no Chrome/Vite
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
});

// 📸 Storage (Fundamental para o Upload de Banners do Festival)
export const storage = getStorage(app);

// 🔐 Auth (Versão padrão para Web)
export const auth = getAuth(app);

export default app;
