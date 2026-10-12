import * as P from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import {
  AlertOctagon,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  DoorOpen,
  Gauge,
  HelpCircle,
  Hourglass,
  Info,
  Lock,
  Users,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EXAM_STATUS_LABEL } from '@shared/schemas';
import { AttendanceCompletionChart, AttendanceMeter, RoomUtilizationChart } from '@/components/charts';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { ExamStatusBadge, SubmissionBadge } from '@/components/ui/badges';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, Progress, SeverityIcon, Skeleton } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { AnimatedNumber } from '@/components/ui/number';
import { KpiTile, PageHeader } from '@/components/ui/page';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, qs } from '@/lib/api';
import type { AdminDashboardData, ExamRow, Meta, Paged } from '@/lib/types';
import { fmtDate, fmtNum, fmtRelative, relativeDay, sessionLabel } from '@/lib/utils';

const FILTER_KEYS = ['from', 'to', 'examId', 'courseId', 'departmentId', 'roomId'] as const;

const DEFINITIONS: { k: string; v: string }[] = [
  { k: 'Scope', v: 'Active examinations matching the filters. Deactivated examinations are excluded everywhere.' },
  { k: 'Allocated / unallocated', v: 'Seat rows in draft or published allocations; unallocated = eligible enrolments − allocated seats.' },
  { k: 'Utilization', v: 'Allocated seats ÷ capacity of rooms booked by in-scope examinations.' },
  { k: 'Capacity issues', v: 'Exams whose eligible count exceeds usable booked seats + bookings of rooms not available + seats beyond room capacity.' },
  { k: 'Attendance completion', v: 'Marked ÷ allocated, published examinations only. Unmarked is never counted as absent.' },
  { k: 'Final present / absent', v: 'Marks in rooms whose submission is finalized (locked).' },
  { k: 'Pending rooms', v: 'Occupied rooms of published exams not yet finalized; overdue if the exam date has passed.' },
  { k: 'Pending reports', v: 'Published exams dated today or earlier whose absentee statement is still provisional.' },
];

