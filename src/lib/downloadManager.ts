import { DownloadRecord, DownloadTask } from '../types';
import {
  extractGoogleDriveFileId,
  isHlsUrl,
  isUnsupportedVideoHost,
  normalizeMediaUrl,
  resolveDownloadProxyUrl,
  sanitizeBaseFilename,
  saveOfflineMedia,
  saveToInternalDirectoryIfPermitted,
} from './offlineStorage';

interface InternalTaskState {
  task: DownloadTask;
  abortController: AbortController | null;
  videoChunks: Uint8Array[];
  videoDownloaded: number;
  videoTotal: number;
  videoDone: boolean;
  pdfBlob?: Blob;
  pdfDone: boolean;
  pausedByNetwork: boolean;
  lastEmitAt: number;
}

type Listener = (tasks: Record<string, DownloadTask>) => void;
type CompleteListener = (record: DownloadRecord) => void;

const MAX_CONCURRENT = 3;

async function readProxyErrorMessage(res: Response, fallback: string, sourceUrl?: string): Promise<string> {
  try {
    const txt = await res.text();
    if (txt) {
      try {
        const data = JSON.parse(txt) as { error?: string };
        if (data?.error) return data.error;
      } catch {
        // Not JSON
      }
    }
  } catch {
    // Ignore read error
  }
  if (res.status === 403 && sourceUrl && extractGoogleDriveFileId(sourceUrl)) {
    return 'এই Google Drive ফাইলটি প্রাইভেট (Restricted) করা আছে। Drive-এ গিয়ে "Anyone with the link" চালু করুন।';
  }
  return fallback;
}

