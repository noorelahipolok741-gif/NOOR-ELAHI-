import { DownloadRecord, SubjectDoc } from '../types';

const DB_NAME = 'noor_elahi_offline_v3';
const DB_VERSION = 2;
const STORE_NAME = 'media_blobs';
const SETTINGS_STORE = 'app_settings';
const DIR_HANDLE_KEY = 'download_dir_handle';
const STORAGE_PERM_KEY = 'noor_elahi_storage_perm_v1';

export interface OfflineMediaEntry {
  itemId: string;
  subjectId: string;
  sectionId: string;
  sectionTitle: string;
  classNumber: number;
  videoName: string;
  videoUrl: string;
  pdfUrl: string;
  videoBlob?: Blob;
  pdfBlob?: Blob;
  fileSizeBytes: number;
  savedAt: number;
}

export interface StoragePermissionStatus {
  configured: boolean;
  persisted: boolean;
  hasFolderAccess: boolean;
  folderName?: string;
  supportsFolderPicker: boolean;
  usageMB?: string;
  quotaMB?: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'itemId' });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

async function saveDirHandleToDB(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      tx.objectStore(SETTINGS_STORE).put(handle, DIR_HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Some browsers don't allow structured-cloning directory handles
  }
}

async function loadDirHandleFromDB(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return await new Promise<FileSystemDirectoryHandle | null>((resolve) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly');
      const req = tx.objectStore(SETTINGS_STORE).get(DIR_HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveAppStateBackup(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      tx.objectStore(SETTINGS_STORE).put(value, `cache_${key}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore IndexedDB backup error
  }
}

export async function loadAppStateBackup<T>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly');
      const req = tx.objectStore(SETTINGS_STORE).get(`cache_${key}`);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function removeAppStateBackup(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      tx.objectStore(SETTINGS_STORE).delete(`cache_${key}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore delete failure
  }
}

export async function saveOfflineMedia(entry: OfflineMediaEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save offline media'));
  });
}

export async function getOfflineMedia(itemId: string): Promise<OfflineMediaEntry | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(itemId);
    req.onsuccess = () => resolve((req.result as OfflineMediaEntry) || null);
    req.onerror = () => reject(req.error || new Error('Failed to read offline media'));
  });
}

export async function deleteOfflineMedia(itemId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(itemId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete offline media'));
  });
}

export async function listOfflineMedia(): Promise<OfflineMediaEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result as OfflineMediaEntry[]) || []);
    req.onerror = () => reject(req.error || new Error('Failed to list offline media'));
  });
}

export function getGoogleDriveFileId(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!trimmed) return null;

  // Match /file/d/FILE_ID or /d/FILE_ID
  const pathIdMatch =
    trimmed.match(/drive\.google\.com\/file\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/i) ||
    trimmed.match(/docs\.google\.com\/file\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/i) ||
    trimmed.match(/drive\.google\.com\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/i);
  if (pathIdMatch?.[1]) return pathIdMatch[1];

  // Match ?id=FILE_ID or &id=FILE_ID on drive.google.com / docs.google.com / drive.usercontent.google.com
  const queryIdMatch = trimmed.match(
    /(?:drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com)\/[^\s]*[?&]id=([a-zA-Z0-9_-]+)/i
  );
  if (queryIdMatch?.[1]) return queryIdMatch[1];

  try {
    const u = new URL(normalizeMediaUrl(trimmed));
    if (
      !u.hostname.includes('drive.google.com') &&
      !u.hostname.includes('docs.google.com') &&
      !u.hostname.includes('drive.usercontent.google.com')
    ) {
      return null;
    }
    if (u.pathname.includes('/folders/')) return null;
    const pMatch =
      u.pathname.match(/\/file(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)/) ||
      u.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (pMatch?.[1]) return pMatch[1];
    const idParam = u.searchParams.get('id');
    if (idParam && /^[a-zA-Z0-9_-]+$/.test(idParam)) return idParam;
    return null;
  } catch {
    return null;
  }
}

