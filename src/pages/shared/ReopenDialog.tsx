import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Callout } from '@/components/ui/feedback';
import { Field, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { withToast } from '@/lib/forms';

/** Admin-only: reopening finalized attendance requires a recorded reason and is audited. */
export function ReopenDialog({ examId, room, onClose }: { examId: string; room: { id: string; roomNo: string } | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const tooShort = reason.trim().length < 10;
  return (
    <Dialog
      open={!!room}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          setReason('');
        }
      }}
      size="sm"
      title={`Reopen attendance for ${room?.roomNo ?? ''}?`}
      description="The in-charge will be able to correct marks and must submit again."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={tooShort}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await withToast(() => api.post(`/attendance/${examId}/${room!.id}/reopen`, { reason: reason.trim() }), 'Attendance reopened');
                setReason('');
                onClose();
              } catch {
                /* toast */
              } finally {
                setBusy(false);
              }
            }}
          >
            Reopen attendance
          </Button>
        </>
      }
    >
      <Callout tone="warning" className="mb-4">
        This action is recorded in the audit timeline with your name and reason.
      </Callout>
      <Field label="Reason for reopening" hint="At least 10 characters" error={reason && tooShort ? 'Please describe the reason (min 10 characters)' : undefined}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Student 23CSE004 was marked absent but signed the attendance sheet" />
      </Field>
    </Dialog>
  );
}
