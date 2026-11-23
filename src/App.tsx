import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
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
  SUBJECT_LIST,
  SubjectDoc,
  WatchProgress,
} from './types';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  sha256Hex,
  testConnection,
} from './lib/firebase';
import { downloadManager } from './lib/downloadManager';
import {
  deleteOfflineMedia,
  exportOfflineItemToPhone,
  listOfflineMedia,
  loadAppStateBackup,
  removeAppStateBackup,
  saveAppStateBackup,
} from './lib/offlineStorage';
import {
  formatNotificationRemainingLabel,
  loadSeenNotificationIds,
  markNotificationsSeen,
  normalizeActiveNotifications,
  serializeNotificationsForCache,
} from './lib/notifications';
import { useOnlineStatus } from './hooks/useOnlineStatus';
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
  const historySeqRef = useRef<number>(0);

  const {
    activeTab,
    subjectId: selectedSubjectId,
    downloadSubjectId: selectedDownloadSubjectId,
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
  const [lastCompletedDownload, setLastCompletedDownload] = useState<{
    itemId: string;
    name: string;
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

  const showBanner = useCallback(
    (msg: string, completedItem?: { itemId: string; name: string }) => {
      setTopBanner(msg);
      if (completedItem) {
        setLastCompletedDownload(completedItem);
      } else {
        setLastCompletedDownload(null);
      }
      window.setTimeout(() => {
        setTopBanner((curr) => (curr === msg ? null : curr));
        if (completedItem) {
          setLastCompletedDownload((curr) =>
            curr?.itemId === completedItem.itemId ? null : curr
          );
        }
      }, completedItem ? 7000 : 4000);
    },
    []
  );

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
          downloadManager.setUid(backedUpUser.uid);
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
        setDownloadsMap((curr) => ({ ...backedUpDownloads, ...curr }));
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

  // Subscribe to downloadManager progress & completion
  useEffect(() => {
    const unsubSnap = downloadManager.subscribe((tasks) => {
      setDownloadTasks(tasks);
    });
    const unsubComplete = downloadManager.onComplete(async (record) => {
      showBanner('ডাউনলোড সম্পন্ন হয়েছে · ফোনে সেভ হচ্ছে', {
        itemId: record.itemId,
        name: record.videoName,
      });
      setDownloadsMap((prev) => {
        const next = { ...prev, [record.itemId]: record };
        writeLocalCache(CACHE_DOWNLOADS_KEY, next);
        return next;
      });

      if (appUser) {
        if (appUser.authMode === 'google' && firebaseUser) {
          const path = `users/${firebaseUser.uid}/downloads`;
          const docPayload = {
            uid: firebaseUser.uid,
            itemId: record.itemId,
            subjectId: record.subjectId,
            sectionId: record.sectionId,
            sectionTitle: (record.sectionTitle || 'ক্লাস').slice(0, 160),
            classNumber: Math.max(1, Number(record.classNumber) || 1),
            videoName: (record.videoName || 'ক্লাস').slice(0, 200),
            videoUrl: (record.videoUrl || '').slice(0, 1000),
            pdfUrl: (record.pdfUrl || '').slice(0, 1000),
            fileSizeBytes: Math.max(0, Number(record.fileSizeBytes) || 0),
            downloadedAt: serverTimestamp(),
          };
          setDoc(doc(db, path, record.itemId), docPayload).catch((err) => {
            handleListenerErrorSafe(err, OperationType.WRITE, `${path}/${record.itemId}`);
          });
        } else if (appUser.authMode === 'number' && appUser.bearerToken) {
          fetch('/api/number-user/state', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${appUser.bearerToken}`,
            },
            body: JSON.stringify({ downloadItem: record }),
          }).catch(() => {});
        }
      }
    });

    return () => {
      unsubSnap();
      unsubComplete();
    };
  }, [appUser, firebaseUser, showBanner]);

  // Hydrate offline IndexedDB downloads on mount
  useEffect(() => {
    listOfflineMedia()
      .then((entries) => {
        if (entries.length === 0) return;
        setDownloadsMap((prev) => {
          const next = { ...prev };
          for (const entry of entries) {
            next[entry.itemId] = {
              uid: appUser?.uid || prev[entry.itemId]?.uid || '',
              itemId: entry.itemId,
              subjectId: entry.subjectId,
              sectionId: entry.sectionId,
              sectionTitle: entry.sectionTitle,
              classNumber: entry.classNumber,
              videoName: entry.videoName,
              videoUrl: entry.videoUrl,
              pdfUrl: entry.pdfUrl,
              fileSizeBytes: entry.fileSizeBytes,
              hasLocalVideo: !!entry.videoBlob,
              hasLocalPdf: !!entry.pdfBlob,
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
    setUnauthorizedDomain('');
    if (code === 'auth/cancelled-popup-request' || code === 'auth/no-current-user') {
      return;
    }
    if (code === 'auth/popup-closed-by-user') {
      setAuthError('Google সাইন-ইন পপআপটি বন্ধ হয়ে গেছে। আবার চেষ্টা করুন।');
    } else if (code === 'auth/popup-blocked') {
      setAuthError('ব্রাউজারে পপআপ ব্লক করা আছে। পপআপ অনুমতি দিয়ে আবার চেষ্টা করুন।');
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
        err instanceof Error
          ? `Google লগইন ব্যর্থ হয়েছে: ${err.message}`
          : 'Google দিয়ে লগইন করা যায়নি। আবার চেষ্টা করুন।'
      );
    }
  }, []);

  // Listen to Firebase Auth state & resolve any standalone redirect sign-in on mount
  useEffect(() => {
    const hasPendingRedirect = (() => {
      try {
        return sessionStorage.getItem('noor_elahi_redirect_pending') === '1';
      } catch {
        return false;
      }
    })();

    if (hasPendingRedirect) {
      setAuthLoading(true);
    }

    getRedirectResult(auth)
      .catch((err: unknown) => {
        applyGoogleAuthError(err);
      })
      .finally(() => {
        try {
          sessionStorage.removeItem('noor_elahi_redirect_pending');
        } catch {
          // Ignore storage error
        }
        if (hasPendingRedirect) {
          setAuthLoading(false);
        }
      });

    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        try {
          localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
        } catch {
          // Ignore
        }
        downloadManager.setUid(fbUser.uid);
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
        fetch('/api/catalog', { cache: 'no-store' })
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
        fetch('/api/number-user/state', {
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
                const merged = { ...data.downloads, ...prev };
                writeLocalCache(CACHE_DOWNLOADS_KEY, merged);
                return merged;
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
                fetch('/api/catalog/sync', {
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
                  fetch('/api/catalog/sync', {
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

    // 4. Downloads Registry
    const dlPath = `users/${firebaseUser.uid}/downloads`;
    unsubs.push(
      onSnapshot(
        query(collection(db, dlPath), where('uid', '==', firebaseUser.uid)),
        (snap) => {
          setDownloadsMap((prev) => {
            const next = { ...prev };
            snap.forEach((d) => {
              const rec = d.data() as DownloadRecord;
              next[d.id] = {
                ...rec,
                hasLocalVideo: prev[d.id]?.hasLocalVideo,
                hasLocalPdf: prev[d.id]?.hasLocalPdf,
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
          fetch('/api/inbox/admin', {
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
        // Ignore storage error before popup
      }
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code || '';
      const isTopLevelWindow = (() => {
        try {
          return window.self === window.top;
        } catch {
          return false;
        }
      })();
      const isStandalonePWA =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;

      if (
        (code === 'auth/popup-blocked' ||
          code === 'auth/operation-not-supported-in-this-environment' ||
          code === 'auth/web-storage-unsupported' ||
          code === 'auth/internal-error') &&
        (isStandalonePWA || isTopLevelWindow)
      ) {
        try {
          sessionStorage.setItem('noor_elahi_redirect_pending', '1');
        } catch {
          // Ignore storage error
        }
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirErr) {
          try {
            sessionStorage.removeItem('noor_elahi_redirect_pending');
          } catch {
            // Ignore
          }
          applyGoogleAuthError(redirErr);
          return;
        }
      }

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
      const res = await fetch('/api/number-auth/login', {
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
      downloadManager.setUid(data.user.uid);
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
      if (firebaseUser) {
        await signOut(auth);
      }
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

      if (appUser.authMode === 'google' && firebaseUser && navigator.onLine) {
        const path = `users/${firebaseUser.uid}/progress`;
        try {
          await setDoc(doc(db, path, itemId), {
            ...entry,
            uid: firebaseUser.uid,
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Non-blocking sync failure while seeking
        }
      } else if (appUser.authMode === 'number' && appUser.bearerToken && navigator.onLine) {
        fetch('/api/number-user/state', {
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
    if (appUser.authMode === 'google' && firebaseUser) {
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
        await updateDoc(doc(db, 'users', firebaseUser.uid), updates);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
      }

      if (payload.newPassword) {
        const msgId = `pwd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        try {
          await setDoc(doc(db, 'adminInbox', msgId), {
            id: msgId,
            uid: firebaseUser.uid,
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
      const res = await fetch('/api/number-auth/update', {
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

    const safeSubject: SubjectDoc = {
      ...subject,
      name: (subject.name || '').slice(0, 120),
      description: (subject.description || '').slice(0, 2000),
      sections: (subject.sections || []).slice(0, 40),
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
        await fetch('/api/catalog/sync', {
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
    if (msg.source === 'server' && firebaseUser) {
      try {
        const idToken = await firebaseUser.getIdToken();
        await fetch(`/api/inbox/admin/${encodeURIComponent(msg.id)}`, {
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

  const handleDeleteDownload = async (itemId: string) => {
    try {
      await deleteOfflineMedia(itemId);
    } catch {
      // Ignore IndexedDB delete failure
    }
    setDownloadsMap((prev) => {
      const next = { ...prev };
      delete next[itemId];
      writeLocalCache(CACHE_DOWNLOADS_KEY, next);
      return next;
    });

    if (appUser?.authMode === 'google' && firebaseUser) {
      const path = `users/${firebaseUser.uid}/downloads/${itemId}`;
      const deleteOp = deleteDoc(
        doc(db, 'users', firebaseUser.uid, 'downloads', itemId)
      ).catch((err) => {
        handleListenerErrorSafe(err, OperationType.DELETE, path);
      });
      if (navigator.onLine) {
        await deleteOp;
      }
    } else if (appUser?.authMode === 'number' && appUser.bearerToken) {
      fetch('/api/number-user/state', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${appUser.bearerToken}`,
        },
        body: JSON.stringify({ removeDownloadId: itemId }),
      }).catch(() => {});
    }
  };

  const handleRestoreMatchedRecords = async (records: DownloadRecord[]) => {
    setDownloadsMap((prev) => {
      const next = { ...prev };
      for (const r of records) {
        next[r.itemId] = r;
      }
      writeLocalCache(CACHE_DOWNLOADS_KEY, next);
      return next;
    });

    if (appUser?.authMode === 'google' && firebaseUser) {
      const writes = records.map((r) => {
        const path = `users/${firebaseUser.uid}/downloads`;
        return setDoc(doc(db, path, r.itemId), {
          uid: firebaseUser.uid,
          itemId: r.itemId,
          subjectId: r.subjectId,
          sectionId: r.sectionId,
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
        fetch('/api/number-user/state', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${appUser.bearerToken}`,
          },
          body: JSON.stringify({ downloadItem: r }),
        }).catch(() => {});
      }
    }
  };

  const handleSendIssueReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportText.trim()) return;
    setReportSending(true);
    setReportFeedback('');
    try {
      if (appUser?.authMode === 'google' && firebaseUser) {
        const msgId = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await setDoc(doc(db, 'adminInbox', msgId), {
          id: msgId,
          uid: firebaseUser.uid,
          type: 'issue_report',
          senderName: appUser.name,
          senderEmail: appUser.email,
          senderPhone: appUser.phone || '',
          newPassword: '',
          message: reportText.trim().slice(0, 2000),
          createdAt: serverTimestamp(),
        });
      } else if (appUser?.authMode === 'number' && appUser.bearerToken) {
        await fetch('/api/inbox/report', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${appUser.bearerToken}`,
          },
          body: JSON.stringify({ message: reportText.trim() }),
        });
      } else {
        setReportFeedback('অনুগ্রহ করে প্রথমে লগইন করুন।');
        setReportSending(false);
        return;
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
      {!appUser ? (
        <AuthSuitcaseScreen
          onGoogleLogin={handleGoogleLogin}
          onNumberLogin={handleNumberLogin}
          authLoading={authLoading}
          authError={authError}
          unauthorizedDomain={unauthorizedDomain}
        />
      ) : (
        <div className="h-[100dvh] w-full bg-[#020617] text-slate-100 flex flex-col overflow-hidden overscroll-none">
          {/* Top Notification Toast */}
          {topBanner && (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] max-w-md w-[94%] rounded-2xl bg-emerald-500 text-slate-950 px-4 py-3 shadow-2xl flex items-center justify-between gap-2.5 text-xs sm:text-sm font-bold">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <span className="truncate">{topBanner}</span>
              </div>
              {lastCompletedDownload && (
                <button
                  type="button"
                  onClick={async () => {
                    const target = lastCompletedDownload;
                    await exportOfflineItemToPhone(target.itemId, target.name);
                    setTopBanner(null);
                    setLastCompletedDownload(null);
                  }}
                  className="shrink-0 px-2.5 py-1.5 rounded-xl bg-slate-950 text-emerald-300 text-[11px] font-bold"
                >
                  ফোনে সেভ
                </button>
              )}
            </div>
          )}

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

          {/* Main Scrollable Viewport (isolated inside 100dvh shell so pull-to-refresh never triggers) */}
          <main className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y pwa-scroll-container">
            <div className="w-full max-w-6xl mx-auto px-4 pt-5 pb-28">
              {activeTab === 'subjects' && (
                <SubjectsView
                  subjects={subjects}
                  downloads={downloadsMap}
                  downloadTasks={downloadTasks}
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
                  onOfflineAlert={() => pushNav((p) => ({ ...p, offlineModalOpen: true }))}
                />
              )}

              {activeTab === 'downloads' && (
                <DownloadsView
                  uid={appUser.uid}
                  subjects={subjects}
                  downloads={downloadsMap}
                  downloadTasks={downloadTasks}
                  isOnline={isOnline}
                  selectedSubjectId={selectedDownloadSubjectId}
                  onSelectSubjectId={(sid) => {
                    if (sid === null) {
                      goBackOr((p) => ({ ...p, downloadSubjectId: null }));
                    } else {
                      pushNav((p) => ({ ...p, downloadSubjectId: sid }));
                    }
                  }}
                  onOfflineAlert={() => pushNav((p) => ({ ...p, offlineModalOpen: true }))}
                  onPlayDownloaded={(rec) => {
                    const secTitle =
                      rec.sectionTitle ||
                      SUBJECT_LIST.find((s) => s.id === rec.subjectId)?.name ||
                      'ক্লাস';
                    pushNav((p) => ({
                      ...p,
                      activeVideo: {
                        item: {
                          id: rec.itemId,
                          name: rec.videoName,
                          videoUrl: rec.videoUrl,
                          pdfUrl: rec.pdfUrl,
                          createdAt: Date.now(),
                        },
                        subjectId: rec.subjectId,
                        sectionId: rec.sectionId,
                        sectionTitle: secTitle,
                        classNumber: rec.classNumber,
                      },
                    }));
                  }}
                  onOpenDownloadedPdf={(rec) =>
                    pushNav((p) => ({
                      ...p,
                      activePdf: {
                        itemId: rec.itemId,
                        title: rec.videoName,
                        pdfUrl: rec.pdfUrl,
                      },
                    }))
                  }
                  onDeleteDownload={handleDeleteDownload}
                  onRestoreMatchedRecords={handleRestoreMatchedRecords}
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

          {/* Fixed Bottom Navigation Bar matching Image 2 & 3 (3 Tabs Only: বিষয়সমূহ, ডাউনলোড, প্রোফাইল) */}
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
                className={`rounded-2xl flex flex-col items-center justify-center gap-1 transition ${
                  activeTab === 'downloads'
                    ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Download className="w-5 h-5" />
                <span className="text-[11px] whitespace-nowrap">ডাউনলোড</span>
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
              videoUrl={activeVideo.item.videoUrl}
              pdfUrl={activeVideo.item.pdfUrl}
              durationLabel={activeVideo.item.duration}
              initialPosition={progressMap[activeVideo.item.id]?.currentTime || 0}
              isDownloaded={Boolean(downloadsMap[activeVideo.item.id])}
              downloadTask={downloadTasks[activeVideo.item.id]}
              isOnline={isOnline}
              onSaveProgress={handleSaveProgress}
              onOpenPdf={() => {
                if (!isOnline && !downloadsMap[activeVideo.item.id]) {
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
              onOfflineAttempt={() => pushNav((p) => ({ ...p, offlineModalOpen: true }))}
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
                  এই ভিডিও বা PDF টি ডাউনলোড করা নেই। অফলাইনে দেখতে চাইলে ইন্টারনেট সংযোগ চালু করে ডাউনলোড করুন।
                </p>
                <button
                  type="button"
                  onClick={() => goBackOr((p) => ({ ...p, offlineModalOpen: false }))}
                  className="w-full py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm"
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
