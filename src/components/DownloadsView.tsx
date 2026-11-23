import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Download,
  FileText,
  FolderSearch,
  HardDrive,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import {
  DownloadRecord,
  DownloadTask,
  SUBJECT_LIST,
  SubjectDoc,
  SubjectMeta,
} from '../types';
import { downloadManager } from '../lib/downloadManager';
import {
  collectFilesFromDirectoryHandle,
  exportOfflineItemToPhone,
  getStoragePermissionStatus,
  requestInternalFolderHandle,
  scanAndRestoreFilesFromDevice,
  StoragePermissionStatus,
} from '../lib/offlineStorage';
import { StoragePermissionModal } from './StoragePermissionModal';
import { useBackOverlay } from '../hooks/useBackHandler';

interface DownloadsViewProps {
  uid: string;
  subjects: Record<string, SubjectDoc>;
  downloads: Record<string, DownloadRecord>;
  downloadTasks: Record<string, DownloadTask>;
  isOnline: boolean;
  selectedSubjectId?: string | null;
  onSelectSubjectId?: (subjectId: string | null) => void;
  onOfflineAlert: () => void;
  onPlayDownloaded: (record: DownloadRecord) => void;
  onOpenDownloadedPdf: (record: DownloadRecord) => void;
  onDeleteDownload: (itemId: string) => Promise<void>;
  onRestoreMatchedRecords: (records: DownloadRecord[]) => Promise<void>;
}

