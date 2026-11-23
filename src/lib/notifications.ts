import { AppNotification } from '../types';

export const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const SEEN_NOTIFS_KEY = 'noor_elahi_seen_notif_ids_v1';

export function getNotificationCreatedAtMs(notif: AppNotification): number {
  if (typeof notif.createdAtMs === 'number' && Number.isFinite(notif.createdAtMs) && notif.createdAtMs > 0) {
    return notif.createdAtMs;
  }
  const raw = notif.createdAt as
    | { toMillis?: () => number; seconds?: number; _seconds?: number }
    | string
    | number
    | undefined;

  if (raw && typeof raw === 'object') {
    if (typeof raw.toMillis === 'function') {
      const ms = raw.toMillis();
      if (Number.isFinite(ms) && ms > 0) return ms;
    }
    const sec = typeof raw.seconds === 'number' ? raw.seconds : raw._seconds;
    if (typeof sec === 'number' && Number.isFinite(sec) && sec > 0) {
      return sec * 1000;
    }
  } else if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  // Fallback to timestamp embedded in generated ID: notif_<epochMs>_<rand>
  const idMatch = typeof notif.id === 'string' ? notif.id.match(/^notif_(\d{10,15})/) : null;
  if (idMatch?.[1]) {
    const parsedIdTs = Number(idMatch[1]);
    if (Number.isFinite(parsedIdTs) && parsedIdTs > 0) return parsedIdTs;
  }

  return 0;
}

export function isNotificationWithin24h(notif: AppNotification, now = Date.now()): boolean {
  if (!notif || notif.isActive === false) return false;
  const createdMs = getNotificationCreatedAtMs(notif);
  if (createdMs <= 0) return false;
  return now - createdMs < NOTIFICATION_TTL_MS;
}

export function normalizeActiveNotifications(
  list: AppNotification[],
  now = Date.now()
): AppNotification[] {
  const dedup = new Map<string, AppNotification>();
  for (const item of list) {
    if (!item?.id) continue;
    const createdAtMs = getNotificationCreatedAtMs(item);
    const normalized: AppNotification = {
      ...item,
      createdAtMs: createdAtMs > 0 ? createdAtMs : undefined,
    };
    if (isNotificationWithin24h(normalized, now)) {
      dedup.set(normalized.id, normalized);
    }
  }
  return Array.from(dedup.values()).sort(
    (a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)
  );
}

export function serializeNotificationsForCache(list: AppNotification[]): AppNotification[] {
  return normalizeActiveNotifications(list).map((n) => ({
    id: n.id,
    subjectId: n.subjectId,
    subjectName: n.subjectName,
    sectionTitle: n.sectionTitle,
    itemName: n.itemName,
    message: n.message,
    isActive: n.isActive,
    createdAtMs: n.createdAtMs || getNotificationCreatedAtMs(n) || Date.now(),
  }));
}

export function loadSeenNotificationIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_NOTIFS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is string => typeof v === 'string'));
    }
  } catch {
    // Ignore storage read error
  }
  return new Set();
}

export function markNotificationsSeen(activeList: AppNotification[]): Set<string> {
  const existing = loadSeenNotificationIds();
  const activeIds = new Set(activeList.map((n) => n.id));
  const next = new Set<string>();
  // Prune old IDs while recording all currently active IDs as seen
  for (const id of existing) {
    if (activeIds.has(id)) next.add(id);
  }
  for (const id of activeIds) {
    next.add(id);
  }
  try {
    localStorage.setItem(SEEN_NOTIFS_KEY, JSON.stringify(Array.from(next)));
  } catch {
    // Ignore storage write error
  }
  return next;
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
function toBnNumber(n: number): string {
  return String(Math.max(0, Math.floor(n))).replace(/\d/g, (d) => BN_DIGITS[Number(d)] || d);
}

export function formatNotificationRemainingLabel(notif: AppNotification, now = Date.now()): string {
  const createdMs = getNotificationCreatedAtMs(notif);
  if (createdMs <= 0) return '২৪ ঘণ্টা পর স্বয়ংক্রিয়ভাবে মুছে যাবে';
  const remainingMs = Math.max(0, NOTIFICATION_TTL_MS - (now - createdMs));
  const totalMins = Math.ceil(remainingMs / 60_000);
  if (totalMins <= 60) {
    return `প্রায় ${toBnNumber(Math.max(1, totalMins))} মিনিট পর মুছে যাবে`;
  }
  const hours = Math.floor(totalMins / 60);
  return `প্রায় ${toBnNumber(hours)} ঘণ্টা পর মুছে যাবে`;
}
