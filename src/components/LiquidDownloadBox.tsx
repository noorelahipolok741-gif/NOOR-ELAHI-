import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import { DownloadTask } from '../types';
import { downloadManager } from '../lib/downloadManager';
import {
  exportOfflineItemToPhone,
  getGoogleDriveFileId,
  getSafeDownloadUrl,
  safeOpenExternalUrl,
} from '../lib/offlineStorage';

interface LiquidDownloadBoxProps {
  itemId: string;
  subjectId: string;
  sectionId: string;
  sectionTitle: string;
  classNumber: number;
  videoName: string;
  videoUrl: string;
  pdfUrl: string;
  isDownloaded: boolean;
  task?: DownloadTask;
  isOnline: boolean;
  onOfflineAttempt?: () => void;
}

function formatMB(bytes: number): string {
  if (!bytes || bytes <= 0) return '0.0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const LiquidDownloadBox: React.FC<LiquidDownloadBoxProps> = ({
  itemId,
  subjectId,
  sectionId,
  sectionTitle,
  classNumber,
  videoName,
  videoUrl,
  pdfUrl,
  isDownloaded,
  task,
  isOnline,
  onOfflineAttempt,
}) => {
  const [exportedNotice, setExportedNotice] = useState(false);

  const safeVideoDlUrl = getSafeDownloadUrl(videoUrl);
  const safePdfDlUrl = getSafeDownloadUrl(pdfUrl);
  const fallbackExternalUrl = safeVideoDlUrl || safePdfDlUrl;

  const beginDownload = () => {
    // Synchronously hand Google Drive videos to native mobile browser download manager
    // so 600-700MB files download cleanly without 404 or mobile memory crashes
    if (videoUrl && getGoogleDriveFileId(videoUrl) && safeVideoDlUrl) {
      safeOpenExternalUrl(safeVideoDlUrl);
    }

    downloadManager.startDownload({
      itemId,
      subjectId,
      sectionId,
      sectionTitle,
      classNumber,
      videoName,
      videoUrl,
      pdfUrl,
      alreadyDownloaded: isDownloaded,
    });
  };

  if (isDownloaded) {
    return (
      <div className="w-full flex items-center gap-2">
        <div className="flex-1 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center gap-2 px-3 text-emerald-300 font-semibold text-xs sm:text-sm select-none min-w-0">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span className="truncate">
            {exportedNotice ? 'ফোনে সেভ হয়েছে' : 'ডাউনলোড করা আছে'}
          </span>
        </div>
        <button
          type="button"
          onClick={async () => {
            const ok = await exportOfflineItemToPhone(itemId, videoName || `ক্লাস ${classNumber}`);
            if (ok) {
              setExportedNotice(true);
              window.setTimeout(() => setExportedNotice(false), 3000);
            }
          }}
          className="h-12 px-3.5 rounded-2xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-cyan-300 font-semibold text-xs flex items-center justify-center gap-1.5 shrink-0 active:scale-95 transition"
          title="ফোনের Downloads ফোল্ডারে সেভ করুন"
        >
          <Download className="w-4 h-4 shrink-0" />
          <span>ফোনে সেভ</span>
        </button>
      </div>
    );
  }

  if (task && task.status === 'error') {
    return (
      <div className="w-full space-y-1.5">
        <div className="w-full rounded-2xl bg-rose-500/10 border border-rose-500/35 px-3 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="text-xs text-rose-200 leading-snug line-clamp-2">
              {task.errorMessage || 'ডাউনলোডে সমস্যা হয়েছে।'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {fallbackExternalUrl && (
              <a
                href={fallbackExternalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1.5 rounded-xl bg-cyan-500 text-slate-950 text-[11px] font-bold flex items-center gap-1 active:scale-95 transition"
                title="ব্রাউজারে সরাসরি ডাউনলোড করুন"
              >
                <ExternalLink className="w-3 h-3" />
                <span>সেভ</span>
              </a>
            )}
            <button
              type="button"
              onClick={() => downloadManager.retryTask(itemId)}
              className="px-2.5 py-1.5 rounded-xl bg-rose-500 text-white text-[11px] font-bold flex items-center gap-1 active:scale-95 transition"
            >
              <RotateCcw className="w-3 h-3" />
              <span>আবার</span>
            </button>
            <button
              type="button"
              onClick={() => downloadManager.cancelTask(itemId)}
              className="p-1.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-400 hover:text-white"
              aria-label="বাতিল করুন"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (
    task &&
    (task.status === 'downloading' || task.status === 'paused' || task.status === 'completed')
  ) {
    const pct = Math.min(100, Math.max(0, task.progress));
    const remaining = Math.max(0, task.totalBytes - task.downloadedBytes);

    return (
      <div className="w-full space-y-1.5">
        <div className="relative w-full h-12 rounded-2xl bg-slate-950/90 border border-slate-700/80 overflow-hidden shadow-inner">
          {/* Liquid Color-Changing Progress Fill from Left to Right */}
          <div
            className="absolute inset-y-0 left-0 liquid-fill-bar transition-all duration-300 ease-out"
            style={{ width: `${pct}%` }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent liquid-shimmer" />
          </div>

          {/* Center Percentage + Pause/Resume Control */}
          <div className="relative z-10 h-full px-3.5 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-200 drop-shadow truncate max-w-[36%]">
              {task.status === 'paused' ? 'বিরতি দেওয়া হয়েছে' : 'ডাউনলোড হচ্ছে'}
            </span>

            <span className="font-mono-num text-sm font-bold text-white drop-shadow">
              {pct}%
            </span>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (task.status === 'paused') {
                  downloadManager.resumeTask(itemId);
                } else {
                  downloadManager.pauseTask(itemId);
                }
              }}
              className="min-w-[36px] min-h-[36px] rounded-xl bg-slate-950/60 hover:bg-slate-900/90 border border-white/15 flex items-center justify-center text-white transition active:scale-95"
              aria-label={task.status === 'paused' ? 'চালু করুন' : 'বিরতি দিন'}
            >
              {task.status === 'paused' ? (
                <Play className="w-4 h-4 fill-current" />
              ) : (
                <Pause className="w-4 h-4 fill-current" />
              )}
            </button>
          </div>
        </div>

        {/* Downloaded MB / Remaining MB telemetry */}
        <div className="flex items-center justify-between px-1 text-[11px] font-mono-num text-slate-400">
          <span>ডাউনলোড: {formatMB(task.downloadedBytes)}</span>
          <span>
            {task.totalBytes > 0
              ? `বাকি: ${formatMB(remaining)}`
              : 'কানেক্ট হচ্ছে...'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (!isOnline) {
          onOfflineAttempt?.();
          return;
        }
        beginDownload();
      }}
      className="group relative w-full h-12 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-cyan-500/30 hover:border-cyan-400/60 overflow-hidden flex items-center justify-center gap-2 px-4 text-sm font-semibold text-cyan-200 transition active:scale-[0.98]"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-cyan-500/15 to-blue-500/10 opacity-70 group-hover:opacity-100 transition-opacity" />
      <Download className="relative z-10 w-4 h-4 text-cyan-400 shrink-0" />
      <span className="relative z-10">ডাউনলোড</span>
    </button>
  );
};
