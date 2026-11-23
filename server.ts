import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import net from 'net';
import dns from 'dns/promises';

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_PATH = path.join(DATA_DIR, 'noor_elahi_store.json');

interface StoredNumberUser {
  uid: string;
  phone: string;
  name: string;
  email: string;
  photoUrl: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredInboxItem {
  id: string;
  uid: string;
  type: 'password_change' | 'issue_report';
  senderName: string;
  senderEmail: string;
  senderPhone: string;
  newPassword: string;
  message: string;
  createdAt: string;
}

interface StoreData {
  sessionSecret?: string;
  numberUsers: Record<string, StoredNumberUser>;
  subjects: Record<string, unknown>;
  notifications: Array<Record<string, unknown>>;
  inbox: StoredInboxItem[];
  progress: Record<string, Record<string, unknown>>;
  downloads: Record<string, Record<string, unknown>>;
}

function ensureStore(): StoreData {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    const initial: StoreData = {
      sessionSecret: crypto.randomBytes(32).toString('hex'),
      numberUsers: {},
      subjects: {},
      notifications: [],
      inbox: [],
      progress: {},
      downloads: {},
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as StoreData;
    if (!parsed.sessionSecret) {
      parsed.sessionSecret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(STORE_PATH, JSON.stringify(parsed, null, 2));
    }
    return parsed;
  } catch {
    const fallback: StoreData = {
      sessionSecret: crypto.randomBytes(32).toString('hex'),
      numberUsers: {},
      subjects: {},
      notifications: [],
      inbox: [],
      progress: {},
      downloads: {},
    };
    return fallback;
  }
}

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const store = ensureStore();
  return store.sessionSecret || 'noor_elahi_fallback_secret';
}

const SESSION_SECRET = getSessionSecret();

function saveStore(data: StoreData) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!data.sessionSecret) {
    data.sessionSecret = SESSION_SECRET;
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function hashPassword(password: string, salt?: string): { salt: string; hash: string } {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return { salt: actualSalt, hash: derived };
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function signToken(payload: { uid: string; phone: string; exp: number }): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token: string): { uid: string; phone: string; exp: number } | null {
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const decoded = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8')) as {
      uid: string;
      phone: string;
      exp: number;
    };
    if (Date.now() > decoded.exp) return null;
    return decoded;
  } catch {
    return null;
  }
}

function isPrivateIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    return isPrivateIp(lower.slice(7));
  }
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
  }
  return false;
}

async function validateExternalUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid protocol');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Blocked local host');
  }
  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error('Blocked private IP');
  }
  const resolved = await dns.lookup(hostname, { all: true });
  for (const record of resolved) {
    if (isPrivateIp(record.address)) {
      throw new Error('Blocked resolved private IP');
    }
  }
  return parsed;
}

