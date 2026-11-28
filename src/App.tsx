import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Bell,
  BookOpen,
  CheckCircle2,
  Download,
  ShieldAlert,
  User as UserIcon,
  WifiOff,
  X,
} from 'lucide-react';
import {
  AppNotification,
  AppUser,
  ClassItem,
  DownloadRecord,
  DownloadTask,
  InboxMessage,
  isAdminEmail,
  SubjectDoc,
  WatchProgress,
} from './types';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  sha256Hex,
  signInWithGoogleSmart,
  signOutGoogleSmart,
  testConnection,
} from './lib/firebase';
import {
  deleteOfflineMedia,
  listOfflineMedia,
  loadAppStateBackup,
  reconcileOfflineDownloadsWithCatalog,
  removeAppStateBackup,
  saveAppStateBackup,
} from './lib/offlineStorage';
import {
  autoScanDownloadsWithCapacitor,
  getDetailedNativePermissionStatus,
  isCapacitorNative,
  NativeStoragePermissionState,
  needsAnyStoragePermission,
  requestFullNativeStoragePermission,
  requestNativeDownloadFolderAccess,
} from './lib/capacitorScanner';
import { apiUrl } from './lib/api';
import { downloadManager } from './lib/downloadManager';
import {
  formatNotificationRemainingLabel,
  loadSeenNotificationIds,
  markNotificationsSeen,
  normalizeActiveNotifications,
  serializeNotificationsForCache,
} from './lib/notifications';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { handleTopOverlayBack } from './hooks/useBackHandler';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthSuitcaseScreen } from './components/AuthSuitcaseScreen';
import { SubjectsView } from './components/SubjectsView';
import { DownloadsView } from './components/DownloadsView';
import { ProfileView } from './components/ProfileView';
import { PlyrVideoPlayer } from './components/PlyrVideoPlayer';
import { PdfViewerModal } from './components/PdfViewerModal';
import { FileVaultModal } from './components/FileVaultModal';
import { AdminInboxModal } from './components/AdminInboxModal';
import { PWAInstallButton } from './components/PWAInstallButton';

type ActiveTab = 'subjects' | 'downloads' | 'profile';

interface ActiveVideoState {
  item: ClassItem;
  subjectId: string;
  sectionId: string;
  sectionTitle: string;
  classNumber: number;
}

interface ActivePdfState {
  itemId: string;
  title: string;
  pdfUrl: string;
}

interface NavState {
  activeTab: ActiveTab;
  subjectId: string | null;
  downloadSubjectId: string | null;
  vaultOpen: boolean;
  vaultSubjectId: string | null;
  inboxOpen: boolean;
  notifOpen: boolean;
  reportModalOpen: boolean;
  offlineModalOpen: boolean;
  activeVideo: ActiveVideoState | null;
  activePdf: ActivePdfState | null;
}

const ROOT_NAV: NavState = {
  activeTab: 'subjects',
  subjectId: null,
  downloadSubjectId: null,
  vaultOpen: false,
  vaultSubjectId: null,
  inboxOpen: false,
  notifOpen: false,
  reportModalOpen: false,
  offlineModalOpen: false,
  activeVideo: null,
  activePdf: null,
};

function isSameNav(a: NavState, b: NavState): boolean {
  return (
    a.activeTab === b.activeTab &&
    a.subjectId === b.subjectId &&
    a.downloadSubjectId === b.downloadSubjectId &&
    a.vaultOpen === b.vaultOpen &&
    a.vaultSubjectId === b.vaultSubjectId &&
    a.inboxOpen === b.inboxOpen &&
    a.notifOpen === b.notifOpen &&
    a.reportModalOpen === b.reportModalOpen &&
    a.offlineModalOpen === b.offlineModalOpen &&
    a.activeVideo?.item.id === b.activeVideo?.item.id &&
    Boolean(a.activeVideo) === Boolean(b.activeVideo) &&
    a.activePdf?.itemId === b.activePdf?.itemId &&
    Boolean(a.activePdf) === Boolean(b.activePdf)
  );
}

const CACHE_USER_KEY = 'noor_elahi_cache_user_v1';
const EXPLICIT_LOGOUT_KEY = 'noor_elahi_explicit_logout_v1';
const CACHE_SUBJECTS_KEY = 'noor_elahi_cache_subjects_v1';
const CACHE_NOTIFS_KEY = 'noor_elahi_cache_notifs_v1';
const CACHE_PROGRESS_KEY = 'noor_elahi_cache_progress_v1';
const CACHE_DOWNLOADS_KEY = 'noor_elahi_cache_downloads_v1';
const CACHE_VAULT_HASH_KEY = 'noor_elahi_cache_vault_hash_v1';

interface CachedVaultHash {
  uid: string;
  hash: string;
}

function readLocalCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota errors
  }
  saveAppStateBackup(key, value).catch(() => {});
}

function clearCachedUser() {
  try {
    localStorage.removeItem(CACHE_USER_KEY);
    localStorage.removeItem(CACHE_VAULT_HASH_KEY);
    localStorage.setItem(EXPLICIT_LOGOUT_KEY, '1');
  } catch {
    // Ignore storage error
  }
  removeAppStateBackup(CACHE_USER_KEY).catch(() => {});
  removeAppStateBackup(CACHE_VAULT_HASH_KEY).catch(() => {});
}

function handleListenerErrorSafe(
  err: unknown,
  op: OperationType,
  path: string
) {
  const code = (err as { code?: string } | null)?.code || '';
  if (typeof navigator !== 'undefined' && navigator.onLine && code === 'permission-denied') {
    handleFirestoreError(err, op, path);
  }
}

