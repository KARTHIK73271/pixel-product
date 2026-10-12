import { useQuery } from '@tanstack/react-query';
import { DoorOpen, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RoomStatusBadge, SubmissionBadge } from '@/components/ui/badges';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Callout, EmptyState, Progress } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorMessage, qs } from '@/lib/api';
import { withToast } from '@/lib/forms';
import type { ExamDetail, ExamRoom, Meta, Room } from '@/lib/types';
import { cn, fmtDate } from '@/lib/utils';

export function RoomsTab({ detail }: { detail: ExamDetail }) {
  const { exam, rooms } = detail;
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/meta'), staleTime: 60_000 });
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const locked = exam.status === 'PUBLISHED' || !exam.isActive;
  const shortage = exam.eligibleCount - exam.capacity;

  /** Saves the hall's full faculty list (max 2). `slot` 0/1 = Faculty 1/2; '' clears that slot. */
  const assign = async (room: ExamRoom, slot: 0 | 1, inchargeId: string) => {
    const next = [...room.inchargeIds];
    if (inchargeId) next[slot] = inchargeId;
    else next.splice(slot, 1); // clearing Faculty 1 promotes Faculty 2
    const inchargeIds = [...new Set(next.filter(Boolean))].slice(0, 2);
    setSaving(room.id);
    try {
      await api.put(`/exams/${exam.id}/incharges`, { assignments: [{ roomId: room.id, inchargeIds }] });
      toast.success(inchargeIds.length === 2 ? `Two faculty assigned to ${room.roomNo}` : inchargeIds.length ? 'Faculty assigned' : `Faculty removed from ${room.roomNo}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      {rooms.length > 0 && shortage > 0 && (
        <Callout tone="critical" title="Insufficient capacity">
          {exam.eligibleCount} eligible students but only {exam.capacity} usable seats — add rooms for {shortage} more student(s).
        </Callout>
      )}
      <Card>
        <CardHeader
          title="Assigned rooms"
          description={`${rooms.length} room(s) · ${exam.capacity} usable seats for ${exam.eligibleCount} eligible students`}
          action={
            <Button size="sm" variant="subtle" disabled={locked} onClick={() => setEditOpen(true)} title={locked ? 'Unpublish to change rooms' : undefined}>
              <Settings2 className="h-3.5 w-3.5" /> Choose rooms
            </Button>
          }
        />
        {rooms.length === 0 ? (
          <EmptyState
            icon={DoorOpen}
            title="No rooms assigned"
            description="Pick available rooms for this date and session. Rooms already booked in the same slot are rejected."
            action={
              <Button size="sm" variant="primary" disabled={locked} onClick={() => setEditOpen(true)}>
                Choose rooms
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Room</TH>
                <TH>Status</TH>
                <TH className="w-48">Seats</TH>
                <TH className="text-right">Remaining</TH>
                <TH className="w-[280px]">Faculty in-charge (up to 2)</TH>
                <TH>Attendance</TH>
              </tr>
            </THead>
            <TBody>
              {rooms.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <p className="font-medium">{r.roomNo}</p>
                    <p className="text-2xs text-faint">
                      {r.block}
                      {r.floor !== null ? ` · Floor ${r.floor}` : ''}
                    </p>
                  </TD>
                  <TD>
                    <RoomStatusBadge status={r.status} />
                  </TD>
                  <TD>
                    <div className="tnum flex justify-between text-xs">
                      <span>
                        {r.allocated}/{r.capacity}
                      </span>
                      <span className="text-muted">{Math.round((r.allocated / r.capacity) * 100)}%</span>
                    </div>
                    <Progress value={r.allocated / r.capacity} className="mt-1.5" />
                  </TD>
                  <TD className="tnum text-right">{r.capacity - r.allocated}</TD>
                  <TD>
                    <div className="space-y-1.5">
                      {([0, 1] as const).map((slot) => {
                        const value = r.inchargeIds[slot] ?? '';
                        const other = r.inchargeIds[slot === 0 ? 1 : 0];
                        const needsFirst = slot === 1 && r.inchargeIds.length === 0;
                        return (
                          <Select
                            key={slot}
                            value={value}
                            disabled={!exam.isActive || saving === r.id || needsFirst}
                            onChange={(e) => assign(r, slot, e.target.value)}
                            className={cn('h-8', slot === 0 && r.allocated > 0 && r.inchargeIds.length === 0 && 'border-warn/60')}
                            aria-label={`Faculty ${slot + 1} for ${r.roomNo}`}
                            title={needsFirst ? 'Choose Faculty 1 first' : undefined}
                          >
                            <option value="">
                              {slot === 0 ? (r.allocated > 0 ? '⚠ Faculty 1 — unassigned' : 'Faculty 1 — unassigned') : 'Faculty 2 — optional'}
                            </option>
                            {meta.data?.incharges
                              .filter((u) => u.id !== other)
                              .map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.fullName}
                                </option>
                              ))}
                          </Select>
                        );
                      })}
                    </div>
                  </TD>
                  <TD>{exam.status === 'PUBLISHED' && r.allocated > 0 ? <SubmissionBadge status={r.submissionStatus} /> : <span className="text-faint">—</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <p className="text-xs text-faint">
        Each exam hall can have up to two faculty in-charges, and both can record attendance. A faculty member supervises only one hall per
        date and session; conflicting or extra assignments are rejected by the database.
      </p>
      <ChooseRoomsDialog open={editOpen} onOpenChange={setEditOpen} detail={detail} />
    </div>
  );
}

function ChooseRoomsDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (v: boolean) => void; detail: ExamDetail }) {
  const { exam, rooms: current } = detail;
  const all = useQuery({
    queryKey: ['rooms', 'slot', exam.examDate, exam.session],
    queryFn: () => api.get<Room[]>(`/rooms${qs({ date: exam.examDate, session: exam.session })}`),
    enabled: open,
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setPicked(new Set(current.map((r) => r.id)));
  }, [open, current]);

  const rooms = all.data ?? [];
  const selectedCap = rooms.filter((r) => picked.has(r.id) && r.status === 'AVAILABLE').reduce((a, r) => a + r.capacity, 0);
  const removing = current.filter((r) => !picked.has(r.id) && r.allocated > 0);
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Choose examination rooms"
      description={`${fmtDate(exam.examDate)} · ${exam.session}. Rooms booked by another examination in this slot show their current load and will be rejected.`}
      footer={
        <>
          <span className={cn('mr-auto self-center text-xs', selectedCap < exam.eligibleCount ? 'text-bad' : 'text-ok')}>
            {selectedCap} seats selected for {exam.eligibleCount} students
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await withToast(() => api.put(`/exams/${exam.id}/rooms`, { roomIds: [...picked] }), 'Rooms updated');
                onOpenChange(false);
              } catch {
                /* toast */
              } finally {
                setBusy(false);
              }
            }}
          >
            Save rooms
          </Button>
        </>
      }
    >
      {removing.length > 0 && (
        <Callout tone="warning" className="mb-3">
          Removing {removing.map((r) => r.roomNo).join(', ')} releases {removing.reduce((a, r) => a + r.allocated, 0)} seat(s); those students become unallocated.
        </Callout>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {rooms.map((r) => {
          const mine = current.some((c) => c.id === r.id);
          const otherBooking = r.bookings.find((b) => b.examId !== exam.id && b.examDate === exam.examDate && b.session === exam.session);
          const disabled = (r.status !== 'AVAILABLE' && !mine) || (!!otherBooking && !mine);
          return (
            <label
              key={r.id}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                picked.has(r.id) ? 'border-accent/50 bg-accent/[0.06]' : 'border-line',
                disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:border-faint/50',
              )}
            >
              <input type="checkbox" className="mt-1 accent-[rgb(var(--accent))]" checked={picked.has(r.id)} disabled={disabled} onChange={() => toggle(r.id)} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium">{r.roomNo}</span>
                  <RoomStatusBadge status={r.status} />
                </span>
                <span className="block text-xs text-muted">
                  {r.block} · {r.capacity} seats
                </span>
                {otherBooking && <span className="mt-1 block text-xs text-warn">Booked by {otherBooking.name.split('—').pop()?.trim()} in this slot</span>}
                {r.status !== 'AVAILABLE' && r.notes && <span className="mt-1 block text-xs text-faint">{r.notes}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </Dialog>
  );
}
