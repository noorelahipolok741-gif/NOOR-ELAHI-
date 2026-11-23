import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  extractGoogleDriveFileId,
  getOfflineMedia,
  normalizeMediaUrl,
  resolveStreamUrl,
  sanitizeBaseFilename,
} from '../lib/offlineStorage';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface PdfViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  itemId: string;
  pdfUrl: string;
}

interface LoadProgress {
  loaded: number;
  total: number;
}

function startsWithPdfHeader(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 5) return false;
  const bytes = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
  for (let i = 0; i <= bytes.length - 5; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

function formatMB(bytes: number): string {
  if (!bytes || bytes <= 0) return '0.0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function computeInitialContainerWidth(): number {
  if (typeof window === 'undefined') return 600;
  return Math.max(280, Math.min((window.innerWidth || 400) - 24, 860));
}

async function ensureFakeWorkerLoadedIfNeeded(): Promise<void> {
  const g = globalThis as { pdfjsWorker?: { WorkerMessageHandler?: unknown } };
  if (g.pdfjsWorker?.WorkerMessageHandler) return;
  try {
    const workerModulePath = '/pdf.worker.min.mjs';
    const mod = (await import(/* @vite-ignore */ workerModulePath)) as {
      WorkerMessageHandler?: unknown;
    };
    if (mod?.WorkerMessageHandler && !g.pdfjsWorker) {
      g.pdfjsWorker = { WorkerMessageHandler: mod.WorkerMessageHandler };
    }
  } catch {
    // Ignore if worker import cannot run on main thread
  }
}

interface PdfPageCanvasProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  totalPages: number;
  containerWidth: number;
  zoom: number;
  defaultAspect: number;
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  eager: boolean;
}

