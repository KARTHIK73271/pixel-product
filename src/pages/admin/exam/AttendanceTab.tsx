import { ClipboardCheck, FileText, Printer, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AttendanceMeter } from '@/components/charts';
import { SubmissionBadge } from '@/components/ui/badges';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { ExamDetail, ExamRoom } from '@/lib/types';
import { fmtDateTime, todayLocalIso } from '@/lib/utils';
import { ReopenDialog } from '@/pages/shared/ReopenDialog';

export function ExamAttendanceTab({ detail }: { detail: ExamDetail }) {
  const { exam, rooms } = detail;
  const [reopen, setReopen] = useState<ExamRoom | null>(null);
  const occupied = rooms.filter((r) => r.allocated > 0);
  const overdue = exam.examDate < todayLocalIso();
  if (exam.status !== 'PUBLISHED')
    return (
      <Card>
        <EmptyState icon={ClipboardCheck} title="Attendance opens after publication" description="Publish the seating plan so in-charges can record attendance for their rooms." />
      </Card>
    );
  const totals = occupied.reduce((t, r) => ({ a: t.a + r.allocated, p: t.p + r.present, b: t.b + r.absent }), { a: 0, p: 0, b: 0 });
  return (
    <Card>
      <CardHeader
        title="Room-wise attendance"
        description={`${totals.p} present · ${totals.b} absent · ${totals.a - totals.p - totals.b} unmarked of ${totals.a} · ${exam.finalizedRooms}/${occupied.length} rooms finalized`}
        action={
          <LinkButton size="sm" to={`/print/absentees/${exam.id}`} target="_blank">
            <FileText className="h-3.5 w-3.5" /> Consolidated absentee report
          </LinkButton>
        }
      />
      <Table>
        <THead>
          <tr>
            <TH>Room</TH>
            <TH>In-charge</TH>
            <TH className="w-56">Progress</TH>
            <TH>Submission</TH>
            <TH className="text-right">Actions</TH>
          </tr>
        </THead>
        <TBody>
          {occupied.map((r) => (
            <TR key={r.id}>
              <TD>
                <Link to={`/attendance/${exam.id}/${r.id}`} className="font-medium hover:text-accent">
                  {r.roomNo}
                </Link>
              </TD>
              <TD className={r.inchargeName ? '' : 'text-bad'}>{r.inchargeName ?? 'Unassigned'}</TD>
              <TD>
                <AttendanceMeter present={r.present} absent={r.absent} allocated={r.allocated} />
                <p className="tnum mt-1 text-2xs text-faint">
                  {r.present} P · {r.absent} A · {r.allocated - r.marked} unmarked
                </p>
              </TD>
              <TD>
                <SubmissionBadge status={r.submissionStatus} overdue={overdue && r.submissionStatus !== 'FINALIZED'} />
                {r.finalizedAt && <p className="mt-1 text-2xs text-faint">{fmtDateTime(r.finalizedAt)}</p>}
                {!!r.reopenedCount && <p className="mt-1 text-2xs text-warn">Reopened {r.reopenedCount}×</p>}
              </TD>
              <TD>
                <div className="flex justify-end gap-1.5">
                  <LinkButton size="sm" variant="ghost" to={`/print/attendance/${exam.id}/${r.id}`} target="_blank">
                    <Printer className="h-3.5 w-3.5" /> Sheet
                  </LinkButton>
                  <LinkButton size="sm" variant="ghost" to={`/attendance/${exam.id}/${r.id}`}>
                    <ClipboardCheck className="h-3.5 w-3.5" /> Open
                  </LinkButton>
                  {r.submissionStatus === 'FINALIZED' && (
                    <Button size="sm" variant="ghost" onClick={() => setReopen(r)}>
                      <RotateCcw className="h-3.5 w-3.5" /> Reopen
                    </Button>
                  )}
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <ReopenDialog examId={exam.id} room={reopen ? { id: reopen.id, roomNo: reopen.roomNo } : null} onClose={() => setReopen(null)} />
    </Card>
  );
}
