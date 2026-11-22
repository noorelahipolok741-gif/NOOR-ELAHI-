import React, { useEffect, useState } from 'react';
import { ExternalLink, FileText, X } from 'lucide-react';
import { getOfflineMedia, resolveStreamUrl } from '../lib/offlineStorage';

interface PdfViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  itemId: string;
  pdfUrl: string;
}

export const PdfViewerModal: React.FC<PdfViewerModalProps> = ({
  isOpen,
  onClose,
  title,
  itemId,
  pdfUrl,
}) => {
  const [viewerSrc, setViewerSrc] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      try {
        const offline = await getOfflineMedia(itemId);
        if (offline?.pdfBlob && !cancelled) {
          objectUrl = URL.createObjectURL(offline.pdfBlob);
          setViewerSrc(objectUrl);
          setLoading(false);
          return;
        }
      } catch {
        // Ignore IDB read issue and fall back to network URL
      }

      if (!cancelled) {
        setViewerSrc(resolveStreamUrl(pdfUrl));
        setLoading(false);
      }
    }

    loadPdf();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [isOpen, itemId, pdfUrl]);

  if (!isOpen) return null;

  const openExternal = () => {
    if (!viewerSrc) return;
    const link = document.createElement('a');
    link.href = viewerSrc;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#020617]/95 backdrop-blur-md overscroll-none">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800 bg-slate-950/90 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <FileText className="w-5 h-5 text-emerald-400 shrink-0" />
          <h3 className="text-sm font-semibold text-white truncate">{title} — PDF</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={openExternal}
            className="flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 transition"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>মোবাইল ভিউয়ার</span>
          </button>
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

      <div className="flex-1 relative overflow-y-auto overscroll-none bg-slate-900">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-9 h-9 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          </div>
        ) : viewerSrc ? (
          <iframe
            src={viewerSrc}
            title={`${title} PDF`}
            className="w-full h-full min-h-[80vh] border-0 bg-white"
          />
        ) : (
          <div className="h-full flex items-center justify-center p-6 text-sm text-slate-400">
            PDF লোড করা যায়নি।
          </div>
        )}
      </div>
    </div>
  );
};
