import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

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
provider.setCustomParameters({ prompt: "select_account" });

let currentUser = null;
let accessToken = "";
let bookings = [];
let settings = defaultSettings();
let callback = () => {};
let unsubscribeBookings = null;
let unsubscribeSettings = null;
let bookingsReady = false;
let settingsReady = false;

export const cloudSync = {
  get user() { return currentUser; },
  get gmailAccessToken() { return accessToken; },
  subscribe(next) {
    callback = next;
    emit(currentUser ? "syncing" : "signed-out");
    return () => { callback = () => {}; };
  },
  async authorizeGmail() {
    provider.addScope("https://www.googleapis.com/auth/gmail.readonly");
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    accessToken = credential?.accessToken || "";
    if (!accessToken) throw new Error("Gmailのアクセストークンを取得できませんでした。");
    return accessToken;
  },
  async signIn() {
    const result = await signInWithPopup(auth, provider);
    accessToken = GoogleAuthProvider.credentialFromResult(result)?.accessToken || "";
  },
  async signOut() {
    accessToken = "";
    await signOut(auth);
  },
  async saveBooking(booking) {
    ensureUser();
    await setDoc(doc(bookingsRef(), booking.id), booking);
  },
  async deleteBooking(id) {
    ensureUser();
    await deleteDoc(doc(bookingsRef(), id));
  },
  async saveSettings(next) {
    ensureUser();
    await setDoc(settingsRef(), next, { merge: true });
  },
};

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  startListeners();
});

function startListeners() {
  unsubscribeBookings?.();
  unsubscribeSettings?.();
  bookings = [];
  settings = defaultSettings();
  bookingsReady = false;
  settingsReady = false;
  if (!currentUser) {
    emit("signed-out");
    return;
  }
  emit("syncing");
  unsubscribeBookings = onSnapshot(bookingsRef(), (snapshot) => {
    bookings = snapshot.docs.map((item) => item.data());
    bookingsReady = true;
    emit(bookingsReady && settingsReady ? "synced" : "syncing");
  }, (error) => emit("error", error));
  unsubscribeSettings = onSnapshot(settingsRef(), (snapshot) => {
    settings = { ...defaultSettings(), ...(snapshot.exists() ? snapshot.data() : {}) };
    settingsReady = true;
    emit(bookingsReady && settingsReady ? "synced" : "syncing");
  }, (error) => emit("error", error));
}

function bookingsRef() {
  return collection(db, "users", currentUser.uid, "tripDashboard", "bookings", "items");
}
function settingsRef() {
  return doc(db, "users", currentUser.uid, "tripDashboard", "settings");
}
function ensureUser() {
  if (!currentUser) throw new Error("Googleログインが必要です。");
}
function defaultSettings() {
  return { homeAirport: "福岡", lastSyncedAt: "" };
}
function emit(status, error = null) {
  callback({
    status,
    user: currentUser,
    state: { bookings, settings },
    error: error ? { code: String(error.code || ""), message: String(error.message || error) } : null,
  });
}

