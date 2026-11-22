import React, { useState } from 'react';
import { FolderCheck, HardDrive, ShieldCheck, X } from 'lucide-react';
import {
  requestDeviceStoragePermission,
  supportsDirectoryPicker,
} from '../lib/offlineStorage';

interface StoragePermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGranted: (result: {
    hasFolderAccess: boolean;
    folderName?: string;
    persisted: boolean;
  }) => void;
}

export const StoragePermissionModal: React.FC<StoragePermissionModalProps> = ({
  isOpen,
  onClose,
  onGranted,
}) => {
  const [requesting, setRequesting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const hasFolderPicker = supportsDirectoryPicker();

  const handleGrant = async (chooseFolder: boolean) => {
    setRequesting(true);
    setErrorMsg('');
    try {
      const res = await requestDeviceStoragePermission(chooseFolder);
      if (res.cancelled) {
        setRequesting(false);
        return;
      }
      if (res.granted) {
        onGranted({
          hasFolderAccess: res.hasFolderAccess,
          folderName: res.folderName,
          persisted: res.persisted,
        });
      }
    } catch {
      setErrorMsg('স্টোরেজ অনুমতি নিতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।');
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-[#0b1224] border border-emerald-500/35 p-6 space-y-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center shrink-0">
              <HardDrive className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                মিডিয়া, ফাইল ও স্টোরেজ অনুমতি
              </h3>
              <p className="text-xs text-emerald-400 font-medium">
                অফলাইন ভিডিও ও PDF সংরক্ষণের জন্য প্রয়োজন
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-900 text-slate-400 hover:text-white"
            aria-label="বন্ধ করুন"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-2xl bg-slate-950/90 border border-slate-800 p-4 space-y-2.5 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <p>
            ভিডিও ক্লাস এবং PDF নোটস ডাউনলোড করে আপনার ডিভাইসের স্টোরেজে স্থায়ীভাবে সংরক্ষণ করতে অ্যাপটিকে ফাইল ও মিডিয়া স্টোরেজের অনুমতি দিন।
          </p>
          <div className="flex items-center gap-2 text-xs text-cyan-300 pt-1">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>
              ডাউনলোড করা ফাইল ইন্টারনেট ছাড়াই “ডাউনলোড” ট্যাবে এবং আপনার ডিভাইসে সংরক্ষিত থাকবে।
            </span>
          </div>
        </div>

        {errorMsg && (
          <p className="text-xs text-rose-400 font-medium">{errorMsg}</p>
        )}

        <div className="space-y-2.5">
          {hasFolderPicker && (
            <button
              type="button"
              disabled={requesting}
              onClick={() => handleGrant(true)}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition disabled:opacity-60"
            >
              <FolderCheck className="w-4 h-4 shrink-0" />
              <span>
                {requesting ? 'অনুমতি নেওয়া হচ্ছে...' : 'ফোন ফোল্ডার বেছে নিয়ে অনুমতি দিন'}
              </span>
            </button>
          )}

          <button
            type="button"
            disabled={requesting}
            onClick={() => handleGrant(false)}
            className={`w-full h-12 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition active:scale-[0.98] disabled:opacity-60 ${
              hasFolderPicker
                ? 'bg-slate-900 border border-emerald-500/35 text-emerald-300 hover:bg-slate-800'
                : 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 shadow-lg shadow-emerald-500/20'
            }`}
          >
            <HardDrive className="w-4 h-4 shrink-0" />
            <span>
              {requesting
                ? 'অনুমতি নেওয়া হচ্ছে...'
                : hasFolderPicker
                ? 'অ্যাপ স্টোরেজে অনুমতি দিন'
                : 'ফাইল ও মিডিয়া অনুমতি দিন'}
            </span>
          </button>

          <button
            type="button"
            disabled={requesting}
            onClick={onClose}
            className="w-full h-10 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 transition"
          >
            পরে অনুমতি দেব
          </button>
        </div>
      </div>
    </div>
  );
};
