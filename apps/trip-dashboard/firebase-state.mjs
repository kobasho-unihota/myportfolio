export function emptyCloudState() {
  return {
    bookings: [],
    aiAnalyses: [],
    trips: [],
    importSessions: [],
    tripDrafts: [],
    settings: { homeAirport: "福岡", lastAnalyzedAt: "" },
  };
}

export function cleanCloudState(value = {}) {
  return JSON.parse(JSON.stringify({
    bookings: Array.isArray(value.bookings) ? value.bookings : [],
    aiAnalyses: Array.isArray(value.aiAnalyses) ? value.aiAnalyses : [],
    trips: Array.isArray(value.trips) ? value.trips : [],
    importSessions: Array.isArray(value.importSessions) ? value.importSessions : [],
    tripDrafts: Array.isArray(value.tripDrafts) ? value.tripDrafts : [],
    settings: {
      homeAirport: String(value.settings?.homeAirport || "福岡"),
      lastAnalyzedAt: String(value.settings?.lastAnalyzedAt || ""),
    },
  }));
}

export function hasMigrationData(value = {}) {
  return Boolean(value.bookings?.length || value.aiAnalyses?.length || value.trips?.length ||
    value.importSessions?.length || value.tripDrafts?.length ||
    value.settings?.lastAnalyzedAt || (value.settings?.homeAirport && value.settings.homeAirport !== "福岡"));
}

export function isEmptyCloudState(value = {}) {
  return !value.bookings?.length && !value.aiAnalyses?.length && !value.trips?.length &&
    !value.importSessions?.length && !value.tripDrafts?.length &&
    !value.settings?.lastAnalyzedAt && (!value.settings?.homeAirport || value.settings.homeAirport === "福岡");
}
