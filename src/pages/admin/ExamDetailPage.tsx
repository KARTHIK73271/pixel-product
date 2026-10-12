import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, Circle, FileText, MoreHorizontal, Pencil, Power, Send, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { EXAM_TYPE_LABEL } from '@shared/schemas';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { ExamStatusBadge } from '@/components/ui/badges';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Callout, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { PageHeader, TabPanel, Tabs } from '@/components/ui/page';
import { KeyValue } from '@/components/ui/table';
import { api } from '@/lib/api';
import { withToast } from '@/lib/forms';
import type { ExamDetail } from '@/lib/types';
import { cn, fmtDate, fmtDateTime, relativeDay, sessionLabel } from '@/lib/utils';
import { ExamFormDialog } from './ExamFormDialog';
import { AllocationTab } from './exam/AllocationTab';
import { ExamAttendanceTab } from './exam/AttendanceTab';
import { ExamAuditTab } from './exam/AuditTab';
import { PublishDialog } from './exam/PublishDialog';
import { RoomsTab } from './exam/RoomsTab';
import { StudentsTab } from './exam/StudentsTab';

export function ExamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const setTab = (t: string) => setParams({ tab: t }, { replace: true });
  const q = useQuery({ queryKey: ['exam', id], queryFn: () => api.get<ExamDetail>(`/exams/${id}`) });
  const [editOpen, setEditOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'unpublish' | 'deactivate' | 'reactivate'>(null);
  useBreadcrumbs([{ label: 'Examinations', to: '/examinations' }, { label: q.data ? q.data.exam.courseCode : 'Examination' }]);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="mt-6 h-64" />
      </div>
    );

  const { exam, rooms } = q.data;
  const published = exam.status === 'PUBLISHED';
  const hasAttendance = rooms.some((r) => r.marked > 0);

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {exam.courseCode} <span className="font-normal text-muted">·</span> <span className="font-medium">{exam.courseName}</span>
          </span>
        }
        description={exam.name}
        meta={
          <>
            <ExamStatusBadge status={exam.status} active={exam.isActive} />
            <span className="text-xs text-muted">
              {fmtDate(exam.examDate, 'EEE dd MMM yyyy')} · {sessionLabel(exam.session)} {exam.startTime} · {exam.durationMinutes} min ·{' '}
              {relativeDay(exam.examDate)}
            </span>
          </>
        }
        actions={
          <>
            {exam.status === 'ALLOCATED' && exam.isActive && (
              <Button variant="primary" onClick={() => setPublishOpen(true)}>
                <Send className="h-4 w-4" /> Publish seating
              </Button>
            )}
            {published && (
              <LinkButton to={`/print/absentees/${exam.id}`} target="_blank">
                <FileText className="h-4 w-4" /> Absentee report
              </LinkButton>
            )}
            <Menu>
              <MenuTrigger asChild>
                <Button aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" /> <ChevronDown className="h-3 w-3" />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => setEditOpen(true)} disabled={published || !exam.isActive}>
                  <Pencil className="h-4 w-4" /> Edit details{published ? ' (unpublish first)' : ''}
                </MenuItem>
                {published && (
                  <MenuItem onSelect={() => setConfirm('unpublish')} disabled={hasAttendance}>
                    <Undo2 className="h-4 w-4" /> Unpublish{hasAttendance ? ' (attendance recorded)' : ''}
                  </MenuItem>
                )}
                <MenuSeparator />
                {exam.isActive ? (
                  <MenuItem danger onSelect={() => setConfirm('deactivate')} disabled={hasAttendance}>
                    <Power className="h-4 w-4" /> Deactivate{hasAttendance ? ' (attendance recorded)' : ''}
                  </MenuItem>
                ) : (
                  <MenuItem onSelect={() => setConfirm('reactivate')}>
                    <Power className="h-4 w-4" /> Reactivate
                  </MenuItem>
                )}
              </MenuContent>
            </Menu>
          </>
        }
      />

      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'students', label: 'Eligible students', count: exam.eligibleCount },
          { value: 'rooms', label: 'Rooms & in-charges', count: rooms.length },
          { value: 'allocation', label: 'Seating allocation' },
          { value: 'attendance', label: 'Attendance', count: published ? `${exam.finalizedRooms}/${rooms.filter((r) => r.allocated > 0).length}` : undefined },
          { value: 'audit', label: 'Audit' },
        ]}
      >
        <TabPanel value="overview">
          <Overview detail={q.data} onTab={setTab} />
        </TabPanel>
        <TabPanel value="students">
          <StudentsTab detail={q.data} />
        </TabPanel>
        <TabPanel value="rooms">
          <RoomsTab detail={q.data} />
        </TabPanel>
        <TabPanel value="allocation">
          <AllocationTab detail={q.data} onPublish={() => setPublishOpen(true)} />
        </TabPanel>
        <TabPanel value="attendance">
          <ExamAttendanceTab detail={q.data} />
        </TabPanel>
        <TabPanel value="audit">
          <ExamAuditTab examId={exam.id} />
        </TabPanel>
      </Tabs>

      <ExamFormDialog open={editOpen} onOpenChange={setEditOpen} exam={exam} />
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} detail={q.data} />
      <ConfirmDialog
        open={confirm === 'unpublish'}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Unpublish seating?"
        description="Students will no longer see their rooms and seats until you publish again. The allocation draft is kept."
        confirmLabel="Unpublish"
        onConfirm={() => withToast(() => api.post(`/exams/${exam.id}/unpublish`), 'Seating unpublished')}
      />
      <ConfirmDialog
        open={confirm === 'deactivate'}
        onOpenChange={(v) => !v && setConfirm(null)}
        tone="danger"
        title="Deactivate examination?"
        description={`All ${exam.allocatedCount} seat allocations will be released and the rooms freed for other examinations. Eligible students and room choices are kept so it can be reactivated.`}
        confirmLabel="Deactivate"
        onConfirm={() => withToast(() => api.post(`/exams/${exam.id}/deactivate`), 'Examination deactivated')}
      />
      <ConfirmDialog
        open={confirm === 'reactivate'}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Reactivate examination?"
        description="Rooms and students are re-checked for conflicts in the same date and session."
        confirmLabel="Reactivate"
        onConfirm={() => withToast(() => api.post(`/exams/${exam.id}/reactivate`), 'Examination reactivated')}
      />
    </div>
  );
}

