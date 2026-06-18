const STORAGE_KEYS = {
  bookings: "tripboard:bookings",
  aiAnalyses: "tripboard:ai-analyses",
  trips: "tripboard:trips",
  importSessions: "tripboard:import-sessions",
  tripDrafts: "tripboard:trip-drafts",
  settings: "tripboard:settings",
};

const DEFAULT_SETTINGS = { homeAirport: "福岡", lastAnalyzedAt: "" };

export function loadTripBoardState(storage = localStorage) {
  return {
    bookings: readJson(storage, STORAGE_KEYS.bookings, []),
    aiAnalyses: readJson(storage, STORAGE_KEYS.aiAnalyses, []),
    trips: readJson(storage, STORAGE_KEYS.trips, []),
    importSessions: readJson(storage, STORAGE_KEYS.importSessions, []),
    tripDrafts: readJson(storage, STORAGE_KEYS.tripDrafts, []),
    settings: { ...DEFAULT_SETTINGS, ...readJson(storage, STORAGE_KEYS.settings, {}) },
  };
}

export function saveTripBoardState(state, storage = localStorage) {
  storage.setItem(STORAGE_KEYS.bookings, JSON.stringify(state.bookings || []));
  storage.setItem(STORAGE_KEYS.aiAnalyses, JSON.stringify(state.aiAnalyses || []));
  storage.setItem(STORAGE_KEYS.trips, JSON.stringify(state.trips || []));
  storage.setItem(STORAGE_KEYS.importSessions, JSON.stringify(state.importSessions || []));
  storage.setItem(STORAGE_KEYS.tripDrafts, JSON.stringify(state.tripDrafts || []));
  storage.setItem(STORAGE_KEYS.settings, JSON.stringify({ ...DEFAULT_SETTINGS, ...(state.settings || {}) }));
}

export function clearTripBoardData(storage = localStorage) {
  storage.removeItem(STORAGE_KEYS.bookings);
  storage.removeItem(STORAGE_KEYS.aiAnalyses);
  storage.removeItem(STORAGE_KEYS.trips);
  storage.removeItem(STORAGE_KEYS.importSessions);
  storage.removeItem(STORAGE_KEYS.tripDrafts);
  const settings = { ...DEFAULT_SETTINGS, ...readJson(storage, STORAGE_KEYS.settings, {}) };
  delete settings.lastAnalyzedAt;
  storage.setItem(STORAGE_KEYS.settings, JSON.stringify({ ...settings, lastAnalyzedAt: "" }));
}

export function clearMigratedTripBoardData(storage = localStorage) {
  Object.values(STORAGE_KEYS).forEach((key) => storage.removeItem(key));
}

function readJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
