import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Frosted panel. `featured` adds the rotating light behind the border for the
 * one or two panels a page actually wants to lead with — not for every card.
 */
export function Card({
  className,
  featured,
  flat,
  ...p
}: HTMLAttributes<HTMLDivElement> & { featured?: boolean; flat?: boolean }) {
  return (
    <div
      className={cn('glass edge-light relative rounded-2xl', !flat && 'card-hover', featured && 'halo', className)}
      {...p}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative flex items-start justify-between gap-3 border-b border-line/80 px-4 py-3.5',
        className,
      )}
    >
      {/* a short accent rule marks the start of the panel's content */}
      <span
        aria-hidden
        className="absolute bottom-[-1px] left-4 h-px w-12 bg-gradient-to-r from-accent to-cyan/0"
      />
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...p} />;
}
