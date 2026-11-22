import React, { useState } from 'react';
import {
  Camera,
  Check,
  Edit3,
  FolderLock,
  Inbox,
  Lock,
  LogOut,
  Mail,
  MessageSquareWarning,
  Phone,
  User,
} from 'lucide-react';
import { AppUser } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface ProfileViewProps {
  user: AppUser;
  inboxCount: number;
  onUpdateProfile: (payload: {
    name: string;
    photoUrl: string;
    newPassword?: string;
  }) => Promise<void>;
  onOpenFileVault: () => void;
  onOpenAdminInbox: () => void;
  onOpenReportModal: () => void;
  onLogout: () => void;
}

async function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 200;
        let w = img.width;
        let h = img.height;
        if (w > h && w > maxDim) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else if (h >= w && h > maxDim) {
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
      img.onerror = () => reject(new Error('Image error'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Read error'));
    reader.readAsDataURL(file);
  });
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  user,
  inboxCount,
  onUpdateProfile,
  onOpenFileVault,
  onOpenAdminInbox,
  onOpenReportModal,
  onLogout,
}) => {
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(user.name);
  const [photoInput, setPhotoInput] = useState(user.photoUrl);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressAvatar(file);
      setPhotoInput(dataUrl);
      if (!editing) {
        setSaving(true);
        await onUpdateProfile({ name: user.name, photoUrl: dataUrl });
        setFeedback('প্রোফাইল ছবি আপডেট হয়েছে।');
        setSaving(false);
      }
    } catch {
      setFeedback('ছবি আপলোড করা যায়নি।');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    if (newPassword.trim() && newPassword.trim().length < 4) {
      setFeedback('নতুন পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে।');
      return;
    }
    setSaving(true);
    setFeedback('');
    try {
      await onUpdateProfile({
        name: nameInput.trim(),
        photoUrl: photoInput,
        newPassword: newPassword.trim() || undefined,
      });
      setNewPassword('');
      setEditing(false);
      setFeedback('প্রোফাইল সফলভাবে আপডেট হয়েছে।');
    } catch {
      setFeedback('আপডেট করতে সমস্যা হয়েছে।');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-5">
      {/* Centered Hero Profile Card Matching Uploaded Reference Image 3 */}
      <div className="rounded-3xl bg-[#0d1326] border border-slate-800/80 p-6 flex flex-col items-center text-center space-y-4 shadow-2xl">
        <label className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-indigo-950 to-slate-900 border-2 border-indigo-400/40 overflow-hidden flex items-center justify-center cursor-pointer group shadow-xl">
          {photoInput ? (
            <img
              src={photoInput}
              alt={user.name}
              onError={(e) => {
                e.stopPropagation();
                setPhotoInput('');
              }}
              className="w-full h-full object-cover"
            />
          ) : (
            <User className="w-10 h-10 text-indigo-300" />
          )}
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
            <Camera className="w-5 h-5 text-white" />
          </div>
          <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
        </label>

        <div className="space-y-2 w-full flex flex-col items-center">
          <h2 className="text-2xl font-extrabold text-white tracking-tight">
            {user.name}
          </h2>
          <div className="inline-flex items-center gap-2 rounded-2xl bg-[#070b18] border border-slate-800 px-3.5 py-2 text-xs text-slate-200 max-w-full">
            {user.email ? (
              <Mail className="w-3.5 h-3.5 text-pink-400 shrink-0" />
            ) : (
              <Phone className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            )}
            <span className="truncate">{user.email || user.phone}</span>
          </div>
        </div>

        {/* Side-by-Side Edit & Sign Out Buttons */}
        <div className="grid grid-cols-2 gap-3 w-full pt-1">
          <button
            type="button"
            onClick={() => {
              setEditing((v) => !v);
              setNameInput(user.name);
              setPhotoInput(user.photoUrl);
              setFeedback('');
            }}
            className="h-11 rounded-2xl bg-[#182036] hover:bg-[#1e2945] border border-slate-700/70 text-xs sm:text-sm font-semibold text-white flex items-center justify-center gap-2 transition"
          >
            <Edit3 className="w-4 h-4 text-slate-300" />
            <span>{editing ? 'বাতিল করুন' : 'প্রোফাইল এডিট'}</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="h-11 rounded-2xl bg-[#241322] hover:bg-[#2f162c] border border-rose-500/35 text-xs sm:text-sm font-semibold text-rose-300 flex items-center justify-center gap-2 transition"
          >
            <LogOut className="w-4 h-4" />
            <span>সাইন আউট</span>
          </button>
        </div>
      </div>

      {/* Personal Information Card (Only Name, Gmail/Phone, Password) */}
      <div className="rounded-3xl bg-[#0d1326] border border-slate-800/80 p-5 space-y-3.5">
        <h3 className="text-sm font-bold text-white">ব্যক্তিগত তথ্য</h3>

        {!editing ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-2xl bg-[#070b18] border border-slate-800/80 px-4 py-3">
              <div className="flex items-center gap-2.5 text-slate-400 text-xs">
                <User className="w-4 h-4 text-emerald-400" />
                <span>নাম</span>
              </div>
              <span className="text-sm font-semibold text-white">{user.name}</span>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-[#070b18] border border-slate-800/80 px-4 py-3">
              <div className="flex items-center gap-2.5 text-slate-400 text-xs">
                {user.email ? (
                  <Mail className="w-4 h-4 text-cyan-400" />
                ) : (
                  <Phone className="w-4 h-4 text-cyan-400" />
                )}
                <span>{user.email ? 'জিমেইল' : 'মোবাইল নাম্বার'}</span>
              </div>
              <span className="text-sm font-semibold text-white truncate max-w-[60%]">
                {user.email || user.phone}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-[#070b18] border border-slate-800/80 px-4 py-3">
              <div className="flex items-center gap-2.5 text-slate-400 text-xs">
                <Lock className="w-4 h-4 text-indigo-400" />
                <span>পাসওয়ার্ড</span>
              </div>
              <span className="text-sm font-mono-num text-slate-300">••••••••</span>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">নাম পরিবর্তন</label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-[#070b18] border border-slate-800 focus:border-emerald-500 text-sm text-white outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">
                নতুন পাসওয়ার্ড (পরিবর্তন করতে চাইলে)
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="নতুন পাসওয়ার্ড লিখুন"
                className="w-full h-11 px-3.5 rounded-xl bg-[#070b18] border border-slate-800 focus:border-emerald-500 text-sm text-white outline-none"
              />
              <p className="text-[11px] text-amber-300/90">পাসওয়ার্ডটি গোপন রাখুন</p>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>{saving ? 'সেভ হচ্ছে...' : 'পরিবর্তন সেভ করুন'}</span>
            </button>
          </form>
        )}

        {feedback && (
          <p className="text-xs text-emerald-400 font-medium">{feedback}</p>
        )}
      </div>

      {/* Admin Exclusive Cards Matching Uploaded Reference Image 3 Layout */}
      {user.role === 'admin' && (
        <div className="space-y-4">
          {/* Card 1 (Green Emerald Position -> Inbox) */}
          <div className="rounded-3xl bg-[#0b1622] border border-emerald-500/35 p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Inbox className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <h3 className="text-base font-bold text-emerald-300">অ্যাডমিন ইনবক্স</h3>
                  <p className="text-xs text-slate-400">
                    পাসওয়ার্ড পরিবর্তন ও ইউজারদের অভিযোগসমূহ ({inboxCount}টি)
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                ADMIN ONLY
              </span>
            </div>

            <button
              type="button"
              onClick={onOpenAdminInbox}
              className="w-full h-12 rounded-2xl bg-[#0c352f] hover:bg-[#10443c] border border-emerald-500/40 text-emerald-200 font-bold text-sm flex items-center justify-center gap-2 transition active:scale-[0.98]"
            >
              <Inbox className="w-4 h-4" />
              <span>ইনবক্স খুলুন</span>
            </button>
          </div>

          {/* Card 2 (Amber/Gold-to-Purple Position -> File Vault) */}
          <div className="rounded-3xl bg-gradient-to-br from-[#231915] via-[#131325] to-[#1e1233] border border-amber-500/40 p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                  <FolderLock className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    অ্যাডমিন ফাইল ভল্ট (File Vault)
                  </h3>
                  <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                    সকল বিষয়ের শিরোনাম, ভিডিও ও PDF লিংক পরিচালনা করুন
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-500 text-slate-950 shrink-0">
                ADMIN ONLY
              </span>
            </div>

            <button
              type="button"
              onClick={onOpenFileVault}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-800/80 via-orange-900/70 to-indigo-900/80 hover:from-amber-700/80 hover:to-indigo-800/80 border border-amber-400/45 text-amber-100 font-bold text-sm flex items-center justify-center gap-2 transition active:scale-[0.98]"
            >
              <FolderLock className="w-4 h-4" />
              <span>ফাইল ভল্ট খুলুন</span>
            </button>
          </div>
        </div>
      )}

      {/* Report Issue to Admin — ONLY shown to Non-Admin Users */}
      {user.role !== 'admin' && (
        <button
          type="button"
          onClick={onOpenReportModal}
          className="w-full h-12 rounded-2xl bg-slate-900 border border-slate-800 hover:border-amber-500/40 text-amber-200 font-semibold text-sm flex items-center justify-center gap-2 transition"
        >
          <MessageSquareWarning className="w-4 h-4 text-amber-400 shrink-0" />
          <span>অ্যাপের সমস্যা সম্পর্কে এডমিনকে জানান</span>
        </button>
      )}

      <PWAInstallButton />
    </div>
  );
};