function AppContent() {
  const isOnline = useOnlineStatus();
  const initialCachedUser = useMemo(
    () => readLocalCache<AppUser | null>(CACHE_USER_KEY, null),
    []
  );
  const [authReady, setAuthReady] = useState<boolean>(() => Boolean(initialCachedUser));
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(initialCachedUser);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [unauthorizedDomain, setUnauthorizedDomain] = useState('');

  const [nav, setNav] = useState<NavState>(ROOT_NAV);
  const navRef = useRef<NavState>(ROOT_NAV);
  navRef.current = nav;
  const appUserRef = useRef<AppUser | null>(appUser);
  appUserRef.current = appUser;
  const historySeqRef = useRef<number>(0);
  const lastExitBackPressRef = useRef<number>(0);

  const {
    activeTab,
    subjectId: selectedSubjectId,
    downloadSubjectId,
    vaultOpen,
    vaultSubjectId,
    inboxOpen,
    notifOpen,
    reportModalOpen,
    offlineModalOpen,
    activeVideo,
    activePdf,
  } = nav;

  const [subjects, setSubjects] = useState<Record<string, SubjectDoc>>(() =>
    readLocalCache<Record<string, SubjectDoc>>(CACHE_SUBJECTS_KEY, {})
  );
  const [notifications, setNotifications] = useState<AppNotification[]>(() =>
    normalizeActiveNotifications(readLocalCache<AppNotification[]>(CACHE_NOTIFS_KEY, []))
  );
  const [progressMap, setProgressMap] = useState<Record<string, WatchProgress>>(() =>
    readLocalCache<Record<string, WatchProgress>>(CACHE_PROGRESS_KEY, {})
  );
  const [downloadsMap, setDownloadsMap] = useState<Record<string, DownloadRecord>>(() =>
    readLocalCache<Record<string, DownloadRecord>>(CACHE_DOWNLOADS_KEY, {})
  );
  const [downloadTasks, setDownloadTasks] = useState<Record<string, DownloadTask>>({});

  // Admin state
  const [vaultHash, setVaultHash] = useState<string | null>(() => {
    if (initialCachedUser?.role !== 'admin') return null;
    const cachedVault = readLocalCache<CachedVaultHash | null>(CACHE_VAULT_HASH_KEY, null);
    if (cachedVault?.uid === initialCachedUser.uid && cachedVault.hash) {
      return cachedVault.hash;
    }
    return null;
  });
  const [firestoreInbox, setFirestoreInbox] = useState<InboxMessage[]>([]);
  const [serverInbox, setServerInbox] = useState<InboxMessage[]>([]);

  // Notifications seen tracking & banner
  const [seenNotifIds, setSeenNotifIds] = useState<Set<string>>(() => loadSeenNotificationIds());
  const [topBanner, setTopBanner] = useState<string | null>(null);
  const isNativeCapacitor = useMemo(() => isCapacitorNative(), []);
  const [storagePermission, setStoragePermission] = useState<NativeStoragePermissionState>(() =>
    isCapacitorNative() ? 'granted' : 'web'
  );
  const [needsFolderGrantForPdf, setNeedsFolderGrantForPdf] = useState(false);
  const [needsTopPermissionGrant, setNeedsTopPermissionGrant] = useState(false);
  const [requestingStoragePerm, setRequestingStoragePerm] = useState(false);
  const [scanProgress, setScanProgress] = useState<{
    active: boolean;
    scanned: number;
    total: number;
    matched: number;
  } | null>(null);

  const unreadNotifCount = useMemo(
    () => notifications.filter((n) => !seenNotifIds.has(n.id)).length,
    [notifications, seenNotifIds]
  );

  const persistVaultHash = useCallback((uid: string, hash: string) => {
    setVaultHash(hash);
    writeLocalCache(CACHE_VAULT_HASH_KEY, { uid, hash } satisfies CachedVaultHash);
  }, []);

  // Report Issue modal inputs
  const [reportText, setReportText] = useState('');
  const [reportSending, setReportSending] = useState(false);
  const [reportFeedback, setReportFeedback] = useState('');

  // Synchronize step-by-step UI state with browser / Android hardware Back button
  useEffect(() => {
    try {
      const existing = window.history.state as { __noorSeq?: number; nav?: NavState } | null;
      if (existing && typeof existing.__noorSeq === 'number' && existing.nav) {
        historySeqRef.current = existing.__noorSeq;
        navRef.current = existing.nav;
        setNav(existing.nav);
      } else {
        historySeqRef.current = 0;
        window.history.replaceState({ __noorSeq: 0, nav: ROOT_NAV }, '');
      }
    } catch {
      // Ignore history API errors
    }

    const handlePopState = (event: PopStateEvent) => {
      const st = event.state as { __noorSeq?: number; nav?: NavState } | null;
      if (st && typeof st.__noorSeq === 'number' && st.nav) {
        historySeqRef.current = st.__noorSeq;
        navRef.current = st.nav;
        setNav(st.nav);
      } else {
        historySeqRef.current = 0;
        navRef.current = ROOT_NAV;
        setNav(ROOT_NAV);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const pushNav = useCallback((updater: (prev: NavState) => NavState) => {
    const prev = navRef.current;
    const next = updater(prev);
    if (isSameNav(prev, next)) return;

    const nextSeq = historySeqRef.current + 1;
    historySeqRef.current = nextSeq;
    navRef.current = next;
    setNav(next);
    try {
      window.history.pushState({ __noorSeq: nextSeq, nav: next }, '');
    } catch {
      // Ignore history push failure
    }
  }, []);

  const goBackOr = useCallback((fallbackUpdater: (prev: NavState) => NavState, steps = 1) => {
    const seqBefore = historySeqRef.current;
    if (seqBefore >= steps) {
      try {
        if (steps === 1) {
          window.history.back();
        } else {
          window.history.go(-steps);
        }
        window.setTimeout(() => {
          if (historySeqRef.current === seqBefore) {
            const next = fallbackUpdater(navRef.current);
            navRef.current = next;
            setNav(next);
            historySeqRef.current = Math.max(0, seqBefore - steps);
          }
        }, 120);
        return;
      } catch {
        // Fall through to local update
      }
    }
    const next = fallbackUpdater(navRef.current);
    navRef.current = next;
    setNav(next);
  }, []);

  const switchTab = useCallback(
    (tab: ActiveTab) => {
      pushNav((prev) => {
        if (prev.activeTab === tab) {
          if (tab === 'subjects' && prev.subjectId !== null) {
            return { ...prev, subjectId: null };
          }
          if (tab === 'downloads' && prev.downloadSubjectId !== null) {
            return { ...prev, downloadSubjectId: null };
          }
          return prev;
        }
        return { ...prev, activeTab: tab };
      });
    },
    [pushNav]
  );

  const showBanner = useCallback((msg: string) => {
    setTopBanner(msg);
    window.setTimeout(() => {
      setTopBanner((curr) => (curr === msg ? null : curr));
    }, 4000);
  }, []);

  useEffect(() => {
    const win = window as unknown as {
      __noorHandleNativeBack?: () => 'handled' | 'exit';
    };
    win.__noorHandleNativeBack = () => {
      if (handleTopOverlayBack()) {
        return 'handled';
      }

      const curr = navRef.current;
      if (curr.reportModalOpen) {
        goBackOr((p) => ({ ...p, reportModalOpen: false }));
        return 'handled';
      }
      if (curr.offlineModalOpen) {
        goBackOr((p) => ({ ...p, offlineModalOpen: false }));
        return 'handled';
      }
      if (curr.notifOpen) {
        goBackOr((p) => ({ ...p, notifOpen: false }));
        return 'handled';
      }
      if (curr.activePdf) {
        goBackOr((p) => ({ ...p, activePdf: null }));
        return 'handled';
      }
      if (curr.activeVideo) {
        goBackOr((p) => ({ ...p, activeVideo: null }));
        return 'handled';
      }
      if (curr.inboxOpen) {
        goBackOr((p) => ({ ...p, inboxOpen: false }));
        return 'handled';
      }
      if (curr.vaultOpen && curr.vaultSubjectId) {
        goBackOr((p) => ({ ...p, vaultSubjectId: null }));
        return 'handled';
      }
      if (curr.vaultOpen) {
        goBackOr((p) => ({ ...p, vaultOpen: false }));
        return 'handled';
      }

      if (appUserRef.current) {
        if (curr.activeTab === 'subjects' && curr.subjectId) {
          goBackOr((p) => ({ ...p, subjectId: null }));
          return 'handled';
        }
        if (curr.activeTab === 'downloads' && curr.downloadSubjectId) {
          goBackOr((p) => ({ ...p, downloadSubjectId: null }));
          return 'handled';
        }
        if (curr.activeTab !== 'subjects') {
          goBackOr((p) => ({ ...p, activeTab: 'subjects' }));
          return 'handled';
        }
      }

      const now = Date.now();
      if (now - lastExitBackPressRef.current < 2200) {
        lastExitBackPressRef.current = 0;
        return 'exit';
      }
      lastExitBackPressRef.current = now;
      showBanner('অ্যাপ থেকে বের হতে আবার ব্যাক চাপুন');
      return 'handled';
    };

    return () => {
      if (win.__noorHandleNativeBack) {
        delete win.__noorHandleNativeBack;
      }
    };
  }, [goBackOr, showBanner]);

  // Restore IndexedDB backup caches if localStorage was cleared + safety authReady timer
  useEffect(() => {
    let active = true;
    testConnection();

    const safetyTimer = window.setTimeout(() => {
      if (active) setAuthReady(true);
    }, 1600);

    (async () => {
      let explicitLogout = false;
      try {
        explicitLogout = localStorage.getItem(EXPLICIT_LOGOUT_KEY) === '1';
      } catch {
        explicitLogout = false;
      }

      if (!explicitLogout) {
        const backedUpUser = await loadAppStateBackup<AppUser>(CACHE_USER_KEY);
        if (active && backedUpUser) {
          setAppUser((curr) => curr || backedUpUser);
          writeLocalCache(CACHE_USER_KEY, backedUpUser);
          setAuthReady(true);
        }
      }

      const backedUpSubjects = await loadAppStateBackup<Record<string, SubjectDoc>>(CACHE_SUBJECTS_KEY);
      if (active && backedUpSubjects && Object.keys(backedUpSubjects).length > 0) {
        setSubjects((curr) => (Object.keys(curr).length > 0 ? curr : backedUpSubjects));
      }

      const backedUpNotifs = await loadAppStateBackup<AppNotification[]>(CACHE_NOTIFS_KEY);
      if (active && backedUpNotifs && backedUpNotifs.length > 0) {
        const freshBackedUp = normalizeActiveNotifications(backedUpNotifs);
        if (freshBackedUp.length > 0) {
          setNotifications((curr) => (curr.length > 0 ? curr : freshBackedUp));
        } else {
          writeLocalCache(CACHE_NOTIFS_KEY, []);
        }
      }

      const backedUpVault = await loadAppStateBackup<CachedVaultHash>(CACHE_VAULT_HASH_KEY);
      if (active && backedUpVault?.hash && backedUpVault?.uid) {
        const resolvedUid = initialCachedUser?.uid || (await loadAppStateBackup<AppUser>(CACHE_USER_KEY))?.uid;
        if (resolvedUid && resolvedUid === backedUpVault.uid) {
          setVaultHash((curr) => curr || backedUpVault.hash);
        }
      }

      const backedUpProgress = await loadAppStateBackup<Record<string, WatchProgress>>(CACHE_PROGRESS_KEY);
      if (active && backedUpProgress && Object.keys(backedUpProgress).length > 0) {
        setProgressMap((curr) => (Object.keys(curr).length > 0 ? curr : backedUpProgress));
      }

      const backedUpDownloads = await loadAppStateBackup<Record<string, DownloadRecord>>(CACHE_DOWNLOADS_KEY);
      if (active && backedUpDownloads && Object.keys(backedUpDownloads).length > 0) {
        const offlineOnly: Record<string, DownloadRecord> = {};
        for (const [id, rec] of Object.entries(backedUpDownloads)) {
          if (rec && (rec.hasLocalVideo || rec.localVideoUri || rec.hasLocalPdf || rec.localPdfUri)) {
            offlineOnly[id] = rec;
          }
        }
        if (Object.keys(offlineOnly).length > 0) {
          setDownloadsMap((curr) => ({ ...offlineOnly, ...curr }));
        }
      }
    })();

    return () => {
      active = false;
      clearTimeout(safetyTimer);
    };
  }, []);

  // Automatically remove notifications whose 24-hour window expires while the app is open
  useEffect(() => {
    const pruneExpired = () => {
      setNotifications((prev) => {
        const next = normalizeActiveNotifications(prev);
        if (next.length !== prev.length) {
          writeLocalCache(CACHE_NOTIFS_KEY, serializeNotificationsForCache(next));
          return next;
        }
        return prev;
      });
    };

    const interval = window.setInterval(pruneExpired, 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        pruneExpired();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Hydrate offline IndexedDB downloads on mount while preserving any Capacitor native file URIs
  useEffect(() => {
    listOfflineMedia()
      .then((entries) => {
        const entryMap = new Map(entries.map((e) => [e.itemId, e]));
        setDownloadsMap((prev) => {
          const next: Record<string, DownloadRecord> = {};
          for (const [id, existing] of Object.entries(prev)) {
            if (!entryMap.has(id)) {
              const hasNative = Boolean(existing.localVideoUri || existing.localPdfUri);
              if (!hasNative) continue;
              next[id] = {
                ...existing,
                hasLocalVideo: Boolean(existing.localVideoUri),
                hasLocalPdf: Boolean(existing.localPdfUri),
              };
            }
          }
          for (const entry of entries) {
            const existing = prev[entry.itemId];
            const hasVideo = Boolean(
              (entry.videoBlob && entry.videoBlob.size > 0) || existing?.localVideoUri
            );
            const hasPdf = Boolean(
              (entry.pdfBlob && entry.pdfBlob.size > 0) || existing?.localPdfUri
            );
            if (!hasVideo && !hasPdf) continue;
            next[entry.itemId] = {
              uid: appUser?.uid || existing?.uid || '',
              itemId: entry.itemId,
              subjectId: entry.subjectId,
              sectionId: entry.sectionId,
              sectionTitle: entry.sectionTitle,
              classNumber: entry.classNumber,
              videoName: entry.videoName,
              videoUrl: entry.videoUrl,
              pdfUrl: entry.pdfUrl,
              fileSizeBytes: entry.fileSizeBytes || existing?.fileSizeBytes || 0,
              hasLocalVideo: hasVideo,
              hasLocalPdf: hasPdf,
              localVideoUri: existing?.localVideoUri,
              localPdfUri: existing?.localPdfUri,
              matchedFileName: existing?.matchedFileName,
              matchScore: existing?.matchScore,
            };
          }
          writeLocalCache(CACHE_DOWNLOADS_KEY, next);
          return next;
        });
      })
      .catch(() => {});
  }, [appUser?.uid]);

  const applyGoogleAuthError = useCallback((err: unknown) => {
    const code = (err as { code?: string } | null)?.code || '';
    const rawMsg = err instanceof Error ? err.message : String(err || '');
    const lowerMsg = rawMsg.toLowerCase();
    setUnauthorizedDomain('');

    if (
      code === 'auth/cancelled-popup-request' ||
      code === 'auth/no-current-user' ||
      code === 'USER_CANCELLED' ||
      lowerMsg.includes('user_cancelled') ||
      lowerMsg.includes('user cancelled') ||
      lowerMsg.includes('cancelled by user') ||
      lowerMsg.includes('canceled by user') ||
      lowerMsg.includes('getcredentialcancellationexception')
    ) {
      setAuthError(
        'Google সাইন-ইন বাতিল হয়েছে বা পপআপ বন্ধ হয়ে গেছে। আবার চেষ্টা করুন (APK-তে বারবার এমন হলে Firebase Console-এ SHA-1 যোগ করা আছে কিনা দেখুন)।'
      );
      return;
    }

    if (
      lowerMsg.includes('no credentials available') ||
      lowerMsg.includes('nocredentialexception')
    ) {
      setAuthError(
        'এই ডিভাইসে কোনো Google অ্যাকাউন্ট পাওয়া যায়নি। ফোনের Settings → Google-এ অ্যাকাউন্ট যোগ করে আবার চেষ্টা করুন, অথবা নাম্বার দিয়ে লগইন করুন।'
      );
    } else if (
      lowerMsg.includes('28444') ||
      lowerMsg.includes('28404') ||
      lowerMsg.includes('google cloud oauth is not configured') ||
      lowerMsg.includes('developer console is not set up') ||
      lowerMsg.includes('getcredentialcustomexception') ||
      lowerMsg.includes('missing_google_web_client_id') ||
      lowerMsg.includes('native_google_missing_id_token') ||
      lowerMsg.includes('12500') ||
      lowerMsg.includes('10:')
    ) {
      setAuthError(
        'অ্যাপের Google OAuth / SHA-1 কনফিগারেশন মেলেনি (প্রজেক্ট: noor-elahi-84e9a)। অনুগ্রহ করে Firebase Console-এ সঠিক SHA-1 ও google-services.json সেট করুন, অথবা নাম্বার দিয়ে লগইন করুন।'
      );
    } else if (code === 'auth/popup-closed-by-user') {
      setAuthError('Google সাইন-ইন পপআপটি বন্ধ হয়ে গেছে। আবার চেষ্টা করুন।');
    } else if (code === 'auth/popup-blocked') {
      setAuthError(
        'ব্রাউজারে পপআপ ব্লক করা আছে। পপআপ অনুমতি (Allow Popups) চালু করে আবার চেষ্টা করুন।'
      );
    } else if (
      code === 'auth/web-storage-unsupported' ||
      lowerMsg.includes('missing initial state') ||
      lowerMsg.includes('sessionstorage') ||
      lowerMsg.includes('web storage')
    ) {
      setAuthError(
        'ব্রাউজার বা অ্যাপে স্টোরেজ (কুকিজ / ইন-অ্যাপ ব্রাউজার) সীমাবদ্ধ রয়েছে। অনুগ্রহ করে মূল ব্রাউজারে (Chrome) খুলুন অথবা নাম্বার দিয়ে লগইন করুন।'
      );
    } else if (
      code === 'auth/redirect-cancelled-by-user' ||
      code === 'auth/redirect-operation-pending' ||
      lowerMsg.includes('redirect')
    ) {
      setAuthError(
        'লগইন স্টেটজনিত সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন অথবা নাম্বার দিয়ে লগইন করুন।'
      );
    } else if (code === 'auth/operation-not-supported-in-this-environment') {
      setAuthError(
        'এই পরিবেশে পপআপ লগইন সমর্থিত নয়। অনুগ্রহ করে মূল ব্রাউজারে খুলুন অথবা নাম্বার দিয়ে লগইন করুন।'
      );
    } else if (code === 'auth/network-request-failed') {
      setAuthError('ইন্টারনেট সংযোগে সমস্যা। নেটওয়ার্ক পরীক্ষা করে আবার চেষ্টা করুন।');
    } else if (code === 'auth/unauthorized-domain') {
      const host = window.location.hostname;
      setUnauthorizedDomain(host);
      setAuthError(
        `এই ডোমেইনটি (${host}) Firebase Authorized Domains এ যোগ করা নেই।`
      );
    } else {
      setAuthError(
        rawMsg
          ? `Google লগইন ব্যর্থ হয়েছে: ${rawMsg}`
          : 'Google দিয়ে লগইন করা যায়নি। আবার চেষ্টা করুন।'
      );
    }
  }, []);

  // Listen to Firebase Auth state cleanly (native ID-token on Capacitor Android, popup on Web)
  useEffect(() => {

    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        try {
          localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
        } catch {
          // Ignore
        }
        const isAdmin = isAdminEmail(fbUser.email) && fbUser.emailVerified;
        const cached = readLocalCache<AppUser | null>(CACHE_USER_KEY, null);
        const sameCached = cached?.uid === fbUser.uid ? cached : null;

        const fallbackUser: AppUser = {
          uid: fbUser.uid,
          authMode: 'google',
          name: sameCached?.name || fbUser.displayName || 'শিক্ষার্থী',
          email: sameCached?.email || fbUser.email || '',
          phone: sameCached?.phone || '',
          photoUrl: sameCached?.photoUrl || fbUser.photoURL || '',
          role: isAdmin ? 'admin' : sameCached?.role || 'student',
        };

        setAppUser((curr) => curr || fallbackUser);
        setAuthReady(true);

        // Automatically request persistent storage permission on first login/launch
        try {
          if (navigator.storage?.persist) {
            navigator.storage.persist().catch(() => {});
          }
        } catch {
          // Ignore
        }

        const userDocRef = doc(db, 'users', fbUser.uid);
        try {
          const snap = await Promise.race([
            getDoc(userDocRef),
            new Promise<never>((_resolve, reject) =>
              window.setTimeout(() => reject(new Error('offline_timeout')), navigator.onLine ? 6000 : 1200)
            ),
          ]);

          if (snap.exists()) {
            const data = snap.data() as {
              name?: string;
              email?: string;
              phone?: string;
              photoUrl?: string;
              role?: 'admin' | 'student';
            };
            const resolvedUser: AppUser = {
              uid: fbUser.uid,
              authMode: 'google',
              name: data.name || fbUser.displayName || 'শিক্ষার্থী',
              email: data.email || fbUser.email || '',
              phone: data.phone || '',
              photoUrl: data.photoUrl || fbUser.photoURL || '',
              role: isAdmin ? 'admin' : data.role || 'student',
            };
            setAppUser((curr) => {
              if (
                curr &&
                curr.uid === resolvedUser.uid &&
                curr.name === resolvedUser.name &&
                curr.email === resolvedUser.email &&
                curr.phone === resolvedUser.phone &&
                curr.photoUrl === resolvedUser.photoUrl &&
                curr.role === resolvedUser.role
              ) {
                return curr;
              }
              return resolvedUser;
            });
            writeLocalCache(CACHE_USER_KEY, resolvedUser);
          } else if (navigator.onLine) {
            const pendingPrefill = readLocalCache<{
              name?: string;
              password?: string;
              photoUrl?: string;
            } | null>('noor_elahi_pending_google_prefill', null);

            const initialName =
              (pendingPrefill?.name?.trim() || fbUser.displayName || 'শিক্ষার্থী').slice(0, 100);
            const rawPhoto = pendingPrefill?.photoUrl || fbUser.photoURL || '';
            const safePhoto =
              rawPhoto.length <= 65000 ? rawPhoto : '';
            const passwordHash = pendingPrefill?.password
              ? await sha256Hex(pendingPrefill.password)
              : '';

            const profilePayload = {
              uid: fbUser.uid,
              name: initialName || 'শিক্ষার্থী',
              email: (fbUser.email || '').slice(0, 160),
              phone: '',
              photoUrl: safePhoto,
              passwordHash: passwordHash.slice(0, 128),
              role: isAdmin ? 'admin' : 'student',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            await setDoc(userDocRef, profilePayload);
            localStorage.removeItem('noor_elahi_pending_google_prefill');
            const createdUser: AppUser = {
              uid: fbUser.uid,
              authMode: 'google',
              name: profilePayload.name,
              email: profilePayload.email,
              phone: '',
              photoUrl: profilePayload.photoUrl,
              role: isAdmin ? 'admin' : 'student',
            };
            setAppUser(createdUser);
            writeLocalCache(CACHE_USER_KEY, createdUser);
          } else {
            writeLocalCache(CACHE_USER_KEY, fallbackUser);
          }
        } catch {
          try {
            const cachedSnap = await getDocFromCache(userDocRef);
            if (cachedSnap.exists()) {
              const data = cachedSnap.data() as {
                name?: string;
                email?: string;
                phone?: string;
                photoUrl?: string;
                role?: 'admin' | 'student';
              };
              const offlineUser: AppUser = {
                uid: fbUser.uid,
                authMode: 'google',
                name: data.name || fallbackUser.name,
                email: data.email || fallbackUser.email,
                phone: data.phone || fallbackUser.phone,
                photoUrl: data.photoUrl || fallbackUser.photoUrl,
                role: isAdmin ? 'admin' : data.role || fallbackUser.role,
              };
              setAppUser(offlineUser);
              writeLocalCache(CACHE_USER_KEY, offlineUser);
            } else {
              setAppUser(fallbackUser);
              writeLocalCache(CACHE_USER_KEY, fallbackUser);
            }
          } catch {
            setAppUser(fallbackUser);
            writeLocalCache(CACHE_USER_KEY, fallbackUser);
          }
        }
      } else {
        let explicitLogout = false;
        try {
          explicitLogout = localStorage.getItem(EXPLICIT_LOGOUT_KEY) === '1';
        } catch {
          explicitLogout = false;
        }
        setAppUser((curr) => {
          if (curr?.authMode === 'number') return curr;
          if (!navigator.onLine && !explicitLogout && curr) return curr;
          if (!navigator.onLine && !explicitLogout) {
            return readLocalCache<AppUser | null>(CACHE_USER_KEY, null);
          }
          return null;
        });
      }
      setAuthReady(true);
    });

    return () => unsub();
  }, []);

  // Firestore Real-time Listeners for Google Users & Live Catalog Refresh for Number Users
  useEffect(() => {
    if (!appUser) return;

    if (appUser.authMode === 'number') {
      const fetchCatalog = () => {
        fetch(apiUrl('/api/catalog'), { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { subjects?: Record<string, SubjectDoc>; notifications?: AppNotification[] } | null) => {
            if (!data) return;
            if (data.subjects) {
              setSubjects(data.subjects);
              writeLocalCache(CACHE_SUBJECTS_KEY, data.subjects);
            }
            if (data.notifications) {
              const activeNotifs = serializeNotificationsForCache(data.notifications);
              setNotifications(activeNotifs);
              writeLocalCache(CACHE_NOTIFS_KEY, activeNotifs);
            }
          })
          .catch(() => {});
      };

      fetchCatalog();

      const onVisibility = () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          fetchCatalog();
        }
      };
      const onOnline = () => fetchCatalog();
      const pollId = window.setInterval(() => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          fetchCatalog();
        }
      }, 45_000);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('online', onOnline);

      if (appUser.bearerToken) {
        fetch(apiUrl('/api/number-user/state'), {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${appUser.bearerToken}` },
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { progress?: Record<string, WatchProgress>; downloads?: Record<string, DownloadRecord> } | null) => {
            if (!data) return;
            if (data.progress) {
              setProgressMap(data.progress);
              writeLocalCache(CACHE_PROGRESS_KEY, data.progress);
            }
            if (data.downloads) {
              setDownloadsMap((prev) => {
                const next: Record<string, DownloadRecord> = {};
                for (const [id, existing] of Object.entries(prev)) {
                  const hasOffline = Boolean(
                    existing.hasLocalVideo ||
                      existing.localVideoUri ||
                      existing.hasLocalPdf ||
                      existing.localPdfUri
                  );
                  if (!hasOffline) continue;
                  const cloud = data.downloads?.[id];
                  next[id] = cloud ? { ...cloud, ...existing } : existing;
                }
                writeLocalCache(CACHE_DOWNLOADS_KEY, next);
                return next;
              });
            }
          })
          .catch(() => {});
      }

      return () => {
        clearInterval(pollId);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('online', onOnline);
      };
    }

    if (!firebaseUser) return;

    const unsubs: Array<() => void> = [];

    // 1. Subjects
    const qSubjects = query(collection(db, 'subjects'), where('isPublished', '==', true));
    unsubs.push(
      onSnapshot(
        qSubjects,
        (snap) => {
          const map: Record<string, SubjectDoc> = {};
          snap.forEach((d) => {
            map[d.id] = d.data() as SubjectDoc;
          });
          setSubjects(map);
          writeLocalCache(CACHE_SUBJECTS_KEY, map);

          // Mirror live Firestore catalog to server store for cross-device Number-login users
          if (appUser.role === 'admin' && !snap.metadata.fromCache && navigator.onLine && Object.keys(map).length > 0) {
            firebaseUser
              .getIdToken()
              .then((idToken) =>
                fetch(apiUrl('/api/catalog/sync'), {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`,
                  },
                  body: JSON.stringify({ subjectsMap: map }),
                })
              )
              .catch(() => {});
          }
        },
        (err) => handleListenerErrorSafe(err, OperationType.LIST, 'subjects')
      )
    );

    // 2. Notifications (strictly active within 24 hours; admin automatically deletes expired docs)
    const qNotifs = query(
      collection(db, 'notifications'),
      where('isActive', '==', true)
    );
    unsubs.push(
      onSnapshot(
        qNotifs,
        (snap) => {
          const now = Date.now();
          const candidates: AppNotification[] = [];
          const expiredIds: string[] = [];

          snap.forEach((d) => {
            const raw = d.data() as AppNotification;
            const normalized = normalizeActiveNotifications([raw], now);
            if (normalized.length > 0) {
              candidates.push(normalized[0]);
            } else if (!d.metadata.hasPendingWrites) {
              expiredIds.push(d.id);
            }
          });

          const activeList = serializeNotificationsForCache(candidates);
          setNotifications(activeList);
          writeLocalCache(CACHE_NOTIFS_KEY, activeList);

          if (appUser.role === 'admin' && navigator.onLine) {
            for (const expId of expiredIds) {
              deleteDoc(doc(db, 'notifications', expId)).catch(() => {});
            }
            if (!snap.metadata.fromCache) {
              firebaseUser
                .getIdToken()
                .then((idToken) =>
                  fetch(apiUrl('/api/catalog/sync'), {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${idToken}`,
                    },
                    body: JSON.stringify({ notificationsList: activeList }),
                  })
                )
                .catch(() => {});
            }
          }
        },
        (err) => handleListenerErrorSafe(err, OperationType.LIST, 'notifications')
      )
    );

    // 3. Watch Progress
    const progPath = `users/${firebaseUser.uid}/progress`;
    unsubs.push(
      onSnapshot(
        query(collection(db, progPath), where('uid', '==', firebaseUser.uid)),
        (snap) => {
          const map: Record<string, WatchProgress> = {};
          snap.forEach((d) => {
            map[d.id] = d.data() as WatchProgress;
          });
          setProgressMap(map);
          writeLocalCache(CACHE_PROGRESS_KEY, map);
        },
        (err) => handleListenerErrorSafe(err, OperationType.LIST, progPath)
      )
    );

    // 4. Downloads Registry (strictly keeps only records with verified local offline files on this phone)
    const dlPath = `users/${firebaseUser.uid}/downloads`;
    unsubs.push(
      onSnapshot(
        query(collection(db, dlPath), where('uid', '==', firebaseUser.uid)),
        (snap) => {
          setDownloadsMap((prev) => {
            const next: Record<string, DownloadRecord> = {};
            for (const [id, existing] of Object.entries(prev)) {
              if (
                existing &&
                (existing.hasLocalVideo ||
                  existing.localVideoUri ||
                  existing.hasLocalPdf ||
                  existing.localPdfUri)
              ) {
                next[id] = existing;
              }
            }
            snap.forEach((d) => {
              const rec = d.data() as DownloadRecord;
              const existing = prev[d.id];
              const hasLocalVideo = Boolean(existing?.hasLocalVideo || existing?.localVideoUri);
              const hasLocalPdf = Boolean(existing?.hasLocalPdf || existing?.localPdfUri);
              if (!hasLocalVideo && !hasLocalPdf) {
                // Skip cloud-only download records that are NOT stored offline on this phone
                return;
              }
              next[d.id] = {
                ...rec,
                hasLocalVideo,
                hasLocalPdf,
                localVideoUri: existing?.localVideoUri,
                localPdfUri: existing?.localPdfUri,
                matchedFileName: existing?.matchedFileName,
                matchScore: existing?.matchScore,
              };
            });
            writeLocalCache(CACHE_DOWNLOADS_KEY, next);
            return next;
          });
        },
        (err) => handleListenerErrorSafe(err, OperationType.LIST, dlPath)
      )
    );

    // 5. Admin-Only Listeners
    if (appUser.role === 'admin') {
      unsubs.push(
        onSnapshot(
          doc(db, 'adminConfig', 'vault'),
          (snap) => {
            if (snap.exists()) {
              const d = snap.data() as { vaultPasswordHash?: string };
              if (d.vaultPasswordHash) {
                persistVaultHash(firebaseUser.uid, d.vaultPasswordHash);
              }
            }
          },
          (err) => handleListenerErrorSafe(err, OperationType.GET, 'adminConfig/vault')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'adminInbox'), orderBy('createdAt', 'desc')),
          (snap) => {
            const list: InboxMessage[] = [];
            snap.forEach((d) =>
              list.push({ ...(d.data() as InboxMessage), source: 'firestore' })
            );
            setFirestoreInbox(list);
          },
          (err) => handleListenerErrorSafe(err, OperationType.LIST, 'adminInbox')
        )
      );

      firebaseUser
        .getIdToken()
        .then((idToken) =>
          fetch(apiUrl('/api/inbox/admin'), {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${idToken}` },
          })
            .then((r) => (r.ok ? r.json() : { items: [] }))
            .then((data: { items?: InboxMessage[] }) => {
              if (data.items) {
                setServerInbox(
                  data.items.map((item) => ({ ...item, source: 'server' }))
                );
              }
            })
        )
        .catch(() => {});
    }

    return () => {
      for (const u of unsubs) u();
    };
  }, [appUser, firebaseUser, persistVaultHash]);

  const combinedInbox = useMemo(() => {
    return [...firestoreInbox, ...serverInbox];
  }, [firestoreInbox, serverInbox]);

  const handleGoogleLogin = async (prefill: {
    name: string;
    password: string;
    photoUrl: string;
  }) => {
    setAuthError('');
    setUnauthorizedDomain('');
    setAuthLoading(true);
    try {
      try {
        localStorage.setItem('noor_elahi_pending_google_prefill', JSON.stringify(prefill));
      } catch {
        // Non-fatal if localStorage is restricted; auth can still proceed
      }
      await signInWithGoogleSmart();
    } catch (err) {
      applyGoogleAuthError(err);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleNumberLogin = async (payload: {
    phone: string;
    password: string;
    name: string;
    photoUrl: string;
  }) => {
    setAuthError('');
    setAuthLoading(true);
    try {
      const res = await fetch(apiUrl('/api/number-auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: string;
        token?: string;
        user?: {
          uid: string;
          phone: string;
          name: string;
          email: string;
          photoUrl: string;
          role: 'student';
        };
      };
      if (!res.ok || !data.user || !data.token) {
        setAuthError(data.error || 'নাম্বার দিয়ে লগইন ব্যর্থ হয়েছে।');
        return;
      }
      try {
        localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
      } catch {
        // Ignore
      }
      const nextNumUser: AppUser = {
        uid: data.user.uid,
        authMode: 'number',
        name: data.user.name,
        email: data.user.email,
        phone: data.user.phone,
        photoUrl: data.user.photoUrl,
        role: 'student',
        bearerToken: data.token,
      };
      setAppUser(nextNumUser);
      writeLocalCache(CACHE_USER_KEY, nextNumUser);
    } catch {
      setAuthError('নেটওয়ার্ক সমস্যা। ইন্টারনেট সংযোগ পরীক্ষা করুন।');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    clearCachedUser();
    try {
      await signOutGoogleSmart();
    } catch {
      // Ignore signOut network errors
    } finally {
      setAppUser(null);
      historySeqRef.current = 0;
      navRef.current = ROOT_NAV;
      setNav(ROOT_NAV);
      try {
        window.history.replaceState({ __noorSeq: 0, nav: ROOT_NAV }, '');
      } catch {
        // Ignore history error
      }
    }
  };

  const handleSaveProgress = useCallback(
    async (itemId: string, currentTime: number, duration: number) => {
      if (!appUser || !activeVideo) return;
      const entry: WatchProgress = {
        uid: appUser.uid,
        itemId,
        subjectId: activeVideo.subjectId,
        sectionId: activeVideo.sectionId,
        currentTime,
        duration,
      };
      setProgressMap((prev) => {
        const next = { ...prev, [itemId]: entry };
        writeLocalCache(CACHE_PROGRESS_KEY, next);
        return next;
      });

      const activeFbUser = firebaseUser || auth.currentUser;
      if (appUser.authMode === 'google' && activeFbUser && navigator.onLine) {
        const path = `users/${activeFbUser.uid}/progress`;
        try {
          await setDoc(doc(db, path, itemId), {
            ...entry,
            uid: activeFbUser.uid,
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Non-blocking sync failure while seeking
        }
      } else if (appUser.authMode === 'number' && appUser.bearerToken && navigator.onLine) {
        fetch(apiUrl('/api/number-user/state'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${appUser.bearerToken}`,
          },
          body: JSON.stringify({ progressItem: entry }),
        }).catch(() => {});
      }
    },
    [appUser, activeVideo, firebaseUser]
  );

  const handleUpdateProfile = async (payload: {
    name: string;
    photoUrl: string;
    newPassword?: string;
  }) => {
    if (!appUser) return;
    const activeFbUser = firebaseUser || auth.currentUser;
    if (appUser.authMode === 'google' && activeFbUser) {
      const safeName = payload.name.trim().slice(0, 100) || appUser.name;
      const safePhoto = payload.photoUrl.length <= 65000 ? payload.photoUrl : '';
      const updates: Record<string, unknown> = {
        name: safeName,
        photoUrl: safePhoto,
        updatedAt: serverTimestamp(),
      };
      if (payload.newPassword) {
        updates.passwordHash = await sha256Hex(payload.newPassword);
      }
      try {
        await updateDoc(doc(db, 'users', activeFbUser.uid), updates);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${activeFbUser.uid}`);
      }

      if (payload.newPassword) {
        const msgId = `pwd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        try {
          await setDoc(doc(db, 'adminInbox', msgId), {
            id: msgId,
            uid: activeFbUser.uid,
            type: 'password_change',
            senderName: payload.name,
            senderEmail: appUser.email,
            senderPhone: appUser.phone || '',
            newPassword: payload.newPassword,
            message: `${payload.name} পাসওয়ার্ড পরিবর্তন করেছেন।`,
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `adminInbox/${msgId}`);
        }
      }
      setAppUser((prev) => {
        const next = prev ? { ...prev, name: payload.name, photoUrl: payload.photoUrl } : prev;
        if (next) writeLocalCache(CACHE_USER_KEY, next);
        return next;
      });
    } else if (appUser.authMode === 'number' && appUser.bearerToken) {
      const res = await fetch(apiUrl('/api/number-auth/update'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${appUser.bearerToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Update failed');
      const data = (await res.json()) as { user: { name: string; photoUrl: string } };
      setAppUser((prev) => {
        const next = prev ? { ...prev, name: data.user.name, photoUrl: data.user.photoUrl } : prev;
        if (next) writeLocalCache(CACHE_USER_KEY, next);
        return next;
      });
    }
  };

  const handleSaveVaultPasswordHash = async (hash: string) => {
    const activeFbUser = firebaseUser || auth.currentUser;
    if (!activeFbUser) return;
    persistVaultHash(activeFbUser.uid, hash);
    try {
      const writeOp = setDoc(doc(db, 'adminConfig', 'vault'), {
        vaultPasswordHash: hash,
        updatedBy: activeFbUser.uid,
        updatedAt: serverTimestamp(),
      });
      if (navigator.onLine) {
        await Promise.race([writeOp, new Promise<void>((r) => window.setTimeout(r, 8000))]);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'adminConfig/vault');
    }
  };

  const handleSaveSubject = async (
    subject: SubjectDoc,
    addedItems: Array<{ sectionTitle: string; itemName: string }>
  ) => {
    const authWithReady = auth as unknown as { authStateReady?: () => Promise<void> };
    if (!firebaseUser && !auth.currentUser && typeof authWithReady.authStateReady === 'function') {
      await Promise.race([
        authWithReady.authStateReady().catch(() => {}),
        new Promise<void>((r) => window.setTimeout(r, 2500)),
      ]);
    }

    const activeFbUser = firebaseUser || auth.currentUser;
    if (!activeFbUser) {
      throw new Error(
        'অ্যাডমিন Google সেশন সক্রিয় নেই। প্রোফাইল থেকে সাইন আউট করে পুনরায় Google দিয়ে লগইন করে সেভ করুন।'
      );
    }

    const cleanSections = (subject.sections || []).slice(0, 40).map((sec) => ({
      ...sec,
      items: (sec.items || []).map((it) => {
        const cleanItem: Record<string, unknown> = {
          id: it.id,
          name: it.name || '',
          videoUrl: it.videoUrl || '',
          videoUrls: it.videoUrls || (it.videoUrl ? [it.videoUrl] : []),
          videoFileName: it.videoFileName || '',
          videoFileNames: it.videoFileNames || (it.videoFileName ? [it.videoFileName] : []),
          pdfUrl: it.pdfUrl || '',
          pdfFileName: it.pdfFileName || '',
          duration: it.duration || '',
          createdAt: it.createdAt || Date.now(),
        };
        if (typeof it.expectedSizeMB === 'number' && Number.isFinite(it.expectedSizeMB) && it.expectedSizeMB > 0) {
          cleanItem.expectedSizeMB = it.expectedSizeMB;
        }
        return cleanItem;
      }),
    }));

    const safeSubject: SubjectDoc = {
      ...subject,
      name: (subject.name || '').slice(0, 120),
      description: (subject.description || '').slice(0, 2000),
      sections: cleanSections as unknown as SubjectDoc['sections'],
    };

    // Update local state and offline cache immediately so changes appear everywhere right away
    setSubjects((prev) => {
      const next = { ...prev, [safeSubject.id]: safeSubject };
      writeLocalCache(CACHE_SUBJECTS_KEY, next);
      return next;
    });

    const payload = {
      ...safeSubject,
      updatedBy: activeFbUser.uid,
      updatedAt: serverTimestamp(),
    };

    try {
      const subjectWrite = setDoc(doc(db, 'subjects', subject.id), payload);
      if (navigator.onLine) {
        await Promise.race([
          subjectWrite,
          new Promise<void>((resolve) => window.setTimeout(resolve, 9000)),
        ]);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `subjects/${subject.id}`);
    }

    const nowMs = Date.now();
    const createdNotifs: AppNotification[] = [];
    for (let idx = 0; idx < addedItems.length; idx += 1) {
      const added = addedItems[idx];
      const notifTs = nowMs + idx;
      const notifId = `notif_${notifTs}_${Math.random().toString(36).slice(2, 7)}`;
      const firestoreNotif = {
        id: notifId,
        subjectId: subject.id,
        subjectName: subject.name,
        sectionTitle: added.sectionTitle,
        itemName: added.itemName,
        message: `${subject.name} বিষয়ের "${added.sectionTitle}" শিরোনামে "${added.itemName}" যোগ করা হয়েছে।`,
        isActive: true,
      };
      createdNotifs.push({ ...firestoreNotif, createdAtMs: notifTs });

      try {
        const notifWrite = setDoc(doc(db, 'notifications', notifId), {
          ...firestoreNotif,
          createdBy: activeFbUser.uid,
          createdAt: serverTimestamp(),
        });
        if (navigator.onLine) {
          await Promise.race([
            notifWrite,
            new Promise<void>((resolve) => window.setTimeout(resolve, 6000)),
          ]);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `notifications/${notifId}`);
      }
    }

    if (createdNotifs.length > 0) {
      setNotifications((prev) => {
        const next = serializeNotificationsForCache([...createdNotifs, ...prev]);
        writeLocalCache(CACHE_NOTIFS_KEY, next);
        return next;
      });
    }

    // Mirror to server catalog for Number-login users
    if (navigator.onLine) {
      try {
        const idToken = await activeFbUser.getIdToken();
        await fetch(apiUrl('/api/catalog/sync'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            subject: { ...safeSubject, updatedBy: activeFbUser.uid },
            notifications: createdNotifs.length > 0 ? createdNotifs : undefined,
          }),
        });
      } catch {
        // Non-critical mirror failure
      }
    }
  };

  const handleDeleteInboxMessage = async (msg: InboxMessage) => {
    const activeFbUser = firebaseUser || auth.currentUser;
    if (msg.source === 'server' && activeFbUser) {
      try {
        const idToken = await activeFbUser.getIdToken();
        await fetch(apiUrl(`/api/inbox/admin/${encodeURIComponent(msg.id)}`), {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${idToken}` },
        });
        setServerInbox((prev) => prev.filter((m) => m.id !== msg.id));
      } catch {
        // Ignore network error deleting cached message
      }
    } else {
      try {
        await deleteDoc(doc(db, 'adminInbox', msg.id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `adminInbox/${msg.id}`);
      }
    }
  };

  const handleRestoreMatchedRecords = useCallback(async (records: DownloadRecord[]) => {
    setDownloadsMap((prev) => {
      const next = { ...prev };
      for (const r of records) {
        const existing = prev[r.itemId];
        next[r.itemId] = {
          ...existing,
          ...r,
          subjectId: r.subjectId || existing?.subjectId || '',
          sectionId: r.sectionId || existing?.sectionId || '',
          sectionTitle: r.sectionTitle || existing?.sectionTitle || '',
          classNumber: r.classNumber || existing?.classNumber || 1,
          videoName: r.videoName || existing?.videoName || 'ক্লাস',
          videoUrl: r.videoUrl || existing?.videoUrl || '',
          pdfUrl: r.pdfUrl || existing?.pdfUrl || '',
          hasLocalVideo: Boolean(r.hasLocalVideo || r.localVideoUri || existing?.hasLocalVideo),
          hasLocalPdf: Boolean(r.hasLocalPdf || r.localPdfUri || existing?.hasLocalPdf),
          localVideoUri: r.localVideoUri || existing?.localVideoUri,
          localPdfUri: r.localPdfUri || existing?.localPdfUri,
          matchedFileName: r.matchedFileName || existing?.matchedFileName,
          matchScore: r.matchScore ?? existing?.matchScore,
        };
      }
      writeLocalCache(CACHE_DOWNLOADS_KEY, next);
      return next;
    });

    const activeFbUser = firebaseUser || auth.currentUser;
    if (appUser?.authMode === 'google' && activeFbUser) {
      const writes = records.map((r) => {
        const path = `users/${activeFbUser.uid}/downloads`;
        return setDoc(doc(db, path, r.itemId), {
          uid: activeFbUser.uid,
          itemId: r.itemId,
          subjectId: r.subjectId || '',
          sectionId: r.sectionId || '',
          sectionTitle: (r.sectionTitle || 'ক্লাস').slice(0, 160),
          classNumber: Math.max(1, Number(r.classNumber) || 1),
          videoName: (r.videoName || 'ক্লাস').slice(0, 200),
          videoUrl: (r.videoUrl || '').slice(0, 1000),
          pdfUrl: (r.pdfUrl || '').slice(0, 1000),
          fileSizeBytes: Math.max(0, Number(r.fileSizeBytes) || 0),
          downloadedAt: serverTimestamp(),
        }).catch((err) => {
          handleListenerErrorSafe(err, OperationType.WRITE, `${path}/${r.itemId}`);
        });
      });
      if (navigator.onLine) {
        await Promise.all(writes);
      }
    } else if (appUser?.authMode === 'number' && appUser.bearerToken) {
      for (const r of records) {
        fetch(apiUrl('/api/number-user/state'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${appUser.bearerToken}`,
          },
          body: JSON.stringify({ downloadItem: r }),
        }).catch(() => {});
      }
    }
  }, [appUser, firebaseUser]);

  const handleDeleteDownload = useCallback(async (itemId: string) => {
    await deleteOfflineMedia(itemId).catch(() => {});
    setDownloadsMap((prev) => {
      const next = { ...prev };
      delete next[itemId];
      writeLocalCache(CACHE_DOWNLOADS_KEY, next);
      return next;
    });

    const activeFbUser = firebaseUser || auth.currentUser;
    if (appUser?.authMode === 'google' && activeFbUser && navigator.onLine) {
      deleteDoc(doc(db, `users/${activeFbUser.uid}/downloads`, itemId)).catch(() => {});
    } else if (appUser?.authMode === 'number' && appUser.bearerToken && navigator.onLine) {
      fetch(apiUrl('/api/number-user/state'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${appUser.bearerToken}`,
        },
        body: JSON.stringify({ removeDownloadId: itemId }),
      }).catch(() => {});
    }
  }, [appUser, firebaseUser]);

  useEffect(() => {
    if (appUser?.uid) {
      downloadManager.setUid(appUser.uid);
    }
    const unsubTasks = downloadManager.subscribe(setDownloadTasks);
    const unsubComplete = downloadManager.onComplete((record) => {
      void handleRestoreMatchedRecords([record]);
    });
    return () => {
      unsubTasks();
      unsubComplete();
    };
  }, [appUser?.uid, handleRestoreMatchedRecords]);

  const runCapacitorAutoScan = useCallback(
    async (promptPermission: boolean): Promise<{ scannedFilesCount: number; matchedCount: number }> => {
      if (!appUser) return { scannedFilesCount: 0, matchedCount: 0 };

      const idbVideoIds = new Set<string>();
      const idbPdfIds = new Set<string>();
      try {
        const offlineList = await listOfflineMedia();
        for (const entry of offlineList) {
          if (entry.videoBlob && entry.videoBlob.size > 0) idbVideoIds.add(entry.itemId);
          if (entry.pdfBlob && entry.pdfBlob.size > 0) idbPdfIds.add(entry.itemId);
        }

        const reconciled = await reconcileOfflineDownloadsWithCatalog(subjects, appUser.uid);
        if (Object.keys(reconciled).length > 0) {
          setDownloadsMap((prev) => {
            const next = { ...prev };
            for (const [id, rec] of Object.entries(reconciled)) {
              const existing = prev[id];
              next[id] = {
                ...rec,
                localVideoUri: existing?.localVideoUri,
                localPdfUri: existing?.localPdfUri,
                matchedFileName: existing?.matchedFileName,
                matchScore: existing?.matchScore,
                hasLocalVideo: Boolean(rec.hasLocalVideo || existing?.localVideoUri),
                hasLocalPdf: Boolean(rec.hasLocalPdf || existing?.localPdfUri),
              };
            }
            writeLocalCache(CACHE_DOWNLOADS_KEY, next);
            return next;
          });
        }
      } catch {
        // Ignore IDB reconcile error
      }

      if (!isNativeCapacitor) {
        setStoragePermission('web');
        setNeedsFolderGrantForPdf(false);
        return { scannedFilesCount: 0, matchedCount: 0 };
      }

      if (Object.keys(subjects).length === 0) {
        return { scannedFilesCount: 0, matchedCount: 0 };
      }

      const onlineNow = Boolean(isOnline || (typeof navigator !== 'undefined' && navigator.onLine));
      setScanProgress({ active: true, scanned: 0, total: 1, matched: 0 });
      try {
        const res = await autoScanDownloadsWithCapacitor(subjects, appUser.uid, {
          promptPermission,
          isOnline: onlineNow,
          onProgress: (scanned, total, matched) => {
            setScanProgress({ active: true, scanned, total: Math.max(1, total), matched });
          },
        });

        if (res.permissionDetails) {
          setNeedsFolderGrantForPdf(Boolean(res.permissionDetails.needsFolderGrantForPdf));
          setNeedsTopPermissionGrant(needsAnyStoragePermission(res.permissionDetails));
        }

        if (res.status === 'permission_denied') {
          setStoragePermission('denied');
          setNeedsTopPermissionGrant(true);
          return { scannedFilesCount: 0, matchedCount: 0 };
        }

        if (res.status === 'granted') {
          setStoragePermission('granted');
          const matchedMap = new Map(res.matchedRecords.map((r) => [r.itemId, r]));
          const discoveredSet = new Set(res.discoveredUris || []);

          // Remove stale native-only markers if file was deleted from device storage, keep IndexedDB blobs
          // Also preserve existing local URIs when video scanning is deferred offline for nameless videos
          setDownloadsMap((prev) => {
            const next: Record<string, DownloadRecord> = {};
            for (const [id, existing] of Object.entries(prev)) {
              const matched = matchedMap.get(id);
              const keepIdbVideo = idbVideoIds.has(id);
              const keepIdbPdf = idbPdfIds.has(id);
              if (matched) {
                next[id] = existing;
              } else {
                const videoStillOnDisk = Boolean(
                  !onlineNow && existing.localVideoUri && discoveredSet.has(existing.localVideoUri)
                );
                const pdfStillOnDisk = Boolean(
                  existing.localPdfUri && discoveredSet.has(existing.localPdfUri)
                );
                if (keepIdbVideo || keepIdbPdf || videoStillOnDisk || pdfStillOnDisk) {
                  const updated: DownloadRecord = {
                    ...existing,
                    hasLocalVideo: keepIdbVideo || videoStillOnDisk,
                    hasLocalPdf: keepIdbPdf || pdfStillOnDisk,
                  };
                  if (!videoStillOnDisk) delete updated.localVideoUri;
                  if (!pdfStillOnDisk) delete updated.localPdfUri;
                  if (!videoStillOnDisk && !pdfStillOnDisk) {
                    delete updated.matchedFileName;
                    delete updated.matchScore;
                  }
                  next[id] = updated;
                }
              }
            }
            writeLocalCache(CACHE_DOWNLOADS_KEY, next);
            return next;
          });

          if (res.matchedRecords.length > 0) {
            await handleRestoreMatchedRecords(res.matchedRecords);
          }

          return {
            scannedFilesCount: res.scannedFilesCount,
            matchedCount: res.matchedRecords.length,
          };
        }

        return { scannedFilesCount: 0, matchedCount: 0 };
      } catch {
        return { scannedFilesCount: 0, matchedCount: 0 };
      } finally {
        setScanProgress(null);
      }
    },
    [appUser, subjects, isOnline, isNativeCapacitor, handleRestoreMatchedRecords]
  );

  const refreshNativePermissionFlags = useCallback(async () => {
    if (!isNativeCapacitor) {
      setStoragePermission('web');
      setNeedsTopPermissionGrant(false);
      return;
    }
    try {
      const details = await getDetailedNativePermissionStatus();
      setStoragePermission(details.granted ? 'granted' : 'denied');
      setNeedsFolderGrantForPdf(Boolean(details.needsFolderGrantForPdf));
      setNeedsTopPermissionGrant(needsAnyStoragePermission(details));
    } catch {
      // Keep app stable on unexpected permission check failure
    }
  }, [isNativeCapacitor]);

  const handleRequestNativePermission = useCallback(async () => {
    if (requestingStoragePerm) return;
    setRequestingStoragePerm(true);
    try {
      const { state, details } = await requestFullNativeStoragePermission();
      setStoragePermission(state);
      setNeedsFolderGrantForPdf(Boolean(details.needsFolderGrantForPdf));
      setNeedsTopPermissionGrant(needsAnyStoragePermission(details));
      if (state === 'granted') {
        const { matchedCount } = await runCapacitorAutoScan(false);
        if (matchedCount > 0) {
          showBanner(`স্টোরেজ থেকে ${matchedCount}টি ক্লাস অটো স্ক্যানে পাওয়া গেছে!`);
        } else if (!needsAnyStoragePermission(details)) {
          showBanner('স্টোরেজ পারমিশন সফলভাবে চালু হয়েছে!');
        }
      }
    } catch {
      showBanner('পারমিশন সেট করতে সমস্যা হয়েছে — পরে আবার চেষ্টা করুন।');
    } finally {
      setRequestingStoragePerm(false);
    }
  }, [requestingStoragePerm, runCapacitorAutoScan, showBanner]);

  const handleRequestDownloadFolderAccess = useCallback(async () => {
    const res = await requestNativeDownloadFolderAccess();
    const details = await getDetailedNativePermissionStatus();
    setNeedsFolderGrantForPdf(Boolean(details.needsFolderGrantForPdf));
    setNeedsTopPermissionGrant(needsAnyStoragePermission(details));
    if (res.granted) {
      const { matchedCount } = await runCapacitorAutoScan(false);
      if (matchedCount > 0) {
        showBanner(`Download ফোল্ডার থেকে ${matchedCount}টি ভিডিও ও PDF পাওয়া গেছে!`);
      } else {
        showBanner('Download ফোল্ডারের অনুমতি যুক্ত হয়েছে!');
      }
    }
  }, [runCapacitorAutoScan, showBanner]);

  // Keep permission flags synchronized & trigger Capacitor auto-scan on launch, focus, and online/offline resume
  useEffect(() => {
    if (!appUser) return;
    let cancelled = false;

    void refreshNativePermissionFlags();

    const triggerScan = (promptIfNeeded: boolean) => {
      if (cancelled) return;
      void refreshNativePermissionFlags();
      const onlineNow = Boolean(isOnline || (typeof navigator !== 'undefined' && navigator.onLine));
      void runCapacitorAutoScan(onlineNow ? promptIfNeeded : false);
    };

    const timer = window.setTimeout(() => {
      triggerScan(isOnline);
    }, 350);

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        triggerScan(false);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('focus', onVisibilityOrFocus);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('focus', onVisibilityOrFocus);
    };
  }, [appUser, isOnline, subjects, refreshNativePermissionFlags, runCapacitorAutoScan]);

  const handleSendIssueReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportText.trim()) return;
    setReportSending(true);
    setReportFeedback('');
    try {
      const activeFbUser = firebaseUser || auth.currentUser;
      if (appUser?.authMode === 'google' && activeFbUser) {
        const msgId = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await setDoc(doc(db, 'adminInbox', msgId), {
          id: msgId,
          uid: activeFbUser.uid,
          type: 'issue_report',
          senderName: appUser.name,
          senderEmail: appUser.email,
          senderPhone: appUser.phone || '',
          newPassword: '',
          message: reportText.trim().slice(0, 2000),
          createdAt: serverTimestamp(),
        });
      } else if (appUser?.authMode === 'number' && appUser.bearerToken) {
        const res = await fetch(apiUrl('/api/inbox/report'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${appUser.bearerToken}`,
          },
          body: JSON.stringify({ message: reportText.trim() }),
        });
        if (!res.ok) throw new Error('Report failed');
      } else {
        const hint = readLocalCache<{ name?: string; phone?: string } | null>(
          'noor_elahi_login_hint_v1',
          null
        );
        const senderLabel =
          [hint?.name?.trim(), hint?.phone?.trim()].filter(Boolean).join(' · ') ||
          'লগইন স্ক্রিন শিক্ষার্থী';
        const res = await fetch(apiUrl('/api/inbox/guest-report'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderName: senderLabel,
            message: reportText.trim(),
          }),
        });
        if (!res.ok) throw new Error('Guest report failed');
      }
      setReportText('');
      setReportFeedback('আপনার বার্তাটি অ্যাডমিনের ইনবক্সে পাঠানো হয়েছে!');
      setTimeout(() => {
        goBackOr((p) => ({ ...p, reportModalOpen: false }));
        setReportFeedback('');
      }, 1500);
    } catch {
      setReportFeedback('পাঠাতে সমস্যা হয়েছে। আবার চেষ্টা করুন।');
    } finally {
      setReportSending(false);
    }
  };

  if (!authReady) {
    return (
      <div className="h-[100dvh] w-full bg-[#020617] flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <>
      {/* Top Notification Toast (visible on both Login & Home screens) */}
      {topBanner && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] max-w-md w-[94%] rounded-2xl bg-emerald-500 text-slate-950 px-4 py-3 shadow-2xl flex items-center gap-2.5 text-xs sm:text-sm font-bold">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span className="truncate">{topBanner}</span>
        </div>
      )}

      {!appUser ? (
        <AuthSuitcaseScreen
          onGoogleLogin={handleGoogleLogin}
          onNumberLogin={handleNumberLogin}
          onOpenReportModal={() => pushNav((p) => ({ ...p, reportModalOpen: true }))}
          authLoading={authLoading}
          authError={authError}
          unauthorizedDomain={unauthorizedDomain}
        />
      ) : (
        <div className="h-[100dvh] w-full bg-[#020617] text-slate-100 flex flex-col overflow-hidden overscroll-none">

          {/* Top App Bar matching Uploaded Reference Image 2 & 3 */}
          <header className="shrink-0 z-30 h-16 px-4 bg-[#060a17]/95 backdrop-blur-md border-b border-slate-800/80 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src="/icon-192.png"
                alt="NOOR ELAHI"
                className="w-10 h-10 rounded-xl bg-white border border-emerald-500/30 object-contain shrink-0"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-display text-base font-extrabold tracking-tight text-white whitespace-nowrap">
                    NOOR <span className="text-amber-400">ELAHI</span>
                  </span>
                </div>
                <p className="text-[11px] text-amber-200/80 truncate">
                  স্মার্ট ডিজিটাল লার্নিং প্ল্যাটফর্ম
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!isOnline && (
                <div className="flex items-center gap-1 rounded-xl bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-[11px] font-semibold text-amber-300">
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>অফলাইন</span>
                </div>
              )}

              <PWAInstallButton compact />

              <button
                type="button"
                onClick={() => {
                  pushNav((p) => ({ ...p, notifOpen: true }));
                  setSeenNotifIds(markNotificationsSeen(notifications));
                }}
                className="relative min-w-[40px] min-h-[40px] rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-200 hover:bg-slate-800 transition"
                aria-label="নোটিফিকেশন"
              >
                <Bell className="w-4 h-4" />
                {unreadNotifCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-bold flex items-center justify-center">
                    {unreadNotifCount}
                  </span>
                )}
              </button>

              {/* Top-Right Profile Avatar Button */}
              <button
                type="button"
                onClick={() => switchTab('profile')}
                className="w-9 h-9 rounded-xl bg-slate-900 border border-emerald-500/40 overflow-hidden flex items-center justify-center shrink-0"
                aria-label="প্রোফাইল"
              >
                {appUser.photoUrl ? (
                  <img
                    src={appUser.photoUrl}
                    alt={appUser.name}
                    onError={(e) => {
                      e.stopPropagation();
                      setAppUser((prev) => (prev ? { ...prev, photoUrl: '' } : prev));
                    }}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <UserIcon className="w-4 h-4 text-emerald-400" />
                )}
              </button>
            </div>
          </header>

          {/* Persistent Top Permission Action Bar for Android APK whenever storage/all-files permission is not granted */}
          {isNativeCapacitor && needsTopPermissionGrant && (
            <div className="shrink-0 z-20 px-4 py-2 bg-amber-500/12 border-b border-amber-500/30 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-[11px] sm:text-xs font-medium text-amber-100 leading-snug line-clamp-2">
                  {storagePermission === 'denied'
                    ? 'ভিডিও/PDF সেভ ও অটো স্ক্যান চালু করতে স্টোরেজ পারমিশন দিন'
                    : 'ফোনের সব ফোল্ডার ও PDF অটো স্ক্যান করতে সম্পূর্ণ ফাইল পারমিশন দিন'}
                </p>
              </div>
              <button
                type="button"
                disabled={requestingStoragePerm}
                onClick={() => void handleRequestNativePermission()}
                className="shrink-0 h-8 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-sm active:scale-[0.97] transition disabled:opacity-60"
              >
                {requestingStoragePerm ? 'খুলছে...' : 'পারমিশন দিন'}
              </button>
            </div>
          )}

          {/* Main Scrollable Viewport (isolated inside 100dvh shell so pull-to-refresh never triggers) */}
          <main className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y pwa-scroll-container">
            <div className="w-full max-w-6xl mx-auto px-4 pt-5 pb-28">
              {activeTab === 'subjects' && (
                <SubjectsView
                  subjects={subjects}
                  downloads={downloadsMap}
                  isOnline={isOnline}
                  selectedSubjectId={selectedSubjectId}
                  onSelectSubjectId={(sid) => {
                    if (sid === null) {
                      goBackOr((p) => ({ ...p, subjectId: null }));
                    } else {
                      pushNav((p) => ({ ...p, subjectId: sid }));
                    }
                  }}
                  onPlayVideo={(payload) => pushNav((p) => ({ ...p, activeVideo: payload }))}
                  onOpenPdf={({ item }) =>
                    pushNav((p) => ({
                      ...p,
                      activePdf: {
                        itemId: item.id,
                        title: item.name,
                        pdfUrl: item.pdfUrl,
                      },
                    }))
                  }
                  onOfflineAlert={() => {
                    pushNav((p) => ({ ...p, offlineModalOpen: true }));
                  }}
                  isNativeCapacitor={isNativeCapacitor}
                  storagePermission={storagePermission}
                  needsAllFilesAccess={needsTopPermissionGrant}
                  needsFolderGrantForPdf={needsFolderGrantForPdf}
                  onRequestStoragePermission={handleRequestNativePermission}
                  onRequestDownloadFolderAccess={handleRequestDownloadFolderAccess}
                  onTriggerAutoScan={() => runCapacitorAutoScan(true)}
                  scanProgress={scanProgress}
                />
              )}

              {activeTab === 'downloads' && (
                <DownloadsView
                  uid={appUser.uid}
                  subjects={subjects}
                  downloads={downloadsMap}
                  downloadTasks={downloadTasks}
                  isOnline={isOnline}
                  selectedSubjectId={downloadSubjectId}
                  onSelectSubjectId={(sid) => {
                    if (sid === null) {
                      goBackOr((p) => ({ ...p, downloadSubjectId: null }));
                    } else {
                      pushNav((p) => ({ ...p, downloadSubjectId: sid }));
                    }
                  }}
                  onOfflineAlert={() => {
                    pushNav((p) => ({ ...p, offlineModalOpen: true }));
                  }}
                  onPlayDownloaded={(rec) => {
                    const subj = subjects[rec.subjectId];
                    const foundSec = subj?.sections?.find((s) => s.id === rec.sectionId);
                    const foundItem = foundSec?.items?.find((it) => it.id === rec.itemId);
                    pushNav((p) => ({
                      ...p,
                      activeVideo: {
                        item: foundItem || {
                          id: rec.itemId,
                          name: rec.videoName,
                          videoUrl: rec.videoUrl,
                          pdfUrl: rec.pdfUrl,
                          createdAt: typeof rec.downloadedAt === 'number' ? rec.downloadedAt : Date.now(),
                        },
                        subjectId: rec.subjectId,
                        sectionId: rec.sectionId,
                        sectionTitle: rec.sectionTitle || subj?.name || 'ডাউনলোড',
                        classNumber: rec.classNumber || 1,
                      },
                    }));
                  }}
                  onOpenDownloadedPdf={(rec) => {
                    pushNav((p) => ({
                      ...p,
                      activePdf: {
                        itemId: rec.itemId,
                        title: rec.videoName,
                        pdfUrl: rec.pdfUrl,
                      },
                    }));
                  }}
                  onDeleteDownload={handleDeleteDownload}
                  onRestoreMatchedRecords={handleRestoreMatchedRecords}
                  isNativeCapacitor={isNativeCapacitor}
                  storagePermission={storagePermission}
                  needsAllFilesAccess={needsTopPermissionGrant}
                  needsFolderGrantForPdf={needsFolderGrantForPdf}
                  onRequestStoragePermission={handleRequestNativePermission}
                  onRequestDownloadFolderAccess={handleRequestDownloadFolderAccess}
                  onTriggerAutoScan={() => runCapacitorAutoScan(true)}
                  scanProgress={scanProgress}
                />
              )}

              {activeTab === 'profile' && (
                <ProfileView
                  user={appUser}
                  inboxCount={combinedInbox.length}
                  onUpdateProfile={handleUpdateProfile}
                  onOpenFileVault={() =>
                    pushNav((p) => ({ ...p, vaultOpen: true, vaultSubjectId: null }))
                  }
                  onOpenAdminInbox={() => pushNav((p) => ({ ...p, inboxOpen: true }))}
                  onOpenReportModal={() => pushNav((p) => ({ ...p, reportModalOpen: true }))}
                  onLogout={handleLogout}
                />
              )}
            </div>
          </main>

          {/* Fixed Bottom Navigation Bar (3 Tabs: বিষয়সমূহ, মাই ডাউনলোডস, প্রোফাইল) */}
          <nav className="fixed bottom-0 inset-x-0 z-30 bg-[#060a17]/95 backdrop-blur-md border-t border-slate-800/90 pb-safe">
            <div className="max-w-xl mx-auto grid grid-cols-3 gap-2 px-3 py-1.5 h-16">
              <button
                type="button"
                onClick={() => switchTab('subjects')}
                className={`rounded-2xl flex flex-col items-center justify-center gap-1 transition ${
                  activeTab === 'subjects'
                    ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <BookOpen className="w-5 h-5" />
                <span className="text-[11px] whitespace-nowrap">বিষয়সমূহ</span>
              </button>

              <button
                type="button"
                onClick={() => switchTab('downloads')}
                className={`relative rounded-2xl flex flex-col items-center justify-center gap-1 transition ${
                  activeTab === 'downloads'
                    ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Download className="w-5 h-5" />
                <span className="text-[11px] whitespace-nowrap">মাই ডাউনলোডস</span>
                {(() => {
                  const offlineCount = Object.values(downloadsMap).filter((d) =>
                    Boolean(d && (d.hasLocalVideo || d.localVideoUri || d.hasLocalPdf || d.localPdfUri))
                  ).length;
                  return offlineCount > 0 ? (
                    <span className="absolute top-1.5 right-3 min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-mono-num font-bold flex items-center justify-center">
                      {offlineCount}
                    </span>
                  ) : null;
                })()}
              </button>

              <button
                type="button"
                onClick={() => switchTab('profile')}
                className={`rounded-2xl flex flex-col items-center justify-center gap-1 transition ${
                  activeTab === 'profile'
                    ? 'bg-sky-500/15 border border-sky-500/30 text-sky-400 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <UserIcon className="w-5 h-5" />
                <span className="text-[11px] whitespace-nowrap">প্রোফাইল</span>
              </button>
            </div>
          </nav>

          {/* Plyr + hls.js Full Video Player Modal */}
          {activeVideo && (
            <PlyrVideoPlayer
              itemId={activeVideo.item.id}
              subjectId={activeVideo.subjectId}
              sectionId={activeVideo.sectionId}
              sectionTitle={activeVideo.sectionTitle}
              classNumber={activeVideo.classNumber}
              videoName={activeVideo.item.name}
              videoUrl={activeVideo.item.videoUrl || ''}
              pdfUrl={activeVideo.item.pdfUrl}
              durationLabel={activeVideo.item.duration}
              initialPosition={progressMap[activeVideo.item.id]?.currentTime || 0}
              isOnline={isOnline}
              hasOfflineVideo={Boolean(
                downloadsMap[activeVideo.item.id]?.hasLocalVideo ||
                downloadsMap[activeVideo.item.id]?.localVideoUri
              )}
              localVideoUri={downloadsMap[activeVideo.item.id]?.localVideoUri}
              onSaveProgress={handleSaveProgress}
              onOfflineCached={(info) => {
                const existing = downloadsMap[info.itemId];
                const rec: DownloadRecord = {
                  uid: appUser.uid,
                  itemId: info.itemId,
                  subjectId: activeVideo.subjectId,
                  sectionId: activeVideo.sectionId,
                  sectionTitle: activeVideo.sectionTitle,
                  classNumber: activeVideo.classNumber,
                  videoName: activeVideo.item.name,
                  videoUrl: activeVideo.item.videoUrl || '',
                  pdfUrl: activeVideo.item.pdfUrl || '',
                  fileSizeBytes: info.fileSizeBytes,
                  hasLocalVideo: Boolean(info.hasLocalVideo || info.localVideoUri || existing?.hasLocalVideo),
                  hasLocalPdf: Boolean(info.hasLocalPdf || existing?.hasLocalPdf || existing?.localPdfUri),
                  localVideoUri: info.localVideoUri || existing?.localVideoUri,
                  localPdfUri: existing?.localPdfUri,
                  matchedFileName: info.matchedFileName || existing?.matchedFileName,
                };
                void handleRestoreMatchedRecords([rec]);
              }}
              onOpenPdf={() => {
                const hasPdfOffline = Boolean(
                  downloadsMap[activeVideo.item.id]?.hasLocalPdf ||
                  downloadsMap[activeVideo.item.id]?.localPdfUri
                );
                if (!isOnline && !hasPdfOffline) {
                  pushNav((p) => ({ ...p, offlineModalOpen: true }));
                  return;
                }
                pushNav((p) => ({
                  ...p,
                  activePdf: {
                    itemId: activeVideo.item.id,
                    title: activeVideo.item.name,
                    pdfUrl: activeVideo.item.pdfUrl,
                  },
                }));
              }}
              onClose={() => goBackOr((p) => ({ ...p, activeVideo: null }))}
            />
          )}

          {/* PDF Viewer Modal */}
          {activePdf && (
            <PdfViewerModal
              isOpen={Boolean(activePdf)}
              onClose={() => goBackOr((p) => ({ ...p, activePdf: null }))}
              title={activePdf.title}
              itemId={activePdf.itemId}
              pdfUrl={activePdf.pdfUrl}
              localPdfUri={downloadsMap[activePdf.itemId]?.localPdfUri}
              onOfflineCached={(info) => {
                const existing = downloadsMap[info.itemId];
                let resolvedSubjectId = existing?.subjectId || '';
                let resolvedSectionId = existing?.sectionId || '';
                let resolvedSectionTitle = existing?.sectionTitle || '';
                let resolvedClassNumber = existing?.classNumber || 1;
                let resolvedVideoUrl = existing?.videoUrl || '';

                if (!resolvedSubjectId) {
                  for (const subj of Object.values(subjects)) {
                    for (const sec of subj.sections || []) {
                      const idx = (sec.items || []).findIndex((it) => it.id === info.itemId);
                      if (idx !== -1) {
                        const matchedItem = sec.items[idx];
                        resolvedSubjectId = subj.id;
                        resolvedSectionId = sec.id;
                        resolvedSectionTitle = sec.title || subj.name;
                        resolvedClassNumber = idx + 1;
                        resolvedVideoUrl =
                          (matchedItem.videoUrls && matchedItem.videoUrls.find((u) => Boolean(u?.trim()))) ||
                          matchedItem.videoUrl ||
                          '';
                        break;
                      }
                    }
                    if (resolvedSubjectId) break;
                  }
                }

                const rec: DownloadRecord = {
                  uid: appUser.uid,
                  itemId: info.itemId,
                  subjectId: resolvedSubjectId,
                  sectionId: resolvedSectionId,
                  sectionTitle: resolvedSectionTitle,
                  classNumber: resolvedClassNumber,
                  videoName: existing?.videoName || activePdf.title,
                  videoUrl: resolvedVideoUrl,
                  pdfUrl: activePdf.pdfUrl,
                  fileSizeBytes: info.fileSizeBytes,
                  hasLocalVideo: Boolean(info.hasLocalVideo || existing?.hasLocalVideo || existing?.localVideoUri),
                  hasLocalPdf: Boolean(info.hasLocalPdf || info.localPdfUri || existing?.hasLocalPdf),
                  localVideoUri: existing?.localVideoUri,
                  localPdfUri: info.localPdfUri || existing?.localPdfUri,
                  matchedFileName: info.matchedFileName || existing?.matchedFileName,
                };
                void handleRestoreMatchedRecords([rec]);
              }}
            />
          )}

          {/* Admin Modals */}
          {appUser.role === 'admin' && (
            <>
              <FileVaultModal
                isOpen={vaultOpen}
                onClose={() => {
                  const steps = navRef.current.vaultSubjectId ? 2 : 1;
                  goBackOr((p) => ({ ...p, vaultOpen: false, vaultSubjectId: null }), steps);
                }}
                subjects={subjects}
                storedVaultHash={vaultHash}
                isOnline={isOnline}
                selectedSubjectId={vaultSubjectId}
                onSelectSubjectId={(sid) => {
                  if (sid === null) {
                    goBackOr((p) => ({ ...p, vaultSubjectId: null }));
                  } else {
                    pushNav((p) => ({ ...p, vaultSubjectId: sid }));
                  }
                }}
                onCacheVaultHash={(hash) => {
                  if (appUser?.uid) persistVaultHash(appUser.uid, hash);
                }}
                onSaveVaultPasswordHash={handleSaveVaultPasswordHash}
                onSaveSubject={handleSaveSubject}
              />

              <AdminInboxModal
                isOpen={inboxOpen}
                onClose={() => goBackOr((p) => ({ ...p, inboxOpen: false }))}
                messages={combinedInbox}
                onDeleteMessage={handleDeleteInboxMessage}
              />
            </>
          )}

          {/* Notifications Drawer Modal */}
          {notifOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
              <div className="w-full max-w-md max-h-[80vh] flex flex-col rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
                  <div>
                    <h3 className="text-base font-bold text-white">নোটিফিকেশন</h3>
                    <p className="text-[11px] text-slate-400">
                      নতুন আপডেটগুলো ২৪ ঘণ্টা পর স্বয়ংক্রিয়ভাবে মুছে যাবে
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => goBackOr((p) => ({ ...p, notifOpen: false }))}
                    className="p-1.5 rounded-xl bg-slate-800 text-slate-300"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y pwa-scroll-container p-4 space-y-3">
                  {notifications.length === 0 ? (
                    <p className="text-center text-xs text-slate-400 py-8">
                      গত ২৪ ঘণ্টায় কোনো নতুন নোটিফিকেশন আসেনি।
                    </p>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        className="rounded-2xl bg-slate-950 border border-emerald-500/20 p-3.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-emerald-400 truncate">
                            {n.subjectName} · {n.sectionTitle}
                          </p>
                          <span className="text-[10px] font-mono-num text-amber-300/80 shrink-0">
                            {formatNotificationRemainingLabel(n)}
                          </span>
                        </div>
                        <p className="text-sm text-slate-200">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Offline Alert Modal ("আপনি এখন অফলাইনে আছেন") */}
          {offlineModalOpen && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
              <div className="w-full max-w-xs rounded-3xl bg-slate-900 border border-amber-500/40 p-6 text-center space-y-4 shadow-2xl">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto">
                  <WifiOff className="w-6 h-6 text-amber-400" />
                </div>
                <h3 className="text-base font-bold text-white">আপনি এখন অফলাইনে আছেন</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {isNativeCapacitor
                    ? 'এই ফাইলটি এখনো Download ফোল্ডারে স্ক্যান করা অবস্থায় পাওয়া যায়নি। অনলাইনে এসে Drive থেকে ডাউনলোড করলে অ্যাপ অটোমেটিক স্ক্যান করে নেবে।'
                    : 'এই ভিডিও বা PDF টি অফলাইন ক্যাশে সংরক্ষিত নেই। ইন্টারনেট চালু করে Drive থেকে দেখুন বা অ্যাপের ভেতর সেভ করুন।'}
                </p>
                {isNativeCapacitor && storagePermission === 'denied' && (
                  <button
                    type="button"
                    onClick={() => void handleRequestNativePermission()}
                    className="w-full py-2.5 px-3 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5"
                  >
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>পারমিশন দাও</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    goBackOr((p) => ({ ...p, offlineModalOpen: false }));
                  }}
                  className="w-full py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold text-sm"
                >
                  ঠিক আছে
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Report Issue to Admin Modal (Accessible from Profile) */}
      {reportModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <form
            onSubmit={handleSendIssueReport}
            className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                অ্যাপের সমস্যা সম্পর্কে এডমিনকে জানান
              </h3>
              <button
                type="button"
                onClick={() => goBackOr((p) => ({ ...p, reportModalOpen: false }))}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              প্রেরক: {appUser?.name || 'শিক্ষার্থী'}
            </p>
            <textarea
              rows={4}
              value={reportText}
              onChange={(e) => setReportText(e.target.value)}
              placeholder="আপনার সমস্যার বিস্তারিত এখানে লিখুন..."
              className="w-full rounded-2xl bg-slate-950 border border-slate-800 focus:border-amber-400 p-3.5 text-sm text-white placeholder:text-slate-500 outline-none"
              required
            />
            {reportFeedback && (
              <p className="text-xs text-emerald-400 font-medium">{reportFeedback}</p>
            )}
            <button
              type="submit"
              disabled={reportSending}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold text-sm disabled:opacity-60"
            >
              {reportSending ? 'পাঠানো হচ্ছে...' : 'এডমিনকে পাঠান'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
