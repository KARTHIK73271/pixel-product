import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import type { AdminDashboardData } from '@/lib/types';
import { fmtPct } from '@/lib/utils';

// Series colors validated for colour-vision-deficiency separation on the dark surface.
// The gradients below only lighten each hue along its own axis, so the identity of a
// series never depends on the gradient being perceived.
const C = {
  present: '#3987e5',
  presentLit: '#5ba6f5',
  absent: '#d95926',
  absentLit: '#ee7a44',
  neutral: '#3a4458',
  neutralLit: '#48546c',
  grid: '#1e2638',
  axis: '#7d879b',
  surface: 'rgb(14 19 33)',
};

const axisProps = { stroke: C.axis, fontSize: 11, tickLine: false, axisLine: false } as const;

/** One horizontal gradient per series, lit at the far end of the bar.
 *  `ns` keeps the gradient ids unique when two charts share a page. */
const seriesGradients = (ns: string) =>
  (
    [
      ['present', C.present, C.presentLit],
      ['absent', C.absent, C.absentLit],
      ['neutral', C.neutral, C.neutralLit],
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
  const rows = data.filter((r) => r.bookings > 0).map((r) => ({ ...r, pct: Math.round(r.utilization * 100) }));
  if (rows.length === 0) return <p className="py-10 text-center text-[13px] text-faint">No room bookings in the selected scope.</p>;
  return (
    <div style={{ height: Math.max(160, rows.length * 34 + 40) }} role="img" aria-label="Seat utilization per booked room">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }} barCategoryGap={8}>
          <defs>{seriesGradients('util')}</defs>
          <CartesianGrid horizontal={false} stroke={C.grid} />
          <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} {...axisProps} />
          <YAxis type="category" dataKey="roomNo" width={56} {...axisProps} tick={{ fill: '#c3cad8', fontSize: 12 }} />
          <ReferenceLine x={100} stroke={C.axis} strokeDasharray="3 3" />
          <Tooltip
            cursor={{ fill: 'rgb(255 255 255 / 0.04)' }}
            content={({ active, payload }: TooltipProps<number, string>) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as UtilRow & { pct: number };
              return (
                <TooltipBox
                  title={`Room ${r.roomNo}`}
                  rows={[
                    { label: 'Utilization', value: `${r.pct}%`, color: C.present },
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
  if (data.length === 0) return <p className="py-10 text-center text-[13px] text-faint">No published examinations in the selected scope.</p>;
  return (
    <div className="space-y-3">
      <ChartLegend
        items={[
          { label: 'Present', color: C.present },
          { label: 'Absent', color: C.absent },
          { label: 'Unmarked', color: C.neutral },
        ]}
      />
      <div style={{ height: Math.max(150, data.length * 40 + 30) }} role="img" aria-label="Attendance marking progress per examination">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, bottom: 4, left: 4 }} barCategoryGap={10}>
            <defs>{seriesGradients('att')}</defs>
            <CartesianGrid horizontal={false} stroke={C.grid} />
            <XAxis type="number" allowDecimals={false} {...axisProps} />
            <YAxis type="category" dataKey="label" width={56} {...axisProps} tick={{ fill: '#c3cad8', fontSize: 12 }} />
            <Tooltip
              cursor={{ fill: 'rgb(255 255 255 / 0.04)' }}
              content={({ active, payload }: TooltipProps<number, string>) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as AttRow;
                const marked = r.present + r.absent;
                return (
                  <TooltipBox
                    title={`${r.label} · ${r.name}`}
                    rows={[
                      { label: 'Present', value: String(r.present), color: C.present },
                      { label: 'Absent', value: String(r.absent), color: C.absent },
                      { label: 'Unmarked', value: String(r.unmarked), color: C.neutral },
                      { label: 'Completion', value: r.allocated ? fmtPct(marked / r.allocated) : '—' },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="present" stackId="a" fill="url(#att-present)" stroke={C.surface} strokeWidth={2} barSize={16} isAnimationActive={false} />
            <Bar dataKey="absent" stackId="a" fill="url(#att-absent)" stroke={C.surface} strokeWidth={2} barSize={16} isAnimationActive={false} />
            <Bar
              dataKey="unmarked"
              stackId="a"
              fill="url(#att-neutral)"
              stroke={C.surface}
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
  if (allocated === 0) return <div className="h-1.5 w-full rounded-full bg-line/60" />;
  const p = (present / allocated) * 100;
  const a = (absent / allocated) * 100;
  return (
    <div
      className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full bg-[#2b3344] shadow-[inset_0_1px_2px_rgb(2_4_10/0.6)]"
      title={`${present} present · ${absent} absent · ${allocated - present - absent} unmarked`}
    >
      {p > 0 && <div className="transition-[width] duration-700" style={{ width: `${p}%`, background: `linear-gradient(90deg, ${C.present}, ${C.presentLit})` }} />}
      {a > 0 && <div className="transition-[width] duration-700" style={{ width: `${a}%`, background: `linear-gradient(90deg, ${C.absent}, ${C.absentLit})` }} />}
    </div>
  );
}
