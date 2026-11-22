import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, Check, Chrome, Copy, Lock, Phone, User, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface AuthSuitcaseScreenProps {
  onGoogleLogin: (prefill: { name: string; password: string; photoUrl: string }) => Promise<void>;
  onNumberLogin: (payload: {
    phone: string;
    password: string;
    name: string;
    photoUrl: string;
  }) => Promise<void>;
  authLoading: boolean;
  authError: string;
  unauthorizedDomain?: string;
}

const SAVED_PROFILE_HINT_KEY = 'noor_elahi_login_hint_v1';

async function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 180;
        let w = img.width;
        let h = img.height;
        if (w > h) {
          if (w > maxDim) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          }
        } else if (h > maxDim) {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve('');
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => reject(new Error('Image load error'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsDataURL(file);
  });
}

export const AuthSuitcaseScreen: React.FC<AuthSuitcaseScreenProps> = ({
  onGoogleLogin,
  onNumberLogin,
  authLoading,
  authError,
  unauthorizedDomain,
}) => {
  const isOnline = useOnlineStatus();
  const [suitcaseOpen, setSuitcaseOpen] = useState(true);
  const [showNumberForm, setShowNumberForm] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [copiedDomain, setCopiedDomain] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSuitcaseOpen(true), 600);
    try {
      const raw = localStorage.getItem(SAVED_PROFILE_HINT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { name?: string; phone?: string; photoUrl?: string };
        if (parsed.name) setName(parsed.name);
        if (parsed.phone) setPhone(parsed.phone);
        if (parsed.photoUrl) setPhotoUrl(parsed.photoUrl);
      }
    } catch {
      // Ignore parse failure
    }
    return () => clearTimeout(timer);
  }, []);

  const persistHint = () => {
    try {
      localStorage.setItem(
        SAVED_PROFILE_HINT_KEY,
        JSON.stringify({ name: name.trim(), phone: phone.trim(), photoUrl })
      );
    } catch {
      // Ignore quota error
    }
  };

  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageToDataUrl(file);
      setPhotoUrl(compressed);
    } catch {
      // Ignore invalid image
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-[#020617] text-slate-100 overflow-y-auto overflow-x-hidden overscroll-none flex flex-col items-center justify-center p-4 sm:p-6 relative">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.14),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(6,182,212,0.10),_transparent_55%)]" />

      <div className="relative z-10 w-full max-w-md space-y-5 my-auto">
        {!isOnline && (
          <div className="rounded-2xl bg-amber-500/15 border border-amber-500/35 px-3.5 py-2.5 flex items-center justify-center gap-2 text-xs font-medium text-amber-200">
            <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
            <span>আপনি অফলাইনে আছেন · প্রথমবার লগইন করতে ইন্টারনেট সংযোগ চালু করুন</span>
          </div>
        )}
        {/* Brand Header with Uploaded NOOR ELAHI Logo */}
        <div className="text-center space-y-1.5">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white border border-emerald-500/30 shadow-xl shadow-emerald-500/10 overflow-hidden mb-1">
            <img src="/icon-192.png" alt="NOOR ELAHI" className="w-full h-full object-contain" />
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            NOOR ELAHI
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            স্মার্ট ডিজিটাল লার্নিং প্ল্যাটফর্ম
          </p>
        </div>

        {/* Animated Suitcase Character & Light Reveal */}
        <div className="relative flex flex-col items-center justify-center pt-1">
          <motion.div
            initial={{ x: -60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex flex-col items-center"
          >
            <AnimatePresence>
              {suitcaseOpen && (
                <motion.div
                  initial={{ opacity: 0, scaleY: 0.2 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  style={{ transformOrigin: 'bottom center' }}
                  className="pointer-events-none -mb-4 w-64 h-20 bg-gradient-to-t from-emerald-400/30 via-cyan-400/10 to-transparent blur-md rounded-t-full"
                />
              )}
            </AnimatePresence>

            <button
              type="button"
              onClick={() => setSuitcaseOpen((v) => !v)}
              className="group relative flex items-end justify-center focus:outline-none"
              aria-label="স্যুটকেস খুলুন"
            >
              <svg width="160" height="92" viewBox="0 0 160 92" fill="none" className="drop-shadow-lg">
                <circle cx="34" cy="24" r="10" fill="#38BDF8" fillOpacity="0.9" />
                <path
                  d="M18 58C18 45 25 38 34 38C43 38 50 45 50 58V78H18V58Z"
                  fill="#0F172A"
                  stroke="#38BDF8"
                  strokeWidth="2"
                />
                <motion.path
                  d="M46 48L68 54"
                  stroke="#38BDF8"
                  strokeWidth="4"
                  strokeLinecap="round"
                  animate={{ rotate: suitcaseOpen ? -8 : 0 }}
                />

                <rect
                  x="64"
                  y="48"
                  width="74"
                  height="34"
                  rx="7"
                  fill="#0F172A"
                  stroke="#10B981"
                  strokeWidth="2.2"
                />
                <rect x="92" y="48" width="18" height="7" rx="2" fill="#10B981" />

                <motion.rect
                  x="69"
                  y="44"
                  width="64"
                  height="6"
                  rx="3"
                  fill="#34D399"
                  animate={{ opacity: suitcaseOpen ? 0.95 : 0 }}
                  transition={{ duration: 0.35 }}
                />

                <motion.g
                  style={{ transformOrigin: '64px 48px' }}
                  animate={{ rotate: suitcaseOpen ? -28 : 0 }}
                  transition={{ type: 'spring', stiffness: 180, damping: 16 }}
                >
                  <path
                    d="M64 48C64 42 68 38 74 38H128C134 38 138 42 138 48H64Z"
                    fill="#1E293B"
                    stroke="#34D399"
                    strokeWidth="2.2"
                  />
                  <path
                    d="M93 38V33C93 31 95 29 97 29H105C107 29 109 31 109 33V38"
                    stroke="#34D399"
                    strokeWidth="2.2"
                  />
                </motion.g>
              </svg>
            </button>
          </motion.div>
        </div>

        {/* Main Auth Card Emerging from Suitcase Light */}
        <motion.div
          initial={false}
          animate={
            suitcaseOpen
              ? { opacity: 1, y: 0, scale: 1 }
              : { opacity: 0.75, y: 8, scale: 0.98 }
          }
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-3xl bg-slate-900/90 backdrop-blur-xl border border-slate-800 p-5 sm:p-6 shadow-2xl space-y-5"
        >
          {/* Profile Photo & Name Setup Row */}
          <div className="flex items-center gap-4">
            <label className="relative w-16 h-16 rounded-2xl bg-slate-950 border border-slate-700 hover:border-emerald-400/60 flex items-center justify-center cursor-pointer overflow-hidden shrink-0 transition">
              {photoUrl ? (
                <img src={photoUrl} alt="প্রোফাইল ছবি" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-1 text-slate-400">
                  <Camera className="w-5 h-5 text-emerald-400" />
                  <span className="text-[10px]">ছবি</span>
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoPick}
                className="hidden"
              />
            </label>

            <div className="flex-1 space-y-2">
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="আপনার নাম লিখুন"
                  className="w-full h-11 pl-9 pr-3 rounded-xl bg-slate-950 border border-slate-800 focus:border-emerald-500/60 text-sm text-white placeholder:text-slate-500 outline-none transition"
                />
              </div>
              <p className="text-[11px] text-slate-400">
                নাম ও ছবি আপনার প্রোফাইলে প্রদর্শিত হবে
              </p>
            </div>
          </div>

          {/* Password Box with Required Warning Caption */}
          <div className="space-y-1.5">
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="পাসওয়ার্ড লিখুন"
                autoComplete="current-password"
                className="w-full h-11 pl-10 pr-3 rounded-xl bg-slate-950 border border-slate-800 focus:border-emerald-500/60 text-sm text-white placeholder:text-slate-500 outline-none transition"
              />
            </div>
            <p className="text-[11px] text-amber-300/90 pl-1">
              পাসওয়ার্ডটি গোপন রাখুন
            </p>
          </div>

          {/* Mobile Number Field when Sign in with Number is active */}
          <AnimatePresence>
            {showNumberForm && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden space-y-3"
              >
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="মোবাইল নাম্বার (যেমন: 017XXXXXXXX)"
                    autoComplete="tel"
                    className="w-full h-11 pl-10 pr-3 rounded-xl bg-slate-950 border border-cyan-500/40 focus:border-cyan-400 text-sm text-white placeholder:text-slate-500 outline-none transition"
                  />
                </div>
                <button
                  type="button"
                  disabled={authLoading}
                  onClick={() => {
                    persistHint();
                    onNumberLogin({ phone, password, name, photoUrl });
                  }}
                  className="w-full h-12 rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 text-slate-950 font-bold text-sm shadow-lg shadow-cyan-500/20 active:scale-[0.98] transition disabled:opacity-60"
                >
                  {authLoading ? 'প্রবেশ করা হচ্ছে...' : 'নাম্বার দিয়ে প্রবেশ করুন'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {authError && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3.5 py-2.5 text-xs text-rose-200 space-y-2">
              <p className="leading-relaxed">{authError}</p>
              {unauthorizedDomain && (
                <div className="rounded-lg bg-slate-950/90 border border-slate-800 p-2.5 space-y-2 text-[11px] text-slate-300">
                  <div className="flex items-center justify-between gap-2">
                    <code className="font-mono-num text-emerald-300 truncate">
                      {unauthorizedDomain}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(unauthorizedDomain).then(() => {
                          setCopiedDomain(true);
                          window.setTimeout(() => setCopiedDomain(false), 2000);
                        }).catch(() => {});
                      }}
                      className="shrink-0 inline-flex items-center gap-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-1 text-[10px] font-semibold text-emerald-300"
                    >
                      {copiedDomain ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedDomain ? 'কপি হয়েছে' : 'কপি'}</span>
                    </button>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Firebase Console → Authentication → Settings → Authorized domains এ এই ডোমেইনটি যোগ করলে পুনরায় আপডেট ছাড়াই Google লগইন চালু হবে।
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Two Floating Login Options */}
          <div className="grid grid-cols-1 gap-3 pt-1">
            <button
              type="button"
              disabled={authLoading}
              onClick={() => {
                persistHint();
                onGoogleLogin({ name, password, photoUrl });
              }}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition disabled:opacity-60"
            >
              <Chrome className="w-4 h-4 shrink-0" />
              <span>সাইন ইন উইথ গুগল</span>
            </button>

            <button
              type="button"
              disabled={authLoading}
              onClick={() => setShowNumberForm((v) => !v)}
              className="w-full h-12 rounded-2xl bg-slate-950 border border-slate-700 hover:border-cyan-500/50 text-slate-100 font-semibold text-sm flex items-center justify-center gap-2.5 active:scale-[0.98] transition"
            >
              <Phone className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>{showNumberForm ? 'নাম্বার বক্স লুকান' : 'সাইন ইন উইথ নাম্বার'}</span>
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
