import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

export type LiveStatus = 'connecting' | 'live' | 'offline';

/**
 * Subscribes to the server's change feed and refetches active queries when any record changes.
 * Events contain no data — the refetch goes through the normal authorized API.
 */
export function useRealtime(enabled: boolean): LiveStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/events');
    es.onopen = () => setStatus('live');
    es.onerror = () => setStatus(es.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
    es.addEventListener('change', () => {
      // debounce bursts (e.g. a batch of marks) into one refetch
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
      }, 250);
    });
    return () => {
      window.clearTimeout(timer.current);
      es.close();
    };
  }, [enabled, qc]);

  return status;
}
