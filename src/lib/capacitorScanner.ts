import { Capacitor } from '@capacitor/core';
import { Directory, FileInfo, Filesystem } from '@capacitor/filesystem';
import { ClassItem, DownloadRecord, SubjectDoc } from '../types';
import { getGoogleDriveFileId } from './offlineStorage';

export type NativeStoragePermissionState = 'web' | 'granted' | 'denied';

export interface ScannedNativeFile {
  name: string;
  uri: string;
  sizeBytes: number;
  kind: 'video' | 'pdf';
  compactNorm: string;
  spacedNorm: string;
}

export interface AutoScanResult {
  status: 'web' | 'granted' | 'permission_denied' | 'error';
  scannedFilesCount: number;
  matchedRecords: DownloadRecord[];
  errorMessage?: string;
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

const VIDEO_EXT_RE = /\.(mp4|mkv|webm|mov|m4v|avi|3gp|flv|ts)$/i;
const PDF_EXT_RE = /\.pdf$/i;

export function isCapacitorNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getCapacitorPlatform(): string {
  try {
    return Capacitor.getPlatform();
  } catch {
    return 'web';
  }
}

export function toPlayableNativeSrc(fileUri: string): string {
  if (!fileUri) return '';
  if (
    fileUri.startsWith('blob:') ||
    fileUri.startsWith('data:') ||
    fileUri.startsWith('http://') ||
    fileUri.startsWith('https://') ||
    fileUri.startsWith('capacitor://')
  ) {
    return fileUri;
  }
  try {
    return Capacitor.convertFileSrc(fileUri);
  } catch {
    return fileUri;
  }
}

export function isNativeConvertedOrFileUrl(url?: string | null): boolean {
  if (!url) return false;
  return (
    url.startsWith('file://') ||
    url.startsWith('content://') ||
    url.startsWith('capacitor://') ||
    url.includes('/_capacitor_file_/')
  );
}

/**
 * Strip extensions (.mp4, .pdf, etc.), duplicate counters like (1), (2),
 * dashes (-), underscores (_), spaces, punctuation, and lowercase everything.
 * Example: "Class-1 Physics" and "class 1_physics (1).mp4" -> "class1physics"
 */
export function normalizeCompactName(raw: string): string {
  const withAsciiDigits = (raw || '')
    .normalize('NFC')
    .replace(/[০-৯]/g, (ch) => BENGALI_TO_ASCII_DIGITS[ch] || ch);

  return withAsciiDigits
    .replace(/\.[^/.]+$/, '')
    .replace(/\(\s*\d+\s*\)/g, '')
    .replace(/\[\s*\d+\s*\]/g, '')
    .replace(/[-_.\s,:;|/\\()[\]'"]+/g, '')
    .toLowerCase()
    .trim();
}

export function normalizeSpacedName(raw: string): string {
  const withAsciiDigits = (raw || '')
    .normalize('NFC')
    .replace(/[০-৯]/g, (ch) => BENGALI_TO_ASCII_DIGITS[ch] || ch);

  return withAsciiDigits
    .replace(/\.[^/.]+$/, '')
    .replace(/\(\s*\d+\s*\)/g, ' ')
    .replace(/\[\s*\d+\s*\]/g, ' ')
    .replace(/[-_.,:|/\\()[\]'"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

export function computeNameSimilarity(vaultName: string, deviceFileName: string): number {
  const compactTarget = normalizeCompactName(vaultName);
  const compactFile = normalizeCompactName(deviceFileName);
  if (!compactTarget || !compactFile) return 0;

  if (compactTarget === compactFile) return 1;

  const maxLen = Math.max(compactTarget.length, compactFile.length);
  const dist = levenshteinDistance(compactTarget, compactFile);
  let score = 1 - dist / maxLen;

  // Check clean token / substring containment (e.g., extra prefix/suffix on Drive filename)
  if (compactTarget.length >= 5 && compactFile.includes(compactTarget)) {
    const ratio = compactTarget.length / compactFile.length;
    const containmentScore = Math.max(0.84, 0.96 - (1 - ratio) * 0.12);
    if (containmentScore > score) score = containmentScore;
  } else if (compactFile.length >= 5 && compactTarget.includes(compactFile)) {
    const ratio = compactFile.length / compactTarget.length;
    if (ratio >= 0.8) {
      const containmentScore = Math.max(0.82, ratio);
      if (containmentScore > score) score = containmentScore;
    }
  }

  // Token overlap bonus for multi-word titles in different order
  const targetTokens = normalizeSpacedName(vaultName).split(' ').filter((t) => t.length >= 2);
  const fileTokens = normalizeSpacedName(deviceFileName).split(' ').filter((t) => t.length >= 2);
  if (targetTokens.length >= 2 && fileTokens.length >= 2) {
    const fileSet = new Set(fileTokens);
    let matches = 0;
    for (const tok of targetTokens) {
      if (fileSet.has(tok)) matches += 1;
    }
    const tokenRatio = matches / targetTokens.length;
    if (tokenRatio >= 0.8) {
      score = Math.max(score, 0.8 + (tokenRatio - 0.8) * 0.9);
    }
  }

  return Math.max(0, Math.min(1, score));
}

function scoreCandidateMatch(
  candidateNames: string[],
  driveId: string | null,
  expectedSizeMB: number | undefined,
  file: ScannedNativeFile
): number {
  if (driveId && file.name.includes(driveId)) {
    return 1;
  }

  let bestNameScore = 0;
  for (const name of candidateNames) {
    if (!name.trim()) continue;
    const s = computeNameSimilarity(name, file.name);
    if (s > bestNameScore) bestNameScore = s;
  }

  if (bestNameScore < 0.8) {
    return 0;
  }

  if (expectedSizeMB && expectedSizeMB > 0 && file.sizeBytes > 0) {
    const expectedBytes = expectedSizeMB * 1024 * 1024;
    const diffRatio = Math.abs(file.sizeBytes - expectedBytes) / expectedBytes;
    if (diffRatio <= 0.25) {
      return Math.min(1, bestNameScore + 0.05);
    }
    if (diffRatio > 0.7 && bestNameScore < 0.92) {
      return 0;
    }
  }

  return bestNameScore;
}

export async function checkNativeStoragePermission(
  promptIfNeeded: boolean
): Promise<NativeStoragePermissionState> {
  if (!isCapacitorNative()) {
    return 'web';
  }

  try {
    const status = await Filesystem.checkPermissions();
    if (status.publicStorage === 'granted') {
      return 'granted';
    }
    if (promptIfNeeded) {
      const requested = await Filesystem.requestPermissions();
      if (requested.publicStorage === 'granted') {
        return 'granted';
      }
    }
    return 'denied';
  } catch {
    return 'denied';
  }
}

export async function requestNativeStoragePermission(): Promise<NativeStoragePermissionState> {
  if (!isCapacitorNative()) {
    return 'web';
  }
  try {
    const requested = await Filesystem.requestPermissions();
    return requested.publicStorage === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

async function safeReadDirEntries(
  path: string,
  directory: Directory
): Promise<FileInfo[]> {
  try {
    const res = await Filesystem.readdir({ path, directory });
    return res.files || [];
  } catch {
    return [];
  }
}

async function resolveNativeUri(
  entry: FileInfo,
  fullRelPath: string,
  directory: Directory
): Promise<string> {
  if (entry.uri) return entry.uri;
  try {
    const res = await Filesystem.getUri({ path: fullRelPath, directory });
    return res.uri || '';
  } catch {
    return '';
  }
}

async function collectNativeDownloadFiles(): Promise<ScannedNativeFile[]> {
  const collected: ScannedNativeFile[] = [];
  const seenUris = new Set<string>();

  const rootTargets: Array<{ directory: Directory; path: string; scanSubfolders: boolean }> = [
    { directory: Directory.ExternalStorage, path: 'Download', scanSubfolders: true },
    { directory: Directory.ExternalStorage, path: 'Downloads', scanSubfolders: false },
    { directory: Directory.ExternalStorage, path: 'Download/NOOR ELAHI', scanSubfolders: false },
    { directory: Directory.ExternalStorage, path: 'Download/Noor Elahi', scanSubfolders: false },
    { directory: Directory.Documents, path: '', scanSubfolders: true },
  ];

  const pushFileInfo = async (entry: FileInfo, relPath: string, directory: Directory) => {
    const name = entry.name || '';
    const lower = name.toLowerCase();
    const isPdf = PDF_EXT_RE.test(lower);
    const isVideo = VIDEO_EXT_RE.test(lower);
    if (!isPdf && !isVideo) return;

    const uri = await resolveNativeUri(entry, relPath, directory);
    if (!uri || seenUris.has(uri)) return;
    seenUris.add(uri);

    let sizeBytes = Number(entry.size || 0);
    if (!sizeBytes) {
      try {
        const stat = await Filesystem.stat({ path: relPath, directory });
        sizeBytes = Number(stat.size || 0);
      } catch {
        sizeBytes = 0;
      }
    }

    const compactNorm = normalizeCompactName(name);
    const spacedNorm = normalizeSpacedName(name);
    if (!compactNorm) return;

    collected.push({
      name,
      uri,
      sizeBytes,
      kind: isPdf ? 'pdf' : 'video',
      compactNorm,
      spacedNorm,
    });
  };

  for (const target of rootTargets) {
    const entries = await safeReadDirEntries(target.path, target.directory);
    for (const entry of entries) {
      const relPath = target.path ? `${target.path}/${entry.name}` : entry.name;
      if (entry.type === 'directory') {
        if (target.scanSubfolders && entry.name && !entry.name.startsWith('.')) {
          const subEntries = await safeReadDirEntries(relPath, target.directory);
          for (const sub of subEntries) {
            if (sub.type !== 'directory') {
              await pushFileInfo(sub, `${relPath}/${sub.name}`, target.directory);
            }
          }
        }
      } else {
        await pushFileInfo(entry, relPath, target.directory);
      }
    }
  }

  return collected;
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
}

export async function autoScanDownloadsWithCapacitor(
  subjects: Record<string, SubjectDoc>,
  uid: string,
  options?: {
    promptPermission?: boolean;
    onProgress?: (scanned: number, total: number, matched: number) => void;
  }
): Promise<AutoScanResult> {
  if (!isCapacitorNative()) {
    return {
      status: 'web',
      scannedFilesCount: 0,
      matchedRecords: [],
    };
  }

  const perm = await checkNativeStoragePermission(Boolean(options?.promptPermission));
  if (perm === 'denied') {
    return {
      status: 'permission_denied',
      scannedFilesCount: 0,
      matchedRecords: [],
    };
  }

  try {
    const files = await collectNativeDownloadFiles();
    const videoFiles = files.filter((f) => f.kind === 'video');
    const pdfFiles = files.filter((f) => f.kind === 'pdf');

    const catalogItems: Array<{
      subject: SubjectDoc;
      sectionId: string;
      sectionTitle: string;
      classIndex: number;
      item: ClassItem;
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
          catalogItems.push({
            subject,
            sectionId: section.id,
            sectionTitle: section.title || '',
            classIndex,
            item,
            primaryVideoUrl,
          });
        }
      }
    }

    const matchedRecords: DownloadRecord[] = [];
    const total = catalogItems.length;

    for (let idx = 0; idx < total; idx += 1) {
      const { subject, sectionId, sectionTitle, classIndex, item, primaryVideoUrl } =
        catalogItems[idx];

      const candidateNames = [
        item.name || '',
        `${subject.name} ${item.name || ''}`,
        `${sectionTitle} ${item.name || ''}`,
        `${subject.name} Class ${classIndex}`,
      ].filter((s) => Boolean(s.trim()));

      const videoDriveId = getGoogleDriveFileId(primaryVideoUrl);
      const pdfDriveId = getGoogleDriveFileId(item.pdfUrl);

      let bestVideo: { file: ScannedNativeFile; score: number } | null = null;
      if (primaryVideoUrl) {
        for (const vf of videoFiles) {
          const score = scoreCandidateMatch(candidateNames, videoDriveId, item.expectedSizeMB, vf);
          if (score >= 0.8 && (!bestVideo || score > bestVideo.score)) {
            bestVideo = { file: vf, score };
          }
        }
      }

      let bestPdf: { file: ScannedNativeFile; score: number } | null = null;
      if (item.pdfUrl) {
        for (const pf of pdfFiles) {
          const score = scoreCandidateMatch(candidateNames, pdfDriveId, undefined, pf);
          if (score >= 0.8 && (!bestPdf || score > bestPdf.score)) {
            bestPdf = { file: pf, score };
          }
        }
      }

      if (bestVideo || bestPdf) {
        const sizeBytes = (bestVideo?.file.sizeBytes || 0) + (bestPdf?.file.sizeBytes || 0);
        const topScore = Math.max(bestVideo?.score || 0, bestPdf?.score || 0);

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
          fileSizeBytes: sizeBytes,
          hasLocalVideo: Boolean(bestVideo),
          hasLocalPdf: Boolean(bestPdf),
          localVideoUri: bestVideo?.file.uri,
          localPdfUri: bestPdf?.file.uri,
          matchedFileName: bestVideo?.file.name || bestPdf?.file.name,
          matchScore: Math.round(topScore * 100),
        });
      }

      options?.onProgress?.(idx + 1, total, matchedRecords.length);
      if (idx % 5 === 0) {
        await yieldFrame();
      }
    }

    return {
      status: 'granted',
      scannedFilesCount: files.length,
      matchedRecords,
    };
  } catch (err) {
    return {
      status: 'error',
      scannedFilesCount: 0,
      matchedRecords: [],
      errorMessage: err instanceof Error ? err.message : 'Scan error',
    };
  }
}

export async function readNativePdfAsBlob(localPdfUri: string): Promise<Blob | null> {
  if (!localPdfUri) return null;
  try {
    const convertedUrl = toPlayableNativeSrc(localPdfUri);
    if (convertedUrl) {
      const res = await fetch(convertedUrl);
      if (res.ok) {
        const b = await res.blob();
        if (b.size > 0) {
          return b.type === 'application/pdf' ? b : new Blob([b], { type: 'application/pdf' });
        }
      }
    }
  } catch {
    // Fallback to Filesystem.readFile below
  }

  if (!isCapacitorNative()) return null;
  try {
    const result = await Filesystem.readFile({ path: localPdfUri });
    if (typeof result.data === 'string' && result.data.length > 0) {
      const base64 = result.data.includes(',') ? result.data.split(',')[1] : result.data;
      const binStr = atob(base64);
      const len = binStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        bytes[i] = binStr.charCodeAt(i);
      }
      return new Blob([bytes], { type: 'application/pdf' });
    }
  } catch {
    // Ignore readFile failure
  }
  return null;
}
