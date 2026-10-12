import {
  ArmchairIcon,
  CalendarPlus,
  CheckCheck,
  DoorOpen,
  Eye,
  EyeOff,
  LogIn,
  PencilLine,
  Power,
  RotateCcw,
  Send,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/ui/feedback';
import type { AuditItem } from '@/lib/types';
import { cn, fmtDateTime, fmtRelative } from '@/lib/utils';

const ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  EXAM_CREATED: { icon: CalendarPlus, tone: 'text-accent' },
  EXAM_UPDATED: { icon: PencilLine, tone: 'text-muted' },
  EXAM_PUBLISHED: { icon: Send, tone: 'text-ok' },
  EXAM_UNPUBLISHED: { icon: EyeOff, tone: 'text-warn' },
  EXAM_DEACTIVATED: { icon: Power, tone: 'text-bad' },
  EXAM_REACTIVATED: { icon: Power, tone: 'text-ok' },
  ALLOCATION_COMMITTED: { icon: ArmchairIcon, tone: 'text-cyan' },
  SEAT_ASSIGNED: { icon: ArmchairIcon, tone: 'text-cyan' },
  SEAT_MOVED: { icon: ArmchairIcon, tone: 'text-warn' },
  SEAT_RELEASED: { icon: ArmchairIcon, tone: 'text-bad' },
  ROOMS_ASSIGNED: { icon: DoorOpen, tone: 'text-accent' },
  INCHARGES_ASSIGNED: { icon: UserCheck, tone: 'text-accent' },
  ELIGIBILITY_UPDATED: { icon: Users, tone: 'text-accent' },
  ATTENDANCE_FINALIZED: { icon: CheckCheck, tone: 'text-ok' },
  ATTENDANCE_CORRECTED: { icon: PencilLine, tone: 'text-warn' },
  ATTENDANCE_REOPENED: { icon: RotateCcw, tone: 'text-bad' },
  USER_SIGNED_IN: { icon: LogIn, tone: 'text-faint' },
};

export function actionLabel(action: string) {
  return action
    .toLowerCase()
    .split('_')
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function AuditTimeline({ items, showExam = true }: { items: AuditItem[]; showExam?: boolean }) {
  if (items.length === 0) return <EmptyState icon={Eye} title="No audit events" description="Sensitive operations will appear here as they happen." />;
  return (
    <ol className="relative">
      {items.map((e, i) => {
        const meta = ICONS[e.action] ?? { icon: PencilLine, tone: 'text-muted' };
        return (
          <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < items.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-20px)] w-px bg-line" aria-hidden />}
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-raised">
              <meta.icon className={cn('h-3.5 w-3.5', meta.tone)} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[13px] text-ink">{e.summary}</p>
              <p className="mt-0.5 text-xs text-faint">
                <span className="text-muted">{e.actorName ?? 'System'}</span>
                {e.actorRole && <span> · {e.actorRole.toLowerCase()}</span>} · <span title={fmtDateTime(e.createdAt)}>{fmtRelative(e.createdAt)}</span> ·{' '}
                <span className="font-mono">{e.action}</span>
                {showExam && e.examId && e.examName && (
                  <>
                    {' · '}
                    <Link to={`/examinations/${e.examId}?tab=audit`} className="text-accent hover:underline">
                      {e.examName}
                    </Link>
                  </>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