export function getSafeDownloadUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!trimmed || trimmed.startsWith('/') || trimmed.startsWith('#')) return null;

  const driveId = getGoogleDriveFileId(trimmed);
  if (driveId) {
    return `https://drive.google.com/uc?export=download&id=${driveId}`;
  }

  try {
    const normalized = normalizeMediaUrl(trimmed);
    if (!normalized || normalized.startsWith('/')) return null;
    const u = new URL(normalized);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return null;
    }
    if (u.hostname.includes('docs.google.com')) {
      const m = u.pathname.match(/\/(document|presentation|spreadsheets)(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)/);
      if (m?.[1] && m?.[2]) {
        return m[1] === 'presentation'
          ? `https://docs.google.com/presentation/d/${m[2]}/export/pdf`
          : `https://docs.google.com/${m[1]}/d/${m[2]}/export?format=pdf`;
      }
    }
    return u.toString();
  } catch {
    return null;
  }
}

export const getDownloadUrl = getSafeDownloadUrl;

export function getVideoViewerUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!trimmed || trimmed.startsWith('/')) return null;

  const driveId = getGoogleDriveFileId(trimmed);
  if (driveId) {
    return `https://drive.google.com/file/d/${driveId}/preview`;
  }

  const embedUrl = extractDirectVideoEmbedUrl(trimmed);
  if (embedUrl) return embedUrl;

  try {
    const normalized = normalizeMediaUrl(trimmed);
    const u = new URL(normalized);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function getPdfViewerUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!trimmed || trimmed.startsWith('/')) return null;

  const driveId = getGoogleDriveFileId(trimmed);
  if (driveId) {
    return `https://drive.google.com/file/d/${driveId}/preview`;
  }

  const docsPreview = extractGoogleDocsPreviewUrl(trimmed);
  if (docsPreview) return docsPreview;

  try {
    const normalized = normalizeMediaUrl(trimmed);
    const u = new URL(normalized);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function isDirectVideoFileUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) return false;
  if (getGoogleDriveFileId(rawUrl)) return false;
  if (extractDirectVideoEmbedUrl(rawUrl)) return false;
  try {
    const normalized = normalizeMediaUrl(rawUrl);
    const u = new URL(normalized);
    const host = u.hostname.toLowerCase();
    const pathLower = u.pathname.toLowerCase();
    if (/\.(mp4|webm|ogg|ogv|m4v|mov)(\?.*)?$/i.test(pathLower)) {
      return true;
    }
    if (
      host.includes('dropbox.com') ||
      host.includes('dl.dropboxusercontent.com') ||
      host.includes('pixeldrain.com') ||
      host.includes('raw.githubusercontent.com')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function safeOpenExternalUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof document === 'undefined') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('/')) return false;
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('blob:')) {
    return false;
  }
  try {
    const a = document.createElement('a');
    a.href = trimmed;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch {
    return false;
  }
}

