import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { KpiTile, PageHeader } from '@/components/ui/page';
import { TableSkeleton } from '@/components/ui/table';
import { api } from '@/lib/api';
import type { Duty } from '@/lib/types';
import { DutyTable } from '../shared/DutyTable';

export function AttendanceBoardPage() {
  useBreadcrumbs([{ label: 'Attendance' }]);
  const [timing, setTiming] = useState<'ACTIVE' | 'TODAY' | 'PAST' | 'UPCOMING' | 'ALL'>('ACTIVE');
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['duties'], queryFn: () => api.get<Duty[]>('/duties') });
  const published = (q.data ?? []).filter((d) => d.examStatus === 'PUBLISHED' && d.allocated > 0);
  const rows = useMemo(
    () =>
      (q.data ?? []).filter(
        (d) =>
          (timing === 'ALL' || (timing === 'ACTIVE' ? d.timing !== 'UPCOMING' || d.examStatus === 'PUBLISHED' : d.timing === timing)) &&
          (!status || d.submissionStatus === status),
      ),
    [q.data, timing, status],
  );
  const overdue = published.filter((d) => d.timing === 'PAST' && d.submissionStatus !== 'FINALIZED').length;
  return (
    <div>
      <PageHeader title="Attendance" description="Every examination room, its in-charge and submission state. Admins can mark on behalf of an in-charge and reopen finalized rooms." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile label="Published rooms" value={published.length} />
        <KpiTile label="Finalized" value={published.filter((d) => d.submissionStatus === 'FINALIZED').length} tone="ok" />
        <KpiTile label="In progress / not started" value={published.filter((d) => d.submissionStatus !== 'FINALIZED').length} tone="warn" />
        <KpiTile label="Overdue" value={overdue} tone={overdue ? 'bad' : 'neutral'} sub="Exam date passed, not finalized" />
      </div>
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Select value={timing} onChange={(e) => setTiming(e.target.value as typeof timing)} className="h-9 w-auto" aria-label="When">
            <option value="ACTIVE">Today, past & published</option>
            <option value="TODAY">Today</option>
            <option value="PAST">Past</option>
            <option value="UPCOMING">Upcoming</option>
            <option value="ALL">All</option>
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-auto" aria-label="Submission">
            <option value="">Any submission state</option>
            <option value="NOT_STARTED">Not started</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="FINALIZED">Finalized</option>
          </Select>
        </div>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No rooms match" />
        ) : (
          <DutyTable duties={rows} showIncharge />
        )}
      </Card>
    </div>
  );
}