function Overview({ detail, onTab }: { detail: ExamDetail; onTab: (t: string) => void }) {
  const { exam, rooms, warnings } = detail;
  const occupied = rooms.filter((r) => r.allocated > 0);
  const steps = [
    { label: 'Enrol eligible students', done: exam.eligibleCount > 0, tab: 'students', meta: `${exam.eligibleCount} enrolled` },
    { label: 'Assign rooms', done: rooms.length > 0 && exam.capacity >= exam.eligibleCount, tab: 'rooms', meta: `${rooms.length} rooms · ${exam.capacity} seats` },
    { label: 'Generate & confirm seating', done: exam.status !== 'DRAFT', tab: 'allocation', meta: `${exam.allocatedCount}/${exam.eligibleCount} seated` },
    { label: 'Assign room in-charges', done: occupied.length > 0 && occupied.every((r) => r.inchargeId), tab: 'rooms', meta: `${occupied.filter((r) => r.inchargeId).length}/${occupied.length} rooms covered` },
    { label: 'Publish to students', done: exam.status === 'PUBLISHED', tab: 'allocation', meta: exam.publishedAt ? `Published ${fmtDateTime(exam.publishedAt)}` : 'Not published' },
    {
      label: 'Record & finalize attendance',
      done: occupied.length > 0 && exam.finalizedRooms >= occupied.length,
      tab: 'attendance',
      meta: `${exam.finalizedRooms}/${occupied.length} rooms finalized`,
    },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {warnings.length > 0 && (
          <div className="space-y-2">
            {warnings.map((w, i) => (
              <Callout key={i} tone={w.severity}>
                {w.message}
              </Callout>
            ))}
          </div>
        )}
        <Card>
          <CardHeader title="Examination details" />
          <CardBody>
            <KeyValue
              items={[
                { label: 'Type', value: EXAM_TYPE_LABEL[exam.examType] },
                { label: 'Course', value: `${exam.courseCode} — ${exam.courseName}` },
                { label: 'Department', value: exam.departmentName ?? 'All departments' },
                { label: 'Year / section', value: `Year ${exam.year} · ${exam.section ? `Section ${exam.section}` : 'All sections'}` },
                { label: 'Date', value: fmtDate(exam.examDate, 'EEEE, dd MMM yyyy') },
                { label: 'Session', value: `${sessionLabel(exam.session)} · ${exam.startTime} · ${exam.durationMinutes} min` },
                { label: 'Eligible students', value: exam.eligibleCount },
                { label: 'Usable capacity', value: `${exam.capacity} seats in ${rooms.length} room(s)` },
                { label: 'Published', value: exam.publishedAt ? fmtDateTime(exam.publishedAt) : 'No' },
              ]}
            />
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Workflow" description="Each step is enforced by the server" />
        <ol className="p-2">
          {steps.map((s, i) => (
            <li key={s.label}>
              <button onClick={() => onTab(s.tab)} className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-raised/50">
                {s.done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                ) : (
                  <Circle className={cn('mt-0.5 h-4 w-4 shrink-0', i === current ? 'text-accent' : 'text-faint')} />
                )}
                <span>
                  <span className={cn('block text-[13px] font-medium', i === current ? 'text-ink' : s.done ? 'text-ink/80' : 'text-muted')}>{s.label}</span>
                  <span className="block text-xs text-faint">{s.meta}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
