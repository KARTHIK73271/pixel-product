import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Lock, Rows3, Send, Shuffle, Sparkles, Target } from 'lucide-react';
import { Classroom3D, ViewToggle } from '@/components/Classroom3D';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { AllocationStrategy, SeatOrder } from '@shared/schemas';
import { Badge } from '@/components/ui/badges';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Callout, EmptyState, Progress } from '@/components/ui/feedback';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { AllocationPreview, ExamDetail } from '@/lib/types';
import { cn, fmtPct } from '@/lib/utils';

const STRATEGIES: { value: AllocationStrategy; label: string; icon: typeof Target; desc: string }[] = [
  { value: 'BALANCED', label: 'Balanced', icon: Rows3, desc: 'Use every assigned room, load proportional to capacity — easier invigilation.' },
  { value: 'MIN_ROOMS', label: 'Minimum rooms', icon: Target, desc: 'Fewest rooms that fit everyone (optimal count), tightest combination of seats.' },
];
const ORDERS: { value: SeatOrder; label: string; desc: string }[] = [
  { value: 'ROLL', label: 'By roll number', desc: 'Department → section → roll number' },
  { value: 'INTERLEAVE', label: 'Interleave cohorts', desc: 'Adjacent seats alternate departments/sections' },
];

export function AllocationTab({ detail, onPublish }: { detail: ExamDetail; onPublish: () => void }) {
  const { exam, rooms } = detail;
  const [strategy, setStrategy] = useState<AllocationStrategy>('BALANCED');
  const [order, setOrder] = useState<SeatOrder>('ROLL');
  const [preview, setPreview] = useState<AllocationPreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const published = exam.status === 'PUBLISHED';
  const blockers = [
    !exam.isActive && 'Examination is deactivated.',
    exam.eligibleCount === 0 && 'Enrol eligible students first.',
    rooms.length === 0 && 'Assign at least one room first.',
  ].filter(Boolean) as string[];

  const previewMut = useMutation({
    mutationFn: () => api.post<AllocationPreview>(`/exams/${exam.id}/allocation/preview`, { strategy, order }),
    onSuccess: setPreview,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const commit = async () => {
    try {
      await api.post(`/exams/${exam.id}/allocation/commit`, { strategy, order, previewHash: preview?.previewHash, confirmUnpublish: published });
      toast.success('Seating allocation saved as draft', { description: 'Review it below, then publish to students.' });
      setPreview(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PLAN_CHANGED' && e.details?.preview) {
        setPreview(e.details.preview as AllocationPreview);
        toast.warning('Data changed since the preview', { description: 'The plan has been refreshed — review it and confirm again.' });
      } else toast.error(errorMessage(e));
      throw e;
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Smart allocation"
          description="Plans are computed on the server, explained room by room, and only written when you confirm."
        />
        <CardBody className="space-y-5">
          {blockers.length > 0 && (
            <Callout tone="warning" title="Allocation not possible yet">
              {blockers.join(' ')}
            </Callout>
          )}
          <div className="grid gap-5 lg:grid-cols-2">
            <fieldset>
              <legend className="mb-2 text-2xs uppercase tracking-wide text-faint">Objective</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {STRATEGIES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => {
                      setStrategy(s.value);
                      setPreview(null);
                    }}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors',
                      strategy === s.value ? 'border-accent/60 bg-accent/[0.07]' : 'border-line hover:border-faint/50',
                    )}
                    aria-pressed={strategy === s.value}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-medium">
                      <s.icon className={cn('h-4 w-4', strategy === s.value ? 'text-accent' : 'text-faint')} />
                      {s.label}
                    </span>
                    <span className="mt-1 block text-xs text-muted">{s.desc}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-2xs uppercase tracking-wide text-faint">Seating order</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {ORDERS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => {
                      setOrder(o.value);
                      setPreview(null);
                    }}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors',
                      order === o.value ? 'border-accent/60 bg-accent/[0.07]' : 'border-line hover:border-faint/50',
                    )}
                    aria-pressed={order === o.value}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-medium">
                      <Shuffle className={cn('h-4 w-4', order === o.value ? 'text-accent' : 'text-faint')} />
                      {o.label}
                    </span>
                    <span className="mt-1 block text-xs text-muted">{o.desc}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => previewMut.mutate()} loading={previewMut.isPending} disabled={blockers.length > 0}>
              <Sparkles className="h-4 w-4" /> {exam.status === 'DRAFT' ? 'Generate preview' : 'Preview reallocation'}
            </Button>
            {published && <span className="text-xs text-warn">Reallocating a published examination unpublishes it until you publish again.</span>}
          </div>
        </CardBody>
      </Card>

      {preview && <PreviewPanel preview={preview} onConfirm={() => setConfirmOpen(true)} onDiscard={() => setPreview(null)} />}

      <CurrentAllocation detail={detail} onPublish={onPublish} />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={published ? 'Reallocate and unpublish?' : 'Confirm seating allocation?'}
        description={
          preview
            ? `${preview.totals.allocated} seat(s) across ${preview.totals.roomsUsed} room(s)${preview.totals.unallocated ? `, ${preview.totals.unallocated} unallocated` : ''}. ${
                preview.willReplace ? `${preview.willReplace} existing seat(s) will be replaced. ` : ''
              }${preview.lockedRooms.length ? 'Rooms with recorded attendance are kept unchanged. ' : ''}The plan is saved as a draft — students see nothing until you publish.`
            : ''
        }
        confirmLabel={published ? 'Reallocate' : 'Save allocation'}
        onConfirm={commit}
      />
    </div>
  );
}

