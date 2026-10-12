import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  Building2,
  CalendarDays,
  Lock,
  Maximize2,
  Minimize2,
  Radar,
  UserX,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { SubmissionBadge } from '@/components/ui/badges';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, Progress, Skeleton } from '@/components/ui/feedback';
import { AnimatedNumber } from '@/components/ui/number';
import { PageHeader } from '@/components/ui/page';
import { api } from '@/lib/api';
import type { AdminDashboardData } from '@/lib/types';
import { cn, fmtDate, fmtRelative, relativeDay, sessionLabel } from '@/lib/utils';

type Room = AdminDashboardData['controlCenter']['rooms'][number];

/* ────────────────────────────────────────────────────────────── room state */

type Tone = 'ok' | 'warn' | 'bad' | 'idle';

interface RoomState {
  tone: Tone;
  label: string;
  /** marked ÷ allocated, 0–1 */
  progress: number;
  /** rooms that need a human to look at them pulse */
  urgent: boolean;
}

/**
 * One room's operational state. `overdue` is passed in rather than derived per
 * room because it is a property of the examination date, not of the room.
 */
function roomState(r: Room, overdue: boolean): RoomState {
  const marked = r.present + r.absent;
  const progress = r.allocated > 0 ? marked / r.allocated : 0;
  if (r.submissionStatus === 'FINALIZED') return { tone: 'ok', label: 'Finalized', progress: 1, urgent: false };
  if (overdue) return { tone: 'bad', label: 'Overdue', progress, urgent: true };
  if (r.submissionStatus === 'IN_PROGRESS') return { tone: 'warn', label: 'Marking', progress, urgent: false };
  return { tone: 'idle', label: 'Not started', progress, urgent: false };
}

const TONE: Record<Tone, { ring: string; text: string; border: string; dot: string; rgb: string }> = {
  ok: { ring: 'text-ok', text: 'text-ok', border: 'border-ok/30', dot: 'bg-ok', rgb: 'var(--ok)' },
  warn: { ring: 'text-warn', text: 'text-warn', border: 'border-warn/35', dot: 'bg-warn', rgb: 'var(--warn)' },
  bad: { ring: 'text-bad', text: 'text-bad', border: 'border-bad/45', dot: 'bg-bad', rgb: 'var(--bad)' },
  idle: { ring: 'text-faint', text: 'text-faint', border: 'border-line', dot: 'bg-faint', rgb: 'var(--faint)' },
};

/* ──────────────────────────────────────────────────────────────── the tile */

