import { CheckCircle2, ChevronLeft, ChevronRight, Gauge, Pause, Play, RotateCcw, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badges';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import type { ExamDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

/* ───────────────────────────────────────────────────────────── the placements */

interface Placement {
  seatNo: number;
  roomId: string;
  roomNo: string;
  rollNo: string;
  fullName: string;
  departmentCode: string;
  section: string;
  /** `DEPT-SECTION` — the cohort the separation rule is written against. */
  cohort: string;
}

/** Cohort colours. Chosen to stay distinguishable on the emerald surface and from each other. */
const COHORT_COLORS = ['#C98500', '#9085E9', '#7DD3AC', '#E0BA78', '#5BA6F5', '#EE7A44', '#C4B5FD', '#86EFAC'];

/**
 * The committed plan, read back in the order the allocator filled it: room by
 * room, seat by seat. This is the plan's own ordering — nothing is inferred
 * about wall-clock timing, which the database does not record per seat.
 */
function buildPlacements(detail: ExamDetail): Placement[] {
  const roomOrder = new Map(detail.rooms.map((r, i) => [r.id, i]));
  return detail.students
    .filter((s): s is typeof s & { roomId: string; roomNo: string; seatNo: number } => s.roomId !== null && s.seatNo !== null && s.roomNo !== null)
    .map((s) => ({
      seatNo: s.seatNo,
      roomId: s.roomId,
      roomNo: s.roomNo,
      rollNo: s.rollNo,
      fullName: s.fullName,
      departmentCode: s.departmentCode,
      section: s.section,
      cohort: `${s.departmentCode}-${s.section}`,
    }))
    .sort((a, b) => (roomOrder.get(a.roomId) ?? 0) - (roomOrder.get(b.roomId) ?? 0) || a.seatNo - b.seatNo);
}

/**
 * Adjacent seats holding the same cohort — the thing the seating rule exists to
 * prevent. Computed per room over seat numbers that are literally next to each
 * other, so an empty seat between two students breaks the adjacency.
 */
function adjacencyConflicts(placed: Placement[]) {
  const byRoom = new Map<string, Placement[]>();
  for (const p of placed) {
    if (!byRoom.has(p.roomId)) byRoom.set(p.roomId, []);
    byRoom.get(p.roomId)!.push(p);
  }
  const clashes: { roomNo: string; a: Placement; b: Placement }[] = [];
  for (const list of byRoom.values()) {
    const sorted = [...list].sort((x, y) => x.seatNo - y.seatNo);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.seatNo === prev.seatNo + 1 && cur.cohort === prev.cohort) clashes.push({ roomNo: cur.roomNo, a: prev, b: cur });
    }
  }
  return clashes;
}

/* ─────────────────────────────────────────────────────────────── the seat grid */