const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({
  pdfDoc,
  pageNumber,
  totalPages,
  containerWidth,
  zoom,
  defaultAspect,
  scrollRootRef,
  eager,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeTaskRef = useRef<RenderTask | null>(null);
  const renderSerialRef = useRef(0);

  const [inView, setInView] = useState(eager);
  const [rendered, setRendered] = useState(false);
  const [pageError, setPageError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [dims, setDims] = useState<{ width: number; height: number }>(() => {
    const w = Math.floor(containerWidth * zoom);
    return { width: w, height: Math.floor(w * defaultAspect) };
  });

  useEffect(() => {
    setDims((prev) => {
      const w = Math.floor(containerWidth * zoom);
      const ratio = prev.width > 0 ? prev.height / prev.width : defaultAspect;
      return { width: w, height: Math.max(120, Math.floor(w * ratio)) };
    });
  }, [containerWidth, zoom, defaultAspect]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
          } else if (!eager) {
            // Keep first 3 pages cached; release far offscreen pages on huge 200+ page PDFs
            const rect = entry.boundingClientRect;
            if (Math.abs(rect.top) > 3600) {
              setInView(false);
              setRendered(false);
            }
          }
        }
      },
      {
        root: scrollRootRef.current || null,
        rootMargin: '1100px 0px',
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRootRef, eager]);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    const mySerial = ++renderSerialRef.current;

    async function drawPage() {
      const prevTask = activeTaskRef.current;
      if (prevTask) {
        try {
          prevTask.cancel();
          await prevTask.promise.catch(() => {});
        } catch {
          // Ignore cancellation error
        }
        if (activeTaskRef.current === prevTask) {
          activeTaskRef.current = null;
        }
      }

      if (cancelled || mySerial !== renderSerialRef.current) return;

      try {
        setPageError(false);
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled || mySerial !== renderSerialRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const cssScale = (containerWidth / baseViewport.width) * zoom;
        const displayViewport = page.getViewport({ scale: cssScale });
        const dispW = Math.max(200, Math.floor(displayViewport.width));
        const dispH = Math.max(200, Math.floor(displayViewport.height));

        setDims({ width: dispW, height: dispH });

        const rawDpr = Math.min(window.devicePixelRatio || 1, 2.25);
        // Cap canvas pixel area so mobile Chrome/Safari GPUs never blank out large zoomed pages
        const maxPixels = 3_800_000;
        const rawPixels = dispW * dispH * rawDpr * rawDpr;
        const safeDpr =
          rawPixels > maxPixels
            ? Math.max(1, Math.sqrt(maxPixels / (dispW * dispH)))
            : rawDpr;

        const renderViewport = page.getViewport({ scale: cssScale * safeDpr });
        const canvas = canvasRef.current;
        if (!canvas || cancelled || mySerial !== renderSerialRef.current) return;

        canvas.width = Math.max(1, Math.floor(renderViewport.width));
        canvas.height = Math.max(1, Math.floor(renderViewport.height));
        canvas.style.width = `${dispW}px`;
        canvas.style.height = `${dispH}px`;

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
          throw new Error('2D canvas unavailable');
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const task = page.render({
          canvas,
          canvasContext: ctx,
          viewport: renderViewport,
          background: '#ffffff',
        });
        activeTaskRef.current = task;

        await task.promise;
        if (activeTaskRef.current === task) {
          activeTaskRef.current = null;
        }
        if (!cancelled && mySerial === renderSerialRef.current) {
          setRendered(true);
        }
      } catch (err) {
        if (cancelled || mySerial !== renderSerialRef.current) return;
        const name = (err as { name?: string })?.name || '';
        const msg = err instanceof Error ? err.message : '';
        if (name === 'RenderingCancelledException' || msg.includes('Rendering cancelled')) {
          return;
        }
        setPageError(true);
      }
    }

    drawPage();

    return () => {
      cancelled = true;
      const t = activeTaskRef.current;
      if (t) {
        try {
          t.cancel();
        } catch {
          // Ignore cancel error
        }
      }
    };
  }, [inView, pdfDoc, pageNumber, containerWidth, zoom, retryTick]);

  return (
    <div
      ref={containerRef}
      className="relative rounded-2xl overflow-hidden bg-white shadow-xl border border-slate-700/60 mx-auto flex flex-col"
      style={{ width: `${dims.width}px` }}
    >
      <div
        className="relative bg-white flex items-center justify-center"
        style={{ width: `${dims.width}px`, height: `${dims.height}px` }}
      >
        {inView && (
          <canvas
            ref={canvasRef}
            className="block"
            style={{ width: `${dims.width}px`, height: `${dims.height}px` }}
          />
        )}

        {(!inView || !rendered) && !pageError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-100/95 text-slate-600 pointer-events-none">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
            <span className="text-[11px] font-medium font-mono-num">
              পৃষ্ঠা {pageNumber} লোড হচ্ছে...
            </span>
          </div>
        )}

        {pageError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-slate-900/95 text-slate-200 p-4 text-center">
            <p className="text-xs text-rose-300">পৃষ্ঠা {pageNumber} প্রদর্শন করা যায়নি</p>
            <button
              type="button"
              onClick={() => setRetryTick((k) => k + 1)}
              className="px-3 py-1.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>পুনরায় লোড</span>
            </button>
          </div>
        )}
      </div>

      <div className="bg-slate-950/95 text-slate-300 text-[11px] font-mono-num text-center py-1 border-t border-slate-800 shrink-0">
        পৃষ্ঠা {pageNumber} / {totalPages}
      </div>
    </div>
  );
};