function formatMB(bytes: number): string {
  if (!bytes || bytes <= 0) return '0.0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const DownloadsView: React.FC<DownloadsViewProps> = ({
  uid,
  subjects,
  downloads,
  downloadTasks,
  isOnline,
  selectedSubjectId: controlledSubjectId,
  onSelectSubjectId,
  onOfflineAlert,
  onPlayDownloaded,
  onOpenDownloadedPdf,
  onDeleteDownload,
  onRestoreMatchedRecords,
}) => {
  const [localSubjectId, setLocalSubjectId] = useState<string | null>(null);
  const selectedSubjectId =
    controlledSubjectId !== undefined ? controlledSubjectId : localSubjectId;
  const setSelectedSubjectId = (id: string | null) => {
    if (onSelectSubjectId) {
      onSelectSubjectId(id);
    } else {
      setLocalSubjectId(id);
    }
  };

  const [confirmDeleteItem, setConfirmDeleteItem] = useState<DownloadRecord | null>(null);
  const [showScanPrompt, setShowScanPrompt] = useState(false);
  const [scanResultMsg, setScanResultMsg] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permModalOpen, setPermModalOpen] = useState(false);
  const [permStatus, setPermStatus] = useState<StoragePermissionStatus | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  useBackOverlay(Boolean(confirmDeleteItem), () => setConfirmDeleteItem(null), 'dl-confirm-delete');
  useBackOverlay(showScanPrompt, () => setShowScanPrompt(false), 'dl-scan-prompt');
  useBackOverlay(permModalOpen, () => setPermModalOpen(false), 'dl-storage-perm');

  const refreshPermStatus = () => {
    getStoragePermissionStatus()
      .then(setPermStatus)
      .catch(() => {});
  };

  useEffect(() => {
    refreshPermStatus();
  }, [downloads]);

  const activeTasks = Object.values(downloadTasks);
  const allDownloads = Object.values(downloads);

  const selectedMeta: SubjectMeta | undefined = useMemo(
    () => SUBJECT_LIST.find((s) => s.id === selectedSubjectId),
    [selectedSubjectId]
  );

  const subjectDownloads = useMemo(() => {
    if (!selectedSubjectId) return [];
    return allDownloads.filter((d) => d.subjectId === selectedSubjectId);
  }, [allDownloads, selectedSubjectId]);

  const handleScanFiles = async (files: File[]) => {
    setScanning(true);
    try {
      const { restoredCount, matchedRecords } = await scanAndRestoreFilesFromDevice(
        files,
        subjects,
        uid
      );
      if (matchedRecords.length > 0) {
        await onRestoreMatchedRecords(matchedRecords);
      }
      setScanResultMsg(
        restoredCount > 0
          ? `${restoredCount}টি ডাউনলোড করা ক্লাস ফাইল ভল্টের সাথে মিলিয়ে স্বয়ংক্রিয়ভাবে যুক্ত করা হয়েছে!`
          : 'ফোনের নির্বাচিত ফোল্ডারে File Vault এর নামের সাথে মিল থাকা কোনো ভিডিও বা PDF পাওয়া যায়নি।'
      );
    } catch {
      setScanResultMsg('ফাইল স্ক্যান করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।');
    } finally {
      setScanning(false);
    }
  };

  const triggerDeviceStorageScan = async () => {
    setShowScanPrompt(false);
    const win = window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    };
    if (win.showDirectoryPicker) {
      try {
        const handle = await requestInternalFolderHandle();
        if (handle) {
          refreshPermStatus();
          setScanning(true);
          const files = await collectFilesFromDirectoryHandle(handle);
          await handleScanFiles(files);
          return;
        }
      } catch {
        // User cancelled or browser fell back
      }
    }
    folderInputRef.current?.click();
  };

  return (
    <div className="space-y-5">
      {/* Hidden Fallback Multi-File / Directory Picker */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        accept="video/*,application/pdf,.mp4,.mkv,.webm,.pdf"
        onChange={(e) => {
          const list = e.target.files ? Array.from(e.target.files) : [];
          if (list.length > 0) {
            handleScanFiles(list);
          }
        }}
        className="hidden"
      />

      {/* Storage Permission & Scan Header Card */}
      <div className="rounded-3xl bg-slate-900/80 border border-slate-800 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-base font-bold text-white">মাই ডাউনলোডস</h2>
            <p className="text-xs text-slate-400">
              ডাউনলোড করা ভিডিও ও PDF আপনার স্টোরেজে সংরক্ষিত থাকে
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setPermModalOpen(true)}
              className={`h-10 px-3.5 rounded-2xl border font-semibold text-xs flex items-center gap-1.5 transition ${
                permStatus?.configured
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
              }`}
            >
              {permStatus?.configured ? (
                <ShieldCheck className="w-4 h-4 shrink-0" />
              ) : (
                <HardDrive className="w-4 h-4 shrink-0" />
              )}
              <span>
                {permStatus?.hasFolderAccess && permStatus.folderName
                  ? `ফোল্ডার: ${permStatus.folderName}`
                  : permStatus?.configured
                  ? 'স্টোরেজ অনুমতি সক্রিয়'
                  : 'স্টোরেজ অনুমতি দিন'}
              </span>
            </button>

            <button
              type="button"
              disabled={scanning}
              onClick={() => setShowScanPrompt(true)}
              className="h-10 px-3.5 rounded-2xl bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/40 text-emerald-300 font-semibold text-xs flex items-center justify-center gap-1.5 hover:border-emerald-400 transition shrink-0"
            >
              <FolderSearch className="w-4 h-4 shrink-0" />
              <span>{scanning ? 'স্ক্যান হচ্ছে...' : 'ফাইল ও মিডিয়া স্ক্যান করুন'}</span>
            </button>
          </div>
        </div>

        {permStatus?.usageMB && (
          <p className="text-[11px] font-mono-num text-slate-400">
            অফলাইন স্টোরেজ ব্যবহৃত: {permStatus.usageMB} MB
            {permStatus.quotaMB ? ` / ${permStatus.quotaMB} MB` : ''}
          </p>
        )}
      </div>

      {scanResultMsg && (
        <div className="rounded-2xl bg-cyan-500/10 border border-cyan-500/30 px-4 py-3 flex items-center justify-between gap-3 text-xs text-cyan-200">
          <span>{scanResultMsg}</span>
          <button type="button" onClick={() => setScanResultMsg(null)} className="text-cyan-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Active / Paused / Error Downloads Queue */}
      {activeTasks.length > 0 && (
        <div className="space-y-2.5">
          <h3 className="text-xs font-semibold text-slate-400 px-1">চলমান ডাউনলোড</h3>
          {activeTasks.map((task) => {
            const remaining = Math.max(0, task.totalBytes - task.downloadedBytes);
            return (
              <div
                key={task.itemId}
                className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-cyan-400 font-medium truncate">
                      {task.sectionTitle} · ক্লাস {task.classNumber}
                    </p>
                    <p className="text-sm font-bold text-white truncate">{task.videoName}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {task.status === 'error' ? (
                      <button
                        type="button"
                        onClick={() => downloadManager.retryTask(task.itemId)}
                        className="px-3 h-9 rounded-xl bg-rose-500 text-white text-xs font-bold flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>আবার</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          task.status === 'paused'
                            ? downloadManager.resumeTask(task.itemId)
                            : downloadManager.pauseTask(task.itemId)
                        }
                        className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-white"
                      >
                        {task.status === 'paused' ? (
                          <Play className="w-4 h-4 fill-current" />
                        ) : (
                          <Pause className="w-4 h-4 fill-current" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => downloadManager.cancelTask(task.itemId)}
                      className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-rose-400"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {task.status === 'error' ? (
                  <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 flex items-center gap-2 text-xs text-rose-200">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{task.errorMessage || 'ডাউনলোডে সমস্যা হয়েছে।'}</span>
                  </div>
                ) : (
                  <>
                    <div className="relative h-6 rounded-xl bg-slate-950 overflow-hidden border border-slate-800">
                      <div
                        className="absolute inset-y-0 left-0 liquid-fill-bar transition-all duration-300"
                        style={{ width: `${task.progress}%` }}
                      />
                      <span className="relative z-10 h-full flex items-center justify-center text-[11px] font-mono-num font-bold text-white">
                        {task.progress}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono-num text-slate-400">
                      <span>হয়েছে: {formatMB(task.downloadedBytes)}</span>
                      <span>
                        {task.totalBytes > 0 ? `বাকি: ${formatMB(remaining)}` : 'কানেক্ট হচ্ছে...'}
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Either Subject Grid OR Selected Subject's Downloaded Items */}
      {!selectedSubjectId || !selectedMeta ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SUBJECT_LIST.map((meta) => {
            const count = allDownloads.filter((d) => d.subjectId === meta.id).length;
            return (
              <button
                key={meta.id}
                type="button"
                onClick={() => setSelectedSubjectId(meta.id)}
                className={`text-left rounded-3xl bg-gradient-to-br ${meta.gradient} border ${meta.accentBorder} p-5 shadow-xl active:scale-[0.98] transition-all flex flex-col justify-between min-h-[136px]`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className={`text-xs font-medium ${meta.accentText}`}>
                      {meta.shortLabel}
                    </span>
                    <h3 className="text-lg font-bold text-white mt-0.5">{meta.name}</h3>
                  </div>
                  <ChevronRight className={`w-5 h-5 ${meta.accentText}`} />
                </div>

                <div className="mt-4 rounded-2xl bg-slate-950/85 border border-white/5 px-3.5 py-2 flex items-center justify-between text-xs">
                  <span className="font-mono-num text-slate-300">
                    ডাউনলোড করা: {count}টি
                  </span>
                  <span className={`font-semibold ${meta.accentText}`}>খুলুন</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedSubjectId(null)}
              className="min-w-[44px] min-h-[44px] rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-200 hover:bg-slate-800 transition"
              aria-label="পিছনে যান"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <p className={`text-xs font-medium ${selectedMeta.accentText}`}>ডাউনলোড তালিকা</p>
              <h3 className="text-lg font-bold text-white">{selectedMeta.name}</h3>
            </div>
          </div>

          {subjectDownloads.length === 0 ? (
            <div className="rounded-3xl bg-slate-900/70 border border-slate-800 p-8 text-center space-y-1.5">
              <p className="text-sm font-semibold text-slate-300">
                এই বিষয়ে কোনো ফাইল ডাউনলোড করা নেই
              </p>
              <p className="text-xs text-slate-500">
                অনলাইন থেকে ডাউনলোড করুন অথবা ফোনের স্টোরেজ স্ক্যান করুন।
              </p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {subjectDownloads.map((rec) => (
                <div
                  key={rec.itemId}
                  className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-800 p-4 space-y-3"
                >
                  {/* Header: Section Title + Class Number + Video Name + Export + Delete */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-emerald-400 truncate">
                        {rec.sectionTitle} · ক্লাস {rec.classNumber}
                      </p>
                      <h4 className="text-sm sm:text-base font-bold text-white truncate">
                        {rec.videoName}
                      </h4>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {(rec.hasLocalVideo || rec.hasLocalPdf) && (
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await exportOfflineItemToPhone(rec.itemId, rec.videoName);
                            if (ok) {
                              setScanResultMsg(`“${rec.videoName}” আপনার ডিভাইস স্টোরেজে সেভ করা হয়েছে।`);
                            }
                          }}
                          className="h-9 px-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 text-[11px] font-semibold flex items-center gap-1 transition"
                          title="ডিভাইস স্টোরেজে সেভ করুন"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>ফোনে সেভ</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteItem(rec)}
                        className="min-w-[38px] min-h-[38px] rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 flex items-center justify-center shrink-0 transition"
                        aria-label="ডিলিট করুন"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Colorful Rectangular Split Box: Left = Video, Right = PDF */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      disabled={!rec.videoUrl && !rec.hasLocalVideo}
                      onClick={() => {
                        if (!isOnline && !rec.hasLocalVideo) {
                          onOfflineAlert();
                          return;
                        }
                        onPlayDownloaded(rec);
                      }}
                      className="rounded-2xl bg-gradient-to-br from-emerald-600/25 via-teal-600/20 to-cyan-600/25 border border-emerald-400/35 hover:border-emerald-400/70 p-3.5 flex items-center justify-center gap-2 text-emerald-200 font-semibold text-xs sm:text-sm active:scale-[0.98] transition disabled:opacity-40"
                    >
                      <Video className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>ভিডিও দেখুন</span>
                    </button>

                    <button
                      type="button"
                      disabled={!rec.pdfUrl && !rec.hasLocalPdf}
                      onClick={() => {
                        if (!isOnline && !rec.hasLocalPdf) {
                          onOfflineAlert();
                          return;
                        }
                        onOpenDownloadedPdf(rec);
                      }}
                      className="rounded-2xl bg-gradient-to-br from-indigo-600/25 via-violet-600/20 to-purple-600/25 border border-indigo-400/35 hover:border-indigo-400/70 p-3.5 flex items-center justify-center gap-2 text-indigo-200 font-semibold text-xs sm:text-sm active:scale-[0.98] transition disabled:opacity-40"
                    >
                      <FileText className="w-4 h-4 text-indigo-300 shrink-0" />
                      <span>PDF পড়ুন</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white">ডাউনলোড ডিলিট করবেন?</h3>
            <p className="text-sm text-slate-300">
              “{confirmDeleteItem.videoName}” ভিডিও ও PDF মুছে ফেলা হবে এবং স্টোরেজ খালি হবে।
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteItem(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-200 text-sm font-semibold"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = confirmDeleteItem.itemId;
                  setConfirmDeleteItem(null);
                  await onDeleteDownload(id);
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white text-sm font-semibold"
              >
                ডিলিট করুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File & Media Permission Modal before Scanning */}
      {showScanPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <FolderSearch className="w-5 h-5 text-emerald-400" />
              </div>
              <h3 className="text-base font-bold text-white">ফাইল ও মিডিয়া অনুমতি</h3>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              আপনার ফোনের ইন্টারনাল স্টোরেজে আগে থেকে ডাউনলোড করা ভিডিও এবং PDF স্ক্যান করতে ফোল্ডার বা ফাইল নির্বাচন করার অনুমতি দিন। File Vault এর নামের সাথে মিল পেলে সেগুলো স্বয়ংক্রিয়ভাবে মাই ডাউনলোডসে যুক্ত হয়ে যাবে।
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowScanPrompt(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-sm font-semibold"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={triggerDeviceStorageScan}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-sm font-bold"
              >
                অনুমতি দিন
              </button>
            </div>
          </div>
        </div>
      )}

      <StoragePermissionModal
        isOpen={permModalOpen}
        onClose={() => setPermModalOpen(false)}
        onGranted={() => {
          setPermModalOpen(false);
          refreshPermStatus();
          setScanResultMsg('মিডিয়া ও ফাইল স্টোরেজ অনুমতি সফলভাবে সক্রিয় করা হয়েছে!');
        }}
      />
    </div>
  );
};
