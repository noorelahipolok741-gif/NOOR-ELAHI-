import React, { useEffect, useRef, useState } from 'react';
import Plyr from 'plyr';
import Hls from 'hls.js';
import {
  ArrowLeft,
  ExternalLink,
  FastForward,
  FileText,
  Loader2,
  Pause,
  Play,
  Rewind,
  RotateCcw,
} from 'lucide-react';
import { DownloadTask } from '../types';
import {
  encodeProxyParam,
  extractDirectVideoEmbedUrl,
  getOfflineMedia,
  isHlsUrl,
  normalizeMediaUrl,
  resolveHlsProxyUrl,
  resolveStreamUrl,
} from '../lib/offlineStorage';
import { LiquidDownloadBox } from './LiquidDownloadBox';

interface PlyrVideoPlayerProps {
  itemId: string;
  subjectId: string;
  sectionId: string;
  sectionTitle: string;
  classNumber: number;
  videoName: string;
  videoUrl: string;
  pdfUrl: string;
  durationLabel?: string;
  initialPosition: number;
  isDownloaded: boolean;
  downloadTask?: DownloadTask;
  isOnline: boolean;
  onSaveProgress: (itemId: string, currentTime: number, duration: number) => void;
  onOpenPdf: () => void;
  onOfflineAttempt: () => void;
  onClose: () => void;
}

const STANDARD_QUALITIES = [1080, 720, 360, 144];

function formatDurationMinutes(sec: number): string {
  if (!sec || !Number.isFinite(sec)) return '';
  const mins = Math.floor(sec / 60);
  const rem = Math.floor(sec % 60);
  return `${mins}:${rem.toString().padStart(2, '0')} মিনিট`;
}

