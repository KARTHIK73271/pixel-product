import { Box as BoxIcon, Eye, LayoutGrid, Minus, Plus, RotateCcw, ScanLine } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

/**
 * Lightweight 3D classroom built with CSS 3D transforms (no WebGL library, so it loads instantly).
 * Desks are real boxes (top + four sides) laid out row by row from the board, with a centre aisle,
 * chairs, a teacher's desk, glass side walls and the board on the front wall.
 * Drag to orbit, use the buttons to zoom or jump to a preset view, hover a desk for details.
 */
export interface Seat3D {
  no: number;
  /** Desk colour; empty desks use the neutral tone. */
  color?: string;
  /** Short text on the desk top (defaults to the seat number). */
  label?: string;
  /** Hover detail line, e.g. "23CSE004 · Ishita Gupta · Present". */
  detail?: string;
}

export interface LegendItem {
  label: string;
  color: string;
}

const EMPTY = '#1f4a3e';
const DESK_W = 46;
const DESK_D = 30;
const DESK_H = 16;
const GAP_X = 18;
const GAP_Y = 30;
const AISLE = 30;
const PAD = 34;
const FRONT = 110; // space for board + teacher's desk
const WALL_H = 46;

const VIEWS = {
  iso: { tilt: 58, spin: -24 },
  front: { tilt: 68, spin: 0 },
  top: { tilt: 8, spin: 0 },
};

function colsFor(capacity: number) {
  if (capacity <= 20) return 5;
  if (capacity <= 36) return 6;
  if (capacity <= 64) return 8;
  return 10;
}

/** A box whose footprint is w×d on the floor and which rises h. Faces are shaded for depth. */
function Box({ w, d, h, color, style, className }: { w: number; d: number; h: number; color: string; style?: CSSProperties; className?: string }) {
  const face = (shade: number): CSSProperties => ({
    position: 'absolute',
    background: `linear-gradient(rgb(0 0 0 / ${shade}), rgb(0 0 0 / ${shade})), ${color}`,
    backfaceVisibility: 'visible',
  });
  return (
    <div className={className} style={{ position: 'absolute', width: w, height: d, transformStyle: 'preserve-3d', ...style }}>
      {/* back (y = 0) and front (y = d) */}
      <div style={{ ...face(0.38), left: 0, top: 0, width: w, height: h, transformOrigin: 'top', transform: 'rotateX(90deg)' }} />
      <div style={{ ...face(0.22), left: 0, top: d, width: w, height: h, transformOrigin: 'top', transform: 'rotateX(90deg)' }} />
      {/* left (x = 0) and right (x = w) */}
      <div style={{ ...face(0.45), left: 0, top: 0, width: h, height: d, transformOrigin: 'left', transform: 'rotateY(-90deg)' }} />
      <div style={{ ...face(0.32), left: w, top: 0, width: h, height: d, transformOrigin: 'left', transform: 'rotateY(-90deg)' }} />
      {/* top */}
      <div
        style={{
          ...face(0),
          inset: 0,
          transform: `translateZ(${h}px)`,
          boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.18)',
          backgroundImage: `linear-gradient(135deg, rgb(255 255 255 / 0.22), rgb(255 255 255 / 0) 55%), linear-gradient(${color}, ${color})`,
        }}
      />
    </div>
  );
}

