const STORAGE_KEYS = {
  bookings: "tripboard:bookings",
  aiAnalyses: "tripboard:ai-analyses",
  trips: "tripboard:trips",
  settings: "tripboard:settings",
};

const DEFAULT_SETTINGS = { homeAirport: "福岡", lastAnalyzedAt: "" };

export function loadTripBoardState(storage = localStorage) {
  return {
    bookings: readJson(storage, STORAGE_KEYS.bookings, []),
    aiAnalyses: readJson(storage, STORAGE_KEYS.aiAnalyses, []),
    trips: readJson(storage, STORAGE_KEYS.trips, []),
    settings: { ...DEFAULT_SETTINGS, ...readJson(storage, STORAGE_KEYS.settings, {}) },
  };
}

export function saveTripBoardState(state, storage = localStorage) {
  storage.setItem(STORAGE_KEYS.bookings, JSON.stringify(state.bookings || []));
  storage.setItem(STORAGE_KEYS.aiAnalyses, JSON.stringify(state.aiAnalyses || []));
  storage.setItem(STORAGE_KEYS.trips, JSON.stringify(state.trips || []));
  storage.setItem(STORAGE_KEYS.settings, JSON.stringify({ ...DEFAULT_SETTINGS, ...(state.settings || {}) }));
}

export function clearTripBoardData(storage = localStorage) {
  storage.removeItem(STORAGE_KEYS.bookings);
  storage.removeItem(STORAGE_KEYS.aiAnalyses);
  storage.removeItem(STORAGE_KEYS.trips);
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
