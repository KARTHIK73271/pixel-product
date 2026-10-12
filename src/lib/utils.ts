import { clsx, type ClassValue } from 'clsx';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';
import { SESSION_LABEL, type ExamSession } from '@shared/schemas';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const fmtDate = (iso: string | null | undefined, pattern = 'dd MMM yyyy') =>
  iso ? format(parseISO(iso.length === 10 ? `${iso}T00:00:00` : iso), pattern) : '—';
export const fmtDateTime = (iso: string | null | undefined) => (iso ? format(parseISO(iso), 'dd MMM yyyy, HH:mm') : '—');
export const fmtRelative = (iso: string) => `${formatDistanceToNowStrict(parseISO(iso))} ago`;
export const fmtPct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const fmtNum = (v: number) => new Intl.NumberFormat('en-IN').format(v);
export const sessionLabel = (s: string) => SESSION_LABEL[s as ExamSession] ?? s;

export function todayLocalIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function relativeDay(iso: string) {
  const today = todayLocalIso();
  const diff = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
}
