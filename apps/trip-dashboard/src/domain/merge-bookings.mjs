import { tokyoDate } from "./date.mjs";
import { removeEmpty, uniqueBy } from "./text.mjs";

export function effectiveBooking(booking) {
  return { ...booking, data: { ...(booking.parsed || {}), ...removeEmpty(booking.overrides || {}) } };
}

export function mergeBookings(existing, incoming) {
  const merged = new Map(existing.map((booking) => [booking.id, structuredCloneSafe(booking)]));
  [...incoming].sort((a, b) => sourceTime(a) - sourceTime(b)).forEach((booking) => {
    let key = booking.id;
    let current = merged.get(key);
    if (!current && booking.type === "flight") {
      const matching = [...merged.entries()].find(([, candidate]) => candidate.type === "flight" && flightSignature(candidate) === flightSignature(booking));
      if (matching) [key, current] = matching;
    }
    if (!current) return merged.set(booking.id, structuredCloneSafe(booking));
    const incomingIsNewer = sourceTime(booking) >= sourceTime(current);
    merged.set(key, {
      ...current,
      provider: booking.provider || current.provider,
      status: current.status === "cancelled" || booking.status === "cancelled" ? "cancelled" : incomingIsNewer ? booking.status : current.status,
      parsed: incomingIsNewer ? { ...current.parsed, ...removeEmpty(booking.parsed) } : { ...booking.parsed, ...removeEmpty(current.parsed) },
      source: uniqueBy([...(current.source || []), ...(booking.source || [])].sort((a, b) => Date.parse(a.receivedAt || 0) - Date.parse(b.receivedAt || 0)), (item) => item.messageId || `${item.subject}:${item.receivedAt}`),
      overrides: current.overrides || {},
      hidden: current.hidden || false,
      updatedAt: new Date(Math.max(Date.parse(current.updatedAt || 0), Date.parse(booking.updatedAt || 0))).toISOString(),
    });
  });
  return [...merged.values()];
}

function sourceTime(booking) { return Math.max(Date.parse(booking.updatedAt || 0), ...((booking.source || []).map((item) => Date.parse(item.receivedAt || 0)))); }
function flightSignature(booking) { const data = booking.parsed || booking.data || {}; return data.flightNumber && data.startAt ? `${data.flightNumber}:${tokyoDate(data.startAt)}` : ""; }
function structuredCloneSafe(value) { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
