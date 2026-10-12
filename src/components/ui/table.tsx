import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Skeleton } from './feedback';

export function Table({ className, ...p }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-[13px]', className)} {...p} />
    </div>
  );
}
export function THead({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn('border-b border-line bg-gradient-to-b from-raised/70 to-raised/20', className)}
      {...p}
    />
  );
}
export function TBody({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-line/60', className)} {...p} />;
}
/** Hovering a row lights a 2px accent edge on its leading side. */
export function TR({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'transition-colors duration-200 hover:bg-raised/50',
        'hover:shadow-[inset_2px_0_0_0_rgb(var(--accent)/0.8)]',
        className,
      )}
      {...p}
    />
  );
}
export function TH({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'h-10 whitespace-nowrap px-3 text-left text-2xs font-semibold uppercase tracking-[0.1em] text-faint',
        className,
      )}
      {...p}
    />
  );
}
export function TD({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2.5 align-middle text-ink/90', className)} {...p} />;
}

export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: K;
  sort: { key: K; dir: 'asc' | 'desc' };
  onSort: (s: { key: K; dir: 'asc' | 'desc' }) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <TH className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        className={cn(
          'inline-flex items-center gap-1 rounded uppercase tracking-[0.1em] transition-colors hover:text-ink',
          active && 'text-accent',
        )}
        onClick={() => onSort({ key: sortKey, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' })}
      >
        {label}
        {active && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </TH>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }, (_, j) => (
            <Skeleton key={j} className={cn('h-4', j === 0 ? 'w-1/4' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between border-t border-line/80 px-4 py-2.5 text-xs text-muted">
      <span className="tnum">
        <span className="text-ink">
          {from}–{to}
        </span>{' '}
        of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="tnum rounded-md border border-line bg-canvas/60 px-2 py-0.5 text-ink">
          {page} <span className="text-faint">/ {pages}</span>
        </span>
        <Button size="icon" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function KeyValue({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3', className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0 border-l border-line/80 pl-3">
          <dt className="text-2xs uppercase tracking-[0.1em] text-faint">{it.label}</dt>
          <dd className="mt-1 truncate text-[13px] font-medium text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