function RoomGrid({
  roomNo,
  capacity,
  seats,
  currentSeat,
  colorOf,
}: {
  roomNo: string;
  capacity: number;
  seats: Map<number, Placement>;
  currentSeat: number | null;
  colorOf: (cohort: string) => string;
}) {
  const cells = Array.from({ length: capacity }, (_, i) => i + 1);
  return (
    <div className="rounded-xl border border-line bg-canvas/40 p-3">
      <div className="mb-2.5 flex items-baseline justify-between">
        <p className="display text-[13px] text-ink">{roomNo}</p>
        <p className="tnum text-2xs text-faint">
          {seats.size}/{capacity} seated
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        {cells.map((n) => {
          const p = seats.get(n);
          const isCurrent = currentSeat === n && !!p;
          return (
            <span
              key={n}
              title={p ? `Seat ${n} · ${p.rollNo} · ${p.cohort}` : `Seat ${n} · empty`}
              className={cn(
                'tnum grid h-6 w-6 place-items-center rounded-[5px] border text-[9px] font-medium transition-all duration-300',
                p ? 'border-transparent text-[#0b1f19]' : 'border-line/70 bg-canvas/60 text-faint/40',
                isCurrent && 'scale-125 ring-2 ring-accent',
              )}
              style={p ? { background: colorOf(p.cohort) } : undefined}
            >
              {n}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── the tab */

const SPEEDS = [0.5, 1, 2, 4] as const;

export function ReplayTab({ detail }: { detail: ExamDetail }) {
  const placements = useMemo(() => buildPlacements(detail), [detail]);
  const total = placements.length;

  const [step, setStep] = useState(total);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const timer = useRef<number | undefined>(undefined);

  // a freshly loaded (or re-allocated) plan starts fully drawn, not mid-replay
  useEffect(() => {
    setStep(total);
    setPlaying(false);
  }, [total]);

  useEffect(() => {
    if (!playing) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    timer.current = window.setTimeout(() => setStep((s) => Math.min(total, s + 1)), 420 / speed);
    return () => window.clearTimeout(timer.current);
  }, [playing, step, total, speed]);

  const play = useCallback(() => {
    setPlaying((p) => {
      if (!p && step >= total) setStep(0); // replay from the top when finished
      return !p;
    });
  }, [step, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === ' ') {
        e.preventDefault();
        play();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPlaying(false);
        setStep((s) => Math.min(total, s + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPlaying(false);
        setStep((s) => Math.max(0, s - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play, total]);

  const shown = useMemo(() => placements.slice(0, step), [placements, step]);
  const current = step > 0 ? placements[step - 1] : null;

  const cohorts = useMemo(() => [...new Set(placements.map((p) => p.cohort))].sort(), [placements]);
  const colorOf = useCallback((cohort: string) => COHORT_COLORS[cohorts.indexOf(cohort) % COHORT_COLORS.length], [cohorts]);

  const seatsByRoom = useMemo(() => {
    const m = new Map<string, Map<number, Placement>>();
    for (const p of shown) {
      if (!m.has(p.roomId)) m.set(p.roomId, new Map());
      m.get(p.roomId)!.set(p.seatNo, p);
    }
    return m;
  }, [shown]);

  const conflicts = useMemo(() => adjacencyConflicts(shown), [shown]);
  const roomsOpened = seatsByRoom.size;
  const usedRooms = useMemo(() => detail.rooms.filter((r) => placements.some((p) => p.roomId === r.id)), [detail.rooms, placements]);

  if (total === 0) {
    return (
      <Card>
        <EmptyState
          icon={Sparkles}
          title="No seating plan to replay yet"
          description="Generate and confirm a seating allocation, then come back here to watch how the plan was built, seat by seat."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── transport ────────────────────────────────────────────── */}
      <Card featured>
        <CardHeader
          eyebrow="Show your work"
          title="Allocation replay"
          description="The committed plan, read back in the order the allocator filled it — room by room, seat by seat. Watch cohorts spread out and the separation rule hold."
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="sm" onClick={play}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {playing ? 'Pause' : step >= total ? 'Replay' : 'Play'}
            </Button>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="secondary"
                aria-label="Previous seat"
                disabled={step === 0}
                onClick={() => {
                  setPlaying(false);
                  setStep((s) => Math.max(0, s - 1));
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                aria-label="Next seat"
                disabled={step >= total}
                onClick={() => {
                  setPlaying(false);
                  setStep((s) => Math.min(total, s + 1));
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Back to start"
                onClick={() => {
                  setPlaying(false);
                  setStep(0);
                }}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5 text-faint" />
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeed(s)}
                  className={cn(
                    'tnum rounded-md border px-1.5 py-0.5 text-2xs font-medium transition-colors',
                    speed === s ? 'border-accent/40 bg-accent/15 text-accent' : 'border-line text-muted hover:text-ink',
                  )}
                >
                  {s}×
                </button>
              ))}
            </div>

            <span className="tnum ml-auto text-[13px] text-muted">
              Seat <span className="font-semibold text-ink">{step}</span> of {total}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={total}
            value={step}
            aria-label="Scrub through the allocation"
            onChange={(e) => {
              setPlaying(false);
              setStep(Number(e.target.value));
            }}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-canvas/80 accent-[rgb(var(--accent))]"
          />

          {/* ── live verdict ───────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Seats placed" value={step} />
            <Stat label="Rooms opened" value={roomsOpened} />
            <Stat label="Cohorts mixed" value={new Set(shown.map((p) => p.cohort)).size} />
            <div
              className={cn(
                'rounded-xl border p-3',
                conflicts.length === 0 ? 'border-ok/30 bg-ok/[0.06]' : 'border-bad/35 bg-bad/[0.06]',
              )}
            >
              <p className={cn('flex items-center gap-1.5 text-[13px] font-semibold', conflicts.length === 0 ? 'text-ok' : 'text-bad')}>
                {conflicts.length === 0 ? <ShieldCheck className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
                {conflicts.length === 0 ? 'Rule holds' : `${conflicts.length} clash${conflicts.length === 1 ? '' : 'es'}`}
              </p>
              <p className="mt-0.5 text-2xs text-muted">No two adjacent seats share a cohort</p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── the floor + the log ──────────────────────────────────── */}
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader
            title="Seat map"
            description={`${usedRooms.length} room${usedRooms.length === 1 ? '' : 's'} in this plan`}
            action={
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                {cohorts.slice(0, 6).map((c) => (
                  <span key={c} className="flex items-center gap-1.5 text-2xs text-muted">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colorOf(c) }} />
                    {c}
                  </span>
                ))}
              </div>
            }
          />
          <CardBody className="grid gap-4 lg:grid-cols-2">
            {usedRooms.map((r) => (
              <RoomGrid
                key={r.id}
                roomNo={r.roomNo}
                capacity={r.capacity}
                seats={seatsByRoom.get(r.id) ?? new Map()}
                currentSeat={current && current.roomId === r.id ? current.seatNo : null}
                colorOf={colorOf}
              />
            ))}
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader eyebrow="Decision log" title="Placements" description="Most recent first" />
          {step === 0 ? (
            <CardBody>
              <p className="text-xs text-faint">Press play to watch the plan build itself.</p>
            </CardBody>
          ) : (
            <ul className="max-h-[520px] divide-y divide-line/60 overflow-y-auto">
              {[...shown]
                .slice(-14)
                .reverse()
                .map((p, i) => (
                  <li key={`${p.roomId}${p.seatNo}`} className={cn('flex items-center gap-2.5 px-3.5 py-2', i === 0 && 'bg-accent/[0.06]')}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf(p.cohort) }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink">{p.rollNo}</span>
                      <span className="block truncate text-2xs text-faint">{p.cohort}</span>
                    </span>
                    <span className="tnum shrink-0 text-2xs text-muted">
                      {p.roomNo}·{p.seatNo}
                    </span>
                  </li>
                ))}
            </ul>
          )}
          {step >= total && (
            <div className="flex items-center gap-2 border-t border-line/80 px-3.5 py-2.5 text-2xs text-ok">
              <CheckCircle2 className="h-3.5 w-3.5" /> Plan complete — {total} seats across {roomsOpened} rooms
            </div>
          )}
        </Card>
      </div>

      {conflicts.length > 0 && (
        <Card className="border-bad/30">
          <CardHeader title="Adjacent same-cohort seats" description="These pairs sit next to each other and share a department-section." />
          <CardBody className="flex flex-wrap gap-2">
            {conflicts.map((c) => (
              <Badge key={`${c.a.roomNo}${c.a.seatNo}`} tone="bad">
                {c.roomNo} · seats {c.a.seatNo}–{c.b.seatNo} · {c.a.cohort}
              </Badge>
            ))}
          </CardBody>
        </Card>
      )}

      <p className="text-2xs text-faint">
        Keyboard: <kbd className="rounded border border-line px-1 font-mono">Space</kbd> play/pause ·{' '}
        <kbd className="rounded border border-line px-1 font-mono">←</kbd>{' '}
        <kbd className="rounded border border-line px-1 font-mono">→</kbd> step one seat
      </p>
    </div>
  );
}

/** Counts here track the scrubber frame by frame, so they are never animated —
 *  an easing counter lags the playhead and shows a figure that disagrees with it. */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-canvas/40 p-3">
      <p className="tnum text-[22px] font-semibold leading-none text-ink">{value}</p>
      <p className="mt-1 text-2xs uppercase tracking-[0.1em] text-faint">{label}</p>
    </div>
  );
}