function useFilters() {
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<(typeof FILTER_KEYS)[number], string>;
  const set = (k: (typeof FILTER_KEYS)[number], v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const clear = () => setParams(new URLSearchParams(), { replace: true });
  const active = FILTER_KEYS.some((k) => filters[k]);
  return { filters, set, clear, active };
}

export function DashboardPage() {
  useBreadcrumbs([{ label: 'Control center' }]);
  const { filters, set, clear, active } = useFilters();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/meta'), staleTime: 60_000 });
  const exams = useQuery({ queryKey: ['exams', 'filter-options'], queryFn: () => api.get<Paged<ExamRow>>('/exams?pageSize=100&sort=date_desc') });
  const dash = useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => api.get<AdminDashboardData>(`/dashboard/admin${qs(filters)}`),
    placeholderData: (prev) => prev,
  });
  const d = dash.data;

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Examination control center"
        description={d ? `${fmtDate(d.today, 'EEEE, dd MMMM yyyy')} · updated ${fmtRelative(d.generatedAt)}` : 'Live operational overview'}
        actions={
          <>
            <MetricDefinitions />
            <LinkButton variant="primary" size="sm" to="/examinations?new=1">
              New examination
            </LinkButton>
          </>
        }
      />

      {/* filters — one row above everything they affect */}
      <Card flat className="rise mb-5 flex flex-wrap items-end gap-3 p-3.5">
        <FilterField label="From">
          <Input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} className="h-8 w-[150px]" />
        </FilterField>
        <FilterField label="To">
          <Input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} className="h-8 w-[150px]" />
        </FilterField>
        <FilterField label="Examination">
          <Select value={filters.examId} onChange={(e) => set('examId', e.target.value)} className="h-8 w-[220px]">
            <option value="">All examinations</option>
            {exams.data?.items.map((e) => (
              <option key={e.id} value={e.id}>
                {e.courseCode} · {fmtDate(e.examDate, 'dd MMM')} {e.session}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Course">
          <Select value={filters.courseId} onChange={(e) => set('courseId', e.target.value)} className="h-8 w-[160px]">
            <option value="">All courses</option>
            {meta.data?.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Department">
          <Select value={filters.departmentId} onChange={(e) => set('departmentId', e.target.value)} className="h-8 w-[150px]">
            <option value="">All departments</option>
            {meta.data?.departments.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Room">
          <Select value={filters.roomId} onChange={(e) => set('roomId', e.target.value)} className="h-8 w-[130px]">
            <option value="">All rooms</option>
            {meta.data?.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.roomNo}
              </option>
            ))}
          </Select>
        </FilterField>
        {active && (
          <Button variant="ghost" size="sm" onClick={clear}>
            <X className="h-3.5 w-3.5" /> Clear filters
          </Button>
        )}
      </Card>

      {dash.isError && !d ? (
        <Card>
          <ErrorState error={dash.error} onRetry={() => dash.refetch()} />
        </Card>
      ) : !d ? (
        <DashboardSkeleton />
      ) : (
        <div className="space-y-5">
          <div className="stagger grid grid-cols-2 gap-3.5 md:grid-cols-4">
            <KpiTile
              label="Examinations"
              icon={CalendarDays}
              value={<AnimatedNumber value={d.kpis.totalExams} format={fmtNum} />}
              sub={`${d.kpis.examsByStatus.published} published · ${d.kpis.examsByStatus.allocated} draft plan · ${d.kpis.examsByStatus.draft} setup`}
              definition="Active examinations in scope"
            />
            <KpiTile
              label="Active rooms"
              icon={DoorOpen}
              value={<AnimatedNumber value={d.kpis.activeRooms} format={fmtNum} />}
              sub={`${fmtNum(d.kpis.seatingCapacity)} seats total${d.kpis.unavailableRooms ? ` · ${d.kpis.unavailableRooms} unavailable` : ''}`}
              definition="Rooms with status Available, and their summed capacity"
            />
            <KpiTile
              label="Allocated seats"
              icon={Users}
              value={<AnimatedNumber value={d.kpis.allocated} format={fmtNum} />}
              tone={d.kpis.unallocated > 0 ? 'warn' : 'neutral'}
              sub={
                <span className={d.kpis.unallocated ? 'text-warn' : undefined}>
                  {d.kpis.unallocated} unallocated of {d.kpis.eligible} eligible
                </span>
              }
              definition="Seat allocations (draft + published); unallocated = eligible − allocated"
            />
            <KpiTile
              label="Room utilization"
              icon={Gauge}
              value={<AnimatedNumber value={d.kpis.utilization * 100} format={(n) => `${n}%`} />}
              sub={`${d.kpis.allocated} of ${d.kpis.bookedCapacity} booked seats`}
            >
              <Progress value={d.kpis.utilization} className="mt-3" />
            </KpiTile>
            <KpiTile
              label="Capacity issues"
              icon={AlertOctagon}
              value={<AnimatedNumber value={d.kpis.capacityIssues} />}
              tone={d.kpis.capacityIssues ? 'bad' : 'neutral'}
              sub={
                d.kpis.capacityIssues
                  ? `${d.kpis.capacityBreakdown.shortageExams} shortage · ${d.kpis.capacityBreakdown.unavailableBookings} unavailable room`
                  : 'No shortages or over-allocation'
              }
            />
            <KpiTile
              label="Attendance completion"
              icon={ClipboardList}
              value={<AnimatedNumber value={d.kpis.attendance.completion * 100} format={(n) => `${n}%`} />}
              sub={`${d.kpis.attendance.marked} marked · ${d.kpis.attendance.unmarked} unmarked`}
            >
              <Progress value={d.kpis.attendance.completion} className="mt-3" tone={d.kpis.attendance.completion === 1 ? 'ok' : 'accent'} />
            </KpiTile>
            <KpiTile
              label="Finalized attendance"
              icon={Lock}
              value={
                <span>
                  <AnimatedNumber value={d.kpis.attendance.finalPresent} />
                  <span className="text-base font-normal text-muted"> present</span>
                </span>
              }
              sub={`${d.kpis.attendance.finalAbsent} absent in finalized rooms`}
            />
            <KpiTile
              label="Pending submissions"
              icon={Hourglass}
              value={<AnimatedNumber value={d.kpis.pendingRooms} />}
              tone={d.kpis.overdueRooms ? 'bad' : d.kpis.pendingRooms ? 'warn' : 'neutral'}
              sub={`${d.kpis.overdueRooms} overdue rooms · ${d.kpis.pendingReports} provisional report${d.kpis.pendingReports === 1 ? '' : 's'}`}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <ControlCenter data={d} />
            <PendingTasks data={d} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Room utilization" description="Allocated ÷ offered seats per booked room" />
              <CardBody>
                <RoomUtilizationChart data={d.charts.roomUtilization} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Attendance completion" description="Published examinations · live from attendance records" />
              <CardBody>
                <AttendanceCompletionChart data={d.charts.attendanceByExam} />
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <DepartmentSummary data={d} />
            <Timeline data={d} />
            <Activity data={d} />
          </div>
        </div>
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="block text-2xs uppercase tracking-wide text-faint">{label}</span>
      {children}
    </label>
  );
}

function MetricDefinitions() {
  return (
    <P.Root>
      <P.Trigger asChild>
        <Button variant="ghost" size="sm">
          <HelpCircle className="h-4 w-4" /> How metrics are calculated
        </Button>
      </P.Trigger>
      <P.Portal>
        <P.Content
          align="end"
          sideOffset={8}
          className="glass edge-light relative z-50 w-[420px] max-w-[calc(100vw-1rem)] animate-fade-in rounded-2xl p-4 shadow-pop"
        >
          <p className="display mb-3 text-[15px]">Metric definitions</p>
          <dl className="space-y-2.5 text-xs">
            {DEFINITIONS.map((x) => (
              <div key={x.k}>
                <dt className="font-medium text-ink">{x.k}</dt>
                <dd className="text-muted">{x.v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 border-t border-line/80 pt-3 text-2xs text-faint">All figures are computed live from database records — no stored totals.</p>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

function ControlCenter({ data }: { data: AdminDashboardData }) {
  const { date, rooms } = data.controlCenter;
  const overdue = date !== null && date < data.today;
  return (
    <Card featured className="xl:col-span-2">
      <CardHeader
        eyebrow="Today"
        title="Live examination control"
        description={date ? `${relativeDay(date)} · ${fmtDate(date, 'EEE dd MMM')} — every published room and its attendance state` : 'No published examinations in scope'}
        action={
          <Link to="/attendance" className="text-xs text-accent hover:underline">
            All rooms
          </Link>
        }
      />
      {rooms.length === 0 ? (
        <EmptyState icon={CalendarDays} title="Nothing scheduled" description="Publish an examination to see its rooms here." />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Room</TH>
              <TH>Examination</TH>
              <TH>In-charge</TH>
              <TH className="w-[28%]">Attendance</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {rooms.map((r) => (
              <TR key={`${r.examId}${r.roomId}`}>
                <TD>
                  <Link to={`/attendance/${r.examId}/${r.roomId}`} className="font-medium hover:text-accent">
                    {r.roomNo}
                  </Link>
                  <p className="text-2xs text-faint">{r.block}</p>
                </TD>
                <TD>
                  <p className="font-medium">{r.courseCode}</p>
                  <p className="text-2xs text-faint">
                    {sessionLabel(r.session)} · {r.startTime}
                  </p>
                </TD>
                <TD className={r.inchargeName ? '' : 'text-bad'}>{r.inchargeName ?? 'Unassigned'}</TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <AttendanceMeter present={r.present} absent={r.absent} allocated={r.allocated} />
                    <span className="tnum shrink-0 text-2xs text-muted">
                      {r.present + r.absent}/{r.allocated}
                    </span>
                  </div>
                  <p className="tnum mt-1 text-2xs text-faint">
                    {r.present} present · {r.absent} absent · {r.unmarked} unmarked
                  </p>
                </TD>
                <TD>
                  <SubmissionBadge status={r.submissionStatus} overdue={overdue && r.submissionStatus !== 'FINALIZED'} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function PendingTasks({ data }: { data: AdminDashboardData }) {
  const items = data.alerts;
  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Pending tasks & safeguards"
        description={items.length ? `${items.filter((a) => a.severity === 'critical').length} critical · ${items.length} total` : 'Nothing needs attention'}
      />
      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="All clear" description="No capacity, publication or attendance issues." />
      ) : (
        <ul className="max-h-[440px] divide-y divide-line/70 overflow-y-auto">
          {items.map((a) => (
            <li key={a.id}>
              <Link to={a.href} className="group flex gap-3 px-4 py-3 hover:bg-raised/40">
                <SeverityIcon severity={a.severity} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink">{a.title}</span>
                  <span className="block text-xs text-muted">{a.detail}</span>
                </span>
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DepartmentSummary({ data }: { data: AdminDashboardData }) {
  const rows = data.charts.departments;
  return (
    <Card>
      <CardHeader title="Department summary" description="Enrolment, seating and attendance by student department" />
      {rows.length === 0 ? (
        <EmptyState title="No enrolments in scope" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Dept</TH>
              <TH className="text-right">Eligible</TH>
              <TH className="text-right">Seated</TH>
              <TH className="text-right">Present</TH>
              <TH className="text-right">Absent</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.departmentCode}>
                <TD title={r.departmentName} className="font-medium">
                  {r.departmentCode}
                </TD>
                <TD className="tnum text-right">{r.eligible}</TD>
                <TD className="tnum text-right">{r.allocated}</TD>
                <TD className="tnum text-right">{r.present}</TD>
                <TD className="tnum text-right">{r.absent}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function Timeline({ data }: { data: AdminDashboardData }) {
  return (
    <Card>
      <CardHeader
        title="Upcoming examinations"
        action={
          <Link to="/examinations" className="text-xs text-accent hover:underline">
            View all
          </Link>
        }
      />
      {data.timeline.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No upcoming examinations" />
      ) : (
        <ol className="relative space-y-0 px-4 py-3">
          {data.timeline.map((e, i) => (
            <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
              {i < data.timeline.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-line" aria-hidden />}
              <span
                className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 ${e.status === 'PUBLISHED' ? 'border-ok bg-ok/30' : e.status === 'ALLOCATED' ? 'border-cyan bg-cyan/20' : 'border-faint bg-raised'}`}
                aria-label={EXAM_STATUS_LABEL[e.status]}
              />
              <Link to={`/examinations/${e.id}`} className="min-w-0 flex-1 hover:text-accent">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{e.courseCode}</span>
                  <ExamStatusBadge status={e.status} />
                </span>
                <span className="block truncate text-xs text-muted">
                  {relativeDay(e.examDate)} · {fmtDate(e.examDate, 'dd MMM')} {e.session} {e.startTime} · {e.allocated}/{e.eligible} seated · {e.rooms} room{e.rooms === 1 ? '' : 's'}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Activity({ data }: { data: AdminDashboardData }) {
  return (
    <Card>
      <CardHeader
        title="Recent activity"
        action={
          <Link to="/audit" className="text-xs text-accent hover:underline">
            Audit timeline
          </Link>
        }
      />
      {data.activity.length === 0 ? (
        <EmptyState icon={Info} title="No activity yet" />
      ) : (
        <ul className="divide-y divide-line/70">
          {data.activity.map((a) => (
            <li key={a.id} className="px-4 py-2.5">
              <p className="line-clamp-2 text-[13px] text-ink/90">{a.summary}</p>
              <p className="mt-0.5 text-2xs text-faint">
                {a.actorName} · {fmtRelative(a.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="glass rounded-2xl p-4">
            <Skeleton className="w-24" />
            <Skeleton className="mt-3 h-7 w-16" />
            <Skeleton className="mt-2 w-32" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Skeleton className="h-72 xl:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
