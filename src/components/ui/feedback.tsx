import { AlertCircle, AlertTriangle, CheckCircle2, Info, Inbox, Loader2, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Severity } from '@/lib/types';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/api';
import { Button } from './button';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4', className)} aria-hidden />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-accent', className)} />;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="relative mb-4">
        {/* a dim halo so the empty panel still feels designed */}
        <span aria-hidden className="absolute inset-0 -z-10 rounded-full bg-accent/15 blur-xl" />
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-gradient-to-br from-raised to-surface shadow-inset">
          <Icon className="h-5 w-5 text-faint" />
        </div>
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="relative mb-3">
        <span aria-hidden className="absolute inset-0 -z-10 rounded-full bg-bad/20 blur-xl" />
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-bad/30 bg-bad/10">
          <AlertCircle className="h-5 w-5 text-bad" />
        </div>
      </div>
      <p className="text-sm font-medium">Couldn’t load this data</p>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button size="sm" className="mt-5" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}

const calloutStyles: Record<Severity | 'success', { icon: LucideIcon; cls: string }> = {
  critical: { icon: AlertCircle, cls: 'border-bad/30 bg-bad/[0.07] text-bad' },
  warning: { icon: AlertTriangle, cls: 'border-warn/30 bg-warn/[0.07] text-warn' },
  info: { icon: Info, cls: 'border-accent/30 bg-accent/[0.07] text-accent' },
  success: { icon: CheckCircle2, cls: 'border-ok/30 bg-ok/[0.07] text-ok' },
};

export function Callout({ tone = 'info', title, children, className }: { tone?: Severity | 'success'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const { icon: Icon, cls } = calloutStyles[tone];
  return (
    <div
      className={cn('relative flex gap-2.5 overflow-hidden rounded-xl border px-3.5 py-3 text-[13px]', cls, className)}
      role={tone === 'critical' ? 'alert' : undefined}
    >
      {/* a solid bar on the leading edge carries the severity even without colour */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-current opacity-70" />
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 text-ink/90">
        {title && <p className="font-medium text-ink">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-muted')}>{children}</div>}
      </div>
    </div>
  );
}

export function SeverityIcon({ severity, className }: { severity: Severity; className?: string }) {
  const { icon: Icon, cls } = calloutStyles[severity];
  return <Icon className={cn('h-4 w-4 shrink-0', cls.split(' ').find((c) => c.startsWith('text-')), className)} aria-label={severity} />;
}

export function Progress({ value, className, tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'ok' | 'warn' | 'bad' }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color = {
    accent: 'bg-gradient-to-r from-accent to-accent-2',
    ok: 'bg-gradient-to-r from-ok to-cyan',
    warn: 'bg-gradient-to-r from-warn to-brass',
    bad: 'bg-gradient-to-r from-bad to-warn',
  }[tone];
  const glow = { accent: 'rgb(var(--accent)/0.65)', ok: 'rgb(var(--ok)/0.6)', warn: 'rgb(var(--warn)/0.6)', bad: 'rgb(var(--bad)/0.6)' }[tone];
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-canvas/80 shadow-[inset_0_1px_2px_rgb(1_14_10/0.6)]', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-700 ease-out', color)}
        style={{ width: `${pct}%`, boxShadow: `0 0 10px ${glow}` }}
      />
    </div>
  );
}