export function Classroom3D({
  capacity,
  seats,
  roomNo,
  legend,
  height = 440,
  caption,
}: {
  capacity: number;
  seats: Seat3D[];
  roomNo: string;
  legend?: LegendItem[];
  height?: number;
  caption?: string;
}) {
  const cols = colsFor(capacity);
  const rows = Math.ceil(capacity / cols);
  const half = Math.ceil(cols / 2);
  const floorW = PAD * 2 + cols * DESK_W + (cols - 1) * GAP_X + AISLE;
  const floorD = FRONT + PAD + rows * (DESK_D + GAP_Y);

  const [view, setView] = useState(VIEWS.iso);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(1);
  const [hover, setHover] = useState<Seat3D | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; tilt: number; spin: number } | null>(null);

  // Scale the room to fit the panel width.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    // Fit the room to the panel's width AND height (perspective enlarges the near rows, hence the margins).
    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      const byWidth = (w * 0.7) / floorW;
      const byHeight = (h * 0.95) / (floorD * 0.75 + 90);
      setFit(Math.max(0.3, Math.min(1.2, byWidth, byHeight)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [floorW, floorD]);

  const bySeat = useMemo(() => new Map(seats.map((s) => [s.no, s])), [seats]);
  const occupied = seats.filter((s) => s.color && s.color !== EMPTY).length;

  const onPointerDown = (e: ReactPointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, ...view };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    setView({
      spin: drag.current.spin + dx * 0.35,
      tilt: Math.max(0, Math.min(78, drag.current.tilt - dy * 0.3)),
    });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const deskPos = (i: number) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return {
      left: PAD + c * (DESK_W + GAP_X) + (c >= half ? AISLE : 0),
      top: FRONT + r * (DESK_D + GAP_Y),
    };
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {caption ?? `Room ${roomNo} · ${occupied}/${capacity} desks occupied`} · drag to rotate
        </p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant={view === VIEWS.iso ? 'subtle' : 'ghost'} onClick={() => setView(VIEWS.iso)} title="3D view">
            <Eye className="h-3.5 w-3.5" /> 3D
          </Button>
          <Button size="sm" variant={view === VIEWS.front ? 'subtle' : 'ghost'} onClick={() => setView(VIEWS.front)} title="From the back of the room">
            Front
          </Button>
          <Button size="sm" variant={view === VIEWS.top ? 'subtle' : 'ghost'} onClick={() => setView(VIEWS.top)} title="Top-down plan">
            <ScanLine className="h-3.5 w-3.5" /> Top
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setZoom((z) => Math.max(0.6, z - 0.15))} aria-label="Zoom out">
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setZoom((z) => Math.min(1.8, z + 0.15))} aria-label="Zoom in">
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              setView(VIEWS.iso);
              setZoom(1);
            }}
            aria-label="Reset view"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div
        ref={wrap}
        className="relative cursor-grab touch-none overflow-hidden rounded-2xl border border-white/10 active:cursor-grabbing"
        style={{
          height,
          perspective: 1500,
          background:
            'radial-gradient(ellipse at 50% 30%, rgb(var(--accent) / 0.07), transparent 60%), linear-gradient(180deg, rgb(var(--canvas-2)), rgb(var(--canvas)))',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        role="img"
        aria-label={`3D view of room ${roomNo}: ${occupied} of ${capacity} desks occupied`}
      >
        <div className="absolute left-1/2 top-[46%]" style={{ transformStyle: 'preserve-3d' }}>
          <div
            style={{
              position: 'absolute',
              width: floorW,
              height: floorD,
              left: -floorW / 2,
              top: -floorD / 2,
              transformStyle: 'preserve-3d',
              transform: `scale(${fit * zoom}) rotateX(${view.tilt}deg) rotateZ(${view.spin}deg)`,
              transition: drag.current ? 'none' : 'transform 500ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            {/* floor tiles */}
            <div
              className="absolute inset-0 rounded-md"
              style={{
                background:
                  'linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px) 0 0 / 38px 38px, linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px) 0 0 / 38px 38px, linear-gradient(160deg, #0b3f32, #062a21)',
                boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.12), 0 30px 60px -10px rgb(0 0 0 / 0.6)',
              }}
            />
            {/* front wall with the board (y = 0) */}
            <div
              className="absolute left-0"
              style={{
                top: -(WALL_H + 30),
                width: floorW,
                height: WALL_H + 30,
                // hinged on its bottom edge so the face (and the board text) looks toward the students
                transformOrigin: 'bottom',
                transform: 'rotateX(-90deg)',
                background: 'linear-gradient(180deg, rgb(248 231 201 / 0.10), rgb(248 231 201 / 0.04))',
                borderTop: '1px solid rgb(255 255 255 / 0.25)',
                backdropFilter: 'blur(2px)',
              }}
            >
              <div
                className="absolute left-1/2 flex -translate-x-1/2 items-center justify-center rounded-sm text-[10px] font-semibold tracking-[0.3em]"
                style={{
                  bottom: 24,
                  width: floorW * 0.5,
                  height: 40,
                  background: 'linear-gradient(180deg, #0d3a2e, #0a2f25)',
                  border: '3px solid #c9a96b',
                  color: 'rgb(248 231 201 / 0.75)',
                }}
              >
                BOARD
              </div>
            </div>
            {/* glass side walls */}
            {[0, floorW].map((x) => (
              <div
                key={x}
                className="absolute top-0"
                style={{
                  left: x,
                  width: WALL_H,
                  height: floorD,
                  transformOrigin: 'left',
                  transform: 'rotateY(-90deg)',
                  background: 'linear-gradient(90deg, rgb(248 231 201 / 0.08), rgb(248 231 201 / 0.02))',
                  borderLeft: '1px solid rgb(255 255 255 / 0.18)',
                }}
              />
            ))}
            {/* door marker (front right) */}
            <div
              className="absolute rounded-sm"
              style={{ left: floorW - 52, top: 2, width: 40, height: 6, background: '#c9a96b', transform: 'translateZ(1px)' }}
              title="Door"
            />
            {/* teacher's desk */}
            <Box w={DESK_W * 2} d={DESK_D} h={DESK_H + 4} color="#7a5b2e" style={{ left: floorW / 2 - DESK_W, top: 44 }} />

            {/* student desks + chairs */}
            {Array.from({ length: capacity }, (_, i) => {
              const seat = bySeat.get(i + 1) ?? { no: i + 1 };
              const pos = deskPos(i);
              const color = seat.color ?? EMPTY;
              const active = hover?.no === seat.no;
              return (
                <div
                  key={i}
                  className="absolute"
                  style={{ left: pos.left, top: pos.top, width: DESK_W, height: DESK_D + 16, transformStyle: 'preserve-3d' }}
                  onPointerEnter={() => setHover(seat)}
                  onPointerLeave={() => setHover((h) => (h?.no === seat.no ? null : h))}
                >
                  <Box
                    w={DESK_W}
                    d={DESK_D}
                    h={active ? DESK_H + 10 : DESK_H}
                    color={color}
                    style={{ transition: 'transform 200ms', transform: active ? 'translateZ(2px)' : undefined }}
                  />
                  {/* desk number on the top face */}
                  <div
                    className="pointer-events-none absolute flex items-center justify-center text-[10px] font-semibold"
                    style={{
                      left: 0,
                      top: 0,
                      width: DESK_W,
                      height: DESK_D,
                      transform: `translateZ(${(active ? DESK_H + 10 : DESK_H) + 0.5}px)`,
                      color: seat.color && seat.color !== EMPTY ? 'rgb(255 255 255 / 0.92)' : 'rgb(248 231 201 / 0.45)',
                      textShadow: '0 1px 2px rgb(0 0 0 / 0.6)',
                    }}
                  >
                    {seat.label ?? seat.no}
                  </div>
                  {/* chair */}
                  <Box w={DESK_W * 0.5} d={10} h={8} color="#2d5a4c" style={{ left: DESK_W * 0.25, top: DESK_D + 4 }} />
                </div>
              );
            })}
          </div>
        </div>

        {/* hover card */}
        <div
          className={cn(
            'pointer-events-none absolute bottom-3 left-3 rounded-xl border border-white/15 bg-surface/80 px-3 py-2 text-xs backdrop-blur-md transition-opacity',
            hover ? 'opacity-100' : 'opacity-0',
          )}
        >
          <p className="font-semibold text-ink">Desk {hover?.no}</p>
          <p className="text-muted">{hover?.detail ?? 'Empty desk'}</p>
        </div>
      </div>

      {legend && legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-2xs text-muted">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border border-white/20" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-white/20" style={{ background: EMPTY }} />
            Empty
          </span>
        </div>
      )}
    </div>
  );
}

export const EMPTY_DESK_COLOR = EMPTY;

/** Switch between the 3D classroom and the flat seat grid. */
export function ViewToggle({ mode, onChange }: { mode: '3d' | 'grid'; onChange: (m: '3d' | 'grid') => void }) {
  return (
    <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.04] p-0.5 backdrop-blur-md" role="group" aria-label="Room view">
      {(
        [
          ['3d', '3D room', BoxIcon],
          ['grid', 'Seat grid', LayoutGrid],
        ] as const
      ).map(([m, label, Icon]) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          aria-pressed={mode === m}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
            mode === m ? 'bg-accent text-on-accent shadow-[inset_0_1px_0_0_rgb(255_255_255/0.6)]' : 'text-muted hover:text-ink',
          )}
        >
          <Icon className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}
