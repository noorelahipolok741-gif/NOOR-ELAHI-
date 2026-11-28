import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';

export interface NoorPermissionStatus {
  granted: boolean;
  runtimeGranted: boolean;
  hasAllFilesAccess: boolean;
  needsAllFilesAccess?: boolean;
  hasSavedFolderTree: boolean;
  needsFolderGrantForPdf: boolean;
  sdkInt?: number;
  cancelled?: boolean;
  treeUri?: string;
}

export interface NoorScannedFileItem {
  name: string;
  uri: string;
  sizeBytes: number;
  kind: 'video' | 'pdf';
  folder?: string;
}

export interface NoorDownloadProgressEvent {
  filename: string;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
}

interface NoorStorageNativePlugin {
  checkMediaPermissions(): Promise<NoorPermissionStatus>;
  requestMediaPermissions(): Promise<NoorPermissionStatus>;
  pickPublicFolder(): Promise<NoorPermissionStatus>;
  openAllFilesSettings(): Promise<NoorPermissionStatus>;
  savePublicFile(options: {
    filename: string;
    base64Data: string;
    mimeType?: string;
    subfolder?: string;
  }): Promise<{ saved: boolean; uri?: string; folder?: string; sizeBytes?: number }>;
  downloadToPublicFile(options: {
    url: string;
    filename: string;
    mimeType?: string;
    subfolder?: string;
  }): Promise<{
    saved: boolean;
    uri?: string;
    folder?: string;
    sizeBytes?: number;
    mimeType?: string;
  }>;
  scanPublicFiles(): Promise<{ files: NoorScannedFileItem[]; count: number }>;
  readUriBase64(options: { uri: string }): Promise<{ data: string; sizeBytes: number }>;
  addListener(
    eventName: 'noorDownloadProgress',
    listenerFunc: (event: NoorDownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>;
}

const NoorStorage = registerPlugin<NoorStorageNativePlugin>('NoorStorage');

function isAndroidNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

export function isNoorNativeStorageAvailable(): boolean {
  return isAndroidNative();
}

export async function checkNativePermissionsDetailed(): Promise<NoorPermissionStatus> {
  if (!isAndroidNative()) {
    return {
      granted: true,
      runtimeGranted: true,
      hasAllFilesAccess: true,
      needsAllFilesAccess: false,
      hasSavedFolderTree: false,
      needsFolderGrantForPdf: false,
    };
  }
  try {
    return await NoorStorage.checkMediaPermissions();
  } catch {
    return {
      granted: false,
      runtimeGranted: false,
      hasAllFilesAccess: false,
      needsAllFilesAccess: false,
      hasSavedFolderTree: false,
      needsFolderGrantForPdf: false,
    };
  }
}

export async function requestNativePermissionsDetailed(): Promise<NoorPermissionStatus> {
  if (!isAndroidNative()) {
    return {
      granted: true,
      runtimeGranted: true,
      hasAllFilesAccess: true,
      needsAllFilesAccess: false,
      hasSavedFolderTree: false,
      needsFolderGrantForPdf: false,
    };
  }
  try {
    return await NoorStorage.requestMediaPermissions();
  } catch {
    return await checkNativePermissionsDetailed();
  }
}

export async function pickNativeDownloadFolder(): Promise<NoorPermissionStatus> {
  if (!isAndroidNative()) {
    return {
      granted: true,
      runtimeGranted: true,
      hasAllFilesAccess: true,
      needsAllFilesAccess: false,
      hasSavedFolderTree: false,
      needsFolderGrantForPdf: false,
    };
  }
  try {
    return await NoorStorage.pickPublicFolder();
  } catch {
    return await checkNativePermissionsDetailed();
  }
}

export async function openNativeAllFilesSettings(): Promise<NoorPermissionStatus> {
  if (!isAndroidNative()) {
    return {
      granted: true,
      runtimeGranted: true,
      hasAllFilesAccess: true,
      needsAllFilesAccess: false,
      hasSavedFolderTree: false,
      needsFolderGrantForPdf: false,
    };
  }
  try {
    return await NoorStorage.openAllFilesSettings();
  } catch {
    return await checkNativePermissionsDetailed();
  }
}

export async function scanNativePublicFiles(): Promise<NoorScannedFileItem[]> {
  if (!isAndroidNative()) return [];
  try {
    const res = await NoorStorage.scanPublicFiles();
    return Array.isArray(res?.files) ? res.files : [];
  } catch {
    return [];
  }
}

export async function saveBase64ToNativePublicStorage(options: {
  filename: string;
  base64Data: string;
  mimeType?: string;
  subfolder?: string;
}): Promise<{ saved: boolean; uri?: string; folder?: string; sizeBytes?: number }> {
  if (!isAndroidNative()) return { saved: false };
  return await NoorStorage.savePublicFile(options);
}

export async function downloadUrlToNativePublicStorage(
  options: {
    url: string;
    filename: string;
    mimeType?: string;
    subfolder?: string;
  },
  onProgress?: (ev: NoorDownloadProgressEvent) => void
): Promise<{
  saved: boolean;
  uri?: string;
  folder?: string;
  sizeBytes?: number;
  mimeType?: string;
}> {
  if (!isAndroidNative()) return { saved: false };
  let handle: PluginListenerHandle | null = null;
  if (onProgress) {
    try {
      handle = await NoorStorage.addListener('noorDownloadProgress', (ev) => {
        if (!ev || ev.filename === options.filename) {
          onProgress(ev);
        }
      });
    } catch {
      handle = null;
    }
  }
  try {
    return await NoorStorage.downloadToPublicFile(options);
  } finally {
    if (handle) {
      await handle.remove().catch(() => {});
    }
  }
}

export async function readNativeUriAsBlob(
  uri: string,
  mimeType = 'application/pdf'
): Promise<Blob | null> {
  if (!isAndroidNative() || !uri) return null;
  try {
    const res = await NoorStorage.readUriBase64({ uri });
    if (!res?.data) return null;
    const binStr = atob(res.data);
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  } catch {
    return null;
  }
}
