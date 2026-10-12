import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, CalendarDays } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EXAM_STATUS_LABEL, EXAM_STATUSES, EXAM_TYPE_LABEL, SESSION_LABEL, SESSIONS } from '@shared/schemas';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { ExamStatusBadge } from '@/components/ui/badges';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, Progress } from '@/components/ui/feedback';
import { SearchInput, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { Pagination, Table, TableSkeleton, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, qs } from '@/lib/api';
import type { ExamRow, Meta, Paged } from '@/lib/types';
import { fmtDate, relativeDay } from '@/lib/utils';
import { ExamFormDialog } from './ExamFormDialog';

export function ExamsPage() {
  useBreadcrumbs([{ label: 'Examinations' }]);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [session, setSession] = useState('');
  const [active, setActive] = useState('true');
  const [sort, setSort] = useState('date_asc');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(params.get('new') === '1');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [debounced, status, departmentId, session, active, sort]);

  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/meta'), staleTime: 60_000 });
  const list = useQuery({
    queryKey: ['exams', { debounced, status, departmentId, session, active, sort, page }],
    queryFn: () => api.get<Paged<ExamRow>>(`/exams${qs({ q: debounced, status, departmentId, session, active, sort, page, pageSize: 15 })}`),
    placeholderData: (prev) => prev,
  });

  return (
    <div>
      <PageHeader
        title="Examinations"
        description="Create and manage examination sessions, their cohorts, rooms and publication."
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <CalendarPlus className="h-4 w-4" /> New examination
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name or course code…" className="w-full sm:w-72" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-auto" aria-label="Status">
            <option value="">All statuses</option>
            {EXAM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EXAM_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="h-9 w-auto" aria-label="Department">
            <option value="">All departments</option>
            {meta.data?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code}
              </option>
            ))}
          </Select>
          <Select value={session} onChange={(e) => setSession(e.target.value)} className="h-9 w-auto" aria-label="Session">
            <option value="">Any session</option>
            {SESSIONS.map((s) => (
              <option key={s} value={s}>
                {SESSION_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select value={active} onChange={(e) => setActive(e.target.value)} className="h-9 w-auto" aria-label="Active">
            <option value="true">Active</option>
            <option value="false">Deactivated</option>
            <option value="all">All</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 w-auto sm:ml-auto" aria-label="Sort">
            <option value="date_asc">Date ↑</option>
            <option value="date_desc">Date ↓</option>
            <option value="name">Name</option>
          </Select>
        </div>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data ? (
          <TableSkeleton />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={debounced || status || departmentId || session ? 'No examinations match these filters' : 'No examinations yet'}
            description="Create an examination to start planning rooms and seating."
            action={
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                New examination
              </Button>
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Examination</TH>
                  <TH>Date & session</TH>
                  <TH>Cohort</TH>
                  <TH className="w-44">Seating</TH>
                  <TH>Rooms</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {list.data.items.map((e) => {
                  const short = e.eligibleCount > e.capacity && e.roomCount > 0;
                  return (
                    <TR key={e.id} className="cursor-pointer" onClick={() => navigate(`/examinations/${e.id}`)}>
                      <TD>
                        <p className="font-medium text-ink">{e.courseCode}</p>
                        <p className="max-w-[320px] truncate text-xs text-muted">{e.name}</p>
                      </TD>
                      <TD>
                        <p>{fmtDate(e.examDate)}</p>
                        <p className="text-xs text-muted">
                          {relativeDay(e.examDate)} · {e.session} {e.startTime}
                        </p>
                      </TD>
                      <TD>
                        <p>{e.departmentCode ?? 'All depts'} · Y{e.year}</p>
                        <p className="text-xs text-muted">{e.section ? `Section ${e.section}` : 'All sections'} · {EXAM_TYPE_LABEL[e.examType]}</p>
                      </TD>
                      <TD>
                        <div className="flex items-center justify-between text-xs">
                          <span className="tnum">
                            {e.allocatedCount}/{e.eligibleCount} seated
                          </span>
                          {short && <span className="text-bad">short {e.eligibleCount - e.capacity}</span>}
                        </div>
                        <Progress value={e.eligibleCount ? e.allocatedCount / e.eligibleCount : 0} className="mt-1.5" tone={short ? 'bad' : 'accent'} />
                      </TD>
                      <TD className="tnum">
                        {e.roomCount} <span className="text-xs text-muted">({e.capacity} seats)</span>
                      </TD>
                      <TD>
                        <ExamStatusBadge status={e.status} active={e.isActive} />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <ExamFormDialog
        open={createOpen}
        onOpenChange={(v) => {
          setCreateOpen(v);
          if (!v && params.get('new')) setParams({}, { replace: true });
        }}
        onSaved={(id) => navigate(`/examinations/${id}`)}
      />
    </div>
  );
}
