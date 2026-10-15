import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { useChartTokens } from '@/lib/theme';
import type { AdminDashboardData } from '@/lib/types';
import { fmtPct } from '@/lib/utils';

// Series colours live in index.css so both themes define them in one place, and
// each theme's pair is validated for colour-vision-deficiency separation on its
// own ground: gold vs violet, ΔE 27 under protan/deutan simulation, both ≥ 3:1.
// Recharts writes these into SVG attributes, which cannot resolve var(), so they
// are read as computed values and re-read whenever the theme changes.
const TOKENS = [
  'chart-1',
  'chart-1-lit',
  'chart-2',
  'chart-2-lit',
  'chart-neutral',
  'chart-neutral-lit',
  'chart-grid',
  'chart-axis',
  'chart-surface',
  'chart-tick',
] as const;

function useSeries() {
  const t = useChartTokens(TOKENS);
  return {
    present: t['chart-1'],
    presentLit: t['chart-1-lit'],
    absent: t['chart-2'],
    absentLit: t['chart-2-lit'],
    neutral: t['chart-neutral'],
    neutralLit: t['chart-neutral-lit'],
    grid: t['chart-grid'],
    axis: t['chart-axis'],
    surface: t['chart-surface'],
    tick: t['chart-tick'],
    /** hover band — an 8-digit hex, since an SVG attribute cannot take var() either */
    cursor: `${t['chart-axis']}2e`,
  };
}

type Series = ReturnType<typeof useSeries>;

const axisPropsOf = (s: Series) => ({ stroke: s.axis, fontSize: 11, tickLine: false, axisLine: false }) as const;

/** One horizontal gradient per series, lit at the far end of the bar.
 *  `ns` keeps the gradient ids unique when two charts share a page. */
const seriesGradients = (ns: string, s: Series) =>
  (
    [
      ['present', s.present, s.presentLit],
      ['absent', s.absent, s.absentLit],
      ['neutral', s.neutral, s.neutralLit],
    ] as const
  ).map(([name, from, to]) => (
    <linearGradient key={name} id={`${ns}-${name}`} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stopColor={from} />
      <stop offset="100%" stopColor={to} />
    </linearGradient>
  ));

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="glass rounded-xl px-3.5 py-2.5 text-xs shadow-pop">
      <p className="mb-1.5 font-semibold text-ink">{title}</p>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-8 py-px">
          <span className="flex items-center gap-2 text-muted">
            {r.color && <span className="h-2 w-2 rounded-[2px]" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="tnum font-medium text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted" aria-hidden>
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

type UtilRow = AdminDashboardData['charts']['roomUtilization'][number];

export function RoomUtilizationChart({ data }: { data: UtilRow[] }) {
  const s = useSeries();
  const axisProps = axisPropsOf(s);
  const rows = data.filter((r) => r.bookings > 0).map((r) => ({ ...r, pct: Math.round(r.utilization * 100) }));
  if (rows.length === 0) return <p className="py-10 text-center text-[13px] text-faint">No room bookings in the selected scope.</p>;
  return (
    <div style={{ height: Math.max(160, rows.length * 34 + 40) }} role="img" aria-label="Seat utilization per booked room">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }} barCategoryGap={8}>
          <defs>{seriesGradients('util', s)}</defs>
          <CartesianGrid horizontal={false} stroke={s.grid} />
          <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} {...axisProps} />
          <YAxis type="category" dataKey="roomNo" width={56} {...axisProps} tick={{ fill: s.tick, fontSize: 12 }} />
          <ReferenceLine x={100} stroke={s.axis} strokeDasharray="3 3" />
          <Tooltip
            cursor={{ fill: s.cursor }}
            content={({ active, payload }: TooltipProps<number, string>) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as UtilRow & { pct: number };
              return (
                <TooltipBox
                  title={`Room ${r.roomNo}`}
                  rows={[
                    { label: 'Utilization', value: `${r.pct}%`, color: s.present },
                    { label: 'Seats allocated', value: String(r.allocated) },
                    { label: 'Seats offered', value: `${r.offered} (${r.bookings} booking${r.bookings > 1 ? 's' : ''} × ${r.capacity})` },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="pct" fill="url(#util-present)" radius={[0, 5, 5, 0]} barSize={14} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type AttRow = AdminDashboardData['charts']['attendanceByExam'][number];

export function AttendanceCompletionChart({ data }: { data: AttRow[] }) {
  const s = useSeries();
  const axisProps = axisPropsOf(s);
  if (data.length === 0) return <p className="py-10 text-center text-[13px] text-faint">No published examinations in the selected scope.</p>;
  return (
    <div className="space-y-3">
      <ChartLegend
        items={[
          { label: 'Present', color: s.present },
          { label: 'Absent', color: s.absent },
          { label: 'Unmarked', color: s.neutral },
        ]}
      />
      <div style={{ height: Math.max(150, data.length * 40 + 30) }} role="img" aria-label="Attendance marking progress per examination">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, bottom: 4, left: 4 }} barCategoryGap={10}>
            <defs>{seriesGradients('att', s)}</defs>
            <CartesianGrid horizontal={false} stroke={s.grid} />
            <XAxis type="number" allowDecimals={false} {...axisProps} />
            <YAxis type="category" dataKey="label" width={56} {...axisProps} tick={{ fill: s.tick, fontSize: 12 }} />
            <Tooltip
              cursor={{ fill: s.cursor }}
              content={({ active, payload }: TooltipProps<number, string>) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as AttRow;
                const marked = r.present + r.absent;
                return (
                  <TooltipBox
                    title={`${r.label} · ${r.name}`}
                    rows={[
                      { label: 'Present', value: String(r.present), color: s.present },
                      { label: 'Absent', value: String(r.absent), color: s.absent },
                      { label: 'Unmarked', value: String(r.unmarked), color: s.neutral },
                      { label: 'Completion', value: r.allocated ? fmtPct(marked / r.allocated) : '—' },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="present" stackId="a" fill="url(#att-present)" stroke={s.surface} strokeWidth={2} barSize={16} isAnimationActive={false} />
            <Bar dataKey="absent" stackId="a" fill="url(#att-absent)" stroke={s.surface} strokeWidth={2} barSize={16} isAnimationActive={false} />
            <Bar
              dataKey="unmarked"
              stackId="a"
              fill="url(#att-neutral)"
              stroke={s.surface}
              strokeWidth={2}
              radius={[0, 5, 5, 0]}
              barSize={16}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Compact segmented meter (present / absent / unmarked) for table rows. */
export function AttendanceMeter({ present, absent, allocated }: { present: number; absent: number; allocated: number }) {
  const s = useSeries();
  if (allocated === 0) return <div className="h-1.5 w-full rounded-full bg-line/60" />;
  const p = (present / allocated) * 100;
  const a = (absent / allocated) * 100;
  return (
    <div
      className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full shadow-[inset_0_1px_2px_rgb(1_14_10/0.25)]"
      style={{ background: s.neutral }}
      title={`${present} present · ${absent} absent · ${allocated - present - absent} unmarked`}
    >
      {p > 0 && <div className="transition-[width] duration-700" style={{ width: `${p}%`, background: `linear-gradient(90deg, ${s.present}, ${s.presentLit})` }} />}
      {a > 0 && <div className="transition-[width] duration-700" style={{ width: `${a}%`, background: `linear-gradient(90deg, ${s.absent}, ${s.absentLit})` }} />}
    </div>
  );
}