async function blobHasPdfHeader(blob: Blob): Promise<boolean> {
  try {
    const slice = blob.slice(0, Math.min(1024, blob.size));
    const bytes = new Uint8Array(await slice.arrayBuffer());
    for (let i = 0; i <= bytes.length - 5; i++) {
      if (
        bytes[i] === 0x25 &&
        bytes[i + 1] === 0x50 &&
        bytes[i + 2] === 0x44 &&
        bytes[i + 3] === 0x46 &&
        bytes[i + 4] === 0x2d
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

class DownloadManager {
  private tasks = new Map<string, InternalTaskState>();
  private listeners = new Set<Listener>();
  private completeListeners = new Set<CompleteListener>();
  private userUid = '';

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', () => {
        for (const [, state] of this.tasks) {
          if (state.task.status === 'downloading') {
            state.pausedByNetwork = true;
            this.pauseTask(state.task.itemId, true);
          }
        }
      });

      window.addEventListener('online', () => {
        for (const [, state] of this.tasks) {
          if (state.task.status === 'paused' && state.pausedByNetwork) {
            state.pausedByNetwork = false;
            this.resumeTask(state.task.itemId);
          }
        }
      });
    }
  }

  setUid(uid: string) {
    this.userUid = uid;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.getSnapshot());
    return () => this.listeners.delete(fn);
  }

  onComplete(fn: CompleteListener): () => void {
    this.completeListeners.add(fn);
    return () => this.completeListeners.delete(fn);
  }

  private emit(force = false) {
    const now = Date.now();
    const snap = this.getSnapshot();
    if (!force) {
      // Throttle UI emissions smoothly during high-speed streaming
      let shouldEmit = false;
      for (const [, st] of this.tasks) {
        if (now - st.lastEmitAt >= 120) {
          st.lastEmitAt = now;
          shouldEmit = true;
        }
      }
      if (!shouldEmit) return;
    }
    for (const fn of this.listeners) {
      fn(snap);
    }
  }

  getSnapshot(): Record<string, DownloadTask> {
    const out: Record<string, DownloadTask> = {};
    for (const [id, st] of this.tasks) {
      out[id] = { ...st.task };
    }
    return out;
  }

  startDownload(params: {
    itemId: string;
    subjectId: string;
    sectionId: string;
    sectionTitle: string;
    classNumber: number;
    videoName: string;
    videoUrl: string;
    pdfUrl: string;
    alreadyDownloaded?: boolean;
  }) {
    if (params.alreadyDownloaded) return;

    const cleanVideoUrl = (params.videoUrl || '').trim();
    const cleanPdfUrl = (params.pdfUrl || '').trim();

    if (!cleanVideoUrl && !cleanPdfUrl) {
      this.tasks.set(params.itemId, {
        task: {
          itemId: params.itemId,
          subjectId: params.subjectId,
          sectionId: params.sectionId,
          sectionTitle: params.sectionTitle,
          classNumber: params.classNumber,
          videoName: params.videoName,
          videoUrl: '',
          pdfUrl: '',
          status: 'error',
          progress: 0,
          downloadedBytes: 0,
          totalBytes: 0,
          errorMessage: 'ডাউনলোডের জন্য কোনো ভিডিও বা PDF লিংক দেওয়া নেই।',
        },
        abortController: null,
        videoChunks: [],
        videoDownloaded: 0,
        videoTotal: 0,
        videoDone: true,
        pdfDone: true,
        pausedByNetwork: false,
        lastEmitAt: 0,
      });
      this.emit(true);
      return;
    }

    const existing = this.tasks.get(params.itemId);
    if (existing && (existing.task.status === 'downloading' || existing.task.status === 'completed')) {
      return;
    }

    if (existing && existing.task.status === 'paused') {
      this.resumeTask(params.itemId);
      return;
    }

    if (existing && existing.task.status === 'error') {
      this.tasks.delete(params.itemId);
    }

    const activeCount = Array.from(this.tasks.values()).filter(
      (s) => s.task.status === 'downloading'
    ).length;

    const initialState: InternalTaskState = {
      task: {
        itemId: params.itemId,
        subjectId: params.subjectId,
        sectionId: params.sectionId,
        sectionTitle: params.sectionTitle,
        classNumber: params.classNumber,
        videoName: params.videoName,
        videoUrl: cleanVideoUrl,
        pdfUrl: cleanPdfUrl,
        status: activeCount < MAX_CONCURRENT ? 'downloading' : 'paused',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
      },
      abortController: null,
      videoChunks: [],
      videoDownloaded: 0,
      videoTotal: 0,
      videoDone: !cleanVideoUrl,
      pdfDone: !cleanPdfUrl,
      pausedByNetwork: false,
      lastEmitAt: Date.now(),
    };

    this.tasks.set(params.itemId, initialState);
    this.emit(true);

    if (activeCount < MAX_CONCURRENT) {
      this.runTask(params.itemId);
    }
  }

  pauseTask(itemId: string, byNetwork = false) {
    const state = this.tasks.get(itemId);
    if (!state) return;
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
    state.pausedByNetwork = byNetwork;
    state.task.status = 'paused';
    this.emit(true);
    this.pumpQueue();
  }

  resumeTask(itemId: string) {
    const state = this.tasks.get(itemId);
    if (!state) return;
    if (!navigator.onLine) {
      state.pausedByNetwork = true;
      state.task.status = 'paused';
      this.emit(true);
      return;
    }
    state.pausedByNetwork = false;
    state.task.status = 'downloading';
    state.task.errorMessage = undefined;
    this.emit(true);
    this.runTask(itemId);
  }

  retryTask(itemId: string) {
    const state = this.tasks.get(itemId);
    if (!state) return;
    if (!navigator.onLine) {
      state.task.status = 'error';
      state.task.errorMessage = 'ইন্টারনেট সংযোগ নেই। অনলাইনে এসে আবার চেষ্টা করুন।';
      this.emit(true);
      return;
    }
    state.task.status = 'downloading';
    state.task.errorMessage = undefined;
    this.emit(true);
    this.runTask(itemId);
  }

  cancelTask(itemId: string) {
    const state = this.tasks.get(itemId);
    if (!state) return;
    if (state.abortController) {
      state.abortController.abort();
    }
    this.tasks.delete(itemId);
    this.emit(true);
    this.pumpQueue();
  }

  private pumpQueue() {
    const activeCount = Array.from(this.tasks.values()).filter(
      (s) => s.task.status === 'downloading'
    ).length;
    if (activeCount >= MAX_CONCURRENT) return;
    for (const [id, state] of this.tasks) {
      if (state.task.status === 'paused' && !state.pausedByNetwork && state.task.progress === 0) {
        state.task.status = 'downloading';
        this.emit(true);
        this.runTask(id);
        break;
      }
    }
  }

  private async runTask(itemId: string) {
    const state = this.tasks.get(itemId);
    if (!state) return;

    const controller = new AbortController();
    state.abortController = controller;
    const baseName = sanitizeBaseFilename(state.task.videoName || `Class_${state.task.classNumber}`);

    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
        navigator.storage.persist().catch(() => {});
      }

      // Validate video link format before fetching
      if (!state.videoDone && state.task.videoUrl) {
        if (isUnsupportedVideoHost(state.task.videoUrl) || isHlsUrl(state.task.videoUrl)) {
          if (state.task.pdfUrl) {
            // Class has YouTube/HLS video plus downloadable PDF: skip video cleanly and download PDF
            state.videoDone = true;
          } else if (isUnsupportedVideoHost(state.task.videoUrl)) {
            throw new Error('YouTube/Vimeo লিংক সরাসরি ডাউনলোড করা যায় না; Google Drive বা MP4 লিংক ব্যবহার করুন।');
          } else {
            throw new Error('HLS (.m3u8) স্ট্রিম ডাউনলোড সমর্থিত নয়; Google Drive বা MP4 লিংক ব্যবহার করুন।');
          }
        } else {
          const proxyVideoUrl = resolveDownloadProxyUrl(state.task.videoUrl, `${baseName}.mp4`, 'video');
          const headers: Record<string, string> = {};
          if (state.videoDownloaded > 0) {
            headers['Range'] = `bytes=${state.videoDownloaded}-`;
          }

          const res = await fetch(proxyVideoUrl, {
            headers,
            signal: controller.signal,
          });

          if (!res.ok && res.status !== 206) {
            let resolvedType = '';
            let serverMsg = '';
            try {
              const rawErr = await res.text();
              if (rawErr) {
                const parsed = JSON.parse(rawErr) as { error?: string; resolvedType?: string };
                resolvedType = parsed.resolvedType || '';
                serverMsg = parsed.error || '';
              }
            } catch {
              // Ignore parse error
            }
            if ((resolvedType === 'embed' || resolvedType === 'hls') && state.task.pdfUrl) {
              state.videoDone = true;
            } else {
              throw new Error(
                serverMsg ||
                  (res.status === 403 && extractGoogleDriveFileId(state.task.videoUrl)
                    ? 'এই Google Drive ফাইলটি প্রাইভেট (Restricted) করা আছে। Drive-এ গিয়ে "Anyone with the link" চালু করুন।'
                    : `ভিডিও ডাউনলোড ব্যর্থ হয়েছে (${res.status})`)
              );
            }
          } else {
            const ct = (res.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('text/html')) {
              if (state.task.pdfUrl) {
                state.videoDone = true;
              } else {
                throw new Error('ভিডিও লিংকটি সরাসরি ডাউনলোডযোগ্য নয় (Drive এ পাবলিক এক্সেস দিন)।');
              }
            } else {
              // If server ignored Range and returned 200, reset offset
              if (res.status === 200 && state.videoDownloaded > 0) {
                state.videoChunks = [];
                state.videoDownloaded = 0;
              }

              const contentLenHeader = res.headers.get('content-length');
              const contentRangeHeader = res.headers.get('content-range');
              if (contentRangeHeader) {
                const totalMatch = contentRangeHeader.match(/\/(\d+)$/);
                if (totalMatch?.[1]) state.videoTotal = Number(totalMatch[1]);
              } else if (contentLenHeader) {
                state.videoTotal = state.videoDownloaded + Number(contentLenHeader);
              }

              state.task.totalBytes = state.videoTotal || state.task.totalBytes;
              this.emit(true);

              if (res.body) {
                const reader = res.body.getReader();
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (value) {
                    state.videoChunks.push(value);
                    state.videoDownloaded += value.byteLength;
                    state.task.downloadedBytes = state.videoDownloaded;
                    if (state.videoTotal > 0) {
                      const videoRatio = Math.min(1, state.videoDownloaded / state.videoTotal);
                      state.task.progress = state.task.pdfUrl
                        ? Math.round(videoRatio * 90)
                        : Math.round(videoRatio * 100);
                    } else {
                      state.task.progress = Math.min(88, Math.max(5, state.task.progress + 1));
                    }
                    this.emit(false);
                  }
                }
              } else {
                const buf = new Uint8Array(await res.arrayBuffer());
                state.videoChunks.push(buf);
                state.videoDownloaded = buf.byteLength;
                state.task.downloadedBytes = buf.byteLength;
                state.task.totalBytes = buf.byteLength;
                state.task.progress = state.task.pdfUrl ? 90 : 100;
              }
              state.videoDone = true;
              this.emit(true);
            }
          }
        }
      }

      // 2. Download PDF alongside Video (with direct CORS fallback & %PDF- validation)
      if (!state.pdfDone && state.task.pdfUrl) {
        const hasVideoAlready = state.videoChunks.length > 0;
        let fetchedPdfBlob: Blob | undefined;
        let pdfFailureReason = '';

        try {
          const proxyPdfUrl = resolveDownloadProxyUrl(state.task.pdfUrl, `${baseName}.pdf`, 'pdf');
          const pdfRes = await fetch(proxyPdfUrl, { signal: controller.signal });
          if (pdfRes.ok) {
            const pdfCt = (pdfRes.headers.get('content-type') || '').toLowerCase();
            if (!pdfCt.includes('text/html') && !pdfCt.includes('application/json')) {
              const candidate = await pdfRes.blob();
              if (candidate.size > 0 && (await blobHasPdfHeader(candidate))) {
                fetchedPdfBlob = candidate;
              } else {
                pdfFailureReason = 'PDF ফাইলটি সঠিক ফরম্যাটে পাওয়া যায়নি।';
              }
            } else {
              pdfFailureReason = 'PDF লিংকটি সরাসরি ডাউনলোডযোগ্য নয় (Drive এ পাবলিক এক্সেস দিন)।';
            }
          } else {
            pdfFailureReason = await readProxyErrorMessage(
              pdfRes,
              `PDF ডাউনলোড ব্যর্থ হয়েছে (${pdfRes.status})`,
              state.task.pdfUrl
            );
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') throw err;
          pdfFailureReason = err instanceof Error ? err.message : 'PDF ডাউনলোড ব্যর্থ হয়েছে।';
        }

        // Direct CORS fallback if proxy failed
        if (!fetchedPdfBlob) {
          const normalizedPdf = normalizeMediaUrl(state.task.pdfUrl);
          if (/^https?:\/\//i.test(normalizedPdf)) {
            try {
              const directRes = await fetch(normalizedPdf, { signal: controller.signal });
              if (directRes.ok) {
                const candidate = await directRes.blob();
                if (candidate.size > 0 && (await blobHasPdfHeader(candidate))) {
                  fetchedPdfBlob = candidate;
                }
              }
            } catch {
              // Keep earlier pdfFailureReason
            }
          }
        }

        if (fetchedPdfBlob) {
          state.pdfBlob = fetchedPdfBlob;
          state.task.downloadedBytes += fetchedPdfBlob.size;
          state.task.totalBytes = Math.max(state.task.totalBytes, state.task.downloadedBytes);
          state.pdfDone = true;
        } else if (!hasVideoAlready) {
          throw new Error(pdfFailureReason || 'PDF ডাউনলোড করা যায়নি।');
        } else {
          // Video succeeded while PDF was private/unavailable: keep the downloaded video intact!
          state.pdfDone = true;
        }
      }

      const combinedVideoBlob =
        state.videoChunks.length > 0
          ? new Blob(state.videoChunks as BlobPart[], { type: 'video/mp4' })
          : undefined;

      const totalSize = (combinedVideoBlob?.size || 0) + (state.pdfBlob?.size || 0);
      if (totalSize === 0) {
        throw new Error('ডাউনলোড করা ফাইলটি খালি পাওয়া গেছে। লিংক পরীক্ষা করুন।');
      }

      await saveOfflineMedia({
        itemId: state.task.itemId,
        subjectId: state.task.subjectId,
        sectionId: state.task.sectionId,
        sectionTitle: state.task.sectionTitle,
        classNumber: state.task.classNumber,
        videoName: state.task.videoName,
        videoUrl: state.task.videoUrl,
        pdfUrl: state.task.pdfUrl,
        videoBlob: combinedVideoBlob,
        pdfBlob: state.pdfBlob,
        fileSizeBytes: totalSize,
        savedAt: Date.now(),
      });

      // Save physical files with admin-given name into user's granted device folder or Downloads
      await saveToInternalDirectoryIfPermitted(
        state.task.videoName,
        combinedVideoBlob,
        state.pdfBlob
      );

      state.task.progress = 100;
      state.task.status = 'completed';
      state.task.downloadedBytes = totalSize;
      state.task.totalBytes = totalSize;
      this.emit(true);

      const record: DownloadRecord = {
        uid: this.userUid,
        itemId: state.task.itemId,
        subjectId: state.task.subjectId,
        sectionId: state.task.sectionId,
        sectionTitle: state.task.sectionTitle,
        classNumber: state.task.classNumber,
        videoName: state.task.videoName,
        videoUrl: state.task.videoUrl,
        pdfUrl: state.task.pdfUrl,
        fileSizeBytes: totalSize,
        hasLocalVideo: !!combinedVideoBlob,
        hasLocalPdf: !!state.pdfBlob,
      };

      for (const fn of this.completeListeners) {
        fn(record);
      }

      setTimeout(() => {
        this.tasks.delete(itemId);
        this.emit(true);
        this.pumpQueue();
      }, 1500);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (!navigator.onLine) {
        state.pausedByNetwork = true;
        state.task.status = 'paused';
      } else {
        state.task.status = 'error';
        state.task.errorMessage =
          err instanceof Error && err.message ? err.message : 'ডাউনলোডে সমস্যা হয়েছে';
      }
      this.emit(true);
      this.pumpQueue();
    }
  }
}

export const downloadManager = new DownloadManager();
