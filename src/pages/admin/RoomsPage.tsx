import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Box, DoorOpen, Pencil, Plus } from 'lucide-react';
import { Classroom3D } from '@/components/Classroom3D';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ROOM_STATUSES, roomSchema, type RoomInput } from '@shared/schemas';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { RoomStatusBadge } from '@/components/ui/badges';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, Progress } from '@/components/ui/feedback';
import { Field, Input, SearchInput, Select, Textarea } from '@/components/ui/form';
import { KpiTile, PageHeader } from '@/components/ui/page';
import { SortHeader, Table, TableSkeleton, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, qs } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import type { Room } from '@/lib/types';
import { fmtDate } from '@/lib/utils';

type SortKey = 'roomNo' | 'capacity' | 'remaining';

export function RoomsPage() {
  useBreadcrumbs([{ label: 'Rooms' }]);
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'roomNo', dir: 'asc' });
  const [editing, setEditing] = useState<Room | null | 'new'>(null);
  const [viewing, setViewing] = useState<Room | null>(null);
  const q = useQuery({ queryKey: ['rooms', status], queryFn: () => api.get<Room[]>(`/rooms${qs({ status })}`) });

  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    const list = (q.data ?? []).filter((r) => !t || r.roomNo.toLowerCase().includes(t) || r.block.toLowerCase().includes(t));
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) =>
      sort.key === 'roomNo' ? a.roomNo.localeCompare(b.roomNo, undefined, { numeric: true }) * dir : (a[sort.key] - b[sort.key]) * dir,
    );
  }, [q.data, search, sort]);

  const all = q.data ?? [];
  const available = all.filter((r) => r.status === 'AVAILABLE');
  return (
    <div>
      <PageHeader
        title="Rooms"
        description="Examination halls, capacities and availability. Capacity can’t drop below seats already allocated."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Add room
          </Button>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile label="Rooms" value={all.length} sub={`${available.length} available`} />
        <KpiTile label="Total capacity" value={available.reduce((a, r) => a + r.capacity, 0)} sub="Seats in available rooms" />
        <KpiTile label="Upcoming bookings" value={all.reduce((a, r) => a + r.upcomingBookings, 0)} sub="Room × session bookings" />
        <KpiTile label="Unavailable" value={all.length - available.length} tone={all.length - available.length ? 'warn' : 'neutral'} sub="Maintenance or retired" />
      </div>
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search room or block…" className="w-full sm:w-64" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-auto" aria-label="Status">
            <option value="">All statuses</option>
            {ROOM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0] + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState icon={DoorOpen} title="No rooms found" action={<Button size="sm" onClick={() => setEditing('new')}>Add room</Button>} />
        ) : (
          <Table>
            <THead>
              <tr>
                <SortHeader label="Room" sortKey="roomNo" sort={sort} onSort={setSort} />
                <TH>Block</TH>
                <SortHeader label="Capacity" sortKey="capacity" sort={sort} onSort={setSort} />
                <TH className="w-48">Peak allocated (upcoming)</TH>
                <SortHeader label="Remaining" sortKey="remaining" sort={sort} onSort={setSort} />
                <TH>Next bookings</TH>
                <TH>Status</TH>
                <TH className="w-10" />
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">{r.roomNo}</TD>
                  <TD className="text-muted">
                    {r.block}
                    {r.floor !== null && <span className="text-faint"> · F{r.floor}</span>}
                  </TD>
                  <TD className="tnum">{r.capacity}</TD>
                  <TD>
                    <div className="tnum flex justify-between text-xs">
                      <span>{r.allocated}</span>
                      <span className="text-muted">{Math.round((r.allocated / r.capacity) * 100)}%</span>
                    </div>
                    <Progress value={r.allocated / r.capacity} className="mt-1.5" />
                  </TD>
                  <TD className="tnum">{r.remaining}</TD>
                  <TD className="text-xs text-muted">
                    {r.bookings.length === 0
                      ? '—'
                      : r.bookings
                          .slice(0, 2)
                          .map((b) => `${fmtDate(b.examDate, 'dd MMM')} ${b.session} (${b.allocated})`)
                          .join(', ')}
                    {r.bookings.length > 2 && ` +${r.bookings.length - 2}`}
                  </TD>
                  <TD>
                    <RoomStatusBadge status={r.status} />
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setViewing(r)} aria-label={`3D view of ${r.roomNo}`}>
                        <Box className="h-3.5 w-3.5" /> 3D
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setEditing(r)} aria-label={`Edit ${r.roomNo}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-xs text-faint">Peak allocated = the largest number of seats allocated in this room in any single upcoming date and session.</p>
      <RoomDialog room={editing} onClose={() => setEditing(null)} />
      <Dialog
        open={!!viewing}
        onOpenChange={(v) => !v && setViewing(null)}
        size="xl"
        title={viewing ? `Room ${viewing.roomNo} · ${viewing.block}` : ''}
        description={viewing ? `${viewing.capacity} desks${viewing.floor !== null ? ` · floor ${viewing.floor}` : ''} · ${viewing.status.toLowerCase()}` : undefined}
      >
        {viewing && (
          <Classroom3D
            capacity={viewing.capacity}
            roomNo={viewing.roomNo}
            seats={[]}
            caption={`Room ${viewing.roomNo} layout · ${viewing.capacity} desks · peak upcoming load ${viewing.allocated}/${viewing.capacity}`}
          />
        )}
      </Dialog>
    </div>
  );
}

function RoomDialog({ room, onClose }: { room: Room | null | 'new'; onClose: () => void }) {
  const form = useForm<RoomInput>({ resolver: zodResolver(roomSchema) });
  const editing = room && room !== 'new' ? room : null;
  useEffect(() => {
    if (!room) return;
    form.reset(
      editing
        ? { roomNo: editing.roomNo, block: editing.block, floor: editing.floor, capacity: editing.capacity, status: editing.status, notes: editing.notes ?? '' }
        : { roomNo: '', block: '', floor: null, capacity: 40, status: 'AVAILABLE', notes: '' },
    );
  }, [room, editing, form]);
  const err = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      if (editing) await api.put(`/rooms/${editing.id}`, v);
      else await api.post('/rooms', v);
      toast.success(editing ? 'Room updated' : 'Room added');
      onClose();
    } catch (e) {
      applyServerErrors(form, e);
    }
  });
  return (
    <Dialog
      open={!!room}
      onOpenChange={(v) => !v && onClose()}
      title={editing ? `Edit room ${editing.roomNo}` : 'Add room'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={form.formState.isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Room number" error={err.roomNo?.message}>
          <Input {...form.register('roomNo')} placeholder="A-101" aria-invalid={!!err.roomNo} />
        </Field>
        <Field label="Block / building" error={err.block?.message}>
          <Input {...form.register('block')} placeholder="Academic Block A" aria-invalid={!!err.block} />
        </Field>
        <Field label="Capacity (seats)" error={err.capacity?.message}>
          <Input type="number" min={1} max={500} {...form.register('capacity', { valueAsNumber: true })} aria-invalid={!!err.capacity} />
        </Field>
        <Field label="Floor" error={err.floor?.message}>
          <Input type="number" {...form.register('floor', { valueAsNumber: true })} placeholder="Optional" />
        </Field>
        <Field label="Status" error={err.status?.message} hint="Only available rooms can be booked or allocated">
          <Select {...form.register('status')}>
            {ROOM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0] + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" error={err.notes?.message} className="sm:col-span-2">
          <Textarea {...form.register('notes')} placeholder="e.g. projector repair until 20 Oct" />
        </Field>
      </form>
    </Dialog>
  );
}
