import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { Card } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { SearchInput, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { Pagination } from '@/components/ui/table';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AuditItem, Paged } from '@/lib/types';
import { actionLabel, AuditTimeline } from '../shared/AuditTimeline';

const ACTIONS = [
  'EXAM_CREATED',
  'EXAM_UPDATED',
  'EXAM_PUBLISHED',
  'EXAM_UNPUBLISHED',
  'EXAM_DEACTIVATED',
  'ALLOCATION_COMMITTED',
  'SEAT_MOVED',
  'SEAT_ASSIGNED',
  'SEAT_RELEASED',
  'ROOMS_ASSIGNED',
  'INCHARGES_ASSIGNED',
  'ELIGIBILITY_UPDATED',
  'ATTENDANCE_CORRECTED',
  'ATTENDANCE_FINALIZED',
  'ATTENDANCE_REOPENED',
  'ROOM_UPDATED',
  'USER_SIGNED_IN',
];

export function AuditPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  useBreadcrumbs([{ label: isAdmin ? 'Audit timeline' : 'My activity' }]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [debounced, action]);
  const q = useQuery({
    queryKey: ['audit', { debounced, action, page }],
    queryFn: () => api.get<Paged<AuditItem>>(`/audit${qs({ q: debounced, action, page, pageSize: 30 })}`),
    placeholderData: (p) => p,
  });
  return (
    <div>
      <PageHeader
        title={isAdmin ? 'Audit timeline' : 'My activity'}
        description={
          isAdmin
            ? 'Append-only record of who changed allocations, published examinations, corrected or finalized attendance. Entries cannot be edited or deleted.'
            : 'Your own recorded actions. The full timeline is visible to examination admins.'
        }
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search summary or person…" className="w-full sm:w-72" />
          <Select value={action} onChange={(e) => setAction(e.target.value)} className="h-9 w-auto" aria-label="Action">
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </Select>
        </div>
        <div className="p-4">
          {q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data ? (
            <div className="space-y-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="w-2/3" />
              ))}
            </div>
          ) : (
            <AuditTimeline items={q.data.items} />
          )}
        </div>
        {q.data && q.data.total > q.data.pageSize && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