export function normalizeMediaUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:') || trimmed.startsWith('/')) {
    return trimmed;
  }
  let target = trimmed;
  if (/\s/.test(target)) {
    const match = target.match(/(?:https?:\/\/|drive\.google\.com\/|docs\.google\.com\/)[^\s<>"']+/i);
    if (match?.[0]) target = match[0].replace(/[.,;'">]+$/, '');
  }
  const withProto = /^https?:\/\//i.test(target) ? target : `https://${target}`;
  try {
    const u = new URL(withProto);
    if (
      (u.hostname.includes('docs.google.com') || u.hostname.includes('drive.google.com')) &&
      (u.pathname.includes('/gview') || u.pathname.includes('/viewer'))
    ) {
      const inner = u.searchParams.get('url');
      if (inner && /^https?:\/\//i.test(inner)) {
        return normalizeMediaUrl(inner);
      }
    }
    if (u.pathname.toLowerCase().endsWith('/viewer.html') && u.searchParams.get('file')) {
      const innerFile = u.searchParams.get('file')!;
      if (/^https?:\/\//i.test(innerFile)) {
        return normalizeMediaUrl(innerFile);
      }
    }
    if (u.hostname.includes('dropbox.com')) {
      u.searchParams.delete('dl');
      u.searchParams.set('raw', '1');
      return u.toString();
    }
    if (u.hostname === 'github.com' && u.pathname.includes('/blob/')) {
      return `https://raw.githubusercontent.com${u.pathname.replace('/blob/', '/')}`;
    }
    if (u.hostname.includes('pixeldrain.com')) {
      const m = u.pathname.match(/^\/u\/([a-zA-Z0-9_-]+)/);
      if (m?.[1]) {
        return `https://pixeldrain.com/api/file/${m[1]}`;
      }
    }
    return u.toString();
  } catch {
    return withProto;
  }
}

export function extractGoogleDriveFileId(rawUrl: string): string | null {
  return getGoogleDriveFileId(rawUrl);
}

export function extractGoogleDocsPreviewUrl(rawUrl: string): string | null {
  try {
    const u = new URL(normalizeMediaUrl(rawUrl));
    if (u.hostname.includes('docs.google.com')) {
      const m = u.pathname.match(/\/(document|presentation|spreadsheets)(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)/);
      if (m?.[1] && m?.[2]) {
        return `https://docs.google.com/${m[1]}/d/${m[2]}/preview`;
      }
    }
    const driveId = getGoogleDriveFileId(rawUrl);
    if (driveId) {
      return `https://drive.google.com/file/d/${driveId}/preview`;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractGoogleDriveDownloadUrl(rawUrl: string): string | null {
  try {
    const u = new URL(normalizeMediaUrl(rawUrl));
    if (u.hostname.includes('docs.google.com')) {
      const m = u.pathname.match(/\/(document|presentation|spreadsheets)(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)/);
      if (m?.[1] && m?.[2]) {
        return m[1] === 'presentation'
          ? `https://docs.google.com/presentation/d/${m[2]}/export/pdf`
          : `https://docs.google.com/${m[1]}/d/${m[2]}/export?format=pdf`;
      }
    }
    const driveId = getGoogleDriveFileId(rawUrl);
    if (driveId) {
      return `https://drive.google.com/uc?export=download&id=${driveId}`;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractYouTubeVideoId(rawUrl: string): string | null {
  try {
    const u = new URL(normalizeMediaUrl(rawUrl));
    const host = u.hostname.toLowerCase();
    if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
      const id = u.pathname.replace(/^\/+/, '').split('/')[0];
      return id || null;
    }
    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]+)/);
      if (m?.[1]) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

export function extractVimeoVideoId(rawUrl: string): string | null {
  try {
    const u = new URL(normalizeMediaUrl(rawUrl));
    if (!u.hostname.toLowerCase().includes('vimeo.com')) return null;
    const m = u.pathname.match(/\/(?:video\/)?(\d+)/);
    return m?.[1] || null;
  } catch {
    return null;
  }
}

export function extractDirectVideoEmbedUrl(rawUrl: string): string | null {
  const ytId = extractYouTubeVideoId(rawUrl);
  if (ytId) {
    return `https://www.youtube.com/embed/${ytId}?playsinline=1&rel=0&modestbranding=1`;
  }
  const vimeoId = extractVimeoVideoId(rawUrl);
  if (vimeoId) {
    return `https://player.vimeo.com/video/${vimeoId}?playsinline=1`;
  }
  try {
    const norm = normalizeMediaUrl(rawUrl);
    const u = new URL(norm);
    const host = u.hostname.toLowerCase();
    if (host.includes('dailymotion.com') || host === 'dai.ly') {
      const m = host === 'dai.ly'
        ? u.pathname.match(/^\/([a-zA-Z0-9]+)/)
        : u.pathname.match(/\/(?:embed\/)?video\/([a-zA-Z0-9]+)/);
      if (m?.[1]) return `https://www.dailymotion.com/embed/video/${m[1]}`;
    }
    if (host.includes('loom.com')) {
      const m = u.pathname.match(/\/(?:share|embed)\/([a-zA-Z0-9]+)/);
      if (m?.[1]) return `https://www.loom.com/embed/${m[1]}`;
    }
    if (host.includes('streamable.com')) {
      const m = u.pathname.match(/^\/(?:e\/)?([a-zA-Z0-9]+)$/);
      if (m?.[1]) return `https://streamable.com/e/${m[1]}`;
    }
    if (host.includes('mediadelivery.net') && (u.pathname.includes('/play/') || u.pathname.includes('/embed/'))) {
      return norm.replace('/play/', '/embed/');
    }
  } catch {
    // Ignore parse error
  }
  return null;
}

export function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?.*)?$/i.test(url.trim());
}

export function isUnsupportedVideoHost(url: string): boolean {
  return Boolean(extractDirectVideoEmbedUrl(url));
}

export function encodeProxyParam(url: string): string {
  try {
    const bytes = new TextEncoder().encode(url);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return encodeURIComponent(url);
  }
}

export function resolveStreamUrl(rawUrl: string, kind?: 'video' | 'pdf'): string {
  const normalized = normalizeMediaUrl(rawUrl);
  if (!normalized) return '';
  if (normalized.startsWith('blob:') || normalized.startsWith('data:') || normalized.startsWith('/api/')) {
    return normalized;
  }
  if (normalized.startsWith('/')) {
    return '';
  }
  if (isHlsUrl(normalized)) {
    return normalized;
  }
  const kindParam = kind ? `&kind=${kind}` : '';
  return `/api/proxy-media?u=${encodeURIComponent(encodeProxyParam(normalized))}${kindParam}`;
}

export function resolveHlsProxyUrl(rawUrl: string): string {
  const normalized = normalizeMediaUrl(rawUrl);
  if (!normalized || normalized.startsWith('/')) return '';
  return `/api/proxy-hls?u=${encodeURIComponent(encodeProxyParam(normalized))}`;
}

export function resolveDownloadProxyUrl(rawUrl: string, filename: string, kind?: 'video' | 'pdf'): string {
  const normalized = normalizeMediaUrl(rawUrl);
  if (!normalized) return '';
  if (normalized.startsWith('blob:') || normalized.startsWith('data:') || normalized.startsWith('/api/')) {
    return normalized;
  }
  if (normalized.startsWith('/')) {
    return '';
  }
  const kindParam = kind ? `&kind=${kind}` : '';
  return `/api/proxy-media?u=${encodeURIComponent(encodeProxyParam(normalized))}&filename=${encodeURIComponent(filename)}&download=1${kindParam}`;
}

export function sanitizeBaseFilename(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, '_') || 'class_file';
}

export function triggerBrowserSave(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

let cachedDirHandle: FileSystemDirectoryHandle | null = null;

export function supportsDirectoryPicker(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as { showDirectoryPicker?: unknown };
  // Inside cross-origin iframes showDirectoryPicker may throw SecurityError, so check top === self or try gracefully
  return typeof win.showDirectoryPicker === 'function';
}

export function isStoragePermissionConfigured(): boolean {
  return true;
}

export async function getStoragePermissionStatus(): Promise<StoragePermissionStatus> {
  let persisted = false;
  let usageMB: string | undefined;
  let quotaMB: string | undefined;

  try {
    if (navigator.storage?.persisted) {
      persisted = await navigator.storage.persisted();
    }
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (est.usage !== undefined) {
        usageMB = (est.usage / (1024 * 1024)).toFixed(1);
      }
      if (est.quota !== undefined) {
        quotaMB = (est.quota / (1024 * 1024)).toFixed(0);
      }
    }
  } catch {
    // Ignore unsupported StorageManager APIs
  }

  let handle = cachedDirHandle;
  if (!handle) {
    handle = await loadDirHandleFromDB();
    if (handle) cachedDirHandle = handle;
  }

  let hasFolderAccess = false;
  if (handle) {
    try {
      const qp = (handle as unknown as {
        queryPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
      }).queryPermission;
      if (qp) {
        const perm = await qp.call(handle, { mode: 'readwrite' });
        hasFolderAccess = perm === 'granted';
      } else {
        hasFolderAccess = true;
      }
    } catch {
      hasFolderAccess = false;
    }
  }

  return {
    configured: isStoragePermissionConfigured() || hasFolderAccess,
    persisted,
    hasFolderAccess,
    folderName: handle?.name,
    supportsFolderPicker: supportsDirectoryPicker(),
    usageMB,
    quotaMB,
  };
}

export async function requestDeviceStoragePermission(
  chooseFolder: boolean
): Promise<{
  granted: boolean;
  persisted: boolean;
  hasFolderAccess: boolean;
  folderName?: string;
  cancelled?: boolean;
}> {
  let persisted = false;
  try {
    if (navigator.storage?.persist) {
      persisted = await navigator.storage.persist();
    }
  } catch {
    // Ignore persist failure
  }

  let hasFolderAccess = false;
  let folderName: string | undefined;

  if (chooseFolder && supportsDirectoryPicker()) {
    try {
      const handle = await requestInternalFolderHandle();
      if (handle) {
        hasFolderAccess = true;
        folderName = handle.name;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return {
          granted: false,
          persisted,
          hasFolderAccess: false,
          cancelled: true,
        };
      }
      // If SecurityError (e.g. inside iframe), fall back to persistent app storage + browser Downloads
    }
  }

  try {
    localStorage.setItem(STORAGE_PERM_KEY, 'granted');
  } catch {
    // Ignore storage quota error
  }

  return {
    granted: true,
    persisted,
    hasFolderAccess,
    folderName,
  };
}

async function getWritableDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  let handle = cachedDirHandle || (await loadDirHandleFromDB());
  if (!handle) return null;
  cachedDirHandle = handle;

  try {
    const h = handle as unknown as {
      queryPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
      requestPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
    };
    if (h.queryPermission) {
      const state = await h.queryPermission({ mode: 'readwrite' });
      if (state === 'granted') return handle;
      if (state === 'prompt' && h.requestPermission) {
        const req = await h.requestPermission({ mode: 'readwrite' });
        if (req === 'granted') return handle;
      }
      return null;
    }
    return handle;
  } catch {
    return null;
  }
}

export async function saveToInternalDirectoryIfPermitted(
  videoName: string,
  videoBlob?: Blob,
  pdfBlob?: Blob
): Promise<boolean> {
  const baseName = sanitizeBaseFilename(videoName);
  try {
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {});
    }
  } catch {
    // Ignore persist failure
  }

  try {
    const dirHandle = await getWritableDirectoryHandle();
    if (dirHandle) {
      if (videoBlob) {
        const fh = await dirHandle.getFileHandle(`${baseName}.mp4`, { create: true });
        const writable = await fh.createWritable();
        await writable.write(videoBlob);
        await writable.close();
      }
      if (pdfBlob) {
        const fh = await dirHandle.getFileHandle(`${baseName}.pdf`, { create: true });
        const writable = await fh.createWritable();
        await writable.write(pdfBlob);
        await writable.close();
      }
      return true;
    }
  } catch {
    // Fallback to browser Downloads folder below
  }

  if (videoBlob && pdfBlob) {
    triggerBrowserSave(videoBlob, `${baseName}.mp4`);
    await new Promise<void>((resolve) => {
      window.setTimeout(() => {
        triggerBrowserSave(pdfBlob, `${baseName}.pdf`);
        resolve();
      }, 700);
    });
  } else {
    if (videoBlob) triggerBrowserSave(videoBlob, `${baseName}.mp4`);
    if (pdfBlob) triggerBrowserSave(pdfBlob, `${baseName}.pdf`);
  }
  return false;
}

export async function exportOfflineItemToPhone(
  itemId: string,
  videoName: string
): Promise<boolean> {
  const entry = await getOfflineMedia(itemId);
  if (!entry) return false;
  const savedToFolder = await saveToInternalDirectoryIfPermitted(
    videoName,
    entry.videoBlob,
    entry.pdfBlob
  );
  return savedToFolder || Boolean(entry.videoBlob || entry.pdfBlob);
}

export async function requestInternalFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  const win = window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  };
  if (!win.showDirectoryPicker) return null;
  const handle = await win.showDirectoryPicker({ mode: 'readwrite' });
  cachedDirHandle = handle;
  await saveDirHandleToDB(handle);
  try {
    localStorage.setItem(STORAGE_PERM_KEY, 'granted');
  } catch {
    // Ignore
  }
  return handle;
}

