import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        onClick={() => install()}
        className={
          compact
            ? 'flex items-center gap-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 transition whitespace-nowrap shrink-0'
            : 'w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-4 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition'
        }
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>অ্যাপ ইনস্টল করুন</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className={
            compact
              ? 'flex items-center gap-1.5 rounded-xl bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition whitespace-nowrap shrink-0'
              : 'w-full flex items-center justify-center gap-2 rounded-2xl bg-slate-800/90 border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-slate-800 transition'
          }
        >
          <Smartphone className="w-4 h-4 shrink-0 text-cyan-400" />
          <span>iPhone এ ইনস্টল করুন</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white">হোম স্ক্রিনে যোগ করুন</h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="space-y-2 text-sm text-slate-300 leading-relaxed">
                <li>১. Safari ব্রাউজারের নিচে <strong>Share</strong> আইকনে ট্যাপ করুন।</li>
                <li>২. স্ক্রল করে <strong>Add to Home Screen</strong> নির্বাচন করুন।</li>
                <li>৩. উপরে ডানে <strong>Add</strong> বাটনে ট্যাপ করুন।</li>
              </ol>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-semibold text-sm"
              >
                বুঝেছি
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
