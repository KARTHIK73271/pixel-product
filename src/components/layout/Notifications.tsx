import * as P from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { Bell, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { Severity } from '@/lib/types';
import { Button } from '../ui/button';
import { SeverityIcon, Skeleton } from '../ui/feedback';

interface Notice {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  href: string;
}

/** Notifications are derived live from operational state (alerts, duties, published seats). */
export function Notifications() {
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: Notice[] }>('/notifications'),
    refetchInterval: 60_000,
  });
  const items = data?.items ?? [];
  const urgent = items.filter((i) => i.severity === 'critical').length;
  return (
    <P.Root>
      <P.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications (${items.length})`} className="relative">
          <Bell className="h-4 w-4" />
          {items.length > 0 && (
            <span
              className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ring-2 ring-canvas ${urgent ? 'bg-bad shadow-[0_0_10px_rgb(var(--bad)/0.8)]' : 'bg-accent shadow-[0_0_10px_rgb(var(--accent)/0.8)]'}`}
            >
              {items.length > 9 ? '9+' : items.length}
            </span>
          )}
        </Button>
      </P.Trigger>
      <P.Portal>
        <P.Content
          align="end"
          sideOffset={8}
          className="glass edge-light relative z-50 w-[380px] max-w-[calc(100vw-1rem)] animate-fade-in overflow-hidden rounded-2xl shadow-pop"
        >
          <div className="flex items-center justify-between border-b border-line/80 px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <span className="text-xs text-muted">{urgent ? `${urgent} need attention` : 'Live from current data'}</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1.5">
            {isLoading && (
              <div className="space-y-3 p-3">
                <Skeleton className="w-3/4" />
                <Skeleton className="w-1/2" />
              </div>
            )}
            {!isLoading && items.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <CheckCircle2 className="h-6 w-6 text-ok" />
                <p className="text-[13px] text-muted">You’re all caught up.</p>
              </div>
            )}
            {items.map((n) => (
              <P.Close asChild key={n.id}>
                <Link
                  to={n.href}
                  className="flex gap-2.5 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-raised hover:shadow-[inset_2px_0_0_0_rgb(var(--accent)/0.7)]"
                >
                  <SeverityIcon severity={n.severity} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{n.title}</span>
                    <span className="block text-xs text-muted">{n.detail}</span>
                  </span>
                </Link>
              </P.Close>
            ))}
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
