import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2, ClipboardCheck, DoorOpen, Hourglass, Lock, Users } from 'lucide-react';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { Card, CardHeader } from '@/components/ui/card';
import { Callout, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { KpiTile, PageHeader } from '@/components/ui/page';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Duty } from '@/lib/types';
import { fmtDate } from '@/lib/utils';
import { DutyTable } from '../shared/DutyTable';

interface InchargeDashboard {
  today: string;
  duties: Duty[];
  summary: { assignedRooms: number; today: number; pendingSubmissions: number; finalized: number; studentsToday: number };
}

export function DutiesPage() {
  useBreadcrumbs([{ label: 'Duty dashboard' }]);
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['dashboard', 'incharge'], queryFn: () => api.get<InchargeDashboard>('/dashboard/incharge') });
  const d = q.data;
  const urgent = d?.duties.filter((x) => x.examStatus === 'PUBLISHED' && x.submissionStatus !== 'FINALIZED' && x.timing !== 'UPCOMING') ?? [];
  const today = d?.duties.filter((x) => x.timing === 'TODAY') ?? [];
  const rest = d?.duties.filter((x) => x.timing !== 'TODAY') ?? [];
  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.fullName ?? ''}`}
        description={d ? `${fmtDate(d.today, 'EEEE, dd MMMM yyyy')} · you can access only the examinations and rooms assigned to you.` : undefined}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiTile label="Rooms today" icon={DoorOpen} value={d.summary.today} sub={`${d.summary.studentsToday} students to supervise`} />
            <KpiTile label="Pending submissions" icon={Hourglass} value={d.summary.pendingSubmissions} tone={d.summary.pendingSubmissions ? 'warn' : 'neutral'} sub="Today or overdue" />
            <KpiTile label="Finalized" icon={Lock} value={d.summary.finalized} tone="ok" sub="Locked submissions" />
            <KpiTile label="All assignments" icon={CalendarCheck2} value={d.summary.assignedRooms} sub="Past, today and upcoming" />
          </div>
          {urgent.length > 0 && (
            <Callout tone={urgent.some((u) => u.timing === 'PAST') ? 'critical' : 'warning'} title="Attendance awaiting your submission">
              {urgent.map((u) => `${u.courseCode} · ${u.roomNo} (${u.unmarked} unmarked)`).join(' · ')}
            </Callout>
          )}
          <Card>
            <CardHeader title="Today’s duties" description="Mark attendance as candidates arrive; submit once every student is accounted for." />
            {today.length === 0 ? <EmptyState icon={ClipboardCheck} title="No duties today" /> : <DutyTable duties={today} />}
          </Card>
          <Card>
            <CardHeader title="Other assignments" />
            {rest.length === 0 ? <EmptyState icon={Users} title="No other assignments" /> : <DutyTable duties={rest} />}
          </Card>
        </div>
      )}
    </div>
  );
}