function RoomTile({ room, overdue, onOpen }: { room: Room; overdue: boolean; onOpen: () => void }) {
  const s = roomState(room, overdue);
  const t = TONE[s.tone];
  const marked = room.present + room.absent;
  const pct = Math.round(s.progress * 100);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Room ${room.roomNo}, ${room.courseCode}, ${s.label}, ${marked} of ${room.allocated} marked`}
      className={cn(
        'glass lift group relative flex items-center gap-3.5 rounded-2xl border p-3.5 text-left',
        t.border,
        s.urgent && 'alert-pulse',
      )}
      style={s.urgent ? ({ ['--pulse' as string]: t.rgb } as CSSProperties) : undefined}
    >
      {/* progress ring — one masked conic gradient, animated via --ring */}
      <span className={cn('relative grid h-[64px] w-[64px] shrink-0 place-items-center', t.ring)}>
        <span className="ring absolute inset-0 rounded-full" style={{ ['--ring' as string]: `${pct}%` } as CSSProperties} />
        <span className="flex flex-col items-center leading-none">
          <span className="display text-[15px] text-ink">{room.roomNo}</span>
          <span className="tnum mt-0.5 text-[10px] text-muted">{pct}%</span>
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', t.dot, s.tone === 'warn' && 'breathe')} />
          <span className="truncate text-[13px] font-semibold text-ink">{room.courseCode}</span>
          <span className="tnum ml-auto shrink-0 text-2xs text-muted">
            {marked}/{room.allocated}
          </span>
        </span>

        <span className={cn('mt-0.5 block truncate text-2xs', room.inchargeName ? 'text-faint' : 'text-bad')}>
          {room.inchargeName ?? 'No in-charge assigned'}
        </span>

        {/* present / absent / unmarked, in the room's own proportions */}
        <span className="mt-2 flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-canvas/70">
          {room.present > 0 && <span className="bg-ok" style={{ width: `${(room.present / room.allocated) * 100}%` }} />}
          {room.absent > 0 && <span className="bg-bad" style={{ width: `${(room.absent / room.allocated) * 100}%` }} />}
        </span>

        <span className="mt-1.5 flex items-center justify-between gap-2">
          <span className={cn('shrink-0 text-2xs font-medium', t.text)}>{s.label}</span>
          <span className="truncate text-2xs text-faint">
            {sessionLabel(room.session)} · {room.startTime}
          </span>
          <ArrowRight className="h-3 w-3 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
      </span>
    </button>
  );
}

/* ───────────────────────────────────────────────────────────── block group */

function BlockSection({ block, rooms, overdue, onOpen }: { block: string; rooms: Room[]; overdue: boolean; onOpen: (r: Room) => void }) {
  const allocated = rooms.reduce((n, r) => n + r.allocated, 0);
  const marked = rooms.reduce((n, r) => n + r.present + r.absent, 0);
  const done = rooms.filter((r) => r.submissionStatus === 'FINALIZED').length;

  return (
    <section className="rise">
      <div className="mb-3 flex items-center gap-3">
        <Building2 className="h-4 w-4 shrink-0 text-faint" />
        <h2 className="display text-[15px] text-ink">{block}</h2>
        <span className="tnum text-2xs text-faint">
          {done}/{rooms.length} finalized · {marked}/{allocated} marked
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-line to-transparent" />
      </div>
      <div className="stagger grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {rooms.map((r) => (
          <RoomTile key={`${r.examId}${r.roomId}`} room={r} overdue={overdue} onOpen={() => onOpen(r)} />
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────── the counter */

function Counter({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof Users; tone: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-canvas/50', tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="leading-tight">
        <p className="tnum wall-up text-xl font-semibold text-ink">
          <AnimatedNumber value={value} />
        </p>
        <p className="text-2xs uppercase tracking-[0.1em] text-faint">{label}</p>
      </div>
    </div>
  );
}

/** A clock makes the board read as live even while nothing is changing. */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="tnum wall-up font-mono text-lg text-ink">
      {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────── the page */

export function FloorMapPage() {
  useBreadcrumbs([{ label: 'Mission control' }]);
  const [wall, setWall] = useState(false);
  const [focus, setFocus] = useState<Room | null>(null);

  const dash = useQuery({
    queryKey: ['dashboard', 'floor'],
    queryFn: () => api.get<AdminDashboardData>('/dashboard/admin'),
    placeholderData: (prev) => prev,
  });
  const d = dash.data;

  /* wall mode: real fullscreen, toggled by the button or `W` */
  const toggleWall = useCallback(() => setWall((v) => !v), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key.toLowerCase() === 'w') {
        e.preventDefault();
        toggleWall();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleWall]);

  useEffect(() => {
    if (wall) void document.documentElement.requestFullscreen?.().catch(() => undefined);
    else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    // Esc leaves fullscreen without telling React — mirror the browser back into state
    const sync = () => {
      if (!document.fullscreenElement) setWall(false);
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [wall]);

  const rooms = useMemo(() => d?.controlCenter.rooms ?? [], [d]);
  const overdue = !!d && d.controlCenter.date !== null && d.controlCenter.date < d.today;

  const blocks = useMemo(() => {
    const by = new Map<string, Room[]>();
    for (const r of rooms) {
      const key = r.block || 'Unassigned block';
      if (!by.has(key)) by.set(key, []);
      by.get(key)!.push(r);
    }
    return [...by.entries()]
      .map(([block, list]) => [block, [...list].sort((a, b) => a.roomNo.localeCompare(b.roomNo, undefined, { numeric: true }))] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [rooms]);

  const totals = useMemo(() => {
    const t = { present: 0, absent: 0, unmarked: 0, allocated: 0, finalized: 0 };
    for (const r of rooms) {
      t.present += r.present;
      t.absent += r.absent;
      t.unmarked += r.unmarked;
      t.allocated += r.allocated;
      if (r.submissionStatus === 'FINALIZED') t.finalized += 1;
    }
    return t;
  }, [rooms]);

  const completion = totals.allocated > 0 ? (totals.present + totals.absent) / totals.allocated : 0;

  const board = (
    <>
      {/* ── command bar ─────────────────────────────────────────────── */}
      <Card featured className="rise mb-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-5 p-4">
          <div className="min-w-0">
            <p className="eyebrow flex items-center gap-1.5">
              <Radar className="h-3 w-3 text-accent" /> Live floor
            </p>
            <p className="display wall-up mt-1 text-[17px] text-ink">
              {d?.controlCenter.date ? `${relativeDay(d.controlCenter.date)} · ${fmtDate(d.controlCenter.date, 'EEE dd MMM')}` : 'No published examinations'}
            </p>
          </div>

          <Counter label="Present" value={totals.present} icon={Users} tone="text-ok" />
          <Counter label="Absent" value={totals.absent} icon={UserX} tone="text-bad" />
          <Counter label="Unmarked" value={totals.unmarked} icon={Activity} tone="text-muted" />
          <Counter label="Rooms sealed" value={totals.finalized} icon={Lock} tone="text-accent" />

          <div className="ml-auto flex items-center gap-4">
            <Clock />
            <Button variant={wall ? 'secondary' : 'primary'} size="sm" onClick={toggleWall}>
              {wall ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              {wall ? 'Exit wall' : 'Wall mode'}
              <kbd className="ml-1 rounded border border-current/25 px-1 font-mono text-2xs opacity-70">W</kbd>
            </Button>
          </div>

          <div className="w-full">
            <div className="mb-1.5 flex items-center justify-between text-2xs text-muted">
              <span>Attendance captured across all live rooms</span>
              <span className="tnum">
                {totals.present + totals.absent} / {totals.allocated} ({Math.round(completion * 100)}%)
              </span>
            </div>
            <Progress value={completion} tone={completion === 1 ? 'ok' : 'accent'} />
          </div>
        </div>
      </Card>

      {/* ── floor + feed ────────────────────────────────────────────── */}
      {rooms.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="The floor is quiet"
            description="No published examination has rooms in progress right now. Publish an examination and its rooms appear here live."
            action={
              <LinkButton to="/examinations" variant="primary" size="sm">
                Go to examinations
              </LinkButton>
            }
          />
        </Card>
      ) : (
        <div className={cn('grid gap-6', wall ? 'xl:grid-cols-[1fr_340px]' : 'xl:grid-cols-[1fr_300px]')}>
          <div className="space-y-7">
            {blocks.map(([block, list]) => (
              <BlockSection key={block} block={block} rooms={list} overdue={overdue} onOpen={setFocus} />
            ))}
          </div>

          <Card className="rise h-fit">
            <CardHeader eyebrow="Live" title="Activity feed" description={d ? `Updated ${fmtRelative(d.generatedAt)}` : undefined} />
            {d && d.activity.length > 0 ? (
              <ul className="max-h-[70vh] divide-y divide-line/60 overflow-y-auto">
                {d.activity.map((a) => (
                  <li key={a.id} className="px-4 py-2.5">
                    <p className="line-clamp-2 text-xs text-ink/90">{a.summary}</p>
                    <p className="mt-0.5 text-2xs text-faint">
                      {a.actorName} · {fmtRelative(a.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody>
                <p className="text-xs text-faint">Nothing has happened yet today.</p>
              </CardBody>
            )}
          </Card>
        </div>
      )}
    </>
  );

  const detail = focus && (
    <Dialog
      open
      onOpenChange={(v) => !v && setFocus(null)}
      size="md"
      title={`Room ${focus.roomNo}`}
      description={`${focus.block} · ${focus.courseCode} — ${focus.examName}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => setFocus(null)}>
            Close
          </Button>
          <LinkButton variant="primary" to={`/attendance/${focus.examId}/${focus.roomId}`}>
            Open attendance <ArrowRight className="h-4 w-4" />
          </LinkButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SubmissionBadge status={focus.submissionStatus} overdue={overdue && focus.submissionStatus !== 'FINALIZED'} />
          <span className="text-xs text-muted">
            {sessionLabel(focus.session)} · {focus.startTime}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { k: 'Present', v: focus.present, c: 'text-ok' },
            { k: 'Absent', v: focus.absent, c: 'text-bad' },
            { k: 'Unmarked', v: focus.unmarked, c: 'text-muted' },
          ].map((x) => (
            <div key={x.k} className="rounded-xl border border-line bg-canvas/40 p-3">
              <p className={cn('tnum text-2xl font-semibold', x.c)}>{x.v}</p>
              <p className="mt-0.5 text-2xs uppercase tracking-[0.1em] text-faint">{x.k}</p>
            </div>
          ))}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-2xs text-muted">
            <span>Seats marked</span>
            <span className="tnum">
              {focus.present + focus.absent} / {focus.allocated} · capacity {focus.capacity}
            </span>
          </div>
          <Progress value={focus.allocated ? (focus.present + focus.absent) / focus.allocated : 0} />
        </div>

        <p className="text-xs text-muted">
          In-charge: <span className={focus.inchargeName ? 'text-ink' : 'text-bad'}>{focus.inchargeName ?? 'Unassigned'}</span>
        </p>
      </div>
    </Dialog>
  );

  if (dash.isError && !d) {
    return (
      <Card>
        <ErrorState error={dash.error} onRetry={() => dash.refetch()} />
      </Card>
    );
  }

  if (!d) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  /* Wall mode lifts the board out of the shell and onto the projector.
     It goes through a portal to <body>: the page column carries a filled
     `rise` transform, which would otherwise make it — not the viewport — the
     containing block for this fixed overlay. */
  if (wall) {
    return createPortal(
      <div className="wall fixed inset-0 z-[60] overflow-y-auto bg-canvas px-8 py-7">
        {board}
        {detail}
      </div>,
      document.body,
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Live operations"
        title="Exam day mission control"
        description="Every live room on the floor, as it happens. Rings fill as attendance is marked, overdue rooms pulse, and the board updates itself over the server's change feed — no refresh."
        actions={
          <LinkButton to="/attendance" variant="secondary" size="sm">
            Room list
          </LinkButton>
        }
      />
      {board}
      {detail}
    </div>
  );
}