function PreviewPanel({ preview, onConfirm, onDiscard }: { preview: AllocationPreview; onConfirm: () => void; onDiscard: () => void }) {
  const { plan, totals } = preview;
  return (
    <Card className="border-accent/30">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Allocation preview
            <Badge tone={plan.optimality === 'OPTIMAL' ? 'ok' : plan.optimality === 'HEURISTIC' ? 'warn' : 'neutral'}>
              {plan.optimality === 'OPTIMAL' ? 'Optimal room count' : plan.optimality === 'HEURISTIC' ? 'Heuristic' : plan.strategy === 'BALANCED' ? 'Balanced' : 'Best effort'}
            </Badge>
          </span>
        }
        description="Not saved yet. Review each room’s reasoning before confirming."
        action={
          <>
            <Button variant="ghost" size="sm" onClick={onDiscard}>
              Discard
            </Button>
            <Button variant="primary" size="sm" onClick={onConfirm}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Confirm allocation
            </Button>
          </>
        }
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { k: 'Eligible', v: totals.eligible },
            { k: 'Allocated', v: totals.allocated },
            { k: 'Unallocated', v: totals.unallocated, bad: totals.unallocated > 0 },
            { k: 'Rooms used', v: plan.minRoomsRequired !== null ? `${totals.roomsUsed} (min ${plan.minRoomsRequired})` : totals.roomsUsed },
            { k: 'Remaining seats', v: totals.remainingSeats },
          ].map((x) => (
            <div key={x.k} className="rounded-lg border border-line bg-canvas/40 px-3 py-2">
              <p className="text-2xs uppercase tracking-wide text-faint">{x.k}</p>
              <p className={cn('tnum mt-0.5 text-lg font-semibold', x.bad && 'text-bad')}>{x.v}</p>
            </div>
          ))}
        </div>
        {!plan.feasible && (
          <Callout tone="critical" title="Insufficient capacity">
            {plan.studentCount} students need seats but usable capacity is {plan.usableCapacity}. Assign more rooms before publishing, or confirm and handle the
            unallocated students manually.
          </Callout>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {preview.lockedRooms.map((r) => (
            <div key={r.roomId} className="rounded-lg border border-line bg-canvas/40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium">{r.roomNo}</span>
                <Badge tone="neutral" icon={<Lock className="h-3 w-3" />}>
                  Kept
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted">Attendance recorded — existing {r.keptAllocations} seat(s) preserved.</p>
            </div>
          ))}
          {plan.rooms.map((r) => (
            <div key={r.roomId} className={cn('rounded-lg border p-3', r.selected ? 'border-accent/40 bg-accent/[0.04]' : 'border-line opacity-70')}>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium">{r.roomNo}</span>
                <Badge tone={r.selected ? 'accent' : 'neutral'}>{r.selected ? 'Selected' : 'Not used'}</Badge>
              </div>
              <div className="tnum mt-2 flex justify-between text-xs text-muted">
                <span>
                  {r.assigned}/{r.capacity} seats
                </span>
                <span>{fmtPct(r.utilization)}</span>
              </div>
              <Progress value={r.utilization} className="mt-1.5" />
              <p className="mt-2 text-xs text-muted">{r.reason}</p>
            </div>
          ))}
        </div>
        {plan.notes.length > 0 && (
          <ul className="space-y-1 text-xs text-muted">
            {plan.notes.map((n) => (
              <li key={n}>• {n}</li>
            ))}
          </ul>
        )}
        {preview.unallocatedStudents.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-bad">Unallocated students ({preview.unallocatedStudents.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {preview.unallocatedStudents.map((s) => (
                <span key={s.id} className="rounded-md border border-bad/30 bg-bad/[0.06] px-2 py-0.5 font-mono text-2xs" title={s.fullName}>
                  {s.rollNo}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function CurrentAllocation({ detail, onPublish }: { detail: ExamDetail; onPublish: () => void }) {
  const { exam, rooms, students } = detail;
  const [active, setActive] = useState<string | null>(null);
  const [mode, setMode] = useState<'3d' | 'grid'>('3d');
  const occupied = rooms.filter((r) => r.allocated > 0);
  const room = rooms.find((r) => r.id === (active ?? occupied[0]?.id));
  const seats = useMemo(() => {
    if (!room) return [];
    const bySeat = new Map(students.filter((s) => s.roomId === room.id).map((s) => [s.seatNo!, s]));
    return Array.from({ length: room.capacity }, (_, i) => ({ no: i + 1, student: bySeat.get(i + 1) }));
  }, [room, students]);
  // Department colours follow a fixed order of the exam's departments (validated pair; 3rd+ fall back to neutral + legend).
  const deptColor = useMemo(() => {
    const depts = [...new Set(students.map((s) => s.departmentCode))].sort();
    const palette = ['#c98500', '#9085e9'];
    return new Map(depts.map((d, i) => [d, palette[i] ?? '#96a494']));
  }, [students]);

  if (exam.status === 'DRAFT')
    return (
      <Card>
        <EmptyState icon={Rows3} title="No allocation yet" description="Generate a preview above and confirm it to create the draft seating plan." />
      </Card>
    );
  const unallocated = exam.eligibleCount - exam.allocatedCount;
  return (
    <Card>
      <CardHeader
        title={exam.status === 'PUBLISHED' ? 'Published seating' : 'Draft seating (not visible to students)'}
        description={`${exam.allocatedCount} allocated · ${unallocated} unallocated · ${occupied.length} room(s) in use`}
        action={
          exam.status === 'ALLOCATED' && (
            <Button size="sm" variant="primary" onClick={onPublish}>
              <Send className="h-3.5 w-3.5" /> Publish
            </Button>
          )
        }
      />
      <div className="grid gap-0 lg:grid-cols-[280px_1fr]">
        <div className="border-b border-line lg:border-b-0 lg:border-r">
          <Table>
            <THead>
              <tr>
                <TH>Room</TH>
                <TH className="text-right">Seated</TH>
                <TH className="text-right">Free</TH>
              </tr>
            </THead>
            <TBody>
              {rooms.map((r) => (
                <TR key={r.id} className={cn('cursor-pointer', room?.id === r.id && 'bg-raised/60')} onClick={() => setActive(r.id)}>
                  <TD className="font-medium">{r.roomNo}</TD>
                  <TD className="tnum text-right">{r.allocated}</TD>
                  <TD className="tnum text-right text-muted">{r.capacity - r.allocated}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
        <div className="p-4">
          {room && mode === '3d' ? (
            <>
              <div className="mb-3 flex justify-end">
                <ViewToggle mode={mode} onChange={setMode} />
              </div>
              <Classroom3D
                capacity={room.capacity}
                roomNo={room.roomNo}
                seats={seats.map((s) => ({
                  no: s.no,
                  color: s.student ? deptColor.get(s.student.departmentCode) : undefined,
                  detail: s.student ? `${s.student.rollNo} · ${s.student.fullName} (${s.student.departmentCode}-${s.student.section})` : undefined,
                }))}
                legend={[...new Set(students.filter((s) => s.roomId === room.id).map((s) => s.departmentCode))].map((d) => ({
                  label: d,
                  color: deptColor.get(d)!,
                }))}
              />
            </>
          ) : room ? (
            <>
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-xs text-muted">
                  Seat map · {room.roomNo} · {room.allocated}/{room.capacity} occupied (hover a seat for the candidate)
                </p>
                <ViewToggle mode={mode} onChange={setMode} />
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(38px,1fr))] gap-1.5">
                {seats.map((s) => (
                  <div
                    key={s.no}
                    title={s.student ? `Seat ${s.no}: ${s.student.rollNo} · ${s.student.fullName} (${s.student.departmentCode}-${s.student.section})` : `Seat ${s.no}: empty`}
                    className={cn('tnum flex h-9 items-center justify-center rounded-md border text-2xs', s.student ? 'text-ink' : 'border-line text-faint')}
                    style={
                      s.student
                        ? { borderColor: `${deptColor.get(s.student.departmentCode)}80`, background: `${deptColor.get(s.student.departmentCode)}26` }
                        : undefined
                    }
                  >
                    {s.no}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-2xs text-muted">
                {[...new Set(students.filter((s) => s.roomId === room.id).map((s) => s.departmentCode))].map((d) => (
                  <span key={d} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: deptColor.get(d) }} />
                    {d}
                  </span>
                ))}
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm border border-line" /> Empty
                </span>
              </div>
            </>
          ) : (
            <p className="text-[13px] text-faint">No rooms.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
