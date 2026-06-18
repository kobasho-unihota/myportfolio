import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  doc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { cleanCloudState, emptyCloudState } from "./firebase-state.mjs?v=32";

const firebaseConfig = {
  apiKey: "AIzaSyDdRlINBq1fdFbfKKkl5dQQM6rlWAKM9vo",
  authDomain: "seed-note-kobasho.firebaseapp.com",
  projectId: "seed-note-kobasho",
  storageBucket: "seed-note-kobasho.firebasestorage.app",
  messagingSenderId: "1042714808944",
  appId: "1:1042714808944:web:f5253c9b257bdac09a1ab5",
};

const app = initializeApp(firebaseConfig, "tripboard");
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
const provider = new GoogleAuthProvider();

let currentUser = null;
let currentState = emptyCloudState();
let callback = () => {};
let unsubscribeState = null;

export const cloudSync = {
  get user() { return currentUser; },
  subscribe(next) {
    callback = next;
    emit("loading");
    return () => { callback = () => {}; };
  },
  async signIn() {
    await signInWithPopup(auth, provider);
  },
  async signOut() {
    await signOut(auth);
  },
  async saveState(nextState) {
    ensureUser();
    const clean = cleanCloudState(nextState);
    await setDoc(stateRef(), {
      version: 4,
      ...clean,
      updatedAt: new Date().toISOString(),
    });
  },
  async retry() {
    ensureUser();
    startListener(currentUser);
  },
};

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  startListener(user);
});

function startListener(user) {
  unsubscribeState?.();
  unsubscribeState = null;
  currentState = emptyCloudState();
  if (!user) {
    emit("signed-out");
    return;
  }
  emit("syncing");
  unsubscribeState = onSnapshot(stateRef(), (snapshot) => {
    currentState = snapshot.exists() ? cleanCloudState(snapshot.data()) : emptyCloudState();
    emit("synced");
  }, (error) => emit("error", error));
}

function stateRef() {
  return doc(db, "users", currentUser.uid, "tripDashboard", "state");
}

function ensureUser() {
  if (!currentUser) throw new Error("Googleログインが必要です。");
}

function emit(status, error = null) {
  callback({
    status,
    user: currentUser,
    state: currentState,
    error: error ? {
      code: String(error.code || ""),
      message: String(error.message || error),
    } : null,
  });
}
