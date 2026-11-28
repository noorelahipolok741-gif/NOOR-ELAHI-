import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, Camera, Check, Copy, Eye, EyeOff, Lock, Phone, User, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useBackOverlay } from '../hooks/useBackHandler';

interface AuthSuitcaseScreenProps {
  onGoogleLogin: (prefill: { name: string; password: string; photoUrl: string }) => Promise<void>;
  onNumberLogin: (payload: {
    phone: string;
    password: string;
    name: string;
    photoUrl: string;
  }) => Promise<void>;
  onOpenReportModal?: () => void;
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

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}

export const AuthSuitcaseScreen: React.FC<AuthSuitcaseScreenProps> = ({
  onGoogleLogin,
  onNumberLogin,
  onOpenReportModal,
  authLoading,
  authError,
  unauthorizedDomain,
}) => {
  const isOnline = useOnlineStatus();
  const [showNumberForm, setShowNumberForm] = useState(false);
  useBackOverlay(showNumberForm, () => setShowNumberForm(false), 'auth-number-form');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [photoUrl, setPhotoUrl] = useState('');
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [formHintError, setFormHintError] = useState('');

  useEffect(() => {
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
  }, []);

  const persistHint = () => {
    try {
      localStorage.setItem(
        SAVED_PROFILE_HINT_KEY,
        JSON.stringify({ name: name.trim(), phone: phone.trim(), photoUrl })
      );
      localStorage.setItem(
        'noor_elahi_pending_google_prefill',
        JSON.stringify({ name: name.trim(), password, photoUrl })
      );
    } catch {
      // Ignore quota error
    }
  };

  const handleSaveProfileSetup = () => {
    setFormHintError('');
    const cleanName = name.trim();
    const cleanPass = password.trim();
    if (!cleanName) {
      setProfileSaved(false);
      setFormHintError('অনুগ্রহ করে প্রথমে আপনার নাম লিখুন।');
      return;
    }
    if (!cleanPass || cleanPass.length < 4) {
      setProfileSaved(false);
      setFormHintError('কমপক্ষে ৪ অক্ষরের পাসওয়ার্ড লিখে তারপর সেভ করুন।');
      return;
    }
    persistHint();
    setProfileSaved(true);
  };

  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageToDataUrl(file);
      setPhotoUrl(compressed);
      setProfileSaved(false);
    } catch {
      // Ignore invalid image
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-[#020617] text-slate-100 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y pwa-scroll-container px-4 py-6 sm:p-6 relative">
      {/* Moving Blurred Google RGB Ambient Light Backdrop */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="rgb-orb-blue absolute -top-24 -left-24 w-80 h-80 sm:w-[26rem] sm:h-[26rem] rounded-full blur-[96px]"
          style={{ background: 'radial-gradient(circle, rgba(66,133,244,0.48) 0%, rgba(66,133,244,0) 70%)' }}
        />
        <div
          className="rgb-orb-red absolute top-1/4 -right-28 w-80 h-80 sm:w-[25rem] sm:h-[25rem] rounded-full blur-[100px]"
          style={{ background: 'radial-gradient(circle, rgba(234,67,53,0.42) 0%, rgba(234,67,53,0) 70%)' }}
        />
        <div
          className="rgb-orb-yellow absolute bottom-12 -left-20 w-72 h-72 sm:w-[22rem] sm:h-[22rem] rounded-full blur-[96px]"
          style={{ background: 'radial-gradient(circle, rgba(251,188,5,0.32) 0%, rgba(251,188,5,0) 70%)' }}
        />
        <div
          className="rgb-orb-green absolute -bottom-24 right-0 w-80 h-80 sm:w-[26rem] sm:h-[26rem] rounded-full blur-[100px]"
          style={{ background: 'radial-gradient(circle, rgba(52,168,83,0.42) 0%, rgba(52,168,83,0) 70%)' }}
        />
        <div className="absolute inset-0 bg-[#020617]/55" />
      </div>

      <div className="relative z-10 min-h-full w-full flex flex-col items-center justify-center py-2">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md space-y-5"
        >
          {!isOnline && (
            <div className="rounded-2xl bg-amber-500/12 border border-amber-500/35 backdrop-blur-md px-3.5 py-2.5 flex items-center justify-center gap-2 text-xs font-medium text-amber-200">
              <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
              <span>আপনি অফলাইনে আছেন · প্রথমবার লগইন করতে ইন্টারনেট সংযোগ চালু করুন</span>
            </div>
          )}

          {/* Brand Header */}
          <div className="text-center space-y-2">
            <div className="relative inline-flex items-center justify-center">
              <div className="w-16 h-16 rounded-2xl bg-white/95 border border-white/20 shadow-[0_12px_36px_rgba(66,133,244,0.28)] overflow-hidden">
                <img src="/icon-192.png" alt="NOOR ELAHI" className="w-full h-full object-contain" />
              </div>
            </div>
            <div className="space-y-0.5">
              <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                NOOR ELAHI
              </h1>
              <p className="text-xs sm:text-sm text-slate-300/85">
                স্মার্ট ডিজিটাল লার্নিং প্ল্যাটফর্ম
              </p>
            </div>
          </div>

          {/* Sleek Dark Glass Auth Card */}
          <div className="relative rounded-3xl bg-slate-950/75 backdrop-blur-2xl border border-white/12 shadow-[0_24px_70px_rgba(2,6,23,0.85)] overflow-hidden">
            {/* Subtle top Google RGB hairline accent */}
            <div
              className="h-[2px] w-full"
              style={{
                background:
                  'linear-gradient(90deg, #4285F4 0%, #EA4335 33%, #FBBC05 66%, #34A853 100%)',
              }}
            />

            <div className="p-5 sm:p-6 space-y-4">
              {/* Profile Photo & Name Setup Row */}
              <div className="flex items-center gap-3.5">
                <label className="relative w-16 h-16 rounded-2xl bg-slate-900/90 border border-white/12 hover:border-[#4285F4]/70 flex items-center justify-center cursor-pointer overflow-hidden shrink-0 transition">
                  {photoUrl ? (
                    <img src={photoUrl} alt="প্রোফাইল ছবি" className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-400">
                      <Camera className="w-5 h-5 text-[#4285F4]" />
                      <span className="text-[10px] font-medium">ছবি</span>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoPick}
                    className="hidden"
                  />
                </label>

                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setProfileSaved(false);
                        setFormHintError('');
                      }}
                      placeholder="আপনার নাম লিখুন"
                      className="w-full h-11 pl-10 pr-3 rounded-xl bg-slate-900/80 border border-white/10 focus:border-[#4285F4]/80 text-sm text-white placeholder:text-slate-500 outline-none transition"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 pl-0.5 truncate">
                    নাম ও ছবি আপনার প্রোফাইলে প্রদর্শিত হবে
                  </p>
                </div>
              </div>

              {/* Password Field + Required Warning Caption */}
              <div className="space-y-1.5">
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setProfileSaved(false);
                      setFormHintError('');
                    }}
                    placeholder="পাসওয়ার্ড লিখুন"
                    autoComplete="current-password"
                    className="w-full h-11 pl-10 pr-11 rounded-xl bg-slate-900/80 border border-white/10 focus:border-[#34A853]/80 text-sm text-white placeholder:text-slate-500 outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'পাসওয়ার্ড লুকান' : 'পাসওয়ার্ড দেখুন'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-200 transition"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-amber-300/90 pl-1">
                  পাসওয়ার্ডটি গোপন রাখুন
                </p>
              </div>

              {/* Save Setup Button */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleSaveProfileSetup}
                  className={`w-full h-11 rounded-2xl border font-bold text-sm flex items-center justify-center gap-2 transition active:scale-[0.98] ${
                    profileSaved
                      ? 'bg-[#34A853]/18 border-[#34A853]/50 text-emerald-300'
                      : 'bg-white/[0.05] hover:bg-white/[0.09] border-white/14 text-slate-100'
                  }`}
                >
                  <Check className={`w-4 h-4 shrink-0 ${profileSaved ? 'text-[#34A853]' : 'text-emerald-400'}`} />
                  <span>{profileSaved ? 'তথ্য সেভ হয়েছে · এবার নিচে লগইন করুন' : 'সেভ করুন'}</span>
                </button>

                {formHintError && (
                  <p className="text-xs text-rose-300 text-center">{formHintError}</p>
                )}

                <div className="rounded-2xl bg-amber-500/[0.08] border border-amber-400/20 px-3.5 py-2.5 text-[11px] text-amber-100/90 leading-relaxed">
                  সতর্কতা: আপনি যে নাম, পাসওয়ার্ড এবং জিমেইল (Google অ্যাকাউন্ট) বা নাম্বার ব্যবহার করছেন, পরবর্তীতে ঠিক সেই একই তথ্য দিয়ে লগইন না করলে আপনার প্রোফাইল ও অ্যাপের সংরক্ষিত কোনো ডেটা ফিরে আসবে না। পাসওয়ার্ড অনেকের একরকম হতে পারে, কিন্তু নাম ও জিমেইল আলাদা থাকে।
                </div>
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
                        className="w-full h-11 pl-10 pr-3 rounded-xl bg-slate-900/85 border border-[#4285F4]/45 focus:border-[#4285F4] text-sm text-white placeholder:text-slate-500 outline-none transition"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={authLoading}
                      onClick={() => {
                        persistHint();
                        onNumberLogin({ phone, password, name, photoUrl });
                      }}
                      className="w-full h-12 rounded-2xl bg-gradient-to-r from-[#4285F4] to-[#06B6D4] text-white font-bold text-sm shadow-lg shadow-blue-500/25 active:scale-[0.98] transition disabled:opacity-60"
                    >
                      {authLoading ? 'প্রবেশ করা হচ্ছে...' : 'নাম্বার দিয়ে প্রবেশ করুন'}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {authError && (
                <div className="rounded-xl bg-rose-500/12 border border-rose-500/35 px-3.5 py-2.5 text-xs text-rose-200 space-y-2">
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

              {/* Sign-In Action Stack */}
              <div className="grid grid-cols-1 gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={authLoading}
                  onClick={() => {
                    persistHint();
                    onGoogleLogin({ name, password, photoUrl });
                  }}
                  className="w-full h-12 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm flex items-center justify-center gap-2.5 shadow-[0_10px_28px_rgba(255,255,255,0.14)] active:scale-[0.98] transition disabled:opacity-60"
                >
                  <GoogleMark className="w-4.5 h-4.5 shrink-0" />
                  <span>সাইন ইন উইথ গুগল</span>
                </button>

                <button
                  type="button"
                  disabled={authLoading}
                  onClick={() => setShowNumberForm((v) => !v)}
                  className="w-full h-12 rounded-2xl bg-slate-900/90 border border-white/12 hover:border-[#4285F4]/55 text-slate-100 font-semibold text-sm flex items-center justify-center gap-2.5 active:scale-[0.98] transition"
                >
                  <Phone className="w-4 h-4 text-[#4285F4] shrink-0" />
                  <span>{showNumberForm ? 'নাম্বার বক্স লুকান' : 'সাইন ইন উইথ নাম্বার'}</span>
                </button>

                {onOpenReportModal && (
                  <button
                    type="button"
                    onClick={() => {
                      persistHint();
                      onOpenReportModal();
                    }}
                    className="w-full h-11 rounded-2xl bg-amber-500/[0.08] border border-amber-500/25 hover:border-amber-400/55 text-amber-200 font-semibold text-xs flex items-center justify-center gap-2 active:scale-[0.98] transition"
                  >
                    <AlertTriangle className="w-4 h-4 text-[#FBBC05] shrink-0" />
                    <span>অ্যাপের সমস্যা সম্পর্কে এডমিনকে জানান</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