function extractFirstHttpUrl(raw: string): string {
  const cleaned = raw.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (/\s/.test(cleaned)) {
    const match = cleaned.match(/(?:https?:\/\/|drive\.google\.com\/|docs\.google\.com\/)[^\s<>"']+/i);
    if (match?.[0]) {
      return match[0].replace(/[.,;'">]+$/, '');
    }
  }
  return cleaned;
}

function normalizeTargetUrl(rawUrl: string): string {
  const cleaned = extractFirstHttpUrl(rawUrl);
  const withProto = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
  try {
    const u = new URL(withProto);
    // Unwrap Google Docs/Drive gview or PDF.js viewer wrapper URLs
    if (
      (u.hostname.includes('docs.google.com') || u.hostname.includes('drive.google.com')) &&
      (u.pathname.includes('/gview') || u.pathname.includes('/viewer'))
    ) {
      const inner = u.searchParams.get('url');
      if (inner && /^https?:\/\//i.test(inner)) {
        return normalizeTargetUrl(inner);
      }
    }
    if (u.pathname.toLowerCase().endsWith('/viewer.html') && u.searchParams.get('file')) {
      const innerFile = u.searchParams.get('file')!;
      if (/^https?:\/\//i.test(innerFile)) {
        return normalizeTargetUrl(innerFile);
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
    if (u.hostname.includes('docs.google.com')) {
      const m = u.pathname.match(/\/(document|presentation|spreadsheets)(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)/);
      if (m?.[1] && m?.[2]) {
        if (m[1] === 'presentation') {
          return `https://docs.google.com/presentation/d/${m[2]}/export/pdf`;
        }
        return `https://docs.google.com/${m[1]}/d/${m[2]}/export?format=pdf`;
      }
    }
    return u.toString();
  } catch {
    return withProto;
  }
}

function isGoogleDriveFolderUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return (
      (u.hostname.includes('drive.google.com') || u.hostname.includes('docs.google.com')) &&
      /\/folders\//i.test(u.pathname)
    );
  } catch {
    return false;
  }
}

function getDrivePreviewUrl(urlStr: string): string | undefined {
  try {
    const u = new URL(urlStr);
    if (u.hostname.includes('docs.google.com')) {
      const m = u.pathname.match(/\/(document|presentation|spreadsheets)(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)/);
      if (m?.[1] && m?.[2]) {
        return `https://docs.google.com/${m[1]}/d/${m[2]}/preview`;
      }
    }
    const info = extractGoogleDriveInfo(urlStr);
    if (info?.id) {
      const rk = info.resourceKey ? `?resourcekey=${encodeURIComponent(info.resourceKey)}` : '';
      return `https://drive.google.com/file/d/${info.id}/preview${rk}`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function extractGoogleDriveInfo(urlStr: string): { id: string; resourceKey?: string } | null {
  try {
    const u = new URL(urlStr);
    const isDriveHost =
      u.hostname.includes('drive.google.com') ||
      u.hostname.includes('drive.usercontent.google.com');
    const isDocsFileHost =
      u.hostname.includes('docs.google.com') &&
      (/\/file(?:\/u\/\d+)?\/d\//.test(u.pathname) ||
        /\/a\/[^/]+\/file\/d\//.test(u.pathname) ||
        u.pathname === '/open' ||
        u.pathname === '/uc');

    if (!isDriveHost && !isDocsFileHost) {
      return null;
    }
    if (u.pathname.includes('/folders/')) {
      return null;
    }
    const resourceKey = u.searchParams.get('resourcekey') || undefined;
    const pathMatch =
      u.pathname.match(/\/file(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)/) ||
      u.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (pathMatch?.[1]) return { id: pathMatch[1], resourceKey };
    const idParam = u.searchParams.get('id');
    if (idParam && /^[a-zA-Z0-9_-]+$/.test(idParam)) return { id: idParam, resourceKey };
    return null;
  } catch {
    return null;
  }
}

function mergeCookiesFromResponse(cookieJar: Map<string, string>, res: globalThis.Response) {
  const hdrs = res.headers as unknown as { getSetCookie?: () => string[] };
  const rawCookies = typeof hdrs.getSetCookie === 'function'
    ? hdrs.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);

  for (const line of rawCookies) {
    const pair = line.split(';')[0]?.trim();
    if (!pair) continue;
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      cookieJar.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
    }
  }
}

function formatCookieHeader(cookieJar: Map<string, string>): string {
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

const DEFAULT_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchWithCookieJar(
  startUrl: string,
  baseHeaders: Record<string, string>,
  cookieJar: Map<string, string>
): Promise<{ response: globalThis.Response; finalUrl: string }> {
  let currentUrl = startUrl;
  for (let hop = 0; hop < 10; hop += 1) {
    await validateExternalUrl(currentUrl);
    const reqHeaders: Record<string, string> = { ...baseHeaders };
    const cookieStr = formatCookieHeader(cookieJar);
    if (cookieStr) {
      reqHeaders['Cookie'] = cookieStr;
    }

    const res = await fetch(currentUrl, {
      headers: reqHeaders,
      redirect: 'manual',
      signal: AbortSignal.timeout(22000),
    });
    mergeCookiesFromResponse(cookieJar, res);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      res.body?.cancel().catch(() => {});
      if (!loc) return { response: res, finalUrl: currentUrl };
      currentUrl = new URL(loc, currentUrl).toString();
      continue;
    }
    return { response: res, finalUrl: currentUrl };
  }
  throw new Error('অতিরিক্ত রিডাইরেক্ট হয়েছে।');
}

async function readTextLimited(res: globalThis.Response, maxBytes = 1024 * 1024): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    // Return what we collected
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/');
}

function resolveCandidateUrl(raw: string, baseUrl: string): string | null {
  try {
    const cleaned = decodeHtmlEntities(raw.trim()).replace(/^['"]|['"]$/g, '');
    if (
      !cleaned ||
      cleaned.startsWith('data:') ||
      cleaned.startsWith('blob:') ||
      cleaned.startsWith('javascript:') ||
      cleaned.startsWith('#')
    ) {
      return null;
    }
    const u = new URL(cleaned, baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // Unwrap Google gview/viewer or PDF.js viewer?file= params relative to baseUrl
    if (
      (u.hostname.includes('docs.google.com') || u.hostname.includes('drive.google.com')) &&
      (u.pathname.includes('/gview') || u.pathname.includes('/viewer'))
    ) {
      const inner = u.searchParams.get('url');
      if (inner) return resolveCandidateUrl(inner, baseUrl);
    }
    if (u.pathname.toLowerCase().includes('viewer.html') && u.searchParams.get('file')) {
      const innerFile = u.searchParams.get('file')!;
      return resolveCandidateUrl(innerFile, u.toString());
    }
    return u.toString();
  } catch {
    return null;
  }
}

function extractDriveConfirmUrlFromHtml(html: string, driveId: string, resourceKey?: string): string | null {
  const formMatch = html.match(/<form[^>]+id=["']download-form["'][^>]*action=["']([^"']+)["'][^>]*>/i)
    || html.match(/<form[^>]+action=["']([^"']+)["'][^>]*>/i);
  const actionUrl = formMatch?.[1]
    ? decodeHtmlEntities(formMatch[1])
    : 'https://drive.usercontent.google.com/download';

  const params = new URLSearchParams();
  const inputTags = html.match(/<input[^>]*>/gi) || [];
  for (const tag of inputTags) {
    const nameMatch = tag.match(/name=(?:["']([^"']+)["']|([^\s>]+))/i);
    const valMatch = tag.match(/value=(?:["']([^"']*)["']|([^\s>]+))/i);
    const name = nameMatch?.[1] || nameMatch?.[2];
    const value = valMatch?.[1] ?? valMatch?.[2] ?? '';
    if (name) {
      params.set(name, decodeHtmlEntities(value));
    }
  }

  if (params.has('id') || params.has('confirm') || params.has('uuid') || params.has('at')) {
    if (!params.has('id')) params.set('id', driveId);
    if (!params.has('export')) params.set('export', 'download');
    if (!params.has('confirm')) params.set('confirm', 't');
    if (resourceKey && !params.has('resourcekey')) params.set('resourcekey', resourceKey);
    const resolved = actionUrl.startsWith('http')
      ? actionUrl
      : `https://drive.usercontent.google.com${actionUrl.startsWith('/') ? '' : '/'}${actionUrl}`;
    const sep = resolved.includes('?') ? '&' : '?';
    return `${resolved}${sep}${params.toString()}`;
  }

  const hrefMatch = html.match(/href=["']([^"']*export=download[^"']*)["']/i);
  if (hrefMatch?.[1]) {
    const rawHref = decodeHtmlEntities(hrefMatch[1]);
    return rawHref.startsWith('http') ? rawHref : `https://drive.google.com${rawHref}`;
  }

  const jsonDlMatch = html.match(/"downloadUrl"\s*:\s*"([^"]+)"/i);
  if (jsonDlMatch?.[1]) {
    return decodeHtmlEntities(jsonDlMatch[1]);
  }

  return null;
}

function extractDriveVideoStreamsFromViewHtml(html: string): string[] {
  const candidates: string[] = [];
  const rawMatch = html.match(/"url_encoded_fmt_stream_map"\s*:\s*"([^"]+)"/)
    || html.match(/"fmt_stream_map"\s*:\s*"([^"]+)"/);
  if (rawMatch?.[1]) {
    const decoded = decodeHtmlEntities(rawMatch[1]);
    for (const part of decoded.split(',')) {
      const pipeParts = part.split('|');
      const maybeUrl = pipeParts[1] || '';
      if (maybeUrl.startsWith('http')) {
        candidates.push(maybeUrl);
      } else {
        const sp = new URLSearchParams(part);
        const u = sp.get('url');
        if (u && u.startsWith('http')) candidates.push(u);
      }
    }
  }
  const videoPlaybackMatches = html.match(/https?:\/\/[^"'\s<>\\]*googlevideo\.com\/videoplayback[^"'\s<>\\]*/gi) || [];
  for (const m of videoPlaybackMatches) {
    candidates.push(decodeHtmlEntities(m));
  }
  return Array.from(new Set(candidates));
}

function toKnownEmbedUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
      const id = u.pathname.replace(/^\/+/, '').split('/')[0];
      if (id) return `https://www.youtube.com/embed/${id}?playsinline=1&rel=0&modestbranding=1`;
    }
    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/embed/${v}?playsinline=1&rel=0&modestbranding=1`;
      const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]+)/);
      if (m?.[1]) return `https://www.youtube.com/embed/${m[1]}?playsinline=1&rel=0&modestbranding=1`;
    }
    if (host.includes('vimeo.com')) {
      const m = u.pathname.match(/\/(?:video\/)?(\d+)/);
      if (m?.[1]) return `https://player.vimeo.com/video/${m[1]}?playsinline=1`;
    }
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
      return rawUrl.replace('/play/', '/embed/');
    }
    return null;
  } catch {
    return null;
  }
}

interface ExtractedMediaCandidates {
  directStreams: string[];
  hlsStreams: string[];
  embedUrls: string[];
}

function extractMediaFromHtml(
  html: string,
  baseUrl: string,
  kind: 'video' | 'pdf' | ''
): ExtractedMediaCandidates {
  const directStreams: string[] = [];
  const hlsStreams: string[] = [];
  const embedUrls: string[] = [];
  const decodedHtml = decodeHtmlEntities(html);

  const pushDirect = (raw: string | undefined) => {
    if (!raw) return;
    const resolved = resolveCandidateUrl(raw, baseUrl);
    if (!resolved || resolved === baseUrl) return;
    if (/\.m3u8(\?|$|#)/i.test(resolved)) {
      hlsStreams.push(resolved);
    } else {
      directStreams.push(resolved);
    }
  };

  const pushEmbed = (raw: string | undefined) => {
    if (!raw) return;
    const resolved = resolveCandidateUrl(raw, baseUrl);
    if (!resolved) return;
    const normalizedEmbed = toKnownEmbedUrl(resolved) || resolved;
    embedUrls.push(normalizedEmbed);
  };

  // Meta refresh & JS redirect detection (common on redirect/shortener/download pages)
  const metaRefresh =
    html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'\s;>]+)/i) ||
    html.match(/<meta[^>]+content=["'][^"']*url=([^"'\s;>]+)["'][^>]+http-equiv=["']?refresh["']?/i);
  if (metaRefresh?.[1]) pushDirect(metaRefresh[1]);

  const jsRedirect = decodedHtml.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']|location\.replace\(\s*["']([^"']+)["']\)/i);
  if (jsRedirect?.[1] || jsRedirect?.[2]) {
    pushDirect(jsRedirect[1] || jsRedirect[2]);
  }

  // MediaFire download button & base64 scrambled URL
  const mfBtn =
    html.match(/<a[^>]+id=["']downloadButton["'][^>]+href=["']([^"']+)["']/i) ||
    html.match(/href=["'](https?:\/\/download\d*\.mediafire\.com\/[^"']+)["']/i);
  if (mfBtn?.[1]) pushDirect(mfBtn[1]);

  const scrambledMatch = html.match(/data-scrambled-url=["']([^"']+)["']/i);
  if (scrambledMatch?.[1]) {
    try {
      const decodedUrl = Buffer.from(scrambledMatch[1], 'base64').toString('utf-8');
      if (/^https?:\/\//i.test(decodedUrl)) pushDirect(decodedUrl);
    } catch {
      // Ignore malformed base64
    }
  }

  if (kind === 'pdf') {
    // 1. Academic / Citation / Meta PDF tags
    const metaPdf =
      html.match(/<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_pdf_url["']/i);
    if (metaPdf?.[1]) pushDirect(metaPdf[1]);

    // 2. Explicit .pdf attributes & embeds
    const embedPdfRegex = /<(?:iframe|embed|object)[^>]+(?:src|data)=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = embedPdfRegex.exec(html)) !== null) {
      pushDirect(m[1]);
    }

    // 3. PDF.js viewer.html?file=... or Google gview/viewer?url=...
    const viewerParamRegex = /(?:viewer\.html\?(?:[^"'\s<>]*&)?file=|\/(?:gview|viewer)\?(?:[^"'\s<>]*&)?url=)([^"'\s<>&]+)/gi;
    while ((m = viewerParamRegex.exec(decodedHtml)) !== null) {
      try {
        pushDirect(decodeURIComponent(m[1]));
      } catch {
        pushDirect(m[1]);
      }
    }

    // 4. Data attributes & PDFObject.embed(...)
    const dataPdfRegex = /(?:data-(?:pdf-url|pdf|file|download-url)|PDFObject\.embed\()\s*(?:=\s*)?["']([^"']+)["']/gi;
    while ((m = dataPdfRegex.exec(decodedHtml)) !== null) {
      pushDirect(m[1]);
    }

    // 5. JSON / JS fields commonly used by Dropbox, OneDrive, Drive, CMS & portals
    const jsonPdfRegex = /"(?:@microsoft\.graph\.downloadUrl|@content\.downloadUrl|downloadUrl|download_url|pdfUrl|pdf_url|fileUrl|file_url|documentUrl|attachmentUrl|contentUrl|preview_url)"\s*:\s*"([^"]+)"/gi;
    while ((m = jsonPdfRegex.exec(decodedHtml)) !== null) {
      pushDirect(m[1]);
    }

    // 6. Anchor tags ending in .pdf
    const anchorPdfRegex = /<a[^>]+href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi;
    while ((m = anchorPdfRegex.exec(html)) !== null) {
      pushDirect(m[1]);
    }

    // 7. Embedded <embed>/<object>/<iframe> pointing to PDFs, Drive, Docs, Dropbox, OneDrive, or viewer endpoints without .pdf extension
    const allFrameEmbedRegex = /<(?:embed|object|iframe)[^>]+(?:src|data)=["']([^"']+)["'][^>]*>/gi;
    while ((m = allFrameEmbedRegex.exec(html)) !== null) {
      const fullTag = m[0];
      const target = m[1];
      if (
        /application\/pdf|\.pdf|drive\.google\.com|docs\.google\.com|dropbox\.com|1drv\.ms|onedrive|sharepoint|mediafire|pixeldrain|pdf|viewer|download|file=|doc=/i.test(
          `${fullTag} ${target}`
        )
      ) {
        pushDirect(target);
      }
    }

    // 8. Anchor links pointing to cloud PDF hosts or marked with download/PDF cues
    const allAnchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    while ((m = allAnchorRegex.exec(html)) !== null) {
      const attrs = m[1] || '';
      const inner = (m[2] || '').replace(/<[^>]+>/g, ' ').trim();
      const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
      const href = hrefMatch?.[1];
      if (!href) continue;
      if (
        /drive\.google\.com\/(?:file|open|uc)|docs\.google\.com\/(?:file|document|presentation|spreadsheets)|dropbox\.com|1drv\.ms|onedrive\.live\.com|sharepoint\.com|mediafire\.com|pixeldrain\.com|archive\.org\/download/i.test(href) ||
        /\bdownload\b/i.test(attrs) ||
        /(?:pdf|download|ডাউনলোড|পিডিএফ|নোট|sheet)/i.test(`${attrs} ${inner}`)
      ) {
        pushDirect(href);
      }
    }

    // 9. Raw .pdf URLs (both absolute https://...pdf and quoted relative /...pdf) in unescaped HTML
    const rawPdfUrls = decodedHtml.match(/https?:\/\/[^"'\s<>\\]+\.pdf(?:\?[^"'\s<>\\]*)?/gi) || [];
    for (const u of rawPdfUrls) pushDirect(u);

    const quotedRelPdf = decodedHtml.match(/["'](\/[^"'\s<>]+\.pdf(?:\?[^"'\s<>]*)?)["']/gi) || [];
    for (const q of quotedRelPdf) pushDirect(q.slice(1, -1));

    // 10. Cloud drive/file URLs present inside scripts/text
    const cloudUrlMatches = decodedHtml.match(
      /https?:\/\/(?:drive\.google\.com\/(?:file\/[^\s"'<>]+|open\?[^\s"'<>]+|uc\?[^\s"'<>]+)|docs\.google\.com\/(?:file|document|presentation|spreadsheets)\/[^\s"'<>]+|dl\.dropboxusercontent\.com\/[^\s"'<>]+|www\.dropbox\.com\/[^\s"'<>]+|1drv\.ms\/[^\s"'<>]+)/gi
    ) || [];
    for (const u of cloudUrlMatches) pushDirect(u);
  } else {
    // OpenGraph / Twitter video meta tags
    const metaPatterns = [
      /<meta[^>]+(?:property|name)=["'](?:og:video:secure_url|og:video:url|og:video|twitter:player:stream)["'][^>]+content=["']([^"']+)["']/gi,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:video:secure_url|og:video:url|og:video|twitter:player:stream)["']/gi,
    ];
    for (const rx of metaPatterns) {
      let m: RegExpExecArray | null;
      while ((m = rx.exec(html)) !== null) {
        const cand = resolveCandidateUrl(m[1], baseUrl);
        if (!cand) continue;
        if (toKnownEmbedUrl(cand)) {
          pushEmbed(cand);
        } else {
          pushDirect(cand);
        }
      }
    }

    // HTML5 <video> and <source> tags
    const tagRegex = /<(?:video|source)[^>]+src=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = tagRegex.exec(html)) !== null) {
      pushDirect(m[1]);
    }

    // JSON / JS embedded video fields
    const jsonVideoRegex = /"(?:contentUrl|hd_src|sd_src|hd_src_no_ratelimit|sd_src_no_ratelimit|playable_url_quality_hd|playable_url|videoUrl|video_url|streamUrl|mp4Url|hlsUrl)"\s*:\s*"([^"]+)"/gi;
    while ((m = jsonVideoRegex.exec(decodedHtml)) !== null) {
      const cand = resolveCandidateUrl(m[1], baseUrl);
      if (!cand) continue;
      if (toKnownEmbedUrl(cand)) {
        pushEmbed(cand);
      } else {
        pushDirect(cand);
      }
    }

    // Raw .mp4 / .m3u8 / .webm URLs inside scripts/markup
    const rawMediaMatches = decodedHtml.match(/https?:\/\/[^"'\s<>\\]+\.(?:m3u8|mp4|webm|mov|m4v)(?:\?[^"'\s<>\\]*)?/gi) || [];
    for (const u of rawMediaMatches) pushDirect(u);

    // Embedded player <meta og:video> / twitter:player / <iframe src>
    const twitterPlayer =
      html.match(/<meta[^>]+name=["']twitter:player["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:player["']/i);
    if (twitterPlayer?.[1]) pushEmbed(twitterPlayer[1]);

    const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
    while ((m = iframeRegex.exec(html)) !== null) {
      const src = m[1];
      if (
        toKnownEmbedUrl(resolveCandidateUrl(src, baseUrl) || '') ||
        /player|embed|video|youtube|vimeo|dailymotion|bunny|mediadelivery|streamable|loom|wistia/i.test(src)
      ) {
        pushEmbed(src);
      }
    }
  }

  return {
    directStreams: Array.from(new Set(directStreams)),
    hlsStreams: Array.from(new Set(hlsStreams)),
    embedUrls: Array.from(new Set(embedUrls)),
  };
}

interface ResolvedUpstreamMedia {
  kind: 'stream' | 'hls' | 'embed' | 'error';
  response?: globalThis.Response;
  finalUrl?: string;
  hlsUrl?: string;
  embedUrl?: string;
  previewUrl?: string;
  errorMessage?: string;
  statusCode?: number;
}

async function resolveAndFetchMedia(
  targetUrl: string,
  mediaKind: 'video' | 'pdf' | '',
  rangeHeader?: string,
  depth = 0,
  sharedCookieJar?: Map<string, string>,
  referer?: string,
  visited: Set<string> = new Set()
): Promise<ResolvedUpstreamMedia> {
  if (depth > 4) {
    return {
      kind: 'error',
      statusCode: 422,
      errorMessage:
        mediaKind === 'pdf'
          ? 'এই লিংকে সরাসরি কোনো PDF ফাইল পাওয়া যায়নি।'
          : 'এই লিংক থেকে সরাসরি কোনো ভিডিও খুঁজে পাওয়া যায়নি।',
    };
  }

  const normalized = normalizeTargetUrl(targetUrl);
  if (visited.has(normalized)) {
    return {
      kind: 'error',
      statusCode: 422,
      errorMessage:
        mediaKind === 'pdf'
          ? 'এই লিংকে সরাসরি কোনো PDF ফাইল পাওয়া যায়নি।'
          : 'এই লিংক থেকে সরাসরি কোনো ভিডিও খুঁজে পাওয়া যায়নি।',
    };
  }
  visited.add(normalized);

  const cookieJar = sharedCookieJar || new Map<string, string>();
  const baseHeaders: Record<string, string> = {
    'User-Agent': DEFAULT_BROWSER_UA,
    Accept:
      mediaKind === 'pdf'
        ? 'application/pdf,application/octet-stream,text/html,*/*;q=0.8'
        : '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  if (referer) {
    baseHeaders['Referer'] = referer;
  }
  if (rangeHeader) {
    baseHeaders['Range'] = rangeHeader;
  }

  if (isGoogleDriveFolderUrl(normalized)) {
    return {
      kind: 'error',
      statusCode: 422,
      errorMessage: 'এটি Google Drive ফোল্ডারের লিংক। অনুগ্রহ করে ফোল্ডারের ভেতরের নির্দিষ্ট PDF ফাইলের লিংক কপি করে দিন।',
    };
  }

  const driveInfo = extractGoogleDriveInfo(normalized);
  if (driveInfo) {
    const rkParam = driveInfo.resourceKey
      ? `&resourcekey=${encodeURIComponent(driveInfo.resourceKey)}`
      : '';
    const drivePreviewUrl = `https://drive.google.com/file/d/${driveInfo.id}/preview${driveInfo.resourceKey ? `?resourcekey=${encodeURIComponent(driveInfo.resourceKey)}` : ''}`;

    const driveUrls = [
      `https://drive.usercontent.google.com/download?id=${driveInfo.id}&export=download&confirm=t${rkParam}`,
      `https://drive.google.com/uc?export=download&id=${driveInfo.id}&confirm=t${rkParam}`,
      `https://docs.google.com/uc?export=download&id=${driveInfo.id}&confirm=t${rkParam}`,
    ];

    let blockedByPrivateAuth = false;

    for (const url of driveUrls) {
      let res: globalThis.Response;
      let finalUrl: string;
      try {
        const fetched = await fetchWithCookieJar(url, baseHeaders, cookieJar);
        res = fetched.response;
        finalUrl = fetched.finalUrl;
      } catch {
        continue;
      }

      if (finalUrl.includes('accounts.google.com')) {
        res.body?.cancel().catch(() => {});
        blockedByPrivateAuth = true;
        continue;
      }

      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if ((res.ok || res.status === 206) && !ct.includes('text/html')) {
        if (
          mediaKind === 'pdf' &&
          (ct.includes('wordprocessingml') ||
            ct.includes('presentationml') ||
            ct.includes('spreadsheetml') ||
            ct.includes('msword') ||
            ct.includes('vnd.ms-'))
        ) {
          res.body?.cancel().catch(() => {});
          return {
            kind: 'error',
            statusCode: 422,
            previewUrl: drivePreviewUrl,
            errorMessage: 'ফাইলটি Google Drive ভিউয়ারে প্রদর্শন করা হচ্ছে।',
          };
        }
        return { kind: 'stream', response: res, finalUrl };
      }

      if (ct.includes('text/html')) {
        const html = await readTextLimited(res);
        if (html.trimStart().startsWith('%PDF-')) {
          const refetch = await fetchWithCookieJar(url, baseHeaders, cookieJar);
          return { kind: 'stream', response: refetch.response, finalUrl: refetch.finalUrl };
        }
        const confirmUrl = extractDriveConfirmUrlFromHtml(html, driveInfo.id, driveInfo.resourceKey);
        if (confirmUrl) {
          try {
            const confirmed = await fetchWithCookieJar(confirmUrl, baseHeaders, cookieJar);
            const confirmedCt = (confirmed.response.headers.get('content-type') || '').toLowerCase();
            if ((confirmed.response.ok || confirmed.response.status === 206) && !confirmedCt.includes('text/html')) {
              return { kind: 'stream', response: confirmed.response, finalUrl: confirmed.finalUrl };
            }
            confirmed.response.body?.cancel().catch(() => {});
          } catch {
            // Try next Drive URL
          }
        }
      } else {
        res.body?.cancel().catch(() => {});
      }
    }

    // Inspect Google Drive /view HTML as a fallback (extracts downloadUrl for PDFs or video streams for videos)
    const viewUrl = `https://drive.google.com/file/d/${driveInfo.id}/view${driveInfo.resourceKey ? `?resourcekey=${encodeURIComponent(driveInfo.resourceKey)}` : ''}`;
    try {
      const viewRes = await fetchWithCookieJar(
        viewUrl,
        { 'User-Agent': DEFAULT_BROWSER_UA, Accept: 'text/html,*/*' },
        cookieJar
      );
      if (viewRes.finalUrl.includes('accounts.google.com')) {
        viewRes.response.body?.cancel().catch(() => {});
        blockedByPrivateAuth = true;
      } else {
        const viewHtml = await readTextLimited(viewRes.response);
        if (mediaKind === 'pdf') {
          const dlFromView = extractDriveConfirmUrlFromHtml(viewHtml, driveInfo.id, driveInfo.resourceKey);
          if (dlFromView) {
            try {
              const dlRes = await fetchWithCookieJar(dlFromView, { ...baseHeaders, Referer: viewUrl }, cookieJar);
              const dlCt = (dlRes.response.headers.get('content-type') || '').toLowerCase();
              if ((dlRes.response.ok || dlRes.response.status === 206) && !dlCt.includes('text/html')) {
                return { kind: 'stream', response: dlRes.response, finalUrl: dlRes.finalUrl };
              }
              dlRes.response.body?.cancel().catch(() => {});
            } catch {
              // Fall through to previewUrl fallback
            }
          }
        } else {
          const streamCandidates = extractDriveVideoStreamsFromViewHtml(viewHtml);
          for (const streamUrl of streamCandidates) {
            try {
              const sRes = await fetchWithCookieJar(streamUrl, { ...baseHeaders, Referer: viewUrl }, cookieJar);
              const sCt = (sRes.response.headers.get('content-type') || '').toLowerCase();
              if ((sRes.response.ok || sRes.response.status === 206) && !sCt.includes('text/html')) {
                return { kind: 'stream', response: sRes.response, finalUrl: sRes.finalUrl };
              }
              sRes.response.body?.cancel().catch(() => {});
            } catch {
              // Try next stream quality candidate
            }
          }
        }
      }
    } catch {
      // Ignore view HTML fetch failure and return previewUrl
    }

    return {
      kind: 'error',
      statusCode: 422,
      previewUrl: drivePreviewUrl,
      errorMessage: blockedByPrivateAuth
        ? 'এই Google Drive ফাইলটি প্রাইভেট (Restricted) করা আছে। Google Drive-এ গিয়ে Share → "Anyone with the link" চালু করুন।'
        : mediaKind === 'pdf'
        ? 'Google Drive থেকে সরাসরি PDF ডাউনলোড সীমাবদ্ধ ছিল; ফাইলটি ড্রাইভ ভিউয়ারে প্রদর্শন করা হচ্ছে।'
        : 'Google Drive থেকে ভিডিওটি চালু করা যায়নি। "Anyone with the link" ও ডাউনলোড অনুমতি চালু আছে কিনা দেখুন।',
    };
  }

  // Non-Drive URLs: check if direct video embed first
  if (mediaKind !== 'pdf') {
    const knownEmbed = toKnownEmbedUrl(normalized);
    if (knownEmbed) {
      return { kind: 'embed', embedUrl: knownEmbed, finalUrl: normalized };
    }
  }

  let { response: firstRes, finalUrl } = await fetchWithCookieJar(normalized, baseHeaders, cookieJar);
  if (firstRes.status === 403 || firstRes.status === 406 || firstRes.status === 429 || firstRes.status === 503) {
    firstRes.body?.cancel().catch(() => {});
    const minimalHeaders: Record<string, string> = { Accept: '*/*' };
    if (rangeHeader) minimalHeaders['Range'] = rangeHeader;
    const retry = await fetchWithCookieJar(normalized, minimalHeaders, cookieJar);
    firstRes = retry.response;
    finalUrl = retry.finalUrl;
  }
  if (!firstRes.ok && firstRes.status !== 206) {
    firstRes.body?.cancel().catch(() => {});
    const safeStatus = firstRes.status === 401 || firstRes.status === 403 ? 422 : firstRes.status;
    return {
      kind: 'error',
      statusCode: safeStatus,
      errorMessage:
        firstRes.status === 401 || firstRes.status === 403
          ? 'এই ফাইলটির লিংক প্রাইভেট বা অ্যাক্সেস ব্লক করা (403)। ফাইলটি পাবলিক শেয়ার করা আছে কিনা দেখুন।'
          : `লিংক থেকে ফাইল পাওয়া যায়নি (Status ${firstRes.status})।`,
    };
  }

  const firstCt = (firstRes.headers.get('content-type') || '').toLowerCase();
  if (firstCt.includes('mpegurl') || /\.m3u8(\?|$)/i.test(finalUrl)) {
    firstRes.body?.cancel().catch(() => {});
    return { kind: 'hls', hlsUrl: finalUrl, finalUrl };
  }

  if (!firstCt.includes('text/html')) {
    return { kind: 'stream', response: firstRes, finalUrl };
  }

  // Redirected onto a Drive / Docs / Dropbox / Pixeldrain / GitHub URL after shortlink redirect
  const postRedirectNorm = normalizeTargetUrl(finalUrl);
  if (extractGoogleDriveInfo(postRedirectNorm) || postRedirectNorm !== finalUrl) {
    if (!visited.has(postRedirectNorm)) {
      firstRes.body?.cancel().catch(() => {});
      return resolveAndFetchMedia(postRedirectNorm, mediaKind, rangeHeader, depth + 1, cookieJar, finalUrl, visited);
    }
  }

  // Upstream returned text/html: check if misconfigured server sent raw %PDF- bytes or inspect HTML
  const html = await readTextLimited(firstRes);
  if (mediaKind === 'pdf' && html.trimStart().startsWith('%PDF-')) {
    const refetch = await fetchWithCookieJar(finalUrl, baseHeaders, cookieJar);
    return { kind: 'stream', response: refetch.response, finalUrl: refetch.finalUrl };
  }

  const extracted = extractMediaFromHtml(html, finalUrl, mediaKind);

  // OneDrive / SharePoint direct download fallbacks when HTML wrapper is served
  try {
    const finalParsed = new URL(finalUrl);
    if (finalParsed.hostname.includes('1drv.ms') || finalParsed.hostname.includes('onedrive.live.com')) {
      const shareToken = `u!${Buffer.from(finalUrl, 'utf-8').toString('base64url')}`;
      extracted.directStreams.unshift(`https://api.onedrive.com/v1.0/shares/${shareToken}/root/content`);
      if (finalParsed.hostname.includes('onedrive.live.com') && finalParsed.pathname.includes('/redir')) {
        const dlUrl = new URL(finalUrl);
        dlUrl.pathname = dlUrl.pathname.replace('/redir', '/download');
        dlUrl.searchParams.set('download', '1');
        extracted.directStreams.unshift(dlUrl.toString());
      }
    } else if (finalParsed.hostname.includes('sharepoint.com') && !finalParsed.searchParams.has('download')) {
      const spDl = new URL(finalUrl);
      spDl.searchParams.delete('web');
      spDl.searchParams.set('download', '1');
      extracted.directStreams.unshift(spDl.toString());
    } else if (finalParsed.hostname.includes('dropbox.com')) {
      const dbDl = new URL(finalUrl);
      dbDl.searchParams.delete('raw');
      dbDl.searchParams.set('dl', '1');
      extracted.directStreams.push(dbDl.toString());
    }
  } catch {
    // Ignore URL parse error
  }

  for (const cand of extracted.directStreams.slice(0, 8)) {
    try {
      const subResult = await resolveAndFetchMedia(
        cand,
        mediaKind,
        rangeHeader,
        depth + 1,
        cookieJar,
        finalUrl,
        visited
      );
      if (subResult.kind === 'stream' || subResult.kind === 'hls' || subResult.kind === 'embed') {
        return subResult;
      }
    } catch {
      // Try next candidate
    }
  }

  if (mediaKind !== 'pdf') {
    if (extracted.hlsStreams.length > 0) {
      return { kind: 'hls', hlsUrl: extracted.hlsStreams[0], finalUrl };
    }
    if (extracted.embedUrls.length > 0) {
      return { kind: 'embed', embedUrl: extracted.embedUrls[0], finalUrl };
    }

    // Check if the webpage itself is frameable as a last resort for unknown video sites
    const xfo = (firstRes.headers.get('x-frame-options') || '').toLowerCase();
    const csp = (firstRes.headers.get('content-security-policy') || '').toLowerCase();
    const blocksFrame =
      xfo.includes('deny') ||
      xfo.includes('sameorigin') ||
      /frame-ancestors\s+(?:'none'|'self')/i.test(csp);
    if (!blocksFrame && /<(?:video|iframe|source)\b/i.test(html)) {
      return { kind: 'embed', embedUrl: finalUrl, finalUrl };
    }
  }

  return {
    kind: 'error',
    statusCode: 422,
    errorMessage:
      mediaKind === 'pdf'
        ? 'এই লিংকে সরাসরি কোনো PDF ফাইল পাওয়া যায়নি।'
        : 'এই লিংক থেকে সরাসরি কোনো ভিডিও খুঁজে পাওয়া যায়নি।',
  };
}

let cachedCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getGoogleCerts(): Promise<Record<string, string>> {
  if (cachedCerts && Date.now() < cachedCerts.expiresAt) {
    return cachedCerts.certs;
  }
  const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  const certs = (await res.json()) as Record<string, string>;
  cachedCerts = { certs, expiresAt: Date.now() + maxAgeSec * 1000 };
  return certs;
}

const ADMIN_EMAILS = new Set([
  'noorelahipolok741@gmail.com',
  'ashahinoor87@gmail.com',
  'elahipoloknoor@gmail.com',
  'polokmd741@gmail.com',
  'nurailahi321@gmail.com',
  'sabuzsikder68@gmail.com',
  'sahinura383@gmail.com',
]);

const DEFAULT_VAULT_PASS_HASH = '98fb8dccaa60658f6265b145b339f659e4619181c9342678c788eab81f8a3f71';

async function verifyFirebaseAdminBearer(authHeader: string | undefined): Promise<boolean> {
  try {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
    const token = authHeader.slice(7).trim();
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, sigB64] = parts;
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8')) as {
      alg?: string;
      kid?: string;
    };
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as {
      aud?: string;
      iss?: string;
      exp?: number;
      email?: string;
      email_verified?: boolean;
    };

    if (header.alg !== 'RS256' || !header.kid) return false;
    if (payload.aud !== 'noor-elahi-84e9a') return false;
    if (payload.iss !== 'https://securetoken.google.com/noor-elahi-84e9a') return false;
    if (!payload.exp || Date.now() / 1000 >= payload.exp) return false;
    if (!payload.email || !ADMIN_EMAILS.has(payload.email.toLowerCase()) || payload.email_verified !== true) return false;

    const certs = await getGoogleCerts();
    const cert = certs[header.kid];
    if (!cert) return false;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    return verifier.verify(cert, Buffer.from(sigB64, 'base64url'));
  } catch {
    return false;
  }
}

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '2mb' }));

  // Ensure every device and installed PWA always fetches latest app shell, manifest, Service Worker & API state
  app.use((req, res, next) => {
    const reqPath = req.path;
    if (
      reqPath === '/' ||
      reqPath === '/index.html' ||
      reqPath === '/sw.js' ||
      reqPath === '/manifest.json' ||
      (reqPath.startsWith('/api/') && !reqPath.startsWith('/api/proxy-media'))
    ) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Verify Admin File Vault passcode server-side
  app.post('/api/vault/verify', async (req, res) => {
    const isValidAdmin = await verifyFirebaseAdminBearer(req.headers.authorization);
    if (!isValidAdmin) {
      res.status(403).json({ ok: false, error: 'Forbidden' });
      return;
    }
    const { password } = req.body as { password?: string };
    const clean = (password || '').trim();
    if (!clean) {
      res.status(400).json({ ok: false });
      return;
    }
    const expectedHash = process.env.VAULT_PASSCODE
      ? crypto.createHash('sha256').update(process.env.VAULT_PASSCODE).digest('hex')
      : DEFAULT_VAULT_PASS_HASH;
    const candidateHash = crypto.createHash('sha256').update(clean).digest('hex');
    const matched = crypto.timingSafeEqual(
      Buffer.from(candidateHash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
    res.json({ ok: matched });
  });

  const extractQueryMediaUrl = (req: express.Request): string => {
    const encoded = typeof req.query.u === 'string' ? req.query.u.trim() : '';
    if (encoded) {
      try {
        const decoded = Buffer.from(encoded, 'base64url').toString('utf-8').trim();
        if (decoded) return decoded;
      } catch {
        // Fallback to plain url query param
      }
    }
    return typeof req.query.url === 'string' ? req.query.url.trim() : '';
  };

  // Universal Media Resolver for any video/PDF webpage or direct link
  app.get('/api/resolve-media', async (req, res) => {
    const rawUrl = extractQueryMediaUrl(req);
    const mediaKind = req.query.kind === 'video' ? 'video' : req.query.kind === 'pdf' ? 'pdf' : '';
    if (!rawUrl) {
      res.status(400).json({ type: 'error', error: 'Missing url parameter' });
      return;
    }

    try {
      const normalizedUrl = normalizeTargetUrl(rawUrl);
      await validateExternalUrl(normalizedUrl);

      if (mediaKind !== 'pdf') {
        const knownEmbed = toKnownEmbedUrl(normalizedUrl);
        if (knownEmbed) {
          res.json({ type: 'embed', embedUrl: knownEmbed });
          return;
        }
      }

      const resolved = await resolveAndFetchMedia(normalizedUrl, mediaKind);
      if (resolved.kind === 'stream') {
        resolved.response?.body?.cancel().catch(() => {});
        const targetForProxy = resolved.finalUrl || normalizedUrl;
        const b64 = Buffer.from(targetForProxy, 'utf-8').toString('base64url');
        res.json({
          type: 'direct',
          streamUrl: `/api/proxy-media?u=${encodeURIComponent(b64)}${mediaKind ? `&kind=${mediaKind}` : ''}`,
        });
        return;
      }
      if (resolved.kind === 'hls' && resolved.hlsUrl) {
        const b64 = Buffer.from(resolved.hlsUrl, 'utf-8').toString('base64url');
        res.json({
          type: 'hls',
          hlsUrl: resolved.hlsUrl,
          proxiedHlsUrl: `/api/proxy-hls?u=${encodeURIComponent(b64)}`,
        });
        return;
      }
      if (resolved.kind === 'embed' && resolved.embedUrl) {
        res.json({ type: 'embed', embedUrl: resolved.embedUrl });
        return;
      }

      res.status(resolved.statusCode || 422).json({
        type: 'error',
        error: resolved.errorMessage || 'মিডিয়া লিংকটি ওপেন করা যায়নি।',
      });
    } catch (err) {
      res.status(400).json({
        type: 'error',
        error: err instanceof Error ? err.message : 'Invalid URL',
      });
    }
  });

  // CORS-safe HLS (.m3u8) playlist proxy
  app.get('/api/proxy-hls', async (req, res) => {
    const rawUrl = extractQueryMediaUrl(req);
    if (!rawUrl) {
      res.status(400).json({ error: 'Missing url parameter' });
      return;
    }
    try {
      const normalizedUrl = normalizeTargetUrl(rawUrl);
      const cookieJar = new Map<string, string>();
      const { response: upstream, finalUrl } = await fetchWithCookieJar(
        normalizedUrl,
        { 'User-Agent': DEFAULT_BROWSER_UA, Accept: '*/*' },
        cookieJar
      );
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: `HLS playlist error (${upstream.status})` });
        return;
      }
      const text = await readTextLimited(upstream, 2 * 1024 * 1024);
      const rewritten = text
        .split(/\r?\n/)
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/gi, (_m, uri: string) => {
              const abs = new URL(uri, finalUrl).toString();
              const endpoint = /\.m3u8(\?|$)/i.test(abs) ? '/api/proxy-hls' : '/api/proxy-media';
              const b64 = Buffer.from(abs, 'utf-8').toString('base64url');
              return `URI="${endpoint}?u=${encodeURIComponent(b64)}"`;
            });
          }
          const abs = new URL(trimmed, finalUrl).toString();
          const endpoint = /\.m3u8(\?|$)/i.test(abs) ? '/api/proxy-hls' : '/api/proxy-media';
          const b64 = Buffer.from(abs, 'utf-8').toString('base64url');
          return `${endpoint}?u=${encodeURIComponent(b64)}&kind=video`;
        })
        .join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(rewritten);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'HLS proxy error' });
    }
  });

  // Media Proxy for Google Drive, webpages & CORS-restricted video/PDF links (Range-capable for Plyr + Download progress)
  app.get('/api/proxy-media', async (req, res) => {
    const rawUrl = extractQueryMediaUrl(req);
    const filename = typeof req.query.filename === 'string' ? req.query.filename.replace(/[^\w.\-\u0980-\u09FF ]+/g, '_') : '';
    const forceDownload = req.query.download === '1';
    const mediaKind = req.query.kind === 'video' ? 'video' : req.query.kind === 'pdf' ? 'pdf' : '';

    if (!rawUrl) {
      res.status(400).json({ error: 'Missing url parameter' });
      return;
    }

    try {
      const normalizedUrl = normalizeTargetUrl(rawUrl);
      await validateExternalUrl(normalizedUrl);
      const rangeHeader = req.headers.range;
      const resolved = await resolveAndFetchMedia(normalizedUrl, mediaKind, rangeHeader);

      if (resolved.kind === 'hls' && resolved.hlsUrl) {
        res.status(422).json({
          resolvedType: 'hls',
          resolvedUrl: resolved.hlsUrl,
          error: 'HLS স্ট্রিম পাওয়া গেছে।',
        });
        return;
      }

      if (resolved.kind === 'embed' && resolved.embedUrl) {
        res.status(422).json({
          resolvedType: 'embed',
          resolvedUrl: resolved.embedUrl,
          error: 'এম্বেডেড ভিডিও প্লেয়ার পাওয়া গেছে।',
        });
        return;
      }

      if (resolved.kind !== 'stream' || !resolved.response) {
        const previewUrl = resolved.previewUrl || getDrivePreviewUrl(normalizedUrl);
        res.status(resolved.statusCode || 422).json({
          error: resolved.errorMessage || 'ফাইল পাওয়া যায়নি।',
          ...(previewUrl ? { previewUrl } : {}),
        });
        return;
      }

      const upstream = resolved.response;
      const upstreamType = (upstream.headers.get('content-type') || '').toLowerCase();
      if (upstreamType.includes('text/html')) {
        upstream.body?.cancel().catch(() => {});
        const previewUrl = getDrivePreviewUrl(normalizedUrl);
        res.status(422).json({
          error: 'লিংকটি সরাসরি ভিডিও বা PDF রিটার্ন করেনি।',
          ...(previewUrl ? { previewUrl } : {}),
        });
        return;
      }

      if (!upstream.body) {
        res.status(upstream.status);
        res.end();
        return;
      }

      const reader = upstream.body.getReader();
      let closed = false;
      req.on('close', () => {
        closed = true;
        reader.cancel().catch(() => {});
      });

      const firstRead = await reader.read();
      const firstChunk = firstRead.value;

      let resolvedContentType = upstream.headers.get('content-type') || '';
      if (firstChunk && firstChunk.byteLength > 0) {
        const headText = Buffer.from(firstChunk.subarray(0, Math.min(1024, firstChunk.byteLength))).toString('utf-8').trimStart();
        if (/^<!doctype\s+html|^<html[\s>]/i.test(headText)) {
          reader.cancel().catch(() => {});
          const previewUrl = getDrivePreviewUrl(normalizedUrl);
          res.status(422).json({
            error: 'লিংকটি সরাসরি ভিডিও বা PDF রিটার্ন করেনি।',
            ...(previewUrl ? { previewUrl } : {}),
          });
          return;
        }

        const isPdfMagic = firstChunk.byteLength >= 4 && headText.includes('%PDF-');
        const isGenericMime =
          !resolvedContentType ||
          upstreamType.includes('application/octet-stream') ||
          upstreamType.includes('binary/octet-stream') ||
          upstreamType.includes('application/binary') ||
          upstreamType.includes('application/x-download');

        if (isPdfMagic || (isGenericMime && mediaKind === 'pdf')) {
          resolvedContentType = 'application/pdf';
        } else if (isGenericMime && mediaKind === 'video') {
          const isWebm =
            firstChunk.byteLength >= 4 &&
            firstChunk[0] === 0x1a &&
            firstChunk[1] === 0x45 &&
            firstChunk[2] === 0xdf &&
            firstChunk[3] === 0xa3;
          resolvedContentType = isWebm ? 'video/webm' : 'video/mp4';
        } else if (isGenericMime && firstChunk.byteLength >= 8) {
          const box = Buffer.from(firstChunk.subarray(4, 8)).toString('ascii');
          if (box === 'ftyp') {
            resolvedContentType = 'video/mp4';
          }
        }
      } else if (!resolvedContentType && mediaKind) {
        resolvedContentType = mediaKind === 'pdf' ? 'application/pdf' : 'video/mp4';
      }

      res.status(upstream.status);
      if (resolvedContentType) {
        res.setHeader('Content-Type', resolvedContentType);
      }

      const passthroughHeaders = [
        'content-length',
        'content-range',
        'accept-ranges',
        'etag',
        'last-modified',
      ];
      for (const h of passthroughHeaders) {
        const val = upstream.headers.get(h);
        if (val) res.setHeader(h, val);
      }
      if (!upstream.headers.get('accept-ranges')) {
        res.setHeader('Accept-Ranges', 'bytes');
      }
      if (forceDownload && filename) {
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      } else {
        res.setHeader('Content-Disposition', 'inline');
      }
      res.setHeader('Cache-Control', 'public, max-age=3600');

      const writeChunkWithBackpressure = async (chunk: Uint8Array) => {
        if (!chunk || res.writableEnded || closed) return;
        const canContinue = res.write(Buffer.from(chunk));
        if (!canContinue && !closed) {
          await new Promise<void>((resolve) => {
            const onDrain = () => {
              res.off('close', onClose);
              resolve();
            };
            const onClose = () => {
              res.off('drain', onDrain);
              resolve();
            };
            res.once('drain', onDrain);
            res.once('close', onClose);
          });
        }
      };

      if (firstChunk && firstChunk.byteLength > 0) {
        await writeChunkWithBackpressure(firstChunk);
      }

      while (!closed && !firstRead.done) {
        const { done, value } = await reader.read();
        if (done || closed) break;
        if (value) {
          await writeChunkWithBackpressure(value);
        }
      }
      if (!res.writableEnded) {
        res.end();
      }
    } catch (err) {
      if (!res.headersSent) {
        const msg = err instanceof Error ? err.message : 'Proxy error';
        res.status(400).json({ error: msg });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  // Mobile Number Authentication (Register / Sign In)
  app.post('/api/number-auth/login', (req, res) => {
    const { phone, password, name, photoUrl } = req.body as {
      phone?: string;
      password?: string;
      name?: string;
      photoUrl?: string;
    };

    const cleanPhone = (phone || '').trim();
    const cleanPass = (password || '').trim();
    const cleanName = (name || '').trim();

    if (!cleanPhone || cleanPhone.length < 6 || cleanPhone.length > 24) {
      res.status(400).json({ error: 'সঠিক মোবাইল নাম্বার দিন।' });
      return;
    }
    if (!cleanPass || cleanPass.length < 4 || cleanPass.length > 100) {
      res.status(400).json({ error: 'পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে।' });
      return;
    }

    const store = ensureStore();
    const existing = store.numberUsers[cleanPhone];
    const now = new Date().toISOString();

    if (existing) {
      if (!verifyPassword(cleanPass, existing.passwordSalt, existing.passwordHash)) {
        res.status(401).json({ error: 'ভুল পাসওয়ার্ড দিয়েছেন।' });
        return;
      }
      if (cleanName && cleanName !== existing.name) {
        existing.name = cleanName.slice(0, 100);
      }
      if (typeof photoUrl === 'string' && photoUrl.length > 0 && photoUrl.length <= 65000) {
        existing.photoUrl = photoUrl;
      }
      existing.updatedAt = now;
      saveStore(store);

      const token = signToken({ uid: existing.uid, phone: existing.phone, exp: Date.now() + 30 * 86400_000 });
      res.json({
        token,
        user: {
          uid: existing.uid,
          phone: existing.phone,
          name: existing.name,
          email: existing.email,
          photoUrl: existing.photoUrl,
          role: 'student',
        },
      });
      return;
    }

    if (!cleanName) {
      res.status(400).json({ error: 'অনুগ্রহ করে আপনার নাম লিখুন।' });
      return;
    }

    const uid = `num_${crypto.createHash('sha256').update(cleanPhone).digest('hex').slice(0, 20)}`;
    const { salt, hash } = hashPassword(cleanPass);
    const created: StoredNumberUser = {
      uid,
      phone: cleanPhone,
      name: cleanName.slice(0, 100),
      email: '',
      photoUrl: typeof photoUrl === 'string' && photoUrl.length <= 65000 ? photoUrl : '',
      passwordSalt: salt,
      passwordHash: hash,
      createdAt: now,
      updatedAt: now,
    };
    store.numberUsers[cleanPhone] = created;
    saveStore(store);

    const token = signToken({ uid: created.uid, phone: created.phone, exp: Date.now() + 30 * 86400_000 });
    res.json({
      token,
      user: {
        uid: created.uid,
        phone: created.phone,
        name: created.name,
        email: created.email,
        photoUrl: created.photoUrl,
        role: 'student',
      },
    });
  });

  // Update Number User Profile / Password
  app.post('/api/number-auth/update', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const session = verifyToken(token);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, photoUrl, newPassword } = req.body as {
      name?: string;
      photoUrl?: string;
      newPassword?: string;
    };

    const store = ensureStore();
    const user = store.numberUsers[session.phone];
    if (!user || user.uid !== session.uid) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (typeof name === 'string' && name.trim().length > 0) {
      user.name = name.trim().slice(0, 100);
    }
    if (typeof photoUrl === 'string' && photoUrl.length <= 65000) {
      user.photoUrl = photoUrl;
    }
    if (typeof newPassword === 'string' && newPassword.trim().length >= 4) {
      const cleanNew = newPassword.trim().slice(0, 100);
      const { salt, hash } = hashPassword(cleanNew);
      user.passwordSalt = salt;
      user.passwordHash = hash;
      store.inbox.unshift({
        id: `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        uid: user.uid,
        type: 'password_change',
        senderName: user.name,
        senderEmail: user.email || user.phone,
        senderPhone: user.phone,
        newPassword: cleanNew,
        message: `${user.name} (${user.phone}) পাসওয়ার্ড পরিবর্তন করেছেন।`,
        createdAt: new Date().toISOString(),
      });
    }
    user.updatedAt = new Date().toISOString();
    saveStore(store);

    res.json({
      user: {
        uid: user.uid,
        phone: user.phone,
        name: user.name,
        email: user.email,
        photoUrl: user.photoUrl,
        role: 'student',
      },
    });
  });

  const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

  function getServerNotifCreatedAtMs(item: Record<string, unknown>): number {
    if (typeof item.createdAtMs === 'number' && Number.isFinite(item.createdAtMs) && item.createdAtMs > 0) {
      return item.createdAtMs;
    }
    if (typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) && item.createdAt > 0) {
      return item.createdAt;
    }
    if (typeof item.createdAt === 'string' && item.createdAt.trim()) {
      const parsed = Date.parse(item.createdAt);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    if (typeof item.id === 'string') {
      const m = item.id.match(/^notif_(\d{10,15})/);
      if (m?.[1]) {
        const ts = Number(m[1]);
        if (Number.isFinite(ts) && ts > 0) return ts;
      }
    }
    return 0;
  }

  function pruneExpiredServerNotifications(
    list: Array<Record<string, unknown>>,
    now = Date.now()
  ): Array<Record<string, unknown>> {
    const dedup = new Map<string, Record<string, unknown>>();
    for (const raw of list) {
      if (!raw || typeof raw !== 'object' || raw.isActive === false) continue;
      const id = typeof raw.id === 'string' ? raw.id : '';
      if (!id) continue;
      const createdAtMs = getServerNotifCreatedAtMs(raw);
      if (createdAtMs <= 0 || now - createdAtMs >= NOTIFICATION_TTL_MS) continue;
      dedup.set(id, {
        ...raw,
        createdAtMs,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(createdAtMs).toISOString(),
      });
    }
    return Array.from(dedup.values())
      .sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0))
      .slice(0, 40);
  }

  // Catalog mirror so Number-login users and offline caches stay synced with Admin's Vault saves
  app.get('/api/catalog', (_req, res) => {
    const store = ensureStore();
    const pruned = pruneExpiredServerNotifications(store.notifications || []);
    if (pruned.length !== (store.notifications || []).length) {
      store.notifications = pruned;
      saveStore(store);
    }
    res.json({
      subjects: store.subjects,
      notifications: pruned,
    });
  });

  app.post('/api/catalog/sync', async (req, res) => {
    const isValidAdmin = await verifyFirebaseAdminBearer(req.headers.authorization);
    if (!isValidAdmin) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const {
      subject,
      subjectsMap,
      notification,
      notifications,
      notificationsList,
    } = req.body as {
      subject?: { id: string } & Record<string, unknown>;
      subjectsMap?: Record<string, { id: string } & Record<string, unknown>>;
      notification?: Record<string, unknown>;
      notifications?: Array<Record<string, unknown>>;
      notificationsList?: Array<Record<string, unknown>>;
    };

    const store = ensureStore();
    if (subjectsMap && typeof subjectsMap === 'object') {
      store.subjects = { ...store.subjects, ...subjectsMap };
    }
    if (subject && typeof subject.id === 'string') {
      store.subjects[subject.id] = subject;
    }

    const now = Date.now();
    if (Array.isArray(notificationsList)) {
      store.notifications = pruneExpiredServerNotifications(notificationsList, now);
    } else {
      const incomingNotifs: Array<Record<string, unknown>> = [];
      if (Array.isArray(notifications)) {
        incomingNotifs.push(...notifications);
      }
      if (notification) {
        incomingNotifs.push(notification);
      }
      const stamped = incomingNotifs.map((n) => {
        const ts = getServerNotifCreatedAtMs(n) || now;
        return {
          ...n,
          createdAtMs: ts,
          createdAt: typeof n.createdAt === 'string' ? n.createdAt : new Date(ts).toISOString(),
        };
      });
      store.notifications = pruneExpiredServerNotifications(
        [...stamped, ...(store.notifications || [])],
        now
      );
    }

    saveStore(store);
    res.json({ ok: true });
  });

  // Number-user progress & downloads sync
  app.get('/api/number-user/state', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const session = verifyToken(token);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const store = ensureStore();
    res.json({
      progress: store.progress[session.uid] || {},
      downloads: store.downloads[session.uid] || {},
    });
  });

  app.post('/api/number-user/state', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const session = verifyToken(token);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { progressItem, downloadItem, removeDownloadId } = req.body as {
      progressItem?: { itemId: string } & Record<string, unknown>;
      downloadItem?: { itemId: string } & Record<string, unknown>;
      removeDownloadId?: string;
    };
    const store = ensureStore();
    if (!store.progress[session.uid]) store.progress[session.uid] = {};
    if (!store.downloads[session.uid]) store.downloads[session.uid] = {};

    if (progressItem?.itemId) {
      store.progress[session.uid][progressItem.itemId] = progressItem;
    }
    if (downloadItem?.itemId) {
      store.downloads[session.uid][downloadItem.itemId] = downloadItem;
    }
    if (removeDownloadId) {
      delete store.downloads[session.uid][removeDownloadId];
    }
    saveStore(store);
    res.json({ ok: true });
  });

  // Inbox sync for Number users + Admin read/delete
  app.post('/api/inbox/report', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const session = verifyToken(token);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { message } = req.body as { message?: string };
    const cleanMsg = (message || '').trim();
    if (!cleanMsg) {
      res.status(400).json({ error: 'সমস্যার বিবরণ লিখুন।' });
      return;
    }
    const store = ensureStore();
    const user = store.numberUsers[session.phone];
    store.inbox.unshift({
      id: `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      uid: session.uid,
      type: 'issue_report',
      senderName: user?.name || session.phone,
      senderEmail: user?.email || '',
      senderPhone: session.phone,
      newPassword: '',
      message: cleanMsg.slice(0, 2000),
      createdAt: new Date().toISOString(),
    });
    saveStore(store);
    res.json({ ok: true });
  });

  app.post('/api/inbox/guest-report', (req, res) => {
    const { senderName, message } = req.body as { senderName?: string; message?: string };
    const cleanMsg = (message || '').trim();
    const cleanName = (senderName || 'অতিথি ইউজার').trim().slice(0, 100);
    if (!cleanMsg || cleanMsg.length < 3) {
      res.status(400).json({ error: 'সমস্যার বিবরণ লিখুন।' });
      return;
    }
    const store = ensureStore();
    store.inbox.unshift({
      id: `guest_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      uid: 'guest',
      type: 'issue_report',
      senderName: cleanName,
      senderEmail: '',
      senderPhone: '',
      newPassword: '',
      message: cleanMsg.slice(0, 2000),
      createdAt: new Date().toISOString(),
    });
    saveStore(store);
    res.json({ ok: true });
  });

  app.get('/api/inbox/admin', async (req, res) => {
    const isValidAdmin = await verifyFirebaseAdminBearer(req.headers.authorization);
    if (!isValidAdmin) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const store = ensureStore();
    res.json({ items: store.inbox });
  });

  app.delete('/api/inbox/admin/:id', async (req, res) => {
    const isValidAdmin = await verifyFirebaseAdminBearer(req.headers.authorization);
    if (!isValidAdmin) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const store = ensureStore();
    store.inbox = store.inbox.filter((m) => m.id !== req.params.id);
    saveStore(store);
    res.json({ ok: true });
  });

  // Serve PDF.js static fonts, CMaps, WASM, and worker directly so SPA fallback never returns HTML for binary assets
  const publicPdfjsDir = path.resolve(process.cwd(), 'public/pdfjs');
  if (fs.existsSync(publicPdfjsDir)) {
    app.use(
      '/pdfjs',
      express.static(publicPdfjsDir, { maxAge: '1h' }),
      (_req, res) => {
        res.status(404).end();
      }
    );
  }

  // Vite Dev Middleware or Static Production Serve
  if (process.env.NODE_ENV !== 'production') {
    const publicDir = path.resolve(process.cwd(), 'public');
    app.get('/pdf.worker.min.mjs', (_req, res) => {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.sendFile(path.join(publicDir, 'pdf.worker.min.mjs'));
    });
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distDir, {
        setHeaders(res, filePath) {
          const normalizedPath = filePath.replace(/\\/g, '/');
          if (
            normalizedPath.endsWith('/index.html') ||
            normalizedPath.endsWith('/sw.js') ||
            normalizedPath.endsWith('/manifest.json')
          ) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          } else if (normalizedPath.includes('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NOOR ELAHI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
