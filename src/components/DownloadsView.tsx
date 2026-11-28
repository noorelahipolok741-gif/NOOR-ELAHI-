import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  FolderSearch,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
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
  exportOfflineItemToPhone,
  getSafeDownloadUrl,
  getStoragePermissionStatus,
  StoragePermissionStatus,
} from '../lib/offlineStorage';
import { NativeStoragePermissionState } from '../lib/capacitorScanner';
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
  isNativeCapacitor?: boolean;
  storagePermission?: NativeStoragePermissionState;
  needsFolderGrantForPdf?: boolean;
  onRequestStoragePermission?: () => Promise<void>;
  onRequestDownloadFolderAccess?: () => Promise<void>;
  onTriggerAutoScan?: () => Promise<{ scannedFilesCount: number; matchedCount: number }>;
  scanProgress?: {
    active: boolean;
    scanned: number;
    total: number;
    matched: number;
  } | null;
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
  isNativeCapacitor = false,
  storagePermission = 'web',
  needsFolderGrantForPdf = false,
  onRequestStoragePermission,
  onRequestDownloadFolderAccess,
  onTriggerAutoScan,
  scanProgress,
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
  const [scanResultMsg, setScanResultMsg] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permModalOpen, setPermModalOpen] = useState(false);
  const [permStatus, setPermStatus] = useState<StoragePermissionStatus | null>(null);

  useBackOverlay(Boolean(confirmDeleteItem), () => setConfirmDeleteItem(null), 'dl-confirm-delete');
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

  const triggerDeviceStorageScan = async () => {
    if (scanning || scanProgress?.active) return;

    if (onTriggerAutoScan) {
      setScanning(true);
      setScanResultMsg(null);
      try {
        const { scannedFilesCount, matchedCount } = await onTriggerAutoScan();
        setScanResultMsg(
          matchedCount > 0
            ? `ফোন স্টোরেজ (${scannedFilesCount}টি ফাইল) অটো স্ক্যান করে ${matchedCount}টি ডাউনলোড করা ক্লাস মাই ডাউনলোডস ও সংশ্লিষ্ট বিষয়ে যুক্ত করা হয়েছে!`
            : `ফোন স্টোরেজ অটো স্ক্যান সম্পন্ন হয়েছে (${scannedFilesCount}টি ফাইল পরীক্ষা করা হয়েছে), তবে File Vault-এর নামের সাথে মিল থাকা কোনো নতুন ভিডিও বা PDF পাওয়া যায়নি।`
        );
      } catch {
        setScanResultMsg('ফোনের স্টোরেজ স্ক্যান করতে সমস্যা হয়েছে। অনুগ্রহ করে পারমিশন পরীক্ষা করুন।');
      } finally {
        setScanning(false);
      }
    }
  };

  return (
    <div className="space-y-5">
      {/* Storage & Scan Header Card */}
      <div className="rounded-3xl bg-slate-900/80 border border-slate-800 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-base font-bold text-white">মাই ডাউনলোডস</h2>
            <p className="text-xs text-slate-400">
              ডাউনলোড ও স্ক্যান করা ভিডিও এবং PDF এখানে অফলাইনে সংরক্ষিত থাকে
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={scanning || Boolean(scanProgress?.active)}
              onClick={() => void triggerDeviceStorageScan()}
              className="h-10 px-4 rounded-2xl bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/40 text-emerald-300 font-semibold text-xs flex items-center justify-center gap-1.5 hover:border-emerald-400 transition shrink-0 disabled:opacity-60"
            >
              {scanning || scanProgress?.active ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <FolderSearch className="w-4 h-4 shrink-0" />
              )}
              <span>
                {scanning || scanProgress?.active ? 'অটো স্ক্যান হচ্ছে...' : 'অটো স্ক্যান করুন'}
              </span>
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

      {isNativeCapacitor && storagePermission === 'denied' && (
        <div className="rounded-2xl bg-slate-900/95 border border-amber-500/45 px-3.5 py-3 flex items-center justify-between gap-3 text-xs text-amber-200">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="min-w-0 leading-relaxed">
              ফোনের ডাউনলোড করা ভিডিও ও PDF অটো-স্ক্যান করতে স্টোরেজ পারমিশন দিন
            </span>
          </div>
          {onRequestStoragePermission && (
            <button
              type="button"
              onClick={() => void onRequestStoragePermission()}
              className="shrink-0 px-3 py-1.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs"
            >
              পারমিশন দাও
            </button>
          )}
        </div>
      )}

      {scanProgress?.active && (
        <div className="rounded-2xl bg-slate-900/90 border border-cyan-500/30 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-cyan-300">
          <div className="flex items-center gap-2 min-w-0">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span className="truncate">
              ফোন স্টোরেজ স্ক্যান হচ্ছে ({scanProgress.scanned}/{scanProgress.total})...
            </span>
          </div>
          {scanProgress.matched > 0 && (
            <span className="shrink-0 font-mono-num text-emerald-300 font-semibold">
              {scanProgress.matched}টি পাওয়া গেছে
            </span>
          )}
        </div>
      )}

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
                      <>
                        {(getSafeDownloadUrl(task.videoUrl) || getSafeDownloadUrl(task.pdfUrl)) && (
                          <a
                            href={getSafeDownloadUrl(task.videoUrl) || getSafeDownloadUrl(task.pdfUrl) || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 h-9 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold flex items-center gap-1"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>সেভ</span>
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => downloadManager.retryTask(task.itemId)}
                          className="px-3 h-9 rounded-xl bg-rose-500 text-white text-xs font-bold flex items-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>আবার</span>
                        </button>
                      </>
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
              {subjectDownloads.map((rec) => {
                const hasLocalVideo = Boolean(rec.hasLocalVideo || rec.localVideoUri);
                const hasLocalPdf = Boolean(rec.hasLocalPdf || rec.localPdfUri);
                return (
                <div
                  key={rec.itemId}
                  className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-800 p-4 space-y-3"
                >
                  {/* Header: Section Title + Class Number + Video Name + Export + Delete */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-xs font-semibold text-emerald-400 truncate">
                        {rec.sectionTitle || selectedMeta.name} · ক্লাস {rec.classNumber}
                      </p>
                      <h4 className="text-sm sm:text-base font-bold text-white truncate">
                        {rec.videoName}
                      </h4>
                      {rec.matchedFileName && (
                        <p className="text-[11px] text-cyan-300/90 truncate">
                          ডিভাইস ফাইল: {rec.matchedFileName}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {(hasLocalVideo || hasLocalPdf) && (
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await exportOfflineItemToPhone(rec.itemId, rec.videoName);
                            if (res.ok) {
                              if (res.localVideoUri || res.localPdfUri) {
                                await onRestoreMatchedRecords([
                                  {
                                    ...rec,
                                    localVideoUri: res.localVideoUri || rec.localVideoUri,
                                    localPdfUri: res.localPdfUri || rec.localPdfUri,
                                  },
                                ]);
                              }
                              setScanResultMsg(
                                res.folder
                                  ? `“${rec.videoName}” আপনার ফোনের ${res.folder} ফোল্ডারে সেভ করা হয়েছে।`
                                  : `“${rec.videoName}” আপনার মোবাইলের ফোল্ডার / Downloads-এ সেভ করা হয়েছে।`
                              );
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
                      disabled={!rec.videoUrl && !hasLocalVideo}
                      onClick={() => {
                        if (!isOnline && !hasLocalVideo) {
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
                      disabled={!rec.pdfUrl && !hasLocalPdf}
                      onClick={() => {
                        if (!isOnline && !hasLocalPdf) {
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
                );
              })}
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
