import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { ClassItem, SUBJECT_LIST, SubjectDoc, SubjectSection } from '../types';
import { auth, sha256Hex } from '../lib/firebase';
import { normalizeMediaUrl } from '../lib/offlineStorage';

interface FileVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjects: Record<string, SubjectDoc>;
  storedVaultHash: string | null;
  isOnline: boolean;
  selectedSubjectId?: string | null;
  onSelectSubjectId?: (subjectId: string | null) => void;
  onCacheVaultHash?: (hash: string) => void;
  onSaveVaultPasswordHash: (hash: string) => Promise<void>;
  onSaveSubject: (
    subject: SubjectDoc,
    addedItems: Array<{ sectionTitle: string; itemName: string }>
  ) => Promise<void>;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export const FileVaultModal: React.FC<FileVaultModalProps> = ({
  isOpen,
  onClose,
  subjects,
  storedVaultHash,
  isOnline,
  selectedSubjectId: controlledSubjectId,
  onSelectSubjectId,
  onCacheVaultHash,
  onSaveVaultPasswordHash,
  onSaveSubject,
}) => {
  const [unlocked, setUnlocked] = useState(false);
  const [passInput, setPassInput] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [passError, setPassError] = useState('');
  const [savingPass, setSavingPass] = useState(false);

  const [localEditingSubjectId, setLocalEditingSubjectId] = useState<string | null>(null);
  const editingSubjectId =
    controlledSubjectId !== undefined ? controlledSubjectId : localEditingSubjectId;
  const setEditingSubjectId = (id: string | null) => {
    if (onSelectSubjectId) {
      onSelectSubjectId(id);
    } else {
      setLocalEditingSubjectId(id);
    }
  };

  const [draftDescription, setDraftDescription] = useState('');
  const [draftSections, setDraftSections] = useState<SubjectSection[]>([]);
  const [savingSubject, setSavingSubject] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveIsError, setSaveIsError] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setPassError('');
      setPassInput('');
      setSaveMessage('');
      setSaveIsError(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !editingSubjectId) return;
    const existing = subjects[editingSubjectId];
    setDraftDescription(existing?.description || '');
    setDraftSections(
      existing?.sections
        ? JSON.parse(JSON.stringify(existing.sections))
        : []
    );
    setSaveMessage('');
    setSaveIsError(false);
  }, [isOpen, editingSubjectId]);

  if (!isOpen) return null;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');
    const clean = passInput.trim();
    if (!clean) {
      setPassError('ভল্ট পাসওয়ার্ড লিখুন।');
      return;
    }
    setSavingPass(true);
    try {
      const hash = await sha256Hex(clean);
      if (storedVaultHash && hash === storedVaultHash) {
        onCacheVaultHash?.(hash);
        setUnlocked(true);
        setPassInput('');
        return;
      }

      // Wait for Firebase Auth hydration in standalone PWA cold launches
      const authWithReady = auth as unknown as { authStateReady?: () => Promise<void> };
      if (typeof authWithReady.authStateReady === 'function') {
        await Promise.race([
          authWithReady.authStateReady().catch(() => {}),
          new Promise<void>((r) => window.setTimeout(r, 2500)),
        ]);
      }

      const onlineNow = isOnline && (typeof navigator === 'undefined' || navigator.onLine);
      if (!onlineNow) {
        setPassError(
          storedVaultHash
            ? 'ভুল File Vault পাসওয়ার্ড।'
            : 'অফলাইনে প্রথমবার File Vault খুলতে একবার ইন্টারনেট চালু অবস্থায় পাসওয়ার্ড যাচাই করুন।'
        );
        return;
      }

      let idToken = '';
      if (auth.currentUser) {
        try {
          idToken = await auth.currentUser.getIdToken();
        } catch {
          idToken = await auth.currentUser.getIdToken(true).catch(() => '');
        }
      }

      if (!idToken) {
        setPassError(
          'অ্যাডমিন Google সেশন সক্রিয় নেই। প্রোফাইল থেকে সাইন আউট করে পুনরায় "সাইন ইন উইথ গুগল" দিয়ে প্রবেশ করুন।'
        );
        return;
      }

      // Verify against server-side configured admin vault password
      let res = await fetch('/api/vault/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ password: clean }),
      });

      if (res.status === 403 && auth.currentUser) {
        const refreshedToken = await auth.currentUser.getIdToken(true).catch(() => '');
        if (refreshedToken && refreshedToken !== idToken) {
          res = await fetch('/api/vault/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${refreshedToken}`,
            },
            body: JSON.stringify({ password: clean }),
          });
        }
      }

      if (res.status === 403) {
        setPassError(
          'এই Google অ্যাকাউন্টটি অ্যাডমিন হিসেবে যাচাই করা যায়নি। প্রোফাইল থেকে সাইন আউট করে অ্যাডমিন জিমেইল দিয়ে পুনরায় লগইন করুন।'
        );
        return;
      }

      if (!res.ok) {
        setPassError('সার্ভার থেকে ভল্ট যাচাই করা যায়নি। কিছুক্ষণ পর আবার চেষ্টা করুন।');
        return;
      }

      const data = (await res.json()) as { ok?: boolean };
      if (data.ok) {
        onCacheVaultHash?.(hash);
        if (!storedVaultHash) {
          onSaveVaultPasswordHash(hash).catch(() => {});
        }
        setUnlocked(true);
        setPassInput('');
        return;
      }

      setPassError('ভুল File Vault পাসওয়ার্ড।');
    } catch {
      setPassError('ভল্ট আনলক করতে সমস্যা হয়েছে। ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।');
    } finally {
      setSavingPass(false);
    }
  };

  const openSubjectEditor = (subjectId: string) => {
    const existing = subjects[subjectId];
    setDraftDescription(existing?.description || '');
    setDraftSections(
      existing?.sections
        ? JSON.parse(JSON.stringify(existing.sections))
        : []
    );
    setSaveMessage('');
    setEditingSubjectId(subjectId);
  };

  const addSectionBox = () => {
    if (draftSections.length >= 40) {
      setSaveMessage('সর্বোচ্চ ৪০টি শিরোনাম বক্স যোগ করা যাবে।');
      return;
    }
    setDraftSections((prev) => [
      ...prev,
      {
        id: makeId('sec'),
        title: '',
        description: '',
        items: [],
      },
    ]);
  };

  const addSlotToSection = (sectionId: string) => {
    setDraftSections((prev) =>
      prev.map((sec) =>
        sec.id === sectionId
          ? {
              ...sec,
              items: [
                ...sec.items,
                {
                  id: makeId('cls'),
                  name: '',
                  videoUrl: '',
                  pdfUrl: '',
                  duration: '',
                  createdAt: Date.now(),
                },
              ],
            }
          : sec
      )
    );
  };

  const updateSectionField = (
    sectionId: string,
    field: 'title' | 'description',
    val: string
  ) => {
    setDraftSections((prev) =>
      prev.map((sec) => (sec.id === sectionId ? { ...sec, [field]: val } : sec))
    );
  };

  const deleteSection = (sectionId: string) => {
    setDraftSections((prev) => prev.filter((sec) => sec.id !== sectionId));
  };

  const updateSlotField = (
    sectionId: string,
    itemId: string,
    field: keyof ClassItem,
    val: string
  ) => {
    setDraftSections((prev) =>
      prev.map((sec) =>
        sec.id === sectionId
          ? {
              ...sec,
              items: sec.items.map((it) =>
                it.id === itemId ? { ...it, [field]: val } : it
              ),
            }
          : sec
      )
    );
  };

  const deleteSlot = (sectionId: string, itemId: string) => {
    setDraftSections((prev) =>
      prev.map((sec) =>
        sec.id === sectionId
          ? { ...sec, items: sec.items.filter((it) => it.id !== itemId) }
          : sec
      )
    );
  };

  const updateVideoUrlIndex = (sectionId: string, itemId: string, vIdx: number, val: string) => {
    setDraftSections((prev) =>
      prev.map((sec) =>
        sec.id === sectionId
          ? {
              ...sec,
              items: sec.items.map((it) => {
                if (it.id !== itemId) return it;
                const existingUrls = it.videoUrls && it.videoUrls.length > 0 ? [...it.videoUrls] : [it.videoUrl || ''];
                while (existingUrls.length <= vIdx) existingUrls.push('');
                existingUrls[vIdx] = val;
                return {
                  ...it,
                  videoUrl: existingUrls[0] || '',
                  videoUrls: existingUrls.filter(Boolean),
                };
              }),
            }
          : sec
      )
    );
  };

  const addVideoUrlField = (sectionId: string, itemId: string) => {
    setDraftSections((prev) =>
      prev.map((sec) =>
        sec.id === sectionId
          ? {
              ...sec,
              items: sec.items.map((it) => {
                if (it.id !== itemId) return it;
                const existingUrls = it.videoUrls && it.videoUrls.length > 0 ? [...it.videoUrls] : [it.videoUrl || ''];
                return {
                  ...it,
                  videoUrls: [...existingUrls, ''],
                };
              }),
            }
          : sec
      )
    );
  };

  const removeVideoUrlIndex = (sectionId: string, itemId: string, vIdx: number) => {
    setDraftSections((prev) =>
      prev.map((sec) =>
        sec.id === sectionId
          ? {
              ...sec,
              items: sec.items.map((it) => {
                if (it.id !== itemId) return it;
                const existingUrls = it.videoUrls && it.videoUrls.length > 0 ? [...it.videoUrls] : [it.videoUrl || ''];
                const nextUrls = existingUrls.filter((_, idx) => idx !== vIdx);
                return {
                  ...it,
                  videoUrl: nextUrls[0] || '',
                  videoUrls: nextUrls.length > 0 ? nextUrls : [''],
                };
              }),
            }
          : sec
      )
    );
  };

  const handleSave = async () => {
    if (!editingSubjectId) return;
    const meta = SUBJECT_LIST.find((s) => s.id === editingSubjectId);
    if (!meta) return;

    setSavingSubject(true);
    setSaveMessage('');

    try {
      const normalizedSections: SubjectSection[] = draftSections.map((sec) => ({
        ...sec,
        items: (sec.items || []).map((it) => {
          const rawUrls = it.videoUrls && it.videoUrls.length > 0 ? it.videoUrls : [it.videoUrl || ''];
          const normalizedVideoUrls = rawUrls.map((u) => (u?.trim() ? normalizeMediaUrl(u) : '')).filter(Boolean);
          return {
            ...it,
            name: it.name.trim(),
            duration: (it.duration || '').trim(),
            videoUrl: normalizedVideoUrls[0] || '',
            videoUrls: normalizedVideoUrls,
            pdfUrl: it.pdfUrl.trim() ? normalizeMediaUrl(it.pdfUrl) : '',
          };
        }),
      }));

      const prevDoc = subjects[editingSubjectId];
      const prevItemMap = new Map<string, ClassItem>();
      for (const s of prevDoc?.sections || []) {
        for (const it of s.items || []) {
          prevItemMap.set(it.id, it);
        }
      }

      const addedItems: Array<{ sectionTitle: string; itemName: string }> = [];
      for (const sec of normalizedSections) {
        for (const it of sec.items) {
          const prev = prevItemMap.get(it.id);
          const nowHasMedia = Boolean(it.videoUrl?.trim() || (it.videoUrls && it.videoUrls.some(u => u.trim())) || it.pdfUrl?.trim());
          const prevHadMedia = Boolean(prev?.videoUrl?.trim() || (prev?.videoUrls && prev.videoUrls.some(u => u.trim())) || prev?.pdfUrl?.trim());
          if (nowHasMedia && !prevHadMedia) {
            addedItems.push({
              sectionTitle: sec.title.trim() || meta.name,
              itemName: it.name.trim() || 'নতুন ক্লাস',
            });
          }
        }
      }

      const nextDoc: SubjectDoc = {
        id: meta.id,
        name: meta.name,
        description: draftDescription.trim(),
        isPublished: true,
        sections: normalizedSections,
      };

      setDraftSections(normalizedSections);
      await onSaveSubject(nextDoc, addedItems);
      setSaveIsError(false);
      setSaveMessage(
        isOnline
          ? 'সফলভাবে সেভ এবং আপডেট হয়েছে!'
          : 'অফলাইন ক্যাশে সেভ হয়েছে! অনলাইনে এলে স্বয়ংক্রিয়ভাবে সিঙ্ক হবে।'
      );
    } catch (err) {
      setSaveIsError(true);
      setSaveMessage(
        err instanceof Error && err.message
          ? err.message
          : 'সেভ করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।'
      );
    } finally {
      setSavingSubject(false);
    }
  };

  const editingMeta = SUBJECT_LIST.find((s) => s.id === editingSubjectId);

  return (
    <div className="fixed inset-0 z-50 bg-[#020617] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800 bg-slate-950/90 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {editingSubjectId ? (
            <button
              type="button"
              onClick={() => setEditingSubjectId(null)}
              className="min-w-[40px] min-h-[40px] rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-200"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : null}
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white truncate">
              {editingMeta ? `${editingMeta.name} — File Vault` : 'File Vault'}
            </h2>
            <p className="text-[11px] text-emerald-400">অ্যাডমিন কন্টেন্ট ম্যানেজার</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-1.5"
        >
          <X className="w-4 h-4" />
          <span>বের হন</span>
        </button>
      </div>

      {!unlocked ? (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y pwa-scroll-container flex items-center justify-center p-4">
          <form
            onSubmit={handleUnlock}
            className="w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl my-auto"
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
              <Lock className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="text-lg font-bold text-white">File Vault আনলক করুন</h3>
              <p className="text-xs text-slate-400">
                ভেতরে প্রবেশ করতে অ্যাডমিনের ভল্ট পাসওয়ার্ড দিন
              </p>
            </div>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={passInput}
                onChange={(e) => {
                  setPassInput(e.target.value);
                  if (passError) setPassError('');
                }}
                placeholder="ভল্ট পাসওয়ার্ড লিখুন"
                autoComplete="current-password"
                className="w-full h-11 pl-4 pr-11 rounded-xl bg-slate-950 border border-slate-800 focus:border-emerald-500 text-sm text-white outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-white"
                aria-label={showPass ? 'পাসওয়ার্ড লুকান' : 'পাসওয়ার্ড দেখুন'}
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {passError && <p className="text-xs text-rose-400 leading-relaxed">{passError}</p>}
            <button
              type="submit"
              disabled={savingPass}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold text-sm disabled:opacity-60"
            >
              {savingPass ? 'যাচাই হচ্ছে...' : 'প্রবেশ করুন'}
            </button>
          </form>
        </div>
      ) : !editingSubjectId ? (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y pwa-scroll-container p-4 max-w-4xl w-full mx-auto space-y-3">
          <p className="text-xs text-slate-400 px-1">
            কন্টেন্ট যোগ বা আপডেট করতে যেকোনো একটি বিষয় নির্বাচন করুন:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {SUBJECT_LIST.map((meta) => {
              const secCount = subjects[meta.id]?.sections?.length || 0;
              return (
                <button
                  key={meta.id}
                  type="button"
                  onClick={() => openSubjectEditor(meta.id)}
                  className={`text-left rounded-3xl bg-gradient-to-br ${meta.gradient} border ${meta.accentBorder} p-5 flex items-center justify-between gap-3 hover:scale-[1.01] transition`}
                >
                  <div>
                    <span className={`text-xs font-medium ${meta.accentText}`}>
                      {meta.shortLabel}
                    </span>
                    <h3 className="text-base font-bold text-white mt-0.5">{meta.name}</h3>
                    <p className="text-xs text-slate-400 mt-1 font-mono-num">
                      {secCount}টি শিরোনাম বক্স
                    </p>
                  </div>
                  <ChevronRight className={`w-5 h-5 ${meta.accentText}`} />
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y pwa-scroll-container p-4 pb-28 max-w-4xl w-full mx-auto space-y-5">
          <div className="rounded-3xl bg-slate-900 border border-slate-800 p-4 space-y-2">
            <label className="text-xs font-semibold text-emerald-400">
              বিষয়ের ডিসক্রিপশন বক্স
            </label>
            <textarea
              rows={2}
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              placeholder="এই বিষয় সম্পর্কে সংক্ষিপ্ত নির্দেশিকা বা বিবরণ লিখুন..."
              className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-emerald-500"
            />
          </div>

          <div className="space-y-4">
            {draftSections.map((section, sIdx) => (
              <div
                key={section.id}
                className="rounded-3xl bg-slate-900/90 border border-slate-700/80 p-4 space-y-3.5 relative"
              >
                <div className="flex items-start gap-2.5">
                  <div className="flex-1 space-y-2.5">
                    <input
                      type="text"
                      value={section.title}
                      onChange={(e) =>
                        updateSectionField(section.id, 'title', e.target.value)
                      }
                      placeholder={`শিরোনাম ${sIdx + 1} (যেমন: সৃজনশীল সাজেশন / সংক্ষিপ্ত প্রশ্ন)`}
                      className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-cyan-400 text-sm font-semibold text-white outline-none"
                    />
                    <input
                      type="text"
                      value={section.description}
                      onChange={(e) =>
                        updateSectionField(section.id, 'description', e.target.value)
                      }
                      placeholder="শিরোনামের ছোট ডিসক্রিপশন লিখুন..."
                      className="w-full h-10 px-3.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-cyan-400 text-xs text-slate-200 outline-none"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => addSlotToSection(section.id)}
                    title="ভিডিও ও PDF খোপ যোগ করুন"
                    className="w-11 h-11 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 shrink-0 transition"
                  >
                    <Plus className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => deleteSection(section.id)}
                    title="শিরোনাম বক্স ডিলিট করুন"
                    className="w-11 h-11 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3 pt-1">
                  {section.items.map((item, iIdx) => {
                    const itemVideoUrls = item.videoUrls && item.videoUrls.length > 0 ? item.videoUrls : [item.videoUrl || ''];
                    return (
                    <div
                      key={item.id}
                      className="rounded-2xl bg-slate-950 border border-slate-800 p-3.5 space-y-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono-num text-cyan-400 font-semibold shrink-0">
                          #{iIdx + 1}
                        </span>
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) =>
                            updateSlotField(section.id, item.id, 'name', e.target.value)
                          }
                          placeholder="ভিডিও ও ফাইলের নাম লিখুন (স্ক্যান ও স্টুডেন্টের জন্য)"
                          className="flex-1 h-9 px-3 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white outline-none focus:border-emerald-500"
                        />
                        <input
                          type="text"
                          value={item.duration || ''}
                          onChange={(e) =>
                            updateSlotField(section.id, item.id, 'duration', e.target.value)
                          }
                          placeholder="সময় (যেমন ১২ মি.)"
                          className="w-24 h-9 px-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => deleteSlot(section.id, item.id)}
                          className="w-9 h-9 rounded-lg bg-slate-900 text-rose-400 hover:bg-rose-500/15 flex items-center justify-center shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-emerald-400">ভিডিও লিংকসমূহ (পার্ট অনুযায়ী)</span>
                          <button
                            type="button"
                            onClick={() => addVideoUrlField(section.id, item.id)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/35 text-emerald-300 text-xs font-bold flex items-center gap-1 hover:bg-emerald-500/30 transition"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>ভিডিও লিংক যোগ করুন (+)</span>
                          </button>
                        </div>
                        {itemVideoUrls.map((vUrl, vIdx) => (
                          <div key={vIdx} className="flex items-center gap-2">
                            <input
                              type="url"
                              value={vUrl}
                              onChange={(e) => updateVideoUrlIndex(section.id, item.id, vIdx, e.target.value)}
                              placeholder={`ভিডিও লিংক পার্ট ${vIdx + 1} (Drive / MP4)`}
                              className="flex-1 h-10 px-3 rounded-xl bg-slate-900 border border-emerald-500/25 focus:border-emerald-400 text-xs text-emerald-200 placeholder:text-slate-500 outline-none"
                            />
                            {itemVideoUrls.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeVideoUrlIndex(section.id, item.id, vIdx)}
                                className="p-2.5 rounded-xl bg-slate-900 text-rose-400 hover:bg-rose-500/15"
                                title="এই ভিডিও লিংকটি মুছুন"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                        <input
                          type="url"
                          value={item.pdfUrl}
                          onChange={(e) =>
                            updateSlotField(section.id, item.id, 'pdfUrl', e.target.value)
                          }
                          placeholder="PDF এর লিংক (Drive / Direct PDF)"
                          className="w-full h-10 px-3 rounded-xl bg-slate-900 border border-indigo-500/25 focus:border-indigo-400 text-xs text-indigo-200 placeholder:text-slate-500 outline-none"
                        />
                      </div>
                    </div>
                  );})}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addSectionBox}
            className="w-full h-12 rounded-2xl border-2 border-dashed border-slate-700 hover:border-emerald-500/60 text-slate-300 hover:text-emerald-300 font-semibold text-sm flex items-center justify-center gap-2 transition"
          >
            <Plus className="w-5 h-5" />
            <span>নতুন শিরোনাম বক্স যোগ করুন</span>
          </button>

          {saveMessage && (
            <div
              className={`rounded-2xl border px-4 py-3 text-xs font-semibold text-center ${
                saveIsError
                  ? 'bg-rose-500/15 border-rose-500/35 text-rose-300'
                  : 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
              }`}
            >
              {saveMessage}
            </div>
          )}
        </div>
      )}

      {unlocked && editingSubjectId && (
        <div className="p-4 border-t border-slate-800 bg-slate-950/95 backdrop-blur-md shrink-0">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <button
              type="button"
              disabled={savingSubject}
              onClick={handleSave}
              className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              <span>{savingSubject ? 'সেভ হচ্ছে...' : 'সেভ ও আপডেট করুন'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