export const PdfViewerModal: React.FC<PdfViewerModalProps> = ({
  isOpen,
  onClose,
  title,
  itemId,
  pdfUrl,
}) => {
  const scrollWrapRef = useRef<HTMLDivElement | null>(null);

  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [defaultAspect, setDefaultAspect] = useState(1.34);
  const [containerWidth, setContainerWidth] = useState<number>(computeInitialContainerWidth);

  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  const [parsingDoc, setParsingDoc] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);

  // Track responsive viewport container width cleanly so canvases are never sized against 0px
  useEffect(() => {
    if (!isOpen) return;
    const measure = () => {
      const scroller = scrollWrapRef.current;
      const rawW = scroller && scroller.clientWidth > 60 ? scroller.clientWidth : window.innerWidth;
      if (rawW > 0) {
        setContainerWidth(Math.max(280, Math.min(rawW - 24, 860)));
      }
    };
    measure();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && scrollWrapRef.current) {
      ro = new ResizeObserver(measure);
      ro.observe(scrollWrapRef.current);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isOpen]);

  // Create and clean up local same-origin Blob URL whenever pdfBytes updates
  useEffect(() => {
    if (!pdfBytes) {
      setBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
    setBlobUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [pdfBytes]);

  // Load PDF bytes completely cookie-free via IndexedDB offline blob or server-side proxy
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const controller = new AbortController();

    async function readResponseBytesWithProgress(res: Response): Promise<ArrayBuffer> {
      const totalHeader = Number(res.headers.get('content-length') || '0');
      const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : 0;

      if (!res.body) {
        return res.arrayBuffer();
      }

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      let lastEmit = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.byteLength;
          const now = Date.now();
          if (!cancelled && now - lastEmit >= 90) {
            lastEmit = now;
            setLoadProgress({ loaded, total });
          }
        }
      }
      if (!cancelled) {
        setLoadProgress({ loaded, total: total || loaded });
      }
      const combined = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return combined.buffer;
    }

    async function loadPdfData() {
      setLoading(true);
      setLoadProgress(null);
      setErrorMsg(null);
      setPdfBytes(null);
      setPdfDoc(null);
      setPageCount(0);

      try {
        const offline = await getOfflineMedia(itemId);
        if (offline?.pdfBlob && !cancelled) {
          const buf = await offline.pdfBlob.arrayBuffer();
          if (!cancelled && buf.byteLength > 0 && startsWithPdfHeader(buf)) {
            setPdfBytes(buf);
            setLoading(false);
            return;
          }
        }
      } catch {
        // Ignore IDB read issue and fall back to network fetch
      }

      const normalized = normalizeMediaUrl(pdfUrl);
      if (!normalized) {
        if (!cancelled) {
          setErrorMsg('PDF লিংক পাওয়া যায়নি।');
          setLoading(false);
        }
        return;
      }

      const fetchTarget = resolveStreamUrl(normalized, 'pdf');

      try {
        const res = await fetch(fetchTarget, { signal: controller.signal });
        if (!res.ok) {
          if (/^https?:\/\//i.test(normalized)) {
            try {
              const directRes = await fetch(normalized, { signal: controller.signal });
              if (directRes.ok) {
                const directCt = (directRes.headers.get('content-type') || '').toLowerCase();
                if (!directCt.includes('text/html')) {
                  const directBuf = await readResponseBytesWithProgress(directRes);
                  if (startsWithPdfHeader(directBuf)) {
                    if (!cancelled) {
                      setPdfBytes(directBuf);
                      setLoading(false);
                    }
                    return;
                  }
                }
              }
            } catch {
              // Ignore CORS or network error and report proxy message
            }
          }
          let serverMsg = '';
          try {
            const rawErr = await res.text();
            if (rawErr) {
              const j = JSON.parse(rawErr) as { error?: string };
              if (j?.error) serverMsg = j.error;
            }
          } catch {
            // Ignore non-JSON error body
          }
          if (!serverMsg && (res.status === 403 || res.status === 422) && extractGoogleDriveFileId(normalized)) {
            serverMsg =
              'এই Google Drive PDF ফাইলটি প্রাইভেট (Restricted) করা আছে। Google Drive-এ গিয়ে Share → "Anyone with the link" চালু করুন।';
          }
          throw new Error(serverMsg || `PDF লোড ব্যর্থ হয়েছে (${res.status})`);
        }
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html') || ct.includes('application/json')) {
          throw new Error('এই লিংকে সরাসরি PDF পাওয়া যায়নি। লিংকটি পাবলিক শেয়ার করা আছে কিনা দেখুন।');
        }
        const buf = await readResponseBytesWithProgress(res);
        if (!startsWithPdfHeader(buf)) {
          throw new Error('ফাইলটি বৈধ PDF ফরম্যাটে নেই।');
        }
        if (!cancelled) {
          setPdfBytes(buf);
          setLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        if ((err as { name?: string })?.name === 'AbortError') return;
        setErrorMsg(
          err instanceof Error && err.message
            ? err.message
            : 'PDF ফাইলটি লোড করা যায়নি। ইন্টারনেট সংযোগ বা লিংক পরীক্ষা করুন।'
        );
        setLoading(false);
      }
    }

    loadPdfData();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isOpen, itemId, pdfUrl, reloadKey]);

  // Parse PDFDocumentProxy deterministically with complete font/cmap/wasm support + fake-worker fallback
  useEffect(() => {
    if (!isOpen || !pdfBytes) return;
    let cancelled = false;
    let activeLoadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    let openedDoc: PDFDocumentProxy | null = null;

    async function openDocument() {
      setParsingDoc(true);
      setErrorMsg(null);
      setPdfDoc(null);
      setPageCount(0);

      const createDoc = async () => {
        const dataCopy = new Uint8Array(pdfBytes!.slice(0));
        const task = pdfjsLib.getDocument({
          data: dataCopy,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          wasmUrl: '/pdfjs/wasm/',
        });
        activeLoadingTask = task;
        return task.promise;
      };

      try {
        let doc: PDFDocumentProxy;
        try {
          doc = await createDoc();
        } catch (firstErr) {
          if (cancelled) return;
          // Retry once with main-thread worker registration if Web Worker failed under restricted browser rules
          await ensureFakeWorkerLoadedIfNeeded();
          if (cancelled) return;
          if (activeLoadingTask) {
            activeLoadingTask.destroy().catch(() => {});
          }
          try {
            doc = await createDoc();
          } catch {
            throw firstErr;
          }
        }

        if (cancelled) {
          activeLoadingTask?.destroy().catch(() => {});
          return;
        }
        openedDoc = doc;

        try {
          const firstPage = await doc.getPage(1);
          if (!cancelled) {
            const vp = firstPage.getViewport({ scale: 1 });
            if (vp.width > 0 && vp.height > 0) {
              const aspect = Math.min(2.4, Math.max(0.45, vp.height / vp.width));
              setDefaultAspect(aspect);
            }
          }
        } catch {
          // Keep default A4/Letter aspect ratio
        }

        if (!cancelled) {
          setPageCount(doc.numPages);
          setPdfDoc(doc);
          setParsingDoc(false);
        }
      } catch {
        if (!cancelled) {
          setParsingDoc(false);
          setErrorMsg(
            'PDF পৃষ্ঠাগুলো প্রদর্শন করা যায়নি। নিচে "মোবাইল ভিউয়ার" বা "PDF সেভ" ব্যবহার করে দেখতে পারেন।'
          );
        }
      }
    }

    openDocument();

    return () => {
      cancelled = true;
      setPdfDoc(null);
      if (activeLoadingTask) {
        activeLoadingTask.destroy().catch(() => {});
        activeLoadingTask = null;
      }
      if (openedDoc) {
        openedDoc.cleanup().catch(() => {});
        openedDoc = null;
      }
    };
  }, [isOpen, pdfBytes]);

  if (!isOpen) return null;

  const normalizedPdfUrl = normalizeMediaUrl(pdfUrl);
  const directExternalHref =
    typeof navigator !== 'undefined' && !navigator.onLine && blobUrl
      ? blobUrl
      : !errorMsg && pdfBytes && normalizedPdfUrl && /^https?:/i.test(normalizedPdfUrl)
      ? resolveStreamUrl(normalizedPdfUrl, 'pdf')
      : normalizedPdfUrl;
  const downloadFilename = `${sanitizeBaseFilename(title || 'document')}.pdf`;

  const handleCopyLink = async () => {
    if (!normalizedPdfUrl) return;
    try {
      await navigator.clipboard.writeText(normalizedPdfUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = normalizedPdfUrl;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Ignore clipboard unavailability
      }
    }
  };

  const progressPct =
    loadProgress && loadProgress.total > 0
      ? Math.min(100, Math.round((loadProgress.loaded / loadProgress.total) * 100))
      : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#020617]/95 backdrop-blur-md overscroll-none">
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-3 border-b border-slate-800 bg-slate-950/95 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-5 h-5 text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">{title} — PDF</h3>
            {pageCount > 0 && (
              <p className="text-[11px] font-mono-num text-slate-400">
                মোট {pageCount} পৃষ্ঠা
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {pdfDoc && (
            <div className="flex items-center gap-0.5 rounded-xl bg-slate-900 border border-slate-800 px-1 py-1">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.15).toFixed(2))))}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
                aria-label="জুম কমান"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-mono-num text-slate-300 px-1">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.15).toFixed(2))))}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
                aria-label="জুম বাড়ান"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {blobUrl && (
            <a
              href={blobUrl}
              download={downloadFilename}
              className="flex items-center gap-1 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 px-2.5 py-2 text-xs font-semibold text-emerald-300 transition"
              title="ডিভাইসে PDF সেভ করুন"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">সেভ</span>
            </a>
          )}

          {directExternalHref && (
            <a
              href={directExternalHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 sm:px-3 py-2 text-xs font-medium text-slate-200 transition"
              title="মোবাইল ভিউয়ারে খুলুন"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">মোবাইল ভিউয়ার</span>
            </a>
          )}

          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-200 transition"
            aria-label="বন্ধ করুন"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div
        ref={scrollWrapRef}
        className="flex-1 min-h-0 relative overflow-y-auto overflow-x-auto overscroll-contain touch-pan-x touch-pan-y pwa-scroll-container bg-slate-900"
      >
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
            <Loader2 className="w-9 h-9 text-emerald-400 animate-spin" />
            <p className="text-xs font-medium text-slate-200">
              {progressPct !== null
                ? `PDF লোড হচ্ছে... ${progressPct}%`
                : 'PDF লোড হচ্ছে...'}
            </p>
            {loadProgress && loadProgress.loaded > 0 && (
              <div className="w-full max-w-xs space-y-1.5">
                {progressPct !== null && (
                  <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-150"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                )}
                <p className="text-[11px] font-mono-num text-slate-400">
                  {formatMB(loadProgress.loaded)}
                  {loadProgress.total > 0 ? ` / ${formatMB(loadProgress.total)}` : ''}
                </p>
              </div>
            )}
          </div>
        ) : errorMsg ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-4">
            <p className="text-sm text-rose-200 max-w-sm leading-relaxed">{errorMsg}</p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>আবার চেষ্টা করুন</span>
              </button>
              {blobUrl && (
                <a
                  href={blobUrl}
                  download={downloadFilename}
                  className="px-4 py-2.5 rounded-xl bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>PDF সেভ করুন</span>
                </a>
              )}
              {normalizedPdfUrl && (
                <>
                  <a
                    href={directExternalHref || normalizedPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>মোবাইল ভিউয়ার</span>
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-300">কপি হয়েছে</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>লিংক কপি</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : parsingDoc || !pdfDoc ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            <p className="text-xs text-slate-300">পৃষ্ঠাগুলো প্রস্তুত হচ্ছে...</p>
          </div>
        ) : (
          <div className="py-4 px-3 space-y-4 flex flex-col items-center">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNum) => (
              <PdfPageCanvas
                key={`${reloadKey}-${pageNum}`}
                pdfDoc={pdfDoc}
                pageNumber={pageNum}
                totalPages={pageCount}
                containerWidth={containerWidth}
                zoom={zoom}
                defaultAspect={defaultAspect}
                scrollRootRef={scrollWrapRef}
                eager={pageNum <= 3}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
