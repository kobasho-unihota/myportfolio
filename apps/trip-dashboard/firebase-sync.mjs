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
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { buildProviderReplacementOperations } from "./core.mjs?v=12";

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
let aiAnalyses = [];
let settings = defaultSettings();
let callback = () => {};
let unsubscribeBookings = null;
let unsubscribeAnalyses = null;
let unsubscribeSettings = null;
let bookingsReady = false;
let analysesReady = false;
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
  async saveAnalysis(analysis) {
    ensureUser();
    await setDoc(doc(analysesRef(), analysis.messageId), analysis, { merge: true });
  },
  async saveAnalyses(nextAnalyses) {
    ensureUser();
    for (let index = 0; index < nextAnalyses.length; index += 400) {
      const batch = writeBatch(db);
      nextAnalyses.slice(index, index + 400).forEach((analysis) => {
        batch.set(doc(analysesRef(), analysis.messageId), analysis, { merge: true });
      });
      await batch.commit();
    }
  },
  async deleteBooking(id) {
    ensureUser();
    await deleteDoc(doc(bookingsRef(), id));
  },
  async saveSettings(next) {
    ensureUser();
    await setDoc(settingsRef(), next, { merge: true });
  },
  async resetHiddenBookings() {
    ensureUser();
    const hiddenBookings = bookings.filter((booking) => booking.hidden);
    for (let index = 0; index < hiddenBookings.length; index += 400) {
      const batch = writeBatch(db);
      hiddenBookings.slice(index, index + 400).forEach((booking) => {
        batch.set(doc(bookingsRef(), booking.id), {
          hidden: false,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      });
      await batch.commit();
    }
    return hiddenBookings.length;
  },
  async clearImportedData() {
    ensureUser();
    const deleted = { bookings: bookings.length, aiAnalyses: aiAnalyses.length };
    const bookingIds = bookings.map((booking) => booking.id).filter(Boolean);
    const analysisIds = aiAnalyses.map((analysis) => analysis.messageId).filter(Boolean);
    for (let index = 0; index < bookingIds.length; index += 400) {
      const batch = writeBatch(db);
      bookingIds.slice(index, index + 400).forEach((id) => batch.delete(doc(bookingsRef(), id)));
      await batch.commit();
    }
    for (let index = 0; index < analysisIds.length; index += 400) {
      const batch = writeBatch(db);
      analysisIds.slice(index, index + 400).forEach((id) => batch.delete(doc(analysesRef(), id)));
      await batch.commit();
    }
    await setDoc(settingsRef(), { lastSyncedAt: "" }, { merge: true });
    return deleted;
  },
  async replaceHotelBookings(nextHotels) {
    if (!nextHotels.length) {
      throw new Error("解析ホテルが0件のため、既存ホテル予約は変更しません。");
    }
    await replaceProviderBookings("楽天トラベル", nextHotels, { preserveExistingOnEmpty: true });
  },
  async replaceFlightBookings(nextFlights) {
    await replaceProviderBookings("JAL", nextFlights);
  },
};

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  startListeners();
});

function startListeners() {
  unsubscribeBookings?.();
  unsubscribeAnalyses?.();
  unsubscribeSettings?.();
  bookings = [];
  aiAnalyses = [];
  settings = defaultSettings();
  bookingsReady = false;
  analysesReady = false;
  settingsReady = false;
  if (!currentUser) {
    emit("signed-out");
    return;
  }
  emit("syncing");
  unsubscribeBookings = onSnapshot(bookingsRef(), (snapshot) => {
    bookings = snapshot.docs.map((item) => item.data());
    bookingsReady = true;
    emit(bookingsReady && analysesReady && settingsReady ? "synced" : "syncing");
  }, (error) => emit("error", error));
  unsubscribeAnalyses = onSnapshot(analysesRef(), (snapshot) => {
    aiAnalyses = snapshot.docs.map((item) => item.data());
    analysesReady = true;
    emit(bookingsReady && analysesReady && settingsReady ? "synced" : "syncing");
  }, (error) => emit("error", error));
  unsubscribeSettings = onSnapshot(settingsRef(), (snapshot) => {
    settings = { ...defaultSettings(), ...(snapshot.exists() ? snapshot.data() : {}) };
    settingsReady = true;
    emit(bookingsReady && analysesReady && settingsReady ? "synced" : "syncing");
  }, (error) => emit("error", error));
}

function bookingsRef() {
  return collection(db, "users", currentUser.uid, "tripDashboard", "bookings", "items");
}
function analysesRef() {
  return collection(db, "users", currentUser.uid, "tripDashboard", "aiAnalyses", "items");
}
function settingsRef() {
  return doc(db, "users", currentUser.uid, "tripDashboard", "settings");
}
function ensureUser() {
  if (!currentUser) throw new Error("Googleログインが必要です。");
}
async function replaceProviderBookings(providerName, nextBookings, options = {}) {
  ensureUser();
  const operations = buildProviderReplacementOperations(bookings, providerName, nextBookings, options);
  for (let index = 0; index < operations.length; index += 400) {
    const batch = writeBatch(db);
    operations.slice(index, index + 400).forEach((operation) => {
      const target = doc(bookingsRef(), operation.id || operation.booking.id);
      if (operation.type === "delete") batch.delete(target);
      else batch.set(target, operation.booking);
    });
    await batch.commit();
  }
}
function defaultSettings() {
  return { homeAirport: "福岡", lastSyncedAt: "" };
}
function emit(status, error = null) {
  callback({
    status,
    user: currentUser,
    state: { bookings, aiAnalyses, settings },
    error: error ? { code: String(error.code || ""), message: String(error.message || error) } : null,
  });
}
