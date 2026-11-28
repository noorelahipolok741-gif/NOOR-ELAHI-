import { initializeApp } from 'firebase/app';
import {
  Auth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  signInWithCredential,
  signInWithPopup,
  signOut,
  UserCredential,
} from 'firebase/auth';
import {
  doc,
  Firestore,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

let firestoreInstance: Firestore;
try {
  firestoreInstance = initializeFirestore(
    app,
    {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    },
    firebaseConfig.firestoreDatabaseId
  );
} catch {
  firestoreInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

function isSessionStorageAccessible(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const probeKey = '__noor_elahi_ss_probe__';
    window.sessionStorage.setItem(probeKey, '1');
    window.sessionStorage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

const authPersistence = isSessionStorageAccessible()
  ? [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence]
  : [indexedDBLocalPersistence, browserLocalPersistence];

let authInstance: Auth;
try {
  authInstance = initializeAuth(app, {
    persistence: authPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
} catch {
  authInstance = getAuth(app);
}

export const db = firestoreInstance;
export const auth = authInstance;
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

let socialLoginInitialized = false;

async function ensureNativeSocialLoginInitialized(): Promise<void> {
  if (socialLoginInitialized) return;
  const webClientId =
    import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID?.trim() || firebaseConfig.oAuthClientId;
  if (!webClientId) {
    throw new Error('MISSING_GOOGLE_WEB_CLIENT_ID');
  }
  await SocialLogin.initialize({
    google: {
      webClientId,
      mode: 'online',
      skipAuthOnlyAuthorizationAfterSignIn: true,
    },
  });
  socialLoginInitialized = true;
}

/**
 * Signs in with Google reliably across both Capacitor Native (Android/iOS) and Web/PWA:
 * - On Capacitor Native: Uses native Credential Manager / Google Sign-In to fetch an ID token
 *   and authenticates with Firebase via signInWithCredential (never touches WebView sessionStorage or redirects).
 * - On Web / Mobile Browser: Uses signInWithPopup cleanly (never signInWithRedirect).
 */
export async function signInWithGoogleSmart(): Promise<UserCredential> {
  if (Capacitor.isNativePlatform()) {
    await ensureNativeSocialLoginInitialized();
    // Clear any cached Credential Manager selection so Android shows the full chooser with ALL Gmail accounts
    await SocialLogin.logout({ provider: 'google' }).catch(() => {});
    const res = await SocialLogin.login({
      provider: 'google',
      options: {
        style: 'standard',
        filterByAuthorizedAccounts: false,
        autoSelectEnabled: false,
      },
    });
    const googleResult = res?.result;
    const idToken =
      googleResult && googleResult.responseType === 'online' ? googleResult.idToken : null;
    if (!idToken) {
      throw new Error('NATIVE_GOOGLE_MISSING_ID_TOKEN');
    }
    const credential = GoogleAuthProvider.credential(idToken);
    return await signInWithCredential(auth, credential);
  }

  return await signInWithPopup(auth, googleProvider);
}

export async function signOutGoogleSmart(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await ensureNativeSocialLoginInitialized();
      await SocialLogin.logout({ provider: 'google' });
    } catch {
      // Ignore native social logout errors if not signed in natively
    }
  }
  if (auth.currentUser) {
    await signOut(auth);
  }
}

if (typeof window !== 'undefined') {
  isSupported()
    .then((supported) => {
      if (supported && firebaseConfig.measurementId) {
        getAnalytics(app);
      }
    })
    .catch(() => {});
}

export async function testConnection(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch {
    // Non-blocking connection probe
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
