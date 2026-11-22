import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Calculator,
  ChevronRight,
  Cpu,
  FileText,
  Globe,
  Languages,
  PenTool,
  Play,
  PlayCircle,
  Sprout,
} from 'lucide-react';
import {
  ClassItem,
  DownloadRecord,
  DownloadTask,
  SUBJECT_LIST,
  SubjectDoc,
  SubjectMeta,
} from '../types';
import { LiquidDownloadBox } from './LiquidDownloadBox';

interface SubjectsViewProps {
  subjects: Record<string, SubjectDoc>;
  downloads: Record<string, DownloadRecord>;
  downloadTasks: Record<string, DownloadTask>;
  isOnline: boolean;
  onPlayVideo: (payload: {
    item: ClassItem;
    subjectId: string;
    sectionId: string;
    sectionTitle: string;
    classNumber: number;
  }) => void;
  onOpenPdf: (payload: { item: ClassItem; isDownloaded: boolean }) => void;
  onOfflineAlert: () => void;
}

const TOUR_SEEN_KEY = 'noor_elahi_subject_tour_seen_v1';

function getSeenTours(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(TOUR_SEEN_KEY) || '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

function markTourSeen(subjectId: string) {
  try {
    const map = getSeenTours();
    map[subjectId] = true;
    localStorage.setItem(TOUR_SEEN_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage error
  }
}

function SubjectIcon({ id, className }: { id: string; className?: string }) {
  switch (id) {
    case 'eng-1':
      return <Globe className={className} />;
    case 'eng-2':
      return <Languages className={className} />;
    case 'ban-1':
      return <BookOpen className={className} />;
    case 'ban-2':
      return <PenTool className={className} />;
    case 'math':
      return <Calculator className={className} />;
    case 'agri':
      return <Sprout className={className} />;
    case 'ict':
      return <Cpu className={className} />;
    default:
      return <BookOpen className={className} />;
  }
}

export const SubjectsView: React.FC<SubjectsViewProps> = ({
  subjects,
  downloads,
  downloadTasks,
  isOnline,
  onPlayVideo,
  onOpenPdf,
  onOfflineAlert,
}) => {
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourReadingAll, setTourReadingAll] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);

  const selectedMeta: SubjectMeta | undefined = useMemo(
    () => SUBJECT_LIST.find((s) => s.id === selectedSubjectId),
    [selectedSubjectId]
  );
  const selectedDoc = selectedSubjectId ? subjects[selectedSubjectId] : undefined;

  const openSubject = (subjectId: string) => {
    setSelectedSubjectId(subjectId);
    const seen = getSeenTours();
    const doc = subjects[subjectId];
    const hasDescriptions =
      Boolean(doc?.description?.trim()) ||
      Boolean(doc?.sections?.some((sec) => sec.description?.trim() || sec.title?.trim()));

    if (!seen[subjectId] && hasDescriptions) {
      setTourOpen(true);
      setTourReadingAll(false);
      setTourIndex(0);
    } else {
      setTourOpen(false);
    }
  };

  // --- Subject Grid Home (Matching Uploaded Reference Image 2 Styling & Color Grading) ---
  if (!selectedSubjectId || !selectedMeta) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-lg sm:text-xl font-bold text-white">বিষয়সমূহ</h2>
          <span className="text-xs font-medium text-fuchsia-300 font-mono-num">
            ৭টি বিষয়
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
          {SUBJECT_LIST.map((meta) => {
            const doc = subjects[meta.id];
            const sections = doc?.sections || [];
            let videoCount = 0;
            let pdfCount = 0;
            for (const sec of sections) {
              for (const item of sec.items || []) {
                if (item.videoUrl?.trim()) videoCount += 1;
                if (item.pdfUrl?.trim()) pdfCount += 1;
              }
            }

            return (
              <button
                key={meta.id}
                type="button"
                onClick={() => openSubject(meta.id)}
                className="group text-left rounded-3xl bg-[#0b1020] border border-slate-800/90 overflow-hidden shadow-xl hover:border-slate-700 active:scale-[0.98] transition-all flex flex-col"
              >
                {/* Vibrant Color-Graded Upper Card Banner */}
                <div
                  className={`relative bg-gradient-to-br ${meta.headerGradient} p-3.5 sm:p-4 overflow-hidden`}
                >
                  <SubjectIcon
                    id={meta.id}
                    className="w-14 h-14 text-white/15 absolute -right-2 -bottom-2 pointer-events-none"
                  />
                  <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-sm border border-white/25 flex items-center justify-center mb-3">
                    <SubjectIcon id={meta.id} className="w-5 h-5 text-white" />
                  </div>
                  <p className="text-[10px] font-bold tracking-wider text-white/85 uppercase truncate">
                    {meta.shortLabel}
                  </p>
                  <h3 className="text-sm sm:text-base font-bold text-white leading-snug mt-0.5 truncate">
                    {meta.name}
                  </h3>
                </div>

                {/* Lower Dark Surface with Inset Black Box showing Video & PDF counts */}
                <div className="p-3 sm:p-3.5 flex-1 flex flex-col justify-between gap-2.5 bg-[#0b1020]">
                  <p className="text-[11px] text-slate-400 line-clamp-1">
                    {doc?.description?.trim() || 'বিষয়ভিত্তিক ভিডিও ক্লাস ও PDF নোটস'}
                  </p>

                  {/* Black Inset Box for Video & PDF Count */}
                  <div className="rounded-2xl bg-[#050814] border border-slate-800/80 p-2.5 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono-num">
                      <span className="text-slate-300 font-medium">
                        {videoCount}টি ভিডিও
                      </span>
                      <span className={`font-semibold ${meta.accentText}`}>
                        {pdfCount}টি PDF
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800/90 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${meta.accentBar} transition-all`}
                        style={{
                          width: videoCount + pdfCount > 0 ? '100%' : '18%',
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-0.5 text-xs font-semibold text-fuchsia-400 group-hover:text-fuchsia-300">
                    <span>প্রবেশ করুন</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const sections = selectedDoc?.sections || [];
  const sectionsWithTitles = sections.filter((s) => s.title.trim().length > 0);

  return (
    <div className="space-y-5">
      {/* Subject Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setSelectedSubjectId(null)}
          className="min-w-[44px] min-h-[44px] rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-200 hover:bg-slate-800 transition"
          aria-label="বিষয়সমূহে ফিরে যান"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-medium ${selectedMeta.accentText}`}>
            {selectedMeta.shortLabel}
          </p>
          <h2 className="text-xl font-bold text-white truncate">{selectedMeta.name}</h2>
        </div>
        {(selectedDoc?.description || sectionsWithTitles.length > 0) && (
          <button
            type="button"
            onClick={() => {
              setTourOpen(true);
              setTourReadingAll(false);
              setTourIndex(0);
            }}
            className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white shrink-0"
          >
            নির্দেশিকা
          </button>
        )}
      </div>

      {/* Subject Description Box */}
      {selectedDoc?.description?.trim() && (
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 px-4 py-3 text-sm text-slate-300 leading-relaxed">
          {selectedDoc.description}
        </div>
      )}

      {/* First-Time Subject Guided Title Tour Modal */}
      {tourOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-700/80 p-6 space-y-5 shadow-2xl">
            {!tourReadingAll ? (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">{selectedMeta.name}</h3>
                    <p className="text-xs text-slate-400">
                      এই বিষয়ের শিরোনাম ও নির্দেশিকা সম্পর্কে দেখুন
                    </p>
                  </div>
                </div>
                {selectedDoc?.description && (
                  <p className="text-sm text-slate-300 bg-slate-950/70 rounded-2xl p-3.5 border border-slate-800">
                    {selectedDoc.description}
                  </p>
                )}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      markTourSeen(selectedMeta.id);
                      setTourOpen(false);
                    }}
                    className="flex-1 py-3 rounded-xl bg-slate-800 text-slate-300 text-sm font-semibold hover:bg-slate-700 transition"
                  >
                    পরে দেখব
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (sectionsWithTitles.length > 0) {
                        setTourReadingAll(true);
                        setTourIndex(0);
                      } else {
                        markTourSeen(selectedMeta.id);
                        setTourOpen(false);
                      }
                    }}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 text-sm font-bold shadow-lg shadow-emerald-500/20"
                  >
                    দেখুন
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono-num text-emerald-400 font-semibold">
                    শিরোনাম {tourIndex + 1} / {sectionsWithTitles.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      markTourSeen(selectedMeta.id);
                      setTourOpen(false);
                    }}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    বন্ধ করুন
                  </button>
                </div>

                <div className="rounded-2xl bg-slate-950 border border-slate-800 p-4 space-y-2">
                  <h4 className="text-base font-bold text-white">
                    {sectionsWithTitles[tourIndex]?.title}
                  </h4>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {sectionsWithTitles[tourIndex]?.description?.trim() ||
                      'এই শিরোনামের অধীনে নির্ধারিত ক্লাস ও নোটস সাজানো হয়েছে।'}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {tourIndex + 1 < sectionsWithTitles.length ? (
                    <button
                      type="button"
                      onClick={() => setTourIndex((i) => i + 1)}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 text-sm font-bold"
                    >
                      নেক্সট
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        markTourSeen(selectedMeta.id);
                        setTourOpen(false);
                      }}
                      className="w-full py-3 rounded-xl bg-emerald-500 text-slate-950 text-sm font-bold"
                    >
                      সব দেখা সম্পন্ন · শুরু করুন
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sections & Classes */}
      {sections.length === 0 ? (
        <div className="rounded-3xl bg-slate-900/70 border border-slate-800 p-8 text-center space-y-2">
          <p className="text-sm font-semibold text-slate-300">এখনও কিছু আপলোড হয়নি</p>
          <p className="text-xs text-slate-500">
            অ্যাডমিন File Vault থেকে কন্টেন্ট যোগ করলে এখানে দেখা যাবে।
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => {
            const uploadedVideoCount = (section.items || []).filter((i) =>
              Boolean(i.videoUrl?.trim())
            ).length;
            let classCounter = 0;

            return (
              <div
                key={section.id}
                className="rounded-3xl bg-slate-900/80 border border-slate-800 p-4 sm:p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
                  <div className="space-y-1 min-w-0">
                    <h3 className="text-base sm:text-lg font-bold text-white">
                      {section.title || 'শিরোনামহীন'}
                    </h3>
                    {section.description?.trim() && (
                      <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                        {section.description}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs font-mono-num font-semibold text-emerald-400 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1">
                    {uploadedVideoCount}টি
                  </span>
                </div>

                {(!section.items || section.items.length === 0) ? (
                  <div className="rounded-2xl bg-slate-950/70 border border-slate-800/70 p-4 text-center text-xs text-slate-400">
                    এখনও কিছু আপলোড হয়নি
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {section.items.map((item) => {
                      const hasContent = Boolean(item.videoUrl?.trim() || item.pdfUrl?.trim());
                      if (!hasContent) {
                        return (
                          <div
                            key={item.id}
                            className="rounded-2xl bg-slate-950/70 border border-slate-800/70 p-4 flex items-center justify-between"
                          >
                            <span className="text-xs font-medium text-slate-400">
                              {item.name?.trim() || 'নতুন স্লট'}
                            </span>
                            <span className="text-xs text-slate-500">
                              এখনও কিছু আপলোড হয়নি
                            </span>
                          </div>
                        );
                      }

                      classCounter += 1;
                      const currentClassNum = classCounter;
                      const isDownloaded = Boolean(downloads[item.id]);
                      const activeTask = downloadTasks[item.id];
                      const displayName = item.name?.trim() || `ক্লাস ${currentClassNum}`;

                      return (
                        <div
                          key={item.id}
                          className="rounded-3xl bg-slate-950/90 border border-slate-800 p-4 flex flex-col justify-between gap-3.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0">
                              <span className="text-[11px] font-semibold text-cyan-400">
                                ক্লাস {currentClassNum}
                              </span>
                              <h4 className="text-sm sm:text-base font-bold text-white leading-snug">
                                {displayName}
                              </h4>
                              {item.duration?.trim() && (
                                <p className="text-[11px] font-mono-num text-slate-400">
                                  সময়কাল: {item.duration}
                                </p>
                              )}
                            </div>
                            <PlayCircle className="w-6 h-6 text-slate-500 shrink-0" />
                          </div>

                          <div className="space-y-2.5">
                            <div className="flex items-center gap-2">
                              {item.videoUrl?.trim() && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!isOnline && !isDownloaded) {
                                      onOfflineAlert();
                                      return;
                                    }
                                    onPlayVideo({
                                      item: { ...item, name: displayName },
                                      subjectId: selectedMeta.id,
                                      sectionId: section.id,
                                      sectionTitle: section.title || selectedMeta.name,
                                      classNumber: currentClassNum,
                                    });
                                  }}
                                  className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/15 active:scale-[0.98] transition"
                                >
                                  <Play className="w-4 h-4 fill-current shrink-0" />
                                  <span>দেখুন</span>
                                </button>
                              )}

                              {item.pdfUrl?.trim() && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!isOnline && !isDownloaded) {
                                      onOfflineAlert();
                                      return;
                                    }
                                    onOpenPdf({
                                      item: { ...item, name: displayName },
                                      isDownloaded,
                                    });
                                  }}
                                  className="h-12 px-4 rounded-2xl bg-slate-900 border border-indigo-500/35 hover:border-indigo-400 text-indigo-300 font-semibold text-xs flex items-center justify-center gap-1.5 transition shrink-0"
                                >
                                  <FileText className="w-4 h-4 shrink-0" />
                                  <span>PDF</span>
                                </button>
                              )}
                            </div>

                            <LiquidDownloadBox
                              itemId={item.id}
                              subjectId={selectedMeta.id}
                              sectionId={section.id}
                              sectionTitle={section.title || selectedMeta.name}
                              classNumber={currentClassNum}
                              videoName={displayName}
                              videoUrl={item.videoUrl}
                              pdfUrl={item.pdfUrl}
                              isDownloaded={isDownloaded}
                              task={activeTask}
                              isOnline={isOnline}
                              onOfflineAttempt={onOfflineAlert}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
