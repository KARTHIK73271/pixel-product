import { useQuery } from '@tanstack/react-query';
import { MoreHorizontal, MoveRight, UserMinus, UserPlus, Users, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AttendancePill } from '@/components/ui/badges';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Callout, EmptyState } from '@/components/ui/feedback';
import { Checkbox, Field, Input, SearchInput, Select } from '@/components/ui/form';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, qs } from '@/lib/api';
import { withToast } from '@/lib/forms';
import type { ExamDetail, ExamStudent, Paged, Student } from '@/lib/types';

export function StudentsTab({ detail }: { detail: ExamDetail }) {
  const { exam, students, rooms } = detail;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'seated' | 'unseated'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [seatFor, setSeatFor] = useState<ExamStudent | null>(null);
  const [releaseFor, setReleaseFor] = useState<ExamStudent | null>(null);
  const locked = exam.status === 'PUBLISHED' || !exam.isActive;
  const lockReason = !exam.isActive ? 'Examination is deactivated.' : 'Published — unpublish to change eligibility or seats.';

  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return students.filter(
      (s) =>
        (!t || s.rollNo.toLowerCase().includes(t) || s.fullName.toLowerCase().includes(t)) &&
        (filter === 'all' || (filter === 'seated' ? !!s.allocationId : !s.allocationId)),
    );
  }, [students, search, filter]);
  const unseated = students.filter((s) => !s.allocationId).length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      {locked && <Callout tone="info">{lockReason}</Callout>}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search roll number or name…" className="w-full sm:w-64" />
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="h-9 w-auto" aria-label="Seat filter">
            <option value="all">All ({students.length})</option>
            <option value="seated">Seated ({students.length - unseated})</option>
            <option value="unseated">Without seat ({unseated})</option>
          </Select>
          <div className="ml-auto flex flex-wrap gap-2">
            {selected.size > 0 && (
              <Button variant="danger" size="sm" disabled={locked} onClick={() => setRemoveOpen(true)}>
                <UserMinus className="h-3.5 w-3.5" /> Remove {selected.size}
              </Button>
            )}
            <Button size="sm" disabled={locked} onClick={() => setCriteriaOpen(true)} title={locked ? lockReason : 'Enrol by department / year / section'}>
              <Wand2 className="h-3.5 w-3.5" /> Enrol by criteria
            </Button>
            <Button size="sm" variant="subtle" disabled={locked} onClick={() => setAddOpen(true)} title={locked ? lockReason : undefined}>
              <UserPlus className="h-3.5 w-3.5" /> Add students
            </Button>
          </div>
        </div>
        {students.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No eligible students"
            description="Enrol the cohort defined on this examination, or add students individually."
            action={
              <Button size="sm" variant="primary" disabled={locked} onClick={() => setCriteriaOpen(true)}>
                Enrol by criteria
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH className="w-8">
                  <span className="sr-only">Select</span>
                </TH>
                <TH>Roll no.</TH>
                <TH>Name</TH>
                <TH>Dept · Sec</TH>
                <TH>Room</TH>
                <TH>Seat</TH>
                <TH>Attendance</TH>
                <TH className="w-10" />
              </tr>
            </THead>
            <TBody>
              {rows.map((s) => (
                <TR key={s.id}>
                  <TD>
                    <Checkbox checked={selected.has(s.id)} onChange={() => toggle(s.id)} disabled={locked} />
                  </TD>
                  <TD className="font-mono text-xs">{s.rollNo}</TD>
                  <TD>{s.fullName}</TD>
                  <TD className="text-muted">
                    {s.departmentCode} · {s.section}
                  </TD>
                  <TD>{s.roomNo ?? <span className="text-warn">Unallocated</span>}</TD>
                  <TD className="tnum">{s.seatNo ?? '—'}</TD>
                  <TD>{exam.status === 'PUBLISHED' && s.allocationId ? <AttendancePill status={s.attendance} /> : <span className="text-faint">—</span>}</TD>
                  <TD>
                    <Menu>
                      <MenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${s.rollNo}`} disabled={locked || rooms.length === 0}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem onSelect={() => setSeatFor(s)}>
                          <MoveRight className="h-4 w-4" /> {s.allocationId ? 'Move seat' : 'Assign seat'}
                        </MenuItem>
                        {s.allocationId && (
                          <MenuItem danger onSelect={() => setReleaseFor(s)} disabled={!!s.attendance}>
                            <UserMinus className="h-4 w-4" /> Release seat
                          </MenuItem>
                        )}
                      </MenuContent>
                    </Menu>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={criteriaOpen}
        onOpenChange={setCriteriaOpen}
        title="Enrol by criteria"
        description={`Adds every active student in ${exam.departmentCode ?? 'all departments'}, year ${exam.year}${exam.section ? `, section ${exam.section}` : ''}. Students who already sit another examination in this date and session are skipped.`}
        confirmLabel="Enrol students"
        onConfirm={() =>
          withToast(
            () => api.post<{ added: number; skippedConflicts: number }>(`/exams/${exam.id}/eligible`, { mode: 'criteria' }),
            (r) => `${r.added} student(s) enrolled${r.skippedConflicts ? `, ${r.skippedConflicts} skipped (slot conflict)` : ''}`,
          )
        }
      />
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        tone="danger"
        title={`Remove ${selected.size} student(s)?`}
        description="Their seats (if any) are released. Students with recorded attendance cannot be removed."
        confirmLabel="Remove"
        onConfirm={async () => {
          await withToast(() => api.post(`/exams/${exam.id}/eligible`, { mode: 'remove', studentIds: [...selected] }), 'Students removed');
          setSelected(new Set());
        }}
      />
      <ConfirmDialog
        open={!!releaseFor}
        onOpenChange={(v) => !v && setReleaseFor(null)}
        tone="danger"
        title="Release seat?"
        description={releaseFor ? `${releaseFor.rollNo} will lose seat ${releaseFor.seatNo} in ${releaseFor.roomNo} and become unallocated.` : ''}
        confirmLabel="Release"
        onConfirm={() => withToast(() => api.del(`/exams/${exam.id}/allocation/seat/${releaseFor!.id}`), 'Seat released')}
      />
      <AddStudentsDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        examId={exam.id}
        branch={exam.departmentId ? { id: exam.departmentId, code: exam.departmentCode ?? '' } : null}
        existing={new Set(students.map((s) => s.id))}
      />
      <SeatDialog student={seatFor} onClose={() => setSeatFor(null)} detail={detail} />
    </div>
  );
}

function AddStudentsDialog({
  open,
  onOpenChange,
  examId,
  branch,
  existing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  examId: string;
  /** Set when the examination is restricted to one department (branch). */
  branch: { id: string; code: string } | null;
  existing: Set<string>;
}) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // A branch-specific exam only lists students of that branch (the server enforces the same rule).
  const list = useQuery({
    queryKey: ['students', 'picker', search, branch?.id ?? 'all'],
    queryFn: () => api.get<Paged<Student>>(`/students${qs({ q: search.trim(), departmentId: branch?.id, pageSize: 50 })}`),
    enabled: open,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setPicked(new Set());
      }}
      size="lg"
      title="Add eligible students"
      description={
        branch
          ? `This examination is for ${branch.code} students only, so only ${branch.code} students are listed. Students already sitting another examination in the same date and session will be rejected.`
          : 'Multi-department examination: students of any branch can be added. Students already sitting another examination in the same date and session will be rejected.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={picked.size === 0}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await withToast(() => api.post(`/exams/${examId}/eligible`, { mode: 'add', studentIds: [...picked] }), `${picked.size} student(s) added`);
                setPicked(new Set());
                onOpenChange(false);
              } catch {
                /* toast shown */
              } finally {
                setBusy(false);
              }
            }}
          >
            Add {picked.size || ''} student(s)
          </Button>
        </>
      }
    >
      <SearchInput value={search} onChange={setSearch} placeholder="Search by roll number or name…" />
      <div className="mt-3 max-h-[50vh] divide-y divide-line/70 overflow-y-auto rounded-lg border border-line">
        {list.data?.items.map((s) => {
          const already = existing.has(s.id);
          return (
            <label key={s.id} className={`flex items-center gap-3 px-3 py-2 text-[13px] ${already || !s.isActive ? 'opacity-50' : 'cursor-pointer hover:bg-raised/40'}`}>
              <input
                type="checkbox"
                disabled={already || !s.isActive}
                checked={picked.has(s.id) || already}
                onChange={() =>
                  setPicked((p) => {
                    const n = new Set(p);
                    if (n.has(s.id)) n.delete(s.id);
                    else n.add(s.id);
                    return n;
                  })
                }
                className="accent-[rgb(var(--accent))]"
              />
              <span className="w-24 font-mono text-xs">{s.rollNo}</span>
              <span className="flex-1">{s.fullName}</span>
              <span className="text-xs text-muted">
                {s.departmentCode}-{s.year}
                {s.section}
                {already ? ' · enrolled' : !s.isActive ? ' · inactive' : ''}
              </span>
            </label>
          );
        })}
        {list.data && list.data.items.length === 0 && <p className="p-6 text-center text-[13px] text-faint">No students found.</p>}
      </div>
    </Dialog>
  );
}

function SeatDialog({ student, onClose, detail }: { student: ExamStudent | null; onClose: () => void; detail: ExamDetail }) {
  const usable = detail.rooms.filter((r) => r.status === 'AVAILABLE');
  const [roomId, setRoomId] = useState('');
  const [seat, setSeat] = useState('');
  const [busy, setBusy] = useState(false);
  const room = usable.find((r) => r.id === (roomId || usable[0]?.id));
  const taken = new Set(detail.students.filter((s) => s.roomId === room?.id && s.id !== student?.id).map((s) => s.seatNo));
  const seatNo = seat ? Number(seat) : undefined;
  const seatError =
    seatNo !== undefined && room
      ? !Number.isInteger(seatNo) || seatNo < 1
        ? 'Enter a positive seat number'
        : seatNo > room.capacity
          ? `Room ${room.roomNo} has only ${room.capacity} seats`
          : taken.has(seatNo)
            ? 'Seat already taken'
            : undefined
      : undefined;
  const full = room ? taken.size >= room.capacity : false;
  return (
    <Dialog
      open={!!student}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          setRoomId('');
          setSeat('');
        }
      }}
      size="sm"
      title={student?.allocationId ? `Move ${student.rollNo}` : `Assign seat to ${student?.rollNo ?? ''}`}
      description={student?.allocationId ? `Currently ${student.roomNo}, seat ${student.seatNo}.` : 'Manual adjustment; capacity and seat uniqueness are enforced by the database.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!room || !!seatError || full}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await withToast(
                  () => api.post<{ seatNo: number }>(`/exams/${detail.exam.id}/allocation/seat`, { studentId: student!.id, roomId: room!.id, seatNo }),
                  (res) => `${student!.rollNo} → ${room!.roomNo} seat ${res.seatNo}`,
                );
                if (r) {
                  onClose();
                  setSeat('');
                }
              } catch {
                /* toast */
              } finally {
                setBusy(false);
              }
            }}
          >
            Save seat
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Room">
          <Select value={room?.id ?? ''} onChange={(e) => setRoomId(e.target.value)}>
            {usable.map((r) => {
              const occ = detail.students.filter((s) => s.roomId === r.id && s.id !== student?.id).length;
              return (
                <option key={r.id} value={r.id}>
                  {r.roomNo} — {occ}/{r.capacity} occupied
                </option>
              );
            })}
          </Select>
        </Field>
        <Field label="Seat number" hint="Leave blank for the lowest free seat" error={seatError ?? (full ? 'Room is full' : undefined)}>
          <Input type="number" min={1} max={room?.capacity} value={seat} onChange={(e) => setSeat(e.target.value)} placeholder="Auto" />
        </Field>
      </div>
    </Dialog>
  );
}
