import { ClipboardCheck, Printer } from 'lucide-react';
import { AttendanceMeter } from '@/components/charts';
import { Badge, SubmissionBadge } from '@/components/ui/badges';
import { LinkButton } from '@/components/ui/button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { Duty } from '@/lib/types';
import { fmtDate, relativeDay, sessionLabel } from '@/lib/utils';

export function DutyTable({ duties, showIncharge }: { duties: Duty[]; showIncharge?: boolean }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Date</TH>
          <TH>Examination</TH>
          <TH>Room</TH>
          {showIncharge && <TH>In-charge</TH>}
          <TH className="w-52">Attendance</TH>
          <TH>Submission</TH>
          <TH className="text-right">Actions</TH>
        </tr>
      </THead>
      <TBody>
        {duties.map((d) => {
          const canMark = d.examStatus === 'PUBLISHED' && d.allocated > 0;
          return (
            <TR key={`${d.examId}${d.roomId}`}>
              <TD>
                <p className="font-medium">{relativeDay(d.examDate)}</p>
                <p className="text-xs text-muted">
                  {fmtDate(d.examDate, 'dd MMM')} · {sessionLabel(d.session)} {d.startTime}
                </p>
              </TD>
              <TD>
                <p className="font-medium">{d.courseCode}</p>
                <p className="max-w-[240px] truncate text-xs text-muted">{d.courseName}</p>
              </TD>
              <TD>
                <p className="font-medium">{d.roomNo}</p>
                <p className="text-xs text-muted">{d.allocated} students</p>
              </TD>
              {showIncharge && <TD className={d.inchargeName ? '' : 'text-bad'}>{d.inchargeName ?? 'Unassigned'}</TD>}
              <TD>
                {canMark ? (
                  <>
                    <AttendanceMeter present={d.present} absent={d.absent} allocated={d.allocated} />
                    <p className="tnum mt-1 text-2xs text-faint">
                      {d.present} P · {d.absent} A · {d.unmarked} unmarked
                    </p>
                  </>
                ) : (
                  <span className="text-xs text-faint">{d.examStatus === 'PUBLISHED' ? 'No students seated' : 'Seating not yet published'}</span>
                )}
              </TD>
              <TD>
                {d.examStatus === 'PUBLISHED' ? (
                  <SubmissionBadge status={d.submissionStatus} overdue={d.timing === 'PAST' && d.submissionStatus !== 'FINALIZED'} />
                ) : (
                  <Badge>Awaiting publication</Badge>
                )}
                {!!d.reopenedCount && d.submissionStatus !== 'FINALIZED' && <p className="mt-1 text-2xs text-warn">Reopened by admin</p>}
              </TD>
              <TD>
                <div className="flex justify-end gap-1.5">
                  {canMark && (
                    <LinkButton size="sm" variant="ghost" to={`/print/attendance/${d.examId}/${d.roomId}`} target="_blank">
                      <Printer className="h-3.5 w-3.5" /> Sheet
                    </LinkButton>
                  )}
                  {canMark ? (
                    <LinkButton size="sm" variant={d.submissionStatus === 'FINALIZED' ? 'ghost' : 'subtle'} to={`/attendance/${d.examId}/${d.roomId}`}>
                      <ClipboardCheck className="h-3.5 w-3.5" /> {d.submissionStatus === 'FINALIZED' ? 'View' : 'Mark'}
                    </LinkButton>
                  ) : (
                    <span className="px-2 text-xs text-faint" title="Attendance opens once the admin publishes the seating plan">
                      Locked
                    </span>
                  )}
                </div>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
