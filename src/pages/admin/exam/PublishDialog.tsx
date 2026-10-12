import { CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/form';
import { api } from '@/lib/api';
import { withToast } from '@/lib/forms';
import type { ExamDetail } from '@/lib/types';

/** Pre-publication checklist mirroring the server's publish rules. */
export function PublishDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (v: boolean) => void; detail: ExamDetail }) {
  const { exam, rooms } = detail;
  const [ack, setAck] = useState(false);
  const occupied = rooms.filter((r) => r.allocated > 0);
  const missing = occupied.filter((r) => !r.inchargeId);
  const unallocated = exam.eligibleCount - exam.allocatedCount;
  const checks = [
    { ok: exam.status === 'ALLOCATED', label: 'Seating allocation confirmed' },
    { ok: exam.allocatedCount > 0, label: `${exam.allocatedCount} students seated` },
    { ok: missing.length === 0, label: missing.length ? `In-charge missing for ${missing.map((r) => r.roomNo).join(', ')}` : 'Every occupied room has an in-charge' },
  ];
  const blocked = checks.some((c) => !c.ok);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setAck(false);
      }}
      title="Publish seating to students?"
      description="Students will immediately see their room, seat, date and session. In-charges can begin recording attendance."
      confirmLabel="Publish"
      confirmDisabled={blocked || (unallocated > 0 && !ack)}
      onConfirm={() => withToast(() => api.post(`/exams/${exam.id}/publish`, { acknowledgeUnallocated: ack }), 'Seating published to students')}
    >
      <ul className="space-y-2">
        {checks.map((c) => (
          <li key={c.label} className="flex items-center gap-2 text-[13px]">
            {c.ok ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <XCircle className="h-4 w-4 text-bad" />}
            <span className={c.ok ? 'text-ink' : 'text-bad'}>{c.label}</span>
          </li>
        ))}
      </ul>
      {unallocated > 0 && (
        <div className="mt-4 rounded-lg border border-warn/30 bg-warn/[0.06] p-3">
          <p className="text-[13px] text-warn">{unallocated} eligible student(s) have no seat and will see “seat pending”.</p>
          <div className="mt-2">
            <Checkbox checked={ack} onChange={setAck} label={<span className="text-xs text-muted">I understand and want to publish anyway</span>} />
          </div>
        </div>
      )}
    </ConfirmDialog>
  );
}
