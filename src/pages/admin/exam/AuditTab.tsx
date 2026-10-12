import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import type { AuditItem, Paged } from '@/lib/types';
import { AuditTimeline } from '@/pages/shared/AuditTimeline';

export function ExamAuditTab({ examId }: { examId: string }) {
  const q = useQuery({ queryKey: ['audit', 'exam', examId], queryFn: () => api.get<Paged<AuditItem>>(`/audit?examId=${examId}&pageSize=100`) });
  return (
    <Card className="p-4">
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div className="space-y-3">
          <Skeleton className="w-2/3" />
          <Skeleton className="w-1/2" />
          <Skeleton className="w-3/5" />
        </div>
      ) : (
        <AuditTimeline items={q.data.items} showExam={false} />
      )}
    </Card>
  );
}
