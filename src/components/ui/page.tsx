import * as RT from '@radix-ui/react-tabs';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  meta,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="rise mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="display text-[26px] leading-tight text-ink sm:text-[30px]">{title}</h1>
        {/* a short gradient rule under the title ties the page to the accent */}
        <span aria-hidden className="mt-2.5 block h-px w-24 bg-gradient-to-r from-accent via-accent-2 to-transparent" />
        {description && <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-muted">{description}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const tileTone = {
  neutral: { chip: 'from-raised to-surface text-faint', rule: 'from-line-strong', ring: 'border-line/90' },
  accent: { chip: 'from-accent/25 to-accent-2/10 text-accent', rule: 'from-accent', ring: 'border-accent/25' },
  ok: { chip: 'from-ok/20 to-ok/5 text-ok', rule: 'from-ok', ring: 'border-ok/25' },
  warn: { chip: 'from-warn/20 to-warn/5 text-warn', rule: 'from-warn', ring: 'border-warn/30' },
  bad: { chip: 'from-bad/20 to-bad/5 text-bad', rule: 'from-bad', ring: 'border-bad/35' },
} as const;

/** Stat tile: a hero number with a defined calculation shown on hover/focus. */
export function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'neutral',
  definition,
  children,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
  tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent';
  definition?: string;
  children?: ReactNode;
}) {
  const t = tileTone[tone];
  return (
    <div
      className={cn('glass lift group relative overflow-hidden rounded-2xl p-4', t.ring)}
      title={definition}
      tabIndex={definition ? 0 : undefined}
    >
      {/* tone rule along the top edge */}
      <span aria-hidden className={cn('absolute inset-x-0 top-0 h-px bg-gradient-to-r to-transparent', t.rule)} />
      {/* a soft light follows the icon corner on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-accent/10 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
      />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">{label}</p>
        {Icon && (
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-gradient-to-br shadow-inset',
              t.chip,
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <p className="tnum mt-3 text-[28px] font-semibold leading-none tracking-tight text-ink">{value}</p>
      {sub && <p className="mt-2 text-xs leading-relaxed text-muted">{sub}</p>}
      {children}
    </div>
  );
}

export function Tabs({
  value,
  onValueChange,
  tabs,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  tabs: { value: string; label: string; count?: number | string }[];
  children: ReactNode;
}) {
  return (
    <RT.Root value={value} onValueChange={onValueChange}>
      <RT.List
        className="glass mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-xl p-1"
        aria-label="Sections"
      >
        {tabs.map((t) => (
          <RT.Trigger
            key={t.value}
            value={t.value}
            className={cn(
              'relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted',
              'transition-all duration-300 hover:text-ink',
              'data-[state=active]:bg-raised data-[state=active]:text-ink',
              'data-[state=active]:shadow-[0_1px_0_0_rgb(255_255_255/0.07)_inset,0_6px_18px_-10px_rgb(var(--accent)/0.8)]',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="tnum rounded-md bg-canvas/70 px-1.5 text-2xs text-muted">{t.count}</span>
            )}
          </RT.Trigger>
        ))}
      </RT.List>
      {children}
    </RT.Root>
  );
}
export const TabPanel = RT.Content;
