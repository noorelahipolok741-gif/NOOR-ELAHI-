import React from 'react';
import { Inbox, KeyRound, MessageSquareWarning, Trash2, X } from 'lucide-react';
import { InboxMessage } from '../types';

interface AdminInboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  messages: InboxMessage[];
  onDeleteMessage: (msg: InboxMessage) => Promise<void>;
}

export const AdminInboxModal: React.FC<AdminInboxModalProps> = ({
  isOpen,
  onClose,
  messages,
  onDeleteMessage,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#020617] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800 bg-slate-950/90 shrink-0">
        <div className="flex items-center gap-2.5">
          <Inbox className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="text-base font-bold text-white">অ্যাডমিন ইনবক্স</h2>
            <p className="text-[11px] text-slate-400">
              পাসওয়ার্ড পরিবর্তন ও ইউজারদের অভিযোগসমূহ
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-w-[40px] min-h-[40px] rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-200"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 max-w-3xl w-full mx-auto space-y-3">
        {messages.length === 0 ? (
          <div className="rounded-3xl bg-slate-900/70 border border-slate-800 p-8 text-center text-sm text-slate-400">
            ইনবক্সে কোনো বার্তা নেই।
          </div>
        ) : (
          messages.map((msg) => {
            const isPassword = msg.type === 'password_change';
            return (
              <div
                key={msg.id}
                className="rounded-3xl bg-slate-900 border border-slate-800 p-4 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isPassword
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-amber-500/15 text-amber-400'
                      }`}
                    >
                      {isPassword ? (
                        <KeyRound className="w-4 h-4" />
                      ) : (
                        <MessageSquareWarning className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-white truncate">
                        {msg.senderName}
                      </h4>
                      <p className="text-xs text-slate-400 truncate">
                        {msg.senderEmail || msg.senderPhone || 'তথ্য নেই'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onDeleteMessage(msg)}
                    className="min-w-[36px] min-h-[36px] rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 flex items-center justify-center shrink-0"
                    aria-label="ডিলিট করুন"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {isPassword && msg.newPassword ? (
                  <div className="rounded-2xl bg-slate-950 border border-emerald-500/25 px-3.5 py-2.5 text-xs space-y-1">
                    <p className="text-slate-400">নতুন পাসওয়ার্ড:</p>
                    <p className="font-mono-num text-sm font-bold text-emerald-300 select-all">
                      {msg.newPassword}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-xs sm:text-sm text-slate-200 leading-relaxed">
                    {msg.message}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
