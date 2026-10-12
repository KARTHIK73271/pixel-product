import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck, Lock, Printer, RotateCcw, Send, Undo2, UserCheck, UserX, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { EXAM_TYPE_LABEL } from '@shared/schemas';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { SubmissionBadge } from '@/components/ui/badges';
import { Button, LinkButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Callout, EmptyState, ErrorState, Progress, Skeleton } from '@/components/ui/feedback';
import { Checkbox, SearchInput } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { withToast } from '@/lib/forms';
import type { RoomSheet } from '@/lib/types';
import { cn, fmtDate, fmtDateTime, sessionLabel, todayLocalIso } from '@/lib/utils';
import { ReopenDialog } from '../shared/ReopenDialog';

type Mark = 'PRESENT' | 'ABSENT' | null;

export function AttendancePage() {
  const { examId, roomId } = useParams<{ examId: string; roomId: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ['sheet', examId, roomId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<RoomSheet>(`/attendance/${examId}/${roomId}`) });
  const [search, setSearch] = useState('');
  const [onlyUnmarked, setOnlyUnmarked] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const isAdmin = user?.role === 'ADMIN';
  useBreadcrumbs(
    isAdmin
      ? [{ label: 'Attendance', to: '/attendance' }, { label: q.data ? `${q.data.courseCode} · ${q.data.roomNo}` : 'Room' }]
      : [{ label: 'Duty dashboard', to: '/duties' }, { label: q.data ? `${q.data.courseCode} · ${q.data.roomNo}` : 'Room' }],
  );

  const mark = useMutation({
    mutationFn: (marks: { allocationId: string; status: Mark }[]) => api.put(`/attendance/${examId}/${roomId}/marks`, { marks }),
    onMutate: async (marks) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<RoomSheet>(key);
      if (prev) {
        const byId = new Map(marks.map((m) => [m.allocationId, m.status]));
        const students = prev.students.map((s) => (byId.has(s.allocationId) ? { ...s, status: byId.get(s.allocationId)! } : s));
        const present = students.filter((s) => s.status === 'PRESENT').length;
        const absent = students.filter((s) => s.status === 'ABSENT').length;
        qc.setQueryData<RoomSheet>(key, {
          ...prev,
          students,
          counts: { allocated: students.length, present, absent, unmarked: students.length - present - absent },
        });
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(errorMessage(e));
    },
  });

  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (q.data?.students ?? []).filter(
      (s) => (!t || s.rollNo.toLowerCase().includes(t) || s.fullName.toLowerCase().includes(t)) && (!onlyUnmarked || s.status === null),
    );
  }, [q.data, search, onlyUnmarked]);

  if (q.isError)
    return (
      <Card>
        <ErrorState error={q.error} onRetry={(q.error as ApiError)?.status === 403 ? undefined : () => q.refetch()} />
      </Card>
    );
  if (!q.data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-20" />
        <Skeleton className="h-96" />
      </div>
    );

  const s = q.data;
  const finalized = s.submissionStatus === 'FINALIZED';
  const published = s.examStatus === 'PUBLISHED';
  const editable = published && !finalized;
  const { allocated, present, absent, unmarked } = s.counts;
  const marked = present + absent;
  const unmarkedIds = s.students.filter((x) => x.status === null).map((x) => x.allocationId);
  const notToday = s.examDate !== todayLocalIso();

  return (
    <div>
      <PageHeader
        title={
          <span>
            {s.courseCode} · Room {s.roomNo}
          </span>
        }
        description={`${s.examName} · ${EXAM_TYPE_LABEL[s.examType]}`}
        meta={
          <>
            <SubmissionBadge status={s.submissionStatus} overdue={s.examDate < todayLocalIso() && !finalized} />
            <span className="text-xs text-muted">
              {fmtDate(s.examDate, 'EEE dd MMM yyyy')} · {sessionLabel(s.session)} {s.startTime} · {s.block} · In-charge: {s.inchargeName ?? 'unassigned'}
            </span>
          </>
        }
        actions={
          <>
            <LinkButton to={`/print/attendance/${examId}/${roomId}`} target="_blank">
              <Printer className="h-4 w-4" /> Print sheet
            </LinkButton>
            {finalized && isAdmin && (
              <Button variant="danger" onClick={() => setReopenOpen(true)}>
                <RotateCcw className="h-4 w-4" /> Reopen
              </Button>
            )}
            {editable && (
              <Button variant="primary" onClick={() => setConfirmSubmit(true)} disabled={allocated === 0}>
                <Send className="h-4 w-4" /> Submit & finalize
              </Button>
            )}
          </>
        }
      />

      {!published && <Callout tone="info" className="mb-4">Seating for this examination is not published, so attendance cannot be recorded yet.</Callout>}
      {finalized && (
        <Callout tone="success" className="mb-4" title="Attendance finalized and locked">
          Submitted by {s.finalizedByName ?? 'in-charge'} on {fmtDateTime(s.finalizedAt)}. {isAdmin ? 'You can reopen it with a recorded reason.' : 'Only an examination admin can reopen it.'}
        </Callout>
      )}
      {editable && !!s.reopenedCount && (
        <Callout tone="warning" className="mb-4" title="Reopened by an admin">
          Reason: “{s.lastReopenReason}”. Make the corrections and submit again.
        </Callout>
      )}
      {editable && notToday && (
        <Callout tone="info" className="mb-4">
          This examination is dated {fmtDate(s.examDate)}. Make sure you are recording the correct session.
        </Callout>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'Allocated', value: allocated, cls: '' },
          { label: 'Present', value: present, cls: 'text-ok' },
          { label: 'Absent', value: absent, cls: 'text-bad' },
          { label: 'Unmarked', value: unmarked, cls: unmarked ? 'text-warn' : '' },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-line bg-surface p-4" aria-live="polite">
            <p className="text-xs text-muted">{t.label}</p>
            <p className={cn('tnum mt-1 text-2xl font-semibold', t.cls)}>{t.value}</p>
          </div>
        ))}
      </div>
      <div className="mb-5 flex items-center gap-3">
        <Progress value={allocated ? marked / allocated : 0} tone={unmarked === 0 && allocated > 0 ? 'ok' : 'accent'} />
        <span className="tnum shrink-0 text-xs text-muted">
          {marked}/{allocated} marked
        </span>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Find roll number or name…" className="w-full sm:w-64" />
          <Checkbox checked={onlyUnmarked} onChange={setOnlyUnmarked} label={<span className="text-[13px] text-muted">Only unmarked</span>} />
          {editable && unmarkedIds.length > 0 && (
            <Button size="sm" className="ml-auto" onClick={() => setConfirmBulk(true)}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark remaining {unmarkedIds.length} present
            </Button>
          )}
        </div>
        {s.students.length === 0 ? (
          <EmptyState icon={UserCheck} title="No students seated in this room" />
        ) : rows.length === 0 ? (
          <EmptyState icon={Check} title={onlyUnmarked ? 'Everyone is marked' : 'No matches'} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH className="w-16">Seat</TH>
                <TH>Roll no.</TH>
                <TH>Student</TH>
                <TH>Dept · Sec</TH>
                <TH className="w-[260px]">Attendance</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((st) => (
                <TR key={st.allocationId} className={cn(st.status === 'ABSENT' && 'bg-bad/[0.04]')}>
                  <TD className="tnum font-medium">{st.seatNo}</TD>
                  <TD className="font-mono text-xs">{st.rollNo}</TD>
                  <TD>
                    <p>{st.fullName}</p>
                    {st.markedAt && (
                      <p className="text-2xs text-faint">
                        {st.markedByName ?? 'Marked'} · {fmtDateTime(st.markedAt)}
                      </p>
                    )}
                  </TD>
                  <TD className="text-muted">
                    {st.departmentCode} · {st.section}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1.5" role="group" aria-label={`Attendance for ${st.rollNo}`}>
                      <button
                        disabled={!editable}
                        onClick={() => mark.mutate([{ allocationId: st.allocationId, status: 'PRESENT' }])}
                        aria-pressed={st.status === 'PRESENT'}
                        className={cn(
                          'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed',
                          st.status === 'PRESENT' ? 'border-ok/50 bg-ok/15 text-ok' : 'border-line text-muted enabled:hover:border-ok/40 enabled:hover:text-ok',
                          !editable && st.status !== 'PRESENT' && 'opacity-40',
                        )}
                      >
                        <UserCheck className="h-3.5 w-3.5" /> Present
                      </button>
                      <button
                        disabled={!editable}
                        onClick={() => mark.mutate([{ allocationId: st.allocationId, status: 'ABSENT' }])}
                        aria-pressed={st.status === 'ABSENT'}
                        className={cn(
                          'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed',
                          st.status === 'ABSENT' ? 'border-bad/50 bg-bad/15 text-bad' : 'border-line text-muted enabled:hover:border-bad/40 enabled:hover:text-bad',
                          !editable && st.status !== 'ABSENT' && 'opacity-40',
                        )}
                      >
                        <UserX className="h-3.5 w-3.5" /> Absent
                      </button>
                      {editable && st.status && (
                        <Button variant="ghost" size="icon" onClick={() => mark.mutate([{ allocationId: st.allocationId, status: null }])} aria-label="Clear mark (unmarked)" title="Clear → unmarked">
                          <Undo2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {finalized && <Lock className="ml-1 h-3.5 w-3.5 text-faint" aria-label="Locked" />}
                      {!st.status && !editable && published && <X className="h-3.5 w-3.5 text-warn" aria-label="Unmarked" />}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`Mark ${unmarkedIds.length} remaining student(s) present?`}
        description="Only students who are still unmarked are affected. Students already marked absent stay absent."
        confirmLabel="Mark present"
        onConfirm={() => mark.mutateAsync(unmarkedIds.map((id) => ({ allocationId: id, status: 'PRESENT' as const })))}
      />
      <ConfirmDialog
        open={confirmSubmit}
        onOpenChange={setConfirmSubmit}
        title="Submit and finalize attendance?"
        confirmLabel="Submit & finalize"
        confirmDisabled={unmarked > 0}
        description={
          unmarked > 0
            ? `${unmarked} student(s) are still unmarked. Every allocated student must be marked present or absent before submission.`
            : `${present} present and ${absent} absent out of ${allocated}. After finalizing, the records are locked; only an admin can reopen them.`
        }
        onConfirm={() => withToast(() => api.post(`/attendance/${examId}/${roomId}/submit`), 'Attendance submitted and finalized')}
      />
      <ReopenDialog examId={examId!} room={reopenOpen ? { id: roomId!, roomNo: s.roomNo } : null} onClose={() => setReopenOpen(false)} />
    </div>
  );
}
