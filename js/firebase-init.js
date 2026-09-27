/* Loads the Firebase SDK (ES modules from Google's CDN) and exposes what the
   rest of the app needs on window.FB. The other scripts are classic scripts,
   so this module is the one place that deals with imports.

   The apiKey below is a public identifier, not a secret — access control is
   enforced by Firestore security rules. Authentication is handled entirely
   by the app: passwords are stored on user docs in Firestore and compared
   client-side. See firestore.rules for the collection-scoped write bounds
   that stop trivial abuse. */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, onSnapshot, writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBTfvFaYj3__Bzv5NfKuFlwBagtNlHc5RM',
  authDomain: 'vehicle-dashboard-admin.firebaseapp.com',
  projectId: 'vehicle-dashboard-admin',
  storageBucket: 'vehicle-dashboard-admin.firebasestorage.app',
  messagingSenderId: '344058337161',
  appId: '1:344058337161:web:a8da780a69459f2b8cb358',
};

const app = initializeApp(firebaseConfig);

let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  // Persistent cache can fail (e.g. private browsing) — fall back to memory.
  db = initializeFirestore(app, {});
}

window.FB = {
  app, db, firebaseConfig,
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, onSnapshot, writeBatch,
};
