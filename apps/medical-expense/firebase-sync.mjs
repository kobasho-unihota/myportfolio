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

const firebaseConfig = {
  apiKey: "AIzaSyDdRlINBq1fdFbfKKkl5dQQM6rlWAKM9vo",
  authDomain: "seed-note-kobasho.firebaseapp.com",
  projectId: "seed-note-kobasho",
  storageBucket: "seed-note-kobasho.firebasestorage.app",
  messagingSenderId: "1042714808944",
  appId: "1:1042714808944:web:f5253c9b257bdac09a1ab5",
};

const app = initializeApp(firebaseConfig, "medipass");
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
const provider = new GoogleAuthProvider();
let unsubscribeRecords = null;
let unsubscribeSettings = null;
let listener = () => {};
let currentUser = null;
let records = [];
let settings = { incomesByYear: {} };
let recordsLoaded = false;
let settingsLoaded = false;

export const cloudSync = {
  get user() { return currentUser; },
  subscribe(callback) {
    listener = callback;
    emit("loading");
    return () => { listener = () => {}; };
  },
  async signIn() {
    await signInWithPopup(auth, provider);
  },
  async signOut() {
    await signOut(auth);
  },
  async saveRecord(record) {
    ensureUser();
    await setDoc(doc(recordsRef(), record.id), record);
  },
  async deleteRecord(id) {
    ensureUser();
    await deleteDoc(doc(recordsRef(), id));
  },
  async saveSettings(nextSettings) {
    ensureUser();
    await setDoc(settingsRef(), nextSettings, { merge: true });
  },
  async uploadRecords(localRecords) {
    ensureUser();
    await commitOperations(localRecords.map((record) => ({ type: "set", record })));
  },
  async replaceAll(nextState) {
    ensureUser();
    const nextIds = new Set(nextState.records.map((record) => record.id));
    await commitOperations([
      ...records.filter((record) => !nextIds.has(record.id)).map((record) => ({ type: "delete", id: record.id })),
      ...nextState.records.map((record) => ({ type: "set", record })),
    ]);
    await setDoc(settingsRef(), nextState.settings);
  },
  async deleteAll() {
    ensureUser();
    await commitOperations(records.map((record) => ({ type: "delete", id: record.id })));
  },
  async retry() {
    ensureUser();
    startListeners(currentUser);
  },
};

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  startListeners(user);
});

function startListeners(user) {
  stopListeners();
  records = [];
  settings = { incomesByYear: {} };
  recordsLoaded = false;
  settingsLoaded = false;
  if (!user) {
    emit("signed-out");
    return;
  }
  emit("syncing");
  unsubscribeRecords = onSnapshot(recordsRef(), (snapshot) => {
    records = snapshot.docs.map((item) => item.data());
    recordsLoaded = true;
    emit(recordsLoaded && settingsLoaded ? "synced" : "syncing");
  }, (error) => emit("error", error));
  unsubscribeSettings = onSnapshot(settingsRef(), (snapshot) => {
    settings = snapshot.exists() ? snapshot.data() : { incomesByYear: {} };
    settingsLoaded = true;
    emit(recordsLoaded && settingsLoaded ? "synced" : "syncing");
  }, (error) => emit("error", error));
}

function recordsRef() {
  return collection(db, "users", currentUser.uid, "medicalExpense", "records", "items");
}

function settingsRef() {
  return doc(db, "users", currentUser.uid, "medicalExpenseMeta", "settings");
}

function stopListeners() {
  unsubscribeRecords?.();
  unsubscribeSettings?.();
  unsubscribeRecords = null;
  unsubscribeSettings = null;
}

function ensureUser() {
  if (!currentUser) throw new Error("Googleログインが必要です。");
}

async function commitOperations(operations) {
  for (let index = 0; index < operations.length; index += 400) {
    const batch = writeBatch(db);
    operations.slice(index, index + 400).forEach((operation) => {
      const recordDoc = doc(recordsRef(), operation.id || operation.record.id);
      if (operation.type === "delete") batch.delete(recordDoc);
      else batch.set(recordDoc, operation.record);
    });
    await batch.commit();
  }
}

function emit(status, error = null) {
  listener({
    status,
    user: currentUser,
    state: { version: 1, records, settings },
    error: error ? {
      code: String(error.code || ""),
      message: String(error.message || ""),
    } : null,
  });
}