export const PlyrVideoPlayer: React.FC<PlyrVideoPlayerProps> = ({
  itemId,
  subjectId,
  sectionId,
  sectionTitle,
  classNumber,
  videoName,
  videoUrl,
  pdfUrl,
  durationLabel,
  initialPosition,
  isDownloaded,
  downloadTask,
  isOnline,
  onSaveProgress,
  onOpenPdf,
  onOfflineAttempt,
  onClose,
}) => {
  const containerWrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const plyrRef = useRef<Plyr | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const lastTapRef = useRef<{ time: number; side: 'left' | 'right' } | null>(null);
  const singleTapTimerRef = useRef<number | null>(null);
  const fallbackHandlerRef = useRef<(() => void) | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [seekBadge, setSeekBadge] = useState<'+10s' | '-10s' | null>(null);
  const [detectedDuration, setDetectedDuration] = useState<number>(0);

  // Block Plyr's synthetic CustomEvent('error', { bubbles: true }) from bubbling to window
  useEffect(() => {
    const wrap = containerWrapRef.current;
    if (!wrap) return;
    const stopErrorBubble = (e: Event) => {
      e.stopPropagation();
    };
    wrap.addEventListener('error', stopErrorBubble, false);
    return () => {
      wrap.removeEventListener('error', stopErrorBubble, false);
    };
  }, []);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    let progressInterval: number | null = null;
    fallbackHandlerRef.current = null;

    async function initPlayer() {
      setIsBuffering(true);
      setPlayerError(null);
      setEmbedUrl(null);

      let sourceUrl = '';
      let usingOfflineBlob = false;

      try {
        const offline = await getOfflineMedia(itemId);
        if (offline?.videoBlob && !cancelled) {
          objectUrl = URL.createObjectURL(offline.videoBlob);
          sourceUrl = objectUrl;
          usingOfflineBlob = true;
        }
      } catch {
        // Continue to network URL
      }

      if (cancelled) return;

      if (!usingOfflineBlob) {
        const directEmbed = extractDirectVideoEmbedUrl(videoUrl);
        if (directEmbed) {
          setEmbedUrl(directEmbed);
          setIsBuffering(false);
          return;
        }
        sourceUrl = resolveStreamUrl(videoUrl, 'video');
      }

      const videoEl = videoRef.current;
      if (!videoEl || cancelled) return;

      if (!sourceUrl) {
        setIsBuffering(false);
        setPlayerError('ভিডিও লিংক পাওয়া যায়নি।');
        return;
      }

      const cleanupActivePlayer = () => {
        if (progressInterval) {
          clearInterval(progressInterval);
          progressInterval = null;
        }
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        if (plyrRef.current) {
          plyrRef.current.destroy();
          plyrRef.current = null;
        }
        if (videoRef.current) {
          videoRef.current.removeAttribute('src');
        }
      };

      const setupPlyrInstance = (qualityOptions?: {
        default: number;
        options: number[];
        forced?: boolean;
        onChange?: (newQuality: number) => void;
      }) => {
        if (plyrRef.current) {
          plyrRef.current.destroy();
          plyrRef.current = null;
        }

        const player = new Plyr(videoEl, {
          iconUrl: '/plyr.svg',
          controls: [
            'play',
            'progress',
            'current-time',
            'duration',
            'mute',
            'volume',
            'settings',
            'fullscreen',
          ],
          settings: ['quality', 'speed'],
          speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
          quality: qualityOptions || {
            default: 0,
            options: [0, 1080, 720, 360, 144],
            forced: true,
            onChange: () => {},
          },
          i18n: {
            qualityLabel: { 0: 'Auto' },
            speed: 'স্পিড',
            quality: 'কোয়ালিটি',
          },
          clickToPlay: false,
          disableContextMenu: true,
        });

        plyrRef.current = player;

        player.elements.container?.addEventListener('error', (e) => {
          e.stopPropagation();
        });

        const applyInitialSeek = () => {
          if (videoEl.duration && Number.isFinite(videoEl.duration)) {
            setDetectedDuration(videoEl.duration);
            try {
              if (initialPosition > 2 && initialPosition < videoEl.duration - 2) {
                videoEl.currentTime = initialPosition;
              }
            } catch {
              // Ignore seek failure
            }
          }
          setIsBuffering(false);
          setPlayerError(null);
        };

        player.on('ready', () => {
          if (videoEl.readyState >= 1) {
            applyInitialSeek();
          }
        });

        player.on('loadedmetadata', applyInitialSeek);
        player.on('canplay', () => {
          setIsBuffering(false);
          setPlayerError(null);
        });
        player.on('waiting', () => setIsBuffering(true));
        player.on('playing', () => {
          setIsBuffering(false);
          setIsPlaying(true);
          setPlayerError(null);
        });
        player.on('play', () => setIsPlaying(true));
        player.on('pause', () => {
          setIsPlaying(false);
          setOverlayVisible(true);
          onSaveProgress(itemId, videoEl.currentTime || 0, videoEl.duration || 0);
        });
        player.on('ended', () => {
          setIsPlaying(false);
          setOverlayVisible(true);
          onSaveProgress(itemId, videoEl.duration || 0, videoEl.duration || 0);
        });
        player.on('error', () => {
          if (!videoEl.getAttribute('src') && !hlsRef.current) return;
          fallbackHandlerRef.current?.();
        });

        if (progressInterval) clearInterval(progressInterval);
        progressInterval = window.setInterval(() => {
          if (videoEl && !videoEl.paused && videoEl.currentTime > 0) {
            onSaveProgress(itemId, videoEl.currentTime, videoEl.duration || 0);
          }
        }, 3000);
      };

      const startHlsPlayback = (hlsTargetUrl: string, allowProxyFallback: boolean) => {
        if (cancelled) return;
        cleanupActivePlayer();
        if (!Hls.isSupported()) {
          setupPlyrInstance();
          videoEl.src = hlsTargetUrl;
          videoEl.load();
          return;
        }
        const hls = new Hls({
          enableWorker: false,
          lowLatencyMode: true,
          capLevelToPlayerSize: true,
          abrEwmaDefaultEstimate: 500000,
        });
        hlsRef.current = hls;
        hls.loadSource(hlsTargetUrl);
        hls.attachMedia(videoEl);

        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          if (cancelled) return;
          const availableHeights = Array.from(
            new Set(data.levels.map((l) => l.height).filter((h) => h > 0))
          );
          const mergedOptions = [
            0,
            ...Array.from(new Set([...availableHeights, ...STANDARD_QUALITIES])),
          ].sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : b - a));

          setupPlyrInstance({
            default: 0,
            options: mergedOptions,
            forced: true,
            onChange: (newQuality: number) => {
              if (!hlsRef.current) return;
              if (newQuality === 0) {
                hlsRef.current.currentLevel = -1;
              } else {
                const idx = hlsRef.current.levels.findIndex((l) => l.height === newQuality);
                if (idx !== -1) {
                  hlsRef.current.currentLevel = idx;
                }
              }
            },
          });
        });

        let fatalRetries = 0;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            fatalRetries += 1;
            if (fatalRetries <= 1 && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else if (fatalRetries <= 1 && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else if (allowProxyFallback && !hlsTargetUrl.startsWith('/api/proxy-hls')) {
              startHlsPlayback(resolveHlsProxyUrl(hlsTargetUrl), false);
            } else {
              fallbackHandlerRef.current?.();
            }
          }
        });
      };

      let resolvedAttempted = false;
      const triggerSmartResolutionOrError = async () => {
        if (cancelled) return;
        if (usingOfflineBlob || resolvedAttempted) {
          setIsBuffering(false);
          setIsPlaying(false);
          setPlayerError('ভিডিওটি চালু করা যায়নি। লিংক বা ইন্টারনেট সংযোগ পরীক্ষা করুন।');
          return;
        }
        resolvedAttempted = true;
        setIsBuffering(true);

        try {
          const res = await fetch(
            `/api/resolve-media?u=${encodeURIComponent(encodeProxyParam(normalizeMediaUrl(videoUrl)))}&kind=video`
          );
          const data = (await res.json()) as {
            type?: 'direct' | 'hls' | 'embed' | 'error';
            streamUrl?: string;
            hlsUrl?: string;
            proxiedHlsUrl?: string;
            embedUrl?: string;
            error?: string;
          };
          if (cancelled) return;

          if (data.type === 'embed' && data.embedUrl) {
            cleanupActivePlayer();
            setIsBuffering(false);
            setIsPlaying(false);
            setPlayerError(null);
            setEmbedUrl(data.embedUrl);
            return;
          }

          if (data.type === 'hls' && (data.proxiedHlsUrl || data.hlsUrl)) {
            startHlsPlayback(data.proxiedHlsUrl || data.hlsUrl!, false);
            return;
          }

          if (data.type === 'direct' && data.streamUrl && data.streamUrl !== sourceUrl) {
            cleanupActivePlayer();
            setupPlyrInstance();
            videoEl.src = data.streamUrl;
            videoEl.load();
            return;
          }

          setIsBuffering(false);
          setIsPlaying(false);
          setPlayerError(data.error || 'এই লিংকে সরাসরি কোনো ভিডিও পাওয়া যায়নি।');
        } catch {
          if (cancelled) return;
          setIsBuffering(false);
          setIsPlaying(false);
          setPlayerError('ভিডিওটি চালু করা যায়নি। ইন্টারনেট সংযোগ বা ভিডিও লিংক পরীক্ষা করুন।');
        }
      };

      fallbackHandlerRef.current = () => {
        void triggerSmartResolutionOrError();
      };

      if (!usingOfflineBlob && isHlsUrl(sourceUrl)) {
        startHlsPlayback(sourceUrl, true);
      } else {
        setupPlyrInstance();
        videoEl.src = sourceUrl;
        videoEl.load();
        if (videoEl.readyState >= 1) {
          setIsBuffering(false);
          setPlayerError(null);
        }
      }
    }

    initPlayer();

    return () => {
      cancelled = true;
      fallbackHandlerRef.current = null;
      if (progressInterval) clearInterval(progressInterval);
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
      }
      if (videoRef.current && videoRef.current.currentTime > 0) {
        onSaveProgress(
          itemId,
          videoRef.current.currentTime,
          videoRef.current.duration || 0
        );
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (plyrRef.current) {
        plyrRef.current.destroy();
        plyrRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.removeAttribute('src');
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [itemId, videoUrl, reloadKey]);

  const togglePlayPause = () => {
    const player = plyrRef.current;
    if (!player) return;
    if (player.playing) {
      player.pause();
      setOverlayVisible(true);
    } else {
      Promise.resolve(player.play()).catch(() => {
        setIsBuffering(false);
      });
    }
  };

  const handleSurfaceInteraction = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const side: 'left' | 'right' = relX < rect.width / 2 ? 'left' : 'right';
    const now = Date.now();

    if (lastTapRef.current && now - lastTapRef.current.time < 280 && lastTapRef.current.side === side) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapRef.current = null;

      const videoEl = videoRef.current;
      if (videoEl) {
        if (side === 'right') {
          videoEl.currentTime = Math.min(videoEl.duration || videoEl.currentTime + 10, videoEl.currentTime + 10);
          setSeekBadge('+10s');
        } else {
          videoEl.currentTime = Math.max(0, videoEl.currentTime - 10);
          setSeekBadge('-10s');
        }
        setTimeout(() => setSeekBadge(null), 650);
      }
      return;
    }

    lastTapRef.current = { time: now, side };
    singleTapTimerRef.current = window.setTimeout(() => {
      setOverlayVisible((prev) => !prev);
      lastTapRef.current = null;
    }, 260);
  };

  const openExternalVideo = () => {
    const target = normalizeMediaUrl(videoUrl);
    if (!target) return;
    const a = document.createElement('a');
    a.href = target;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#020617] flex flex-col overflow-y-auto overflow-x-hidden overscroll-none">
      {/* Top Bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800/80 bg-slate-950/90 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="min-w-[40px] min-h-[40px] rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-200 hover:bg-slate-800 transition"
          aria-label="পিছনে যান"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-emerald-400 font-medium truncate">
            {sectionTitle} · ক্লাস {classNumber}
          </p>
          <h2 className="text-sm font-bold text-white truncate">{videoName}</h2>
        </div>
        {isOnline && videoUrl && (
          <button
            type="button"
            onClick={openExternalVideo}
            className="shrink-0 h-9 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white flex items-center gap-1.5"
            title="ব্রাউজারে খুলুন"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">ব্রাউজার</span>
          </button>
        )}
      </div>

      {/* Main Content Container */}
      <div className="w-full max-w-4xl mx-auto p-4 space-y-5">
        {/* Video Player Container */}
        <div
          ref={containerWrapRef}
          className="relative rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-2xl"
        >
          {embedUrl ? (
            <div className="relative w-full aspect-video bg-black">
              <iframe
                src={embedUrl}
                title={videoName}
                className="w-full h-full border-0"
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                preload="metadata"
                onError={(e) => {
                  e.stopPropagation();
                  if (!e.currentTarget.getAttribute('src')) return;
                  fallbackHandlerRef.current?.();
                }}
                className="w-full aspect-video"
              />

              {/* Interactive Double-Tap & Floating Overlay Layer */}
              <div
                onClick={handleSurfaceInteraction}
                className="absolute inset-x-0 top-0 bottom-12 z-20 flex flex-col justify-between cursor-pointer"
              >
                <div
                  className={`px-4 py-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent transition-opacity duration-200 ${
                    overlayVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  <p className="text-xs sm:text-sm font-semibold text-white truncate drop-shadow">
                    {videoName}
                  </p>
                </div>

                <div className="flex items-center justify-center relative">
                  {seekBadge === '-10s' && (
                    <div className="absolute left-8 flex items-center gap-1.5 rounded-full bg-black/75 px-3.5 py-2 text-xs font-bold text-white animate-pulse">
                      <Rewind className="w-4 h-4 text-cyan-400" />
                      <span>১০ সে.</span>
                    </div>
                  )}

                  {playerError ? (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="mx-4 max-w-xs rounded-2xl bg-slate-950/95 border border-rose-500/40 px-4 py-3.5 text-center space-y-3"
                    >
                      <p className="text-xs text-rose-200 leading-relaxed">{playerError}</p>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => setReloadKey((k) => k + 1)}
                          className="px-4 py-1.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold flex items-center gap-1.5"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>আবার চেষ্টা করুন</span>
                        </button>
                        {isOnline && videoUrl && (
                          <button
                            type="button"
                            onClick={openExternalVideo}
                            className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>খুলুন</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : isBuffering ? (
                    <div className="w-16 h-16 rounded-full bg-black/70 border border-white/20 flex items-center justify-center">
                      <Loader2 className="w-7 h-7 text-emerald-400 animate-spin" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePlayPause();
                      }}
                      className={`w-16 h-16 rounded-full bg-slate-950/75 backdrop-blur-md border border-white/25 flex items-center justify-center text-white shadow-xl transition-all duration-200 active:scale-90 ${
                        overlayVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'
                      }`}
                      aria-label={isPlaying ? 'পজ করুন' : 'চালু করুন'}
                    >
                      {isPlaying ? (
                        <Pause className="w-7 h-7 fill-current" />
                      ) : (
                        <Play className="w-7 h-7 fill-current ml-0.5" />
                      )}
                    </button>
                  )}

                  {seekBadge === '+10s' && (
                    <div className="absolute right-8 flex items-center gap-1.5 rounded-full bg-black/75 px-3.5 py-2 text-xs font-bold text-white animate-pulse">
                      <span>১০ সে.</span>
                      <FastForward className="w-4 h-4 text-cyan-400" />
                    </div>
                  )}
                </div>

                <div className="h-4" />
              </div>
            </>
          )}
        </div>

        {/* Video Info & Action Controls Below Player */}
        <div className="rounded-3xl bg-slate-900/90 border border-slate-800 p-5 space-y-4">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white">{videoName}</h3>
            <p className="text-xs font-mono-num text-slate-400">
              {detectedDuration > 0
                ? `সময়কাল: ${formatDurationMinutes(detectedDuration)}`
                : durationLabel
                ? `সময়কাল: ${durationLabel}`
                : 'ভিডিও প্লেয়ার প্রস্তুত'}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <LiquidDownloadBox
              itemId={itemId}
              subjectId={subjectId}
              sectionId={sectionId}
              sectionTitle={sectionTitle}
              classNumber={classNumber}
              videoName={videoName}
              videoUrl={videoUrl}
              pdfUrl={pdfUrl}
              isDownloaded={isDownloaded}
              task={downloadTask}
              isOnline={isOnline}
              onOfflineAttempt={onOfflineAttempt}
            />

            {pdfUrl ? (
              <button
                type="button"
                onClick={onOpenPdf}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-indigo-600/25 to-violet-600/25 border border-indigo-400/35 hover:border-indigo-400/60 flex items-center justify-center gap-2 px-4 text-sm font-semibold text-indigo-200 transition active:scale-[0.98]"
              >
                <FileText className="w-4 h-4 text-indigo-300 shrink-0" />
                <span>PDF দেখুন</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
