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
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

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
    return JSON.parse(raw) as StoreData;
  } catch {
    return {
      numberUsers: {},
      subjects: {},
      notifications: [],
      inbox: [],
      progress: {},
      downloads: {},
    };
  }
}

function saveStore(data: StoreData) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
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
    const norm = ip.toLowerCase();
    if (norm === '::1' || norm.startsWith('fe80:') || norm.startsWith('fc') || norm.startsWith('fd')) {
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

function extractGoogleDriveId(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    if (
      !u.hostname.includes('drive.google.com') &&
      !u.hostname.includes('docs.google.com') &&
      !u.hostname.includes('drive.usercontent.google.com')
    ) {
      return null;
    }
    const pathMatch =
      u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
      u.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (pathMatch?.[1]) return pathMatch[1];
    const idParam = u.searchParams.get('id');
    if (idParam && /^[a-zA-Z0-9_-]+$/.test(idParam)) return idParam;
    return null;
  } catch {
    return null;
  }
}

async function fetchMediaWithDriveBypass(
  targetUrl: string,
  rangeHeader?: string
): Promise<globalThis.Response> {
  const driveId = extractGoogleDriveId(targetUrl);
  const fetchHeaders: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  };
  if (rangeHeader) {
    fetchHeaders['Range'] = rangeHeader;
  }

  if (!driveId) {
    return fetch(targetUrl, { headers: fetchHeaders, redirect: 'follow' });
  }

  const directUrl = `https://drive.usercontent.google.com/download?id=${driveId}&export=download&confirm=t`;
  let res = await fetch(directUrl, { headers: fetchHeaders, redirect: 'follow' });
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('text/html')) {
    const html = await res.text();
    const params = new URLSearchParams();
    params.set('id', driveId);
    params.set('export', 'download');

    // Extract all hidden inputs from Drive virus-scan warning form
    const inputRegex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
    const inputs = html.match(inputRegex) || [];
    for (const tag of inputs) {
      const nameMatch = tag.match(/name=["']([^"']+)["']/i);
      const valMatch = tag.match(/value=["']([^"']*)["']/i);
      if (nameMatch?.[1] && valMatch?.[1] !== undefined) {
        params.set(nameMatch[1], valMatch[1]);
      }
    }

    if (!params.has('confirm')) {
      const confirmMatch =
        html.match(/name="confirm"\s+value="([^"]+)"/) ||
        html.match(/confirm=([0-9A-Za-z_-]+)/);
      params.set('confirm', confirmMatch?.[1] || 't');
    }

    const setCookieHeader = res.headers.get('set-cookie');
    const bypassHeaders: Record<string, string> = { ...fetchHeaders };
    if (setCookieHeader) {
      bypassHeaders['Cookie'] = setCookieHeader
        .split(',')
        .map((c) => c.split(';')[0]?.trim())
        .filter(Boolean)
        .join('; ');
    }

    const bypassUrl = `https://drive.usercontent.google.com/download?${params.toString()}`;
    res = await fetch(bypassUrl, { headers: bypassHeaders, redirect: 'follow' });
  }

  return res;
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

  // Media Proxy for Google Drive & CORS-restricted video/PDF links (Range-capable for Plyr + Download progress)
  app.get('/api/proxy-media', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    const filename = typeof req.query.filename === 'string' ? req.query.filename.replace(/[^\w.\-\u0980-\u09FF ]+/g, '_') : '';
    const forceDownload = req.query.download === '1';

    if (!rawUrl) {
      res.status(400).json({ error: 'Missing url parameter' });
      return;
    }

    try {
      await validateExternalUrl(rawUrl);
      const rangeHeader = req.headers.range;
      const upstream = await fetchMediaWithDriveBypass(rawUrl, rangeHeader);

      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).json({ error: `ফাইল পাওয়া যায়নি (${upstream.status})` });
        return;
      }

      const upstreamType = (upstream.headers.get('content-type') || '').toLowerCase();
      if (upstreamType.includes('text/html')) {
        res.status(422).json({
          error: 'লিংকটি পাবলিক বা সরাসরি ডাউনলোডযোগ্য নয় (Google Drive হলে "Anyone with the link" চালু করুন)।',
        });
        return;
      }

      res.status(upstream.status);
      const passthroughHeaders = [
        'content-type',
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
      }
      res.setHeader('Cache-Control', 'public, max-age=3600');

      if (!upstream.body) {
        res.end();
        return;
      }

      const reader = upstream.body.getReader();
      let closed = false;
      req.on('close', () => {
        closed = true;
        reader.cancel().catch(() => {});
      });

      while (!closed) {
        const { done, value } = await reader.read();
        if (done || closed) break;
        if (value && !res.writableEnded) {
          res.write(Buffer.from(value));
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

  // Catalog mirror so Number-login users and offline caches stay synced with Admin's Vault saves
  app.get('/api/catalog', (_req, res) => {
    const store = ensureStore();
    res.json({
      subjects: store.subjects,
      notifications: store.notifications,
    });
  });

  app.post('/api/catalog/sync', async (req, res) => {
    const isValidAdmin = await verifyFirebaseAdminBearer(req.headers.authorization);
    if (!isValidAdmin) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { subject, notification } = req.body as {
      subject?: { id: string } & Record<string, unknown>;
      notification?: Record<string, unknown>;
    };
    const store = ensureStore();
    if (subject && typeof subject.id === 'string') {
      store.subjects[subject.id] = subject;
    }
    if (notification) {
      store.notifications.unshift(notification);
      store.notifications = store.notifications.slice(0, 40);
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

  // Vite Dev Middleware or Static Production Serve
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NOOR ELAHI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
