import { Capacitor } from '@capacitor/core';
import { Directory, FileInfo, Filesystem } from '@capacitor/filesystem';
import { ClassItem, DownloadRecord, SUBJECT_LIST, SubjectDoc } from '../types';
import { getGoogleDriveFileId } from './offlineStorage';
import {
  checkNativePermissionsDetailed,
  downloadUrlToNativePublicStorage,
  isNoorNativeStorageAvailable,
  NoorDownloadProgressEvent,
  NoorPermissionStatus,
  openNativeAllFilesSettings,
  pickNativeDownloadFolder,
  readNativeUriAsBlob,
  requestNativePermissionsDetailed,
  resolveNativePlayableVideoUri,
  saveBase64ToNativePublicStorage,
  scanNativePublicFiles,
} from './noorStoragePlugin';

export type NativeStoragePermissionState = 'web' | 'granted' | 'denied';

export interface ScannedNativeFile {
  name: string;
  uri: string;
  sizeBytes: number;
  kind: 'video' | 'pdf';
  folder?: string;
  compactNorm: string;
  spacedNorm: string;
}

export interface AutoScanResult {
  status: 'web' | 'granted' | 'permission_denied' | 'error';
  scannedFilesCount: number;
  matchedRecords: DownloadRecord[];
  discoveredUris?: string[];
  permissionDetails?: NoorPermissionStatus;
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

export async function prepareNativePlayableVideoSrc(fileUri: string): Promise<string> {
  if (!fileUri) return '';
  if (isCapacitorNative() && isNoorNativeStorageAvailable() && fileUri.startsWith('content://')) {
    const resolved = await resolveNativePlayableVideoUri(fileUri);
    return toPlayableNativeSrc(resolved || fileUri);
  }
  return toPlayableNativeSrc(fileUri);
}

export function isNativeConvertedOrFileUrl(url?: string | null): boolean {
  if (!url) return false;
  return (
    url.startsWith('file://') ||
    url.startsWith('content://') ||
    url.startsWith('capacitor://') ||
    url.includes('/_capacitor_file_/') ||
    url.includes('/_capacitor_content_/')
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
    .replace(/\.(pdf|mp4|mkv|webm|mov|m4v|avi|3gp|flv|ts|m4a)$/i, '')
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
    .replace(/\.(pdf|mp4|mkv|webm|mov|m4v|avi|3gp|flv|ts|m4a)$/i, '')
    .replace(/\(\s*\d+\s*\)/g, ' ')
    .replace(/\[\s*\d+\s*\]/g, ' ')
    .replace(/[-_.,:|/\\()[\]'"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function normalizeSemanticSpaced(raw: string): string {
  const spaced = normalizeSpacedName(raw);
  return spaced
    .replace(/(?:ক্লাস|লেকচার|লেসন)/g, ' class ')
    .replace(/\b(?:lec|lecture|cls)\b/gi, ' class ')
    .replace(/(?:পার্ট|পর্ব)/g, ' part ')
    .replace(/\b(?:ep|episode)\b/gi, ' part ')
    .replace(/(?:অধ্যায়|অধ্যায়|পাঠ)/g, ' chapter ')
    .replace(/\b(?:ch|chap|lesson)\b/gi, ' chapter ')
    .replace(/(?:১ম|প্রথম)/g, ' 1st ')
    .replace(/(?:২য়|দ্বিতীয়|দ্বিতীয়)/g, ' 2nd ')
    .replace(/পত্র/g, ' paper ')
    .replace(/(?:ইংলিশ|ইংরেজি)/g, ' english ')
    .replace(/বাংলা/g, ' bangla ')
    .replace(/(?:গণিত|গনিত|অঙ্ক|অংক)/g, ' math ')
    .replace(/কৃষি/g, ' agri ')
    .replace(/আইসিটি/g, ' ict ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNumberTokens(raw: string): string[] {
  const spaced = normalizeSemanticSpaced(raw);
  const matches = spaced.match(/\d+/g);
  return matches ? matches.map((n) => String(parseInt(n, 10))) : [];
}

function hasNumberConflict(targetRaw: string, fileRaw: string): boolean {
  const targetNums = extractNumberTokens(targetRaw);
  const fileNums = extractNumberTokens(fileRaw);
  if (targetNums.length === 0 || fileNums.length === 0) return false;
  const fileSet = new Set(fileNums);
  for (const num of targetNums) {
    if (!fileSet.has(num)) return true;
  }
  return false;
}

const SUBJECT_FAMILY_TOKENS: Record<string, string[]> = {
  eng: ['english', 'eng'],
  ban: ['bangla', 'bengali', 'ban'],
  math: ['math', 'mathematics'],
  agri: ['agri', 'agriculture'],
  ict: ['ict'],
};

function getSubjectFamily(subjectId: string): string {
  if (subjectId.startsWith('eng')) return 'eng';
  if (subjectId.startsWith('ban')) return 'ban';
  return subjectId;
}

function getRelevantFolderName(folder?: string): string {
  if (!folder) return '';
  const cleaned = folder.replace(/\\/g, '/').replace(/\/+$/, '');
  const seg = cleaned.split('/').pop() || '';
  if (/^(download|downloads|documents|movies|dcim|noorelahi|noor elahi|primary|external|files|video|chrome|browser|telegram)$/i.test(seg)) {
    return '';
  }
  return seg;
}

function detectSubjectAndPaperCheck(
  subjectId: string,
  sectionTitle: string,
  file: ScannedNativeFile
): { conflict: boolean; bonus: number } {
  const folderHint = getRelevantFolderName(file.folder);
  const fileSearchText = normalizeSemanticSpaced(`${file.name} ${folderHint}`);
  const fileTokens = new Set(fileSearchText.split(' ').filter(Boolean));
  const fileCompact = fileSearchText.replace(/\s+/g, '');
  const myFamily = getSubjectFamily(subjectId);

  const matchedFamilies = new Set<string>();
  for (const [family, keywords] of Object.entries(SUBJECT_FAMILY_TOKENS)) {
    for (const kw of keywords) {
      if (fileTokens.has(kw)) {
        matchedFamilies.add(family);
        break;
      }
    }
  }

  // Only reject if file explicitly belongs to a competing subject family and NOT ours
  if (matchedFamilies.size > 0 && !matchedFamilies.has(myFamily)) {
    return { conflict: true, bonus: 0 };
  }

  // Check 1st vs 2nd paper conflicts for English & Bangla using filename + immediate non-generic subfolder
  if (subjectId === 'eng-1' || subjectId === 'eng-2' || subjectId === 'ban-1' || subjectId === 'ban-2') {
    const isPaper1Subject = subjectId.endsWith('-1');
    const hasPaper1Marker = /\b(1st|first|paper\s*1|p1|eng\s*1|ban\s*1)\b/.test(fileSearchText);
    const hasPaper2Marker = /\b(2nd|second|paper\s*2|p2|eng\s*2|ban\s*2)\b/.test(fileSearchText);

    if (isPaper1Subject && hasPaper2Marker && !hasPaper1Marker) {
      return { conflict: true, bonus: 0 };
    }
    if (!isPaper1Subject && hasPaper1Marker && !hasPaper2Marker) {
      return { conflict: true, bonus: 0 };
    }
  }

  let bonus = 0;
  if (matchedFamilies.has(myFamily)) {
    bonus += 0.08;
  }
  const secNorm = normalizeSemanticSpaced(sectionTitle).replace(/\s+/g, '');
  if (secNorm.length >= 4 && fileCompact.includes(secNorm)) {
    bonus += 0.06;
  }
  return { conflict: false, bonus };
}

function stripPdfQualifiers(raw: string): string {
  return (raw || '')
    .replace(/\.pdf$/i, '')
    .replace(/\b(pdf|lecture\s*sheet|sheet|notes?|hand\s*note|class\s*note|slide|suggested|suggestion|guide)\b/gi, ' ')
    .replace(/(পিডিএফ|লেকচার\s*শিট|নোটস?|শিট|স্লাইড|সাজেশন)/g, ' ')
    .replace(/\s+/g, ' ')
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
  const spacedTarget = normalizeSemanticSpaced(vaultName);
  const spacedFile = normalizeSemanticSpaced(deviceFileName);
  const compactTarget = spacedTarget.replace(/\s+/g, '');
  const compactFile = spacedFile.replace(/\s+/g, '');
  if (!compactTarget || !compactFile) return 0;

  if (compactTarget === compactFile) return 1;

  if (hasNumberConflict(vaultName, deviceFileName)) {
    return 0;
  }

  const maxLen = Math.max(compactTarget.length, compactFile.length);
  const dist = levenshteinDistance(compactTarget, compactFile);
  let score = 1 - dist / maxLen;

  // Clean phrase containment on device file name (handles longer Drive/academy/subject prefixes & suffixes on PDFs and videos)
  if (compactTarget.length >= 4 && compactFile.includes(compactTarget)) {
    const ratio = compactTarget.length / compactFile.length;
    const containmentScore =
      ratio >= 0.45
        ? Math.max(0.86, 0.97 - (1 - ratio) * 0.12)
        : Math.max(0.82, 0.88 - (0.45 - ratio) * 0.14);
    if (containmentScore > score) score = containmentScore;
  } else if (compactFile.length >= 5 && compactTarget.includes(compactFile)) {
    const ratio = compactFile.length / compactTarget.length;
    if (ratio >= 0.7) {
      const containmentScore = Math.max(0.82, 0.82 + (ratio - 0.7) * 0.5);
      if (containmentScore > score) score = containmentScore;
    }
  }

  // Token overlap (preserve digit tokens like '1', '2' so "Unit 1 Lesson 1" matches accurately)
  const targetTokens = spacedTarget.split(' ').filter((t) => t.length >= 2 || /^\d+$/.test(t));
  const fileTokens = spacedFile.split(' ').filter((t) => t.length >= 2 || /^\d+$/.test(t));
  if (targetTokens.length >= 2 && fileTokens.length >= 2) {
    const fileSet = new Set(fileTokens);
    let matches = 0;
    for (const tok of targetTokens) {
      if (fileSet.has(tok)) matches += 1;
    }
    const tokenRatio = matches / targetTokens.length;
    if (tokenRatio >= 0.75) {
      const tokenScore = 0.81 + (tokenRatio - 0.75) * 0.65;
      if (tokenScore > score) score = tokenScore;
    }
  }

  return Math.max(0, Math.min(1, score));
}

function scoreCandidateMatch(
  candidateNames: string[],
  driveId: string | null,
  expectedSizeMB: number | undefined,
  subjectId: string,
  sectionTitle: string,
  file: ScannedNativeFile,
  explicitFileNames: string[] = []
): number {
  if (driveId && file.name.includes(driveId)) {
    return 1.25;
  }

  const fileCompareNames =
    file.kind === 'pdf'
      ? Array.from(new Set([file.name, stripPdfQualifiers(file.name)].filter(Boolean)))
      : [file.name];

  // Explicit File Vault filename takes top priority without being blocked by heuristic subject/number filters
  let bestExplicitScore = 0;
  for (const expName of explicitFileNames) {
    if (!expName.trim()) continue;
    const expCompact = normalizeCompactName(expName);
    const fileCompact = normalizeCompactName(file.name);
    if (expCompact && fileCompact && expCompact === fileCompact) {
      return 1.25;
    }
    for (const fName of fileCompareNames) {
      const s = computeNameSimilarity(expName, fName);
      if (s > bestExplicitScore) bestExplicitScore = s;
    }
  }
  if (bestExplicitScore >= 0.8) {
    return bestExplicitScore + 0.18;
  }

  const subjectCheck = detectSubjectAndPaperCheck(subjectId, sectionTitle, file);
  if (subjectCheck.conflict) {
    return 0;
  }

  let bestNameScore = 0;
  for (const name of candidateNames) {
    if (!name.trim()) continue;
    for (const fName of fileCompareNames) {
      const s = computeNameSimilarity(name, fName);
      if (s > bestNameScore) bestNameScore = s;
    }
  }

  if (bestNameScore < 0.8) {
    return 0;
  }

  let finalScore = bestNameScore + subjectCheck.bonus;

  if (expectedSizeMB && expectedSizeMB > 0 && file.sizeBytes > 0) {
    const expectedBytes = expectedSizeMB * 1024 * 1024;
    const diffRatio = Math.abs(file.sizeBytes - expectedBytes) / expectedBytes;
    if (diffRatio <= 0.25) {
      finalScore += 0.05;
    } else if (diffRatio > 0.7 && bestNameScore < 0.92) {
      return 0;
    }
  }

  return finalScore;
}

function normalizeExactPdfFullName(raw: string): string {
  return (raw || '')
    .normalize('NFC')
    .trim()
    .replace(/\.pdf$/i, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function sanitizeExactPdfFsName(raw: string): string {
  return normalizeExactPdfFullName(raw)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreExactPdfMatch(item: ClassItem, file: ScannedNativeFile): number {
  const fileExact = normalizeExactPdfFullName(file.name);
  if (!fileExact) return 0;
  const fileSanitized = sanitizeExactPdfFsName(file.name);

  const explicitPdfName = (item.pdfFileName || '').trim();
  const itemName = (item.name || '').trim();

  if (explicitPdfName) {
    const targetExact = normalizeExactPdfFullName(explicitPdfName);
    if (targetExact && targetExact === fileExact) return 1.25;
    const targetSanitized = sanitizeExactPdfFsName(explicitPdfName);
    if (targetSanitized && targetSanitized === fileSanitized) return 1.2;
  }

  if (itemName) {
    const nameExact = normalizeExactPdfFullName(itemName);
    if (nameExact && nameExact === fileExact) return 1.05;
    const nameSanitized = sanitizeExactPdfFsName(itemName);
    if (nameSanitized && nameSanitized === fileSanitized) return 1.0;
  }

  return 0;
}

export async function getDetailedNativePermissionStatus(): Promise<NoorPermissionStatus> {
  if (!isCapacitorNative()) {
    return {
      granted: true,
      runtimeGranted: true,
      hasAllFilesAccess: true,
      hasSavedFolderTree: false,
      needsFolderGrantForPdf: false,
    };
  }
  if (isNoorNativeStorageAvailable()) {
    try {
      return await checkNativePermissionsDetailed();
    } catch {
      // Fall through to Capacitor Filesystem check
    }
  }
  try {
    const status = await Filesystem.checkPermissions();
    const granted = status.publicStorage === 'granted';
    return {
      granted,
      runtimeGranted: granted,
      hasAllFilesAccess: granted,
      hasSavedFolderTree: false,
      needsFolderGrantForPdf: false,
    };
  } catch {
    return {
      granted: false,
      runtimeGranted: false,
      hasAllFilesAccess: false,
      hasSavedFolderTree: false,
      needsFolderGrantForPdf: false,
    };
  }
}

export async function checkNativeStoragePermission(
  promptIfNeeded: boolean
): Promise<NativeStoragePermissionState> {
  if (!isCapacitorNative()) {
    return 'web';
  }

  if (isNoorNativeStorageAvailable()) {
    try {
      const current = await checkNativePermissionsDetailed();
      if (current.granted) {
        return 'granted';
      }
      if (promptIfNeeded) {
        const requested = await requestNativePermissionsDetailed();
        return requested.granted ? 'granted' : 'denied';
      }
      return 'denied';
    } catch {
      // Fallback to Filesystem plugin check
    }
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

export function needsAnyStoragePermission(status: NoorPermissionStatus): boolean {
  if (!isCapacitorNative()) return false;
  if (!status.runtimeGranted) return true;
  if (typeof status.sdkInt === 'number' && status.sdkInt >= 30 && !status.hasAllFilesAccess) {
    return true;
  }
  return Boolean(status.needsAllFilesAccess);
}

export async function requestFullNativeStoragePermission(): Promise<{
  state: NativeStoragePermissionState;
  details: NoorPermissionStatus;
}> {
  if (!isCapacitorNative()) {
    const webDetails = await getDetailedNativePermissionStatus();
    return { state: 'web', details: webDetails };
  }

  let details = await getDetailedNativePermissionStatus();
  if (!details.runtimeGranted && isNoorNativeStorageAvailable()) {
    try {
      details = await requestNativePermissionsDetailed();
    } catch {
      details = await getDetailedNativePermissionStatus();
    }
  } else if (!details.runtimeGranted) {
    try {
      await Filesystem.requestPermissions();
      details = await getDetailedNativePermissionStatus();
    } catch {
      // Ignore permission dialog cancellation
    }
  }

  if (
    isNoorNativeStorageAvailable() &&
    ((typeof details.sdkInt === 'number' && details.sdkInt >= 30 && !details.hasAllFilesAccess) ||
      details.needsAllFilesAccess)
  ) {
    try {
      details = await openNativeAllFilesSettings();
    } catch {
      details = await getDetailedNativePermissionStatus();
    }
  }

  return {
    state: details.granted ? 'granted' : 'denied',
    details,
  };
}

export async function requestNativeStoragePermission(): Promise<NativeStoragePermissionState> {
  if (!isCapacitorNative()) {
    return 'web';
  }
  if (isNoorNativeStorageAvailable()) {
    try {
      const requested = await requestNativePermissionsDetailed();
      if (requested.granted) return 'granted';
    } catch {
      // Fallback to Filesystem plugin
    }
  }
  try {
    const requested = await Filesystem.requestPermissions();
    return requested.publicStorage === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export async function requestNativeDownloadFolderAccess(): Promise<NoorPermissionStatus> {
  if (!isNoorNativeStorageAvailable()) {
    return await getDetailedNativePermissionStatus();
  }
  return await pickNativeDownloadFolder();
}

export async function requestNativeAllFilesAccessSettings(): Promise<NoorPermissionStatus> {
  if (!isNoorNativeStorageAvailable()) {
    return await getDetailedNativePermissionStatus();
  }
  return await openNativeAllFilesSettings();
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
  const seenKeys = new Set<string>();

  const pushNormalizedEntry = (
    name: string,
    uri: string,
    sizeBytes: number,
    kind: 'video' | 'pdf',
    folder?: string
  ) => {
    if (!name || !uri || seenUris.has(uri)) return;
    const compactNorm = normalizeCompactName(name);
    const spacedNorm = normalizeSpacedName(name);
    if (!compactNorm) return;

    const dedupKey = `${kind}::${compactNorm}::${sizeBytes}`;
    if (seenKeys.has(dedupKey)) return;

    seenUris.add(uri);
    seenKeys.add(dedupKey);
    collected.push({
      name,
      uri,
      sizeBytes,
      kind,
      folder,
      compactNorm,
      spacedNorm,
    });
  };

  // 1. Native Android NoorStorage scan (MediaStore Videos + Downloads + Files + Persisted SAF Trees + Download dirs)
  if (isNoorNativeStorageAvailable()) {
    try {
      const nativeItems = await scanNativePublicFiles();
      for (const item of nativeItems) {
        const lower = (item.name || '').toLowerCase();
        const kind =
          item.kind === 'pdf' || PDF_EXT_RE.test(lower)
            ? 'pdf'
            : item.kind === 'video' || VIDEO_EXT_RE.test(lower)
            ? 'video'
            : null;
        if (!kind) continue;
        pushNormalizedEntry(item.name, item.uri, Number(item.sizeBytes || 0), kind, item.folder);
      }
    } catch {
      // Continue to Capacitor Filesystem fallback below
    }
  }

  // 2. Capacitor Filesystem fallback / supplement
  const rootTargets: Array<{ directory: Directory; path: string; scanSubfolders: boolean }> = [
    { directory: Directory.ExternalStorage, path: 'Download/NoorElahi', scanSubfolders: false },
    { directory: Directory.ExternalStorage, path: 'Download/NOOR ELAHI', scanSubfolders: false },
    { directory: Directory.ExternalStorage, path: 'Download/Noor Elahi', scanSubfolders: false },
    { directory: Directory.ExternalStorage, path: 'Download', scanSubfolders: true },
    { directory: Directory.ExternalStorage, path: 'Downloads', scanSubfolders: true },
    { directory: Directory.ExternalStorage, path: 'Documents/NoorElahi', scanSubfolders: false },
    { directory: Directory.ExternalStorage, path: 'Documents', scanSubfolders: true },
    { directory: Directory.ExternalStorage, path: 'Movies', scanSubfolders: true },
    { directory: Directory.Documents, path: 'NoorElahi', scanSubfolders: false },
    { directory: Directory.Documents, path: '', scanSubfolders: true },
  ];

  const pushFileInfo = async (entry: FileInfo, relPath: string, directory: Directory) => {
    const name = entry.name || '';
    const lower = name.toLowerCase();
    const isPdf = PDF_EXT_RE.test(lower);
    const isVideo = VIDEO_EXT_RE.test(lower);
    if (!isPdf && !isVideo) return;

    const uri = await resolveNativeUri(entry, relPath, directory);
    if (!uri) return;

    let sizeBytes = Number(entry.size || 0);
    if (!sizeBytes) {
      try {
        const stat = await Filesystem.stat({ path: relPath, directory });
        sizeBytes = Number(stat.size || 0);
      } catch {
        sizeBytes = 0;
      }
    }

    pushNormalizedEntry(name, uri, sizeBytes, isPdf ? 'pdf' : 'video');
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

export function itemHasExplicitVideoFileName(item: ClassItem): boolean {
  if (item.videoFileName?.trim()) return true;
  if (item.videoFileNames && item.videoFileNames.some((n) => Boolean(n?.trim()))) {
    return true;
  }
  return false;
}

export async function autoScanDownloadsWithCapacitor(
  subjects: Record<string, SubjectDoc>,
  uid: string,
  options?: {
    promptPermission?: boolean;
    isOnline?: boolean;
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

  const isOnlineNow = options?.isOnline !== false;
  const perm = await checkNativeStoragePermission(Boolean(options?.promptPermission));
  const permissionDetails = await getDetailedNativePermissionStatus();
  if (perm === 'denied') {
    return {
      status: 'permission_denied',
      scannedFilesCount: 0,
      matchedRecords: [],
      permissionDetails,
    };
  }

  try {
    const files = await collectNativeDownloadFiles();
    const videoFiles = files.filter((f) => f.kind === 'video');
    const pdfFiles = files.filter((f) => f.kind === 'pdf');
    const discoveredUris = files.map((f) => f.uri);

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
          if (!primaryVideoUrl && !item.pdfUrl && !itemHasExplicitVideoFileName(item) && !item.pdfFileName?.trim()) continue;
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

    const total = catalogItems.length;

    const extractUrlHint = (raw?: string): string => {
      if (!raw) return '';
      try {
        const u = new URL(raw);
        if (u.hostname.includes('drive.google.com') || u.hostname.includes('docs.google.com')) {
          return '';
        }
        const seg = decodeURIComponent(u.pathname.split('/').pop() || '').trim();
        if (seg && seg.length >= 4 && !/^(view|preview|download|uc|index\.html)$/i.test(seg)) {
          return seg;
        }
      } catch {
        // Ignore malformed URL
      }
      return '';
    };

    const subjectMetaById = new Map(SUBJECT_LIST.map((m) => [m.id, m]));
    const videoCandidates: Array<{ idx: number; file: ScannedNativeFile; score: number }> = [];
    const pdfCandidates: Array<{ idx: number; file: ScannedNativeFile; score: number }> = [];

    for (let idx = 0; idx < total; idx += 1) {
      const { subject, sectionTitle, classIndex, item, primaryVideoUrl } = catalogItems[idx];

      const videoUrlHint = extractUrlHint(primaryVideoUrl);
      const subjMeta = subjectMetaById.get(subject.id);
      const subjShort = subjMeta?.shortLabel || '';

      const baseNames = Array.from(
        new Set(
          [
            item.name || '',
            `${subject.name} ${item.name || ''}`,
            subjShort ? `${subjShort} ${item.name || ''}` : '',
            sectionTitle ? `${sectionTitle} ${item.name || ''}` : '',
            `${subject.name} Class ${classIndex}`,
            `${subject.name} ক্লাস ${classIndex}`,
            subjShort ? `${subjShort} Class ${classIndex}` : '',
            sectionTitle ? `${sectionTitle} Class ${classIndex}` : '',
            sectionTitle ? `${sectionTitle} ক্লাস ${classIndex}` : '',
          ]
            .map((s) => s.trim())
            .filter(Boolean)
        )
      );

      const videoNames = videoUrlHint ? [...baseNames, videoUrlHint] : baseNames;
      const explicitPdfName = item.pdfFileName?.trim() || '';

      const allVideoLinks =
        item.videoUrls && item.videoUrls.length > 0
          ? item.videoUrls
          : primaryVideoUrl
          ? [primaryVideoUrl]
          : [];
      const allVideoNames =
        item.videoFileNames && item.videoFileNames.length > 0
          ? item.videoFileNames
          : item.videoFileName
          ? [item.videoFileName]
          : [];
      const partCount = Math.max(allVideoLinks.length, allVideoNames.length);

      for (let vIdx = 0; vIdx < partCount; vIdx += 1) {
        const vUrl = (allVideoLinks[vIdx] || '').trim();
        const explicitVName =
          (allVideoNames[vIdx] || '').trim() ||
          (vIdx === 0 ? (item.videoFileName || '').trim() : '');
        if (!vUrl && !explicitVName) continue;

        // If NO video file name is configured in File Vault, video scanning only runs when online.
        // If a video file name IS configured, scanning works both offline and online.
        if (!explicitVName && !isOnlineNow) {
          continue;
        }

        const vDriveId = getGoogleDriveFileId(vUrl);
        const partNames =
          partCount > 1
            ? [
                ...videoNames,
                `${item.name || ''} Part ${vIdx + 1}`,
                `${item.name || ''} (পার্ট ${vIdx + 1})`,
              ]
            : videoNames;

        for (const vf of videoFiles) {
          const score = scoreCandidateMatch(
            partNames,
            vDriveId,
            item.expectedSizeMB,
            subject.id,
            sectionTitle,
            vf,
            explicitVName ? [explicitVName] : []
          );
          if (score >= 0.8) {
            videoCandidates.push({ idx, file: vf, score });
          }
        }
      }

      // PDFs always scan offline & online using exact full-name matching (only trailing .pdf is optional)
      if (item.pdfUrl || explicitPdfName) {
        for (const pf of pdfFiles) {
          const score = scoreExactPdfMatch(item, pf);
          if (score >= 1.0) {
            pdfCandidates.push({ idx, file: pf, score });
          }
        }
      }

      options?.onProgress?.(idx + 1, total, 0);
      if (idx % 5 === 0) {
        await yieldFrame();
      }
    }

    // Global 1-to-1 best-score assignment so a single PDF or video file cannot spill into wrong subjects/classes
    videoCandidates.sort((a, b) => b.score - a.score);
    pdfCandidates.sort((a, b) => b.score - a.score);

    const assignedVideos = new Map<number, { file: ScannedNativeFile; score: number }>();
    const usedVideoUris = new Set<string>();
    for (const cand of videoCandidates) {
      if (assignedVideos.has(cand.idx) || usedVideoUris.has(cand.file.uri)) continue;
      assignedVideos.set(cand.idx, { file: cand.file, score: cand.score });
      usedVideoUris.add(cand.file.uri);
    }

    const assignedPdfs = new Map<number, { file: ScannedNativeFile; score: number }>();
    const usedPdfUris = new Set<string>();
    for (const cand of pdfCandidates) {
      if (assignedPdfs.has(cand.idx) || usedPdfUris.has(cand.file.uri)) continue;
      assignedPdfs.set(cand.idx, { file: cand.file, score: cand.score });
      usedPdfUris.add(cand.file.uri);
    }

    const matchedRecords: DownloadRecord[] = [];
    for (let idx = 0; idx < total; idx += 1) {
      const bestVideo = assignedVideos.get(idx) || null;
      const bestPdf = assignedPdfs.get(idx) || null;
      if (!bestVideo && !bestPdf) continue;

      const { subject, sectionId, sectionTitle, classIndex, item, primaryVideoUrl } =
        catalogItems[idx];
      const sizeBytes = (bestVideo?.file.sizeBytes || 0) + (bestPdf?.file.sizeBytes || 0);
      const topScore = Math.min(1, Math.max(bestVideo?.score || 0, bestPdf?.score || 0));

      matchedRecords.push({
        uid,
        itemId: item.id,
        subjectId: subject.id,
        sectionId,
        sectionTitle,
        classNumber: classIndex,
        videoName: item.name?.trim() || `ক্লাস ${classIndex}`,
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

    options?.onProgress?.(total, total, matchedRecords.length);

    return {
      status: 'granted',
      scannedFilesCount: files.length,
      matchedRecords,
      discoveredUris,
      permissionDetails,
    };
  } catch (err) {
    return {
      status: 'error',
      scannedFilesCount: 0,
      matchedRecords: [],
      permissionDetails,
      errorMessage: err instanceof Error ? err.message : 'Scan error',
    };
  }
}

export async function readNativePdfAsBlob(localPdfUri: string): Promise<Blob | null> {
  if (!localPdfUri) return null;

  // 1. Try direct Capacitor WebView local server bridge (handles file:// & content:// via HTTP)
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
    // Fall through to native ContentResolver reader
  }

  if (!isCapacitorNative()) return null;

  // 2. Use NoorStoragePlugin.readUriBase64 (reads SAF tree / MediaStore content:// URIs reliably)
  if (isNoorNativeStorageAvailable()) {
    const directNativeBlob = await readNativeUriAsBlob(localPdfUri, 'application/pdf');
    if (directNativeBlob && directNativeBlob.size > 0) {
      return directNativeBlob;
    }
  }

  // 3. Fallback to @capacitor/filesystem readFile
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

function blobToBase64Raw(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = res.indexOf(',');
      resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
    };
    reader.onerror = () => reject(reader.error || new Error('Blob read failed'));
    reader.readAsDataURL(blob);
  });
}

export async function downloadRemoteFileToCapacitorPublicStorage(
  remoteUrl: string,
  filename: string,
  mimeType: string,
  onProgress?: (ev: NoorDownloadProgressEvent) => void
): Promise<{ saved: boolean; uri?: string; folder?: string; sizeBytes?: number }> {
  if (!isNoorNativeStorageAvailable() || !remoteUrl) {
    return { saved: false };
  }
  const safeFilename = filename.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'noor_elahi_file';
  try {
    const res = await downloadUrlToNativePublicStorage(
      {
        url: remoteUrl,
        filename: safeFilename,
        mimeType,
        subfolder: 'NoorElahi',
      },
      onProgress
    );
    return {
      saved: Boolean(res?.saved),
      uri: res?.uri,
      folder: res?.folder || 'Download/NoorElahi',
      sizeBytes: res?.sizeBytes,
    };
  } catch {
    return { saved: false };
  }
}

export async function saveFileToCapacitorPublicStorage(
  filename: string,
  blob: Blob
): Promise<{ saved: boolean; uri?: string; folder?: string }> {
  if (!isCapacitorNative() || !blob || blob.size === 0) {
    return { saved: false };
  }

  const safeFilename = filename.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'noor_elahi_file';
  const mimeType = safeFilename.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : blob.type || 'video/mp4';

  let base64Data = '';
  try {
    base64Data = await blobToBase64Raw(blob);
  } catch {
    return { saved: false };
  }
  if (!base64Data) {
    return { saved: false };
  }

  // Primary: Native Android MediaStore.Downloads -> saves into visible Download/NoorElahi/<AdminName>
  // Works reliably across Android 10-16 Scoped Storage without permission blocks
  if (isNoorNativeStorageAvailable()) {
    try {
      const nativeRes = await saveBase64ToNativePublicStorage({
        filename: safeFilename,
        base64Data,
        mimeType,
        subfolder: 'NoorElahi',
      });
      if (nativeRes?.saved) {
        return {
          saved: true,
          uri: nativeRes.uri,
          folder: nativeRes.folder || 'Download/NoorElahi',
        };
      }
    } catch {
      // Fallback to @capacitor/filesystem below
    }
  }

  await checkNativeStoragePermission(true);

  const targets: Array<{ directory: Directory; dirPath: string; filePath: string; label: string }> = [
    {
      directory: Directory.ExternalStorage,
      dirPath: 'Download/NoorElahi',
      filePath: `Download/NoorElahi/${safeFilename}`,
      label: 'Download/NoorElahi',
    },
    {
      directory: Directory.Documents,
      dirPath: 'NoorElahi',
      filePath: `NoorElahi/${safeFilename}`,
      label: 'Documents/NoorElahi',
    },
  ];

  for (const target of targets) {
    try {
      await Filesystem.mkdir({
        path: target.dirPath,
        directory: target.directory,
        recursive: true,
      }).catch(() => {});

      const written = await Filesystem.writeFile({
        path: target.filePath,
        data: base64Data,
        directory: target.directory,
        recursive: true,
      });

      let finalUri = written.uri || '';
      if (!finalUri) {
        try {
          const uriRes = await Filesystem.getUri({
            path: target.filePath,
            directory: target.directory,
          });
          finalUri = uriRes.uri || '';
        } catch {
          // Ignore getUri fallback failure
        }
      }

      return {
        saved: true,
        uri: finalUri || undefined,
        folder: target.label,
      };
    } catch {
      // Try next public directory target
    }
  }

  return { saved: false };
}
