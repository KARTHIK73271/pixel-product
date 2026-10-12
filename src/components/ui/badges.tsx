import { CheckCircle2, CircleDashed, CircleDot, Clock3, Lock, Wrench, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { EXAM_STATUS_LABEL, type ExamStatus, type RoomStatus } from '@shared/schemas';
import type { SubmissionState } from '@/lib/types';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'accent' | 'cyan' | 'ok' | 'warn' | 'bad' | 'brass';
const tones: Record<Tone, string> = {
  neutral: 'bg-raised/80 text-muted border-line shadow-[0_0_0_1px_rgb(255_255_255/0.02)_inset]',
  accent: 'bg-accent/12 text-accent border-accent/30 shadow-[0_0_12px_-6px_rgb(var(--accent)/0.9)]',
  cyan: 'bg-cyan/12 text-cyan border-cyan/30 shadow-[0_0_12px_-6px_rgb(var(--cyan)/0.9)]',
  ok: 'bg-ok/12 text-ok border-ok/30 shadow-[0_0_12px_-6px_rgb(var(--ok)/0.9)]',
  warn: 'bg-warn/12 text-warn border-warn/30 shadow-[0_0_12px_-6px_rgb(var(--warn)/0.9)]',
  bad: 'bg-bad/12 text-bad border-bad/30 shadow-[0_0_12px_-6px_rgb(var(--bad)/0.9)]',
  brass: 'bg-brass/12 text-brass border-brass/30 shadow-[0_0_12px_-6px_rgb(var(--brass)/0.9)]',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  icon,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-2xs font-medium tracking-wide',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function ExamStatusBadge({ status, active = true }: { status: ExamStatus; active?: boolean }) {
  if (!active) return <Badge tone="neutral">Deactivated</Badge>;
  const tone: Tone = status === 'PUBLISHED' ? 'ok' : status === 'ALLOCATED' ? 'cyan' : 'neutral';
  const Icon = status === 'PUBLISHED' ? CheckCircle2 : status === 'ALLOCATED' ? CircleDot : CircleDashed;
  return (
    <Badge tone={tone} icon={<Icon className="h-3 w-3" />}>
      {EXAM_STATUS_LABEL[status]}
    </Badge>
  );
}

export function SubmissionBadge({ status, overdue }: { status: SubmissionState; overdue?: boolean }) {
  if (status === 'FINALIZED')
    return (
      <Badge tone="ok" icon={<Lock className="h-3 w-3" />}>
        Finalized
      </Badge>
    );
  if (status === 'IN_PROGRESS')
    return (
      <Badge tone={overdue ? 'bad' : 'warn'} icon={<Clock3 className="h-3 w-3" />}>
        {overdue ? 'Overdue' : 'In progress'}
      </Badge>
    );
  return (
    <Badge tone={overdue ? 'bad' : 'neutral'} icon={<CircleDashed className="h-3 w-3" />}>
      {overdue ? 'Overdue' : 'Not started'}
    </Badge>
  );
}

export function RoomStatusBadge({ status }: { status: RoomStatus }) {
  if (status === 'AVAILABLE') return <Badge tone="ok">Available</Badge>;
  if (status === 'MAINTENANCE')
    return (
      <Badge tone="warn" icon={<Wrench className="h-3 w-3" />}>
        Maintenance
      </Badge>
    );
  return (
    <Badge tone="neutral" icon={<XCircle className="h-3 w-3" />}>
      Retired
    </Badge>
  );
}

export function AttendancePill({ status }: { status: 'PRESENT' | 'ABSENT' | null }) {
  if (status === 'PRESENT') return <Badge tone="ok">Present</Badge>;
  if (status === 'ABSENT') return <Badge tone="bad">Absent</Badge>;
  return <Badge tone="neutral">Unmarked</Badge>;
}