export async function collectFilesFromDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle
): Promise<File[]> {
  const files: File[] = [];
  const iter = dirHandle as unknown as {
    values: () => AsyncIterable<FileSystemHandle>;
  };
  for await (const entry of iter.values()) {
    if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile();
      files.push(file);
    } else if (entry.kind === 'directory') {
      const nested = await collectFilesFromDirectoryHandle(entry as FileSystemDirectoryHandle);
      files.push(...nested);
    }
  }
  return files;
}

const BENGALI_TO_ASCII_DIGITS: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

function yieldToIdle(ms = 24): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void })
        .requestIdleCallback(() => resolve(), { timeout: ms + 40 });
    } else {
      setTimeout(resolve, ms);
    }
  });
}

function normalizeMatchName(raw: string): string {
  const withAsciiDigits = (raw || '')
    .normalize('NFC')
    .replace(/[০-৯]/g, (ch) => BENGALI_TO_ASCII_DIGITS[ch] || ch);

  return withAsciiDigits
    .replace(/\.[^/.]+$/, '')
    .replace(/\(\s*\d+\s*\)/g, ' ')
    .replace(/\[\s*\d+\s*\]/g, ' ')
    .replace(/\b(?:1080p|720p|480p|360p|240p|hd|fhd|uhd|mp4|mkv|webm|mov|m4v|pdf|copy|download|downloaded)\b/gi, ' ')
    .replace(/ক্লাস/g, ' class ')
    .replace(/\b(?:lec|lecture|cls)\b/gi, ' class ')
    .replace(/(?:পার্ট|পর্ব)/g, ' part ')
    .replace(/\b(?:ep|episode)\b/gi, ' part ')
    .replace(/(?:অধ্যায়|অধ্যায়|পাঠ)/g, ' chapter ')
    .replace(/\b(?:ch|chap|lesson)\b/gi, ' chapter ')
    .replace(/[_\-.,:|/\\()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function findBestMatchingFile(
  candidateNorms: string[],
  fileMap: Map<string, File>,
  driveId?: string | null
): File | undefined {
  if (driveId) {
    for (const file of fileMap.values()) {
      if (file.name.includes(driveId)) {
        return file;
      }
    }
  }

  for (const norm of candidateNorms) {
    if (!norm) continue;
    const exact = fileMap.get(norm);
    if (exact) return exact;
  }

  let bestFile: File | undefined;
  let bestScore = 0;

  for (const targetNorm of candidateNorms) {
    if (!targetNorm) continue;
    const targetTokens = targetNorm.split(' ').filter((t) => t.length >= 1);

    for (const [fileNorm, file] of fileMap.entries()) {
      if (fileNorm.length >= 3 && targetNorm.length >= 3) {
        if (fileNorm.includes(targetNorm) || targetNorm.includes(fileNorm)) {
          const lenDiff = Math.abs(fileNorm.length - targetNorm.length);
          const score = 0.92 - Math.min(0.22, lenDiff / 120);
          if (score > bestScore) {
            bestScore = score;
            bestFile = file;
          }
          continue;
        }
      }

      if (targetTokens.length >= 2) {
        const fileTokens = new Set(fileNorm.split(' ').filter((t) => t.length >= 1));
        let matched = 0;
        for (const tok of targetTokens) {
          if (fileTokens.has(tok)) matched += 1;
        }
        const ratio = matched / targetTokens.length;
        if (ratio >= 0.65 && ratio > bestScore) {
          bestScore = ratio;
          bestFile = file;
        }
      }
    }
  }

  return bestScore >= 0.65 ? bestFile : undefined;
}

export async function saveOfflineBlobForClass(params: {
  itemId: string;
  subjectId?: string;
  sectionId?: string;
  sectionTitle?: string;
  classNumber?: number;
  videoName: string;
  videoUrl?: string;
  pdfUrl?: string;
  videoBlob?: Blob;
  pdfBlob?: Blob;
}): Promise<OfflineMediaEntry> {
  const existing = await getOfflineMedia(params.itemId).catch(() => null);
  const nextVideoBlob = params.videoBlob || existing?.videoBlob;
  const nextPdfBlob = params.pdfBlob || existing?.pdfBlob;
  const totalBytes = (nextVideoBlob?.size || 0) + (nextPdfBlob?.size || 0);

  const entry: OfflineMediaEntry = {
    itemId: params.itemId,
    subjectId: params.subjectId || existing?.subjectId || '',
    sectionId: params.sectionId || existing?.sectionId || '',
    sectionTitle: params.sectionTitle || existing?.sectionTitle || '',
    classNumber: params.classNumber || existing?.classNumber || 1,
    videoName: params.videoName || existing?.videoName || 'ক্লাস',
    videoUrl: params.videoUrl ?? existing?.videoUrl ?? '',
    pdfUrl: params.pdfUrl ?? existing?.pdfUrl ?? '',
    videoBlob: nextVideoBlob,
    pdfBlob: nextPdfBlob,
    fileSizeBytes: totalBytes,
    savedAt: Date.now(),
  };

  await saveOfflineMedia(entry);
  return entry;
}

export async function reconcileOfflineDownloadsWithCatalog(
  subjects: Record<string, SubjectDoc>,
  uid: string
): Promise<Record<string, DownloadRecord>> {
  const entries = await listOfflineMedia().catch(() => []);
  const reconciled: Record<string, DownloadRecord> = {};
  if (entries.length === 0) return reconciled;

  const entryById = new Map<string, OfflineMediaEntry>();
  const entryByDriveId = new Map<string, OfflineMediaEntry>();
  const entryByNormName = new Map<string, OfflineMediaEntry>();

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const hasVideo = Boolean(e.videoBlob && e.videoBlob.size > 0);
    const hasPdf = Boolean(e.pdfBlob && e.pdfBlob.size > 0);
    if (!hasVideo && !hasPdf) continue;

    entryById.set(e.itemId, e);
    const vDriveId = getGoogleDriveFileId(e.videoUrl);
    if (vDriveId) entryByDriveId.set(vDriveId, e);
    const pDriveId = getGoogleDriveFileId(e.pdfUrl);
    if (pDriveId) entryByDriveId.set(pDriveId, e);
    const norm = normalizeMatchName(e.videoName);
    if (norm) entryByNormName.set(norm, e);

    reconciled[e.itemId] = {
      uid,
      itemId: e.itemId,
      subjectId: e.subjectId,
      sectionId: e.sectionId,
      sectionTitle: e.sectionTitle,
      classNumber: e.classNumber,
      videoName: e.videoName,
      videoUrl: e.videoUrl,
      pdfUrl: e.pdfUrl,
      fileSizeBytes: e.fileSizeBytes,
      hasLocalVideo: hasVideo,
      hasLocalPdf: hasPdf,
    };

    if (i > 0 && i % 6 === 0) {
      await yieldToIdle(18);
    }
  }

  for (const subject of Object.values(subjects)) {
    for (const section of subject.sections || []) {
      let classIndex = 0;
      for (const item of section.items || []) {
        classIndex += 1;
        if (reconciled[item.id]) continue;

        const primaryVideoUrl =
          (item.videoUrls && item.videoUrls.find((u) => Boolean(u?.trim()))) ||
          item.videoUrl ||
          '';
        const vDriveId = getGoogleDriveFileId(primaryVideoUrl);
        const pDriveId = getGoogleDriveFileId(item.pdfUrl);
        const itemNorm = normalizeMatchName(item.name);

        const matchedEntry =
          entryById.get(item.id) ||
          (vDriveId ? entryByDriveId.get(vDriveId) : undefined) ||
          (pDriveId ? entryByDriveId.get(pDriveId) : undefined) ||
          (itemNorm ? entryByNormName.get(itemNorm) : undefined);

        if (matchedEntry) {
          const saved = await saveOfflineBlobForClass({
            itemId: item.id,
            subjectId: subject.id,
            sectionId: section.id,
            sectionTitle: section.title,
            classNumber: classIndex,
            videoName: item.name || matchedEntry.videoName,
            videoUrl: primaryVideoUrl || matchedEntry.videoUrl,
            pdfUrl: item.pdfUrl || matchedEntry.pdfUrl,
            videoBlob: matchedEntry.videoBlob,
            pdfBlob: matchedEntry.pdfBlob,
          });
          reconciled[item.id] = {
            uid,
            itemId: item.id,
            subjectId: subject.id,
            sectionId: section.id,
            sectionTitle: section.title,
            classNumber: classIndex,
            videoName: saved.videoName,
            videoUrl: saved.videoUrl,
            pdfUrl: saved.pdfUrl,
            fileSizeBytes: saved.fileSizeBytes,
            hasLocalVideo: Boolean(saved.videoBlob && saved.videoBlob.size > 0),
            hasLocalPdf: Boolean(saved.pdfBlob && saved.pdfBlob.size > 0),
          };
          await yieldToIdle(16);
        }
      }
    }
  }

  return reconciled;
}

export async function tryAutoRescanGrantedDirectory(
  subjects: Record<string, SubjectDoc>,
  uid: string,
  onProgress?: (scanned: number, total: number, matched: number) => void
): Promise<DownloadRecord[]> {
  try {
    const handle = cachedDirHandle || (await loadDirHandleFromDB());
    if (!handle) return [];
    const h = handle as unknown as {
      queryPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
    };
    if (h.queryPermission) {
      const state = await h.queryPermission({ mode: 'read' });
      if (state !== 'granted') return [];
    }
    const files = await collectFilesFromDirectoryHandle(handle);
    if (files.length === 0) return [];
    const { matchedRecords } = await scanAndRestoreFilesFromDevice(files, subjects, uid, onProgress);
    return matchedRecords;
  } catch {
    return [];
  }
}

export async function scanAndRestoreFilesFromDevice(
  files: File[],
  subjects: Record<string, SubjectDoc>,
  uid: string,
  onProgress?: (scanned: number, total: number, matched: number) => void
): Promise<{ restoredCount: number; matchedRecords: DownloadRecord[] }> {
  const videoMap = new Map<string, File>();
  const pdfMap = new Map<string, File>();

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const lower = file.name.toLowerCase();
    const norm = normalizeMatchName(file.name);
    if (!norm) continue;
    if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
      pdfMap.set(norm, file);
    } else if (
      lower.endsWith('.mp4') ||
      lower.endsWith('.mkv') ||
      lower.endsWith('.webm') ||
      lower.endsWith('.mov') ||
      lower.endsWith('.m4v') ||
      file.type.startsWith('video/')
    ) {
      videoMap.set(norm, file);
    }
    if (i > 0 && i % 10 === 0) {
      await yieldToIdle(16);
    }
  }

  const allItems: Array<{
    subject: SubjectDoc;
    sectionTitle: string;
    sectionId: string;
    classIndex: number;
    item: SubjectDoc['sections'][number]['items'][number];
    primaryVideoUrl: string;
  }> = [];

  for (const subject of Object.values(subjects)) {
    for (const section of subject.sections || []) {
      let classIndex = 0;
      for (const item of section.items || []) {
        const primaryVideoUrl =
          (item.videoUrls && item.videoUrls.find((u) => Boolean(u?.trim()))) ||
          item.videoUrl ||
          '';
        if (!primaryVideoUrl && !item.pdfUrl) continue;
        classIndex += 1;
        allItems.push({
          subject,
          sectionTitle: section.title || '',
          sectionId: section.id,
          classIndex,
          item,
          primaryVideoUrl,
        });
      }
    }
  }

  const matchedRecords: DownloadRecord[] = [];
  const total = allItems.length;

  for (let idx = 0; idx < total; idx += 1) {
    const { subject, sectionTitle, sectionId, classIndex, item, primaryVideoUrl } = allItems[idx];

    const candidateNorms = Array.from(
      new Set(
        [
          normalizeMatchName(item.name),
          normalizeMatchName(`${subject.name} ${item.name}`),
          normalizeMatchName(`${sectionTitle} ${item.name}`),
          normalizeMatchName(`${subject.name} class ${classIndex}`),
          normalizeMatchName(`${sectionTitle} class ${classIndex}`),
        ].filter(Boolean)
      )
    );

    const videoDriveId = getGoogleDriveFileId(primaryVideoUrl);
    const pdfDriveId = getGoogleDriveFileId(item.pdfUrl);

    const matchedVideo = primaryVideoUrl
      ? findBestMatchingFile(candidateNorms, videoMap, videoDriveId)
      : undefined;
    const matchedPdf = item.pdfUrl
      ? findBestMatchingFile(candidateNorms, pdfMap, pdfDriveId)
      : undefined;

    if (matchedVideo || matchedPdf) {
      const entry = await saveOfflineBlobForClass({
        itemId: item.id,
        subjectId: subject.id,
        sectionId,
        sectionTitle,
        classNumber: classIndex,
        videoName: item.name,
        videoUrl: primaryVideoUrl,
        pdfUrl: item.pdfUrl,
        videoBlob: matchedVideo,
        pdfBlob: matchedPdf,
      });

      matchedRecords.push({
        uid,
        itemId: item.id,
        subjectId: subject.id,
        sectionId,
        sectionTitle,
        classNumber: classIndex,
        videoName: item.name,
        videoUrl: primaryVideoUrl,
        pdfUrl: item.pdfUrl,
        fileSizeBytes: entry.fileSizeBytes,
        hasLocalVideo: Boolean(entry.videoBlob && entry.videoBlob.size > 0),
        hasLocalPdf: Boolean(entry.pdfBlob && entry.pdfBlob.size > 0),
      });
    }

    onProgress?.(idx + 1, total, matchedRecords.length);
    await yieldToIdle(20);
  }

  return {
    restoredCount: matchedRecords.length,
    matchedRecords,
  };
}
