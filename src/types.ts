export interface ClassItem {
  id: string;
  name: string;
  videoUrl: string;
  pdfUrl: string;
  duration?: string;
  createdAt: number;
}

export interface SubjectSection {
  id: string;
  title: string;
  description: string;
  items: ClassItem[];
}

export interface SubjectDoc {
  id: string;
  name: string;
  description: string;
  isPublished: boolean;
  sections: SubjectSection[];
  updatedBy?: string;
  updatedAt?: unknown;
}

export interface SubjectMeta {
  id: string;
  name: string;
  shortLabel: string;
  headerGradient: string;
  gradient: string;
  accentText: string;
  accentBorder: string;
  accentBar: string;
  glowColor: string;
}

export const SUBJECT_LIST: SubjectMeta[] = [
  {
    id: 'eng-1',
    name: 'ইংলিশ ১ম পত্র',
    shortLabel: 'ENGLISH 1ST PAPER',
    headerGradient: 'from-cyan-400 via-sky-500 to-blue-600',
    gradient: 'from-sky-950/90 via-slate-900 to-slate-950',
    accentText: 'text-sky-400',
    accentBorder: 'border-sky-500/30',
    accentBar: 'bg-sky-400',
    glowColor: 'shadow-sky-500/15',
  },
  {
    id: 'eng-2',
    name: 'ইংলিশ ২য় পত্র',
    shortLabel: 'ENGLISH 2ND PAPER',
    headerGradient: 'from-blue-500 via-indigo-600 to-violet-700',
    gradient: 'from-indigo-950/90 via-slate-900 to-slate-950',
    accentText: 'text-indigo-400',
    accentBorder: 'border-indigo-500/30',
    accentBar: 'bg-indigo-400',
    glowColor: 'shadow-indigo-500/15',
  },
  {
    id: 'ban-1',
    name: 'বাংলা ১ম পত্র',
    shortLabel: 'BANGLA 1ST PAPER',
    headerGradient: 'from-amber-400 via-orange-500 to-red-600',
    gradient: 'from-orange-950/90 via-slate-900 to-slate-950',
    accentText: 'text-orange-400',
    accentBorder: 'border-orange-500/30',
    accentBar: 'bg-orange-400',
    glowColor: 'shadow-orange-500/15',
  },
  {
    id: 'ban-2',
    name: 'বাংলা ২য় পত্র',
    shortLabel: 'BANGLA 2ND PAPER',
    headerGradient: 'from-yellow-400 via-amber-500 to-orange-600',
    gradient: 'from-amber-950/90 via-slate-900 to-slate-950',
    accentText: 'text-amber-400',
    accentBorder: 'border-amber-500/30',
    accentBar: 'bg-amber-400',
    glowColor: 'shadow-amber-500/15',
  },
  {
    id: 'math',
    name: 'গণিত',
    shortLabel: 'GENERAL MATHEMATICS',
    headerGradient: 'from-sky-400 via-cyan-500 to-teal-600',
    gradient: 'from-cyan-950/90 via-slate-900 to-slate-950',
    accentText: 'text-cyan-400',
    accentBorder: 'border-cyan-500/30',
    accentBar: 'bg-cyan-400',
    glowColor: 'shadow-cyan-500/15',
  },
  {
    id: 'agri',
    name: 'কৃষি শিক্ষা',
    shortLabel: 'AGRICULTURE STUDIES',
    headerGradient: 'from-emerald-400 via-green-500 to-teal-700',
    gradient: 'from-emerald-950/90 via-slate-900 to-slate-950',
    accentText: 'text-emerald-400',
    accentBorder: 'border-emerald-500/30',
    accentBar: 'bg-emerald-400',
    glowColor: 'shadow-emerald-500/15',
  },
  {
    id: 'ict',
    name: 'তথ্য ও যোগাযোগ প্রযুক্তি',
    shortLabel: 'INFORMATION & ICT',
    headerGradient: 'from-fuchsia-500 via-purple-600 to-indigo-700',
    gradient: 'from-purple-950/90 via-slate-900 to-slate-950',
    accentText: 'text-purple-400',
    accentBorder: 'border-purple-500/30',
    accentBar: 'bg-purple-400',
    glowColor: 'shadow-purple-500/15',
  },
];

export const ADMIN_EMAILS = [
  'noorelahipolok741@gmail.com',
  'ashahinoor87@gmail.com',
  'elahipoloknoor@gmail.com',
  'polokmd741@gmail.com',
  'nurailahi321@gmail.com',
  'sabuzsikder68@gmail.com',
  'sahinura383@gmail.com',
] as const;

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return (ADMIN_EMAILS as readonly string[]).includes(email.trim().toLowerCase());
}

export interface AppUser {
  uid: string;
  authMode: 'google' | 'number';
  name: string;
  email: string;
  phone: string;
  photoUrl: string;
  role: 'admin' | 'student';
  bearerToken?: string;
}

export interface WatchProgress {
  uid: string;
  itemId: string;
  subjectId: string;
  sectionId: string;
  currentTime: number;
  duration: number;
  updatedAt?: unknown;
}

export interface DownloadRecord {
  uid: string;
  itemId: string;
  subjectId: string;
  sectionId: string;
  sectionTitle: string;
  classNumber: number;
  videoName: string;
  videoUrl: string;
  pdfUrl: string;
  fileSizeBytes: number;
  hasLocalVideo?: boolean;
  hasLocalPdf?: boolean;
  downloadedAt?: unknown;
}

export interface DownloadTask {
  itemId: string;
  subjectId: string;
  sectionId: string;
  sectionTitle: string;
  classNumber: number;
  videoName: string;
  videoUrl: string;
  pdfUrl: string;
  status: 'downloading' | 'paused' | 'completed' | 'error';
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  errorMessage?: string;
}

export interface AppNotification {
  id: string;
  subjectId: string;
  subjectName: string;
  sectionTitle: string;
  itemName: string;
  message: string;
  isActive: boolean;
  createdAt?: unknown;
  createdAtMs?: number;
}

export interface InboxMessage {
  id: string;
  uid: string;
  type: 'password_change' | 'issue_report';
  senderName: string;
  senderEmail: string;
  senderPhone: string;
  newPassword: string;
  message: string;
  createdAt?: unknown;
  source?: 'firestore' | 'server';
}
