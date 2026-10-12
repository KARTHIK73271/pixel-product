import { useQuery } from '@tanstack/react-query';
import { FileBarChart2, FileText, Hourglass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { Badge, SubmissionBadge } from '@/components/ui/badges';
import { LinkButton } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page';
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtPct, sessionLabel } from '@/lib/utils';

interface ReportRow {
  id: string;
  name: string;
  examDate: string;
  session: string;
  courseCode: string;
  allocated: number;
  present: number;
  absent: number;
  unmarked: number;
  occupiedRooms: number;
  finalizedRooms: number;
  reportStatus: 'FINAL' | 'PROVISIONAL';
}
interface DeptRow {
  departmentCode: string;
  departmentName: string;
  eligible: number;
  allocated: number;
  present: number;
  absent: number;
  unmarked: number;
  absenteeRate: number | null;
}
interface PendingRow {
  examId: string;
  examName: string;
  examDate: string;
  session: string;
  courseCode: string;
  roomId: string;
  roomNo: string;
  inchargeName: string | null;
  allocated: number;
  marked: number;
  submissionStatus: 'NOT_STARTED' | 'IN_PROGRESS';
  overdue: boolean;
}

export function ReportsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  useBreadcrumbs([{ label: isAdmin ? 'Reports' : 'Absentee reports' }]);
  const index = useQuery({ queryKey: ['reports'], queryFn: () => api.get<ReportRow[]>('/reports') });
  const depts = useQuery({ queryKey: ['reports', 'departments'], queryFn: () => api.get<DeptRow[]>('/reports/departments'), enabled: isAdmin });
  const pending = useQuery({ queryKey: ['reports', 'pending'], queryFn: () => api.get<PendingRow[]>('/reports/pending'), enabled: isAdmin });

  return (
    <div>
      <PageHeader
        title={isAdmin ? 'Reports' : 'Absentee reports'}
        description={
          isAdmin
            ? 'Absentee statements, department statistics and pending submissions — all derived live from attendance records.'
            : 'Statements for the rooms you supervise. Figures come straight from the recorded attendance.'
        }
      />
      <div className="space-y-5">
        <Card>
          <CardHeader title="Absentee statements" description="One click generates a print-ready statement. Provisional until every room is finalized." />
          {index.isError ? (
            <ErrorState error={index.error} onRetry={() => index.refetch()} />
          ) : !index.data ? (
            <TableSkeleton rows={4} />
          ) : index.data.length === 0 ? (
            <EmptyState icon={FileBarChart2} title="No published examinations yet" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Examination</TH>
                  <TH>Date</TH>
                  <TH className="text-right">Seated</TH>
                  <TH className="text-right">Present</TH>
                  <TH className="text-right">Absent</TH>
                  <TH className="text-right">Unmarked</TH>
                  <TH>Rooms final</TH>
                  <TH>Report</TH>
                  <TH className="text-right" />
                </tr>
              </THead>
              <TBody>
                {index.data.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <p className="font-medium">{r.courseCode}</p>
                      <p className="max-w-[280px] truncate text-xs text-muted">{r.name}</p>
                    </TD>
                    <TD>
                      {fmtDate(r.examDate)} <span className="text-xs text-muted">· {sessionLabel(r.session)}</span>
                    </TD>
                    <TD className="tnum text-right">{r.allocated}</TD>
                    <TD className="tnum text-right">{r.present}</TD>
                    <TD className="tnum text-right">{r.absent}</TD>
                    <TD className={`tnum text-right ${r.unmarked ? 'text-warn' : ''}`}>{r.unmarked}</TD>
                    <TD className="tnum">
                      {r.finalizedRooms}/{r.occupiedRooms}
                    </TD>
                    <TD>{r.reportStatus === 'FINAL' ? <Badge tone="ok">Final</Badge> : <Badge tone="warn">Provisional</Badge>}</TD>
                    <TD className="text-right">
                      <LinkButton size="sm" variant="subtle" to={`/print/absentees/${r.id}`} target="_blank">
                        <FileText className="h-3.5 w-3.5" /> Generate
                      </LinkButton>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {isAdmin && (
          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader title="Department-wise statistics" description="Published examinations · absentee rate = absent ÷ marked" />
              {!depts.data ? (
                <TableSkeleton rows={3} />
              ) : depts.data.length === 0 ? (
                <EmptyState title="No data yet" />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <TH>Department</TH>
                      <TH className="text-right">Seated</TH>
                      <TH className="text-right">Present</TH>
                      <TH className="text-right">Absent</TH>
                      <TH className="text-right">Unmarked</TH>
                      <TH className="text-right">Absentee rate</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {depts.data.map((d) => (
                      <TR key={d.departmentCode}>
                        <TD title={d.departmentName} className="font-medium">
                          {d.departmentCode}
                        </TD>
                        <TD className="tnum text-right">{d.allocated}</TD>
                        <TD className="tnum text-right">{d.present}</TD>
                        <TD className="tnum text-right">{d.absent}</TD>
                        <TD className="tnum text-right">{d.unmarked}</TD>
                        <TD className="tnum text-right">{d.absenteeRate === null ? '—' : fmtPct(d.absenteeRate, 1)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
            <Card>
              <CardHeader title="Pending attendance submissions" description="Occupied rooms of published examinations not yet finalized" />
              {!pending.data ? (
                <TableSkeleton rows={3} />
              ) : pending.data.length === 0 ? (
                <EmptyState icon={Hourglass} title="Nothing pending" />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <TH>Exam · Room</TH>
                      <TH>In-charge</TH>
                      <TH className="text-right">Marked</TH>
                      <TH>Status</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {pending.data.map((p) => (
                      <TR key={`${p.examId}${p.roomId}`}>
                        <TD>
                          <Link to={`/attendance/${p.examId}/${p.roomId}`} className="font-medium hover:text-accent">
                            {p.courseCode} · {p.roomNo}
                          </Link>
                          <p className="text-xs text-muted">
                            {fmtDate(p.examDate)} · {p.session}
                          </p>
                        </TD>
                        <TD className={p.inchargeName ? '' : 'text-bad'}>{p.inchargeName ?? 'Unassigned'}</TD>
                        <TD className="tnum text-right">
                          {p.marked}/{p.allocated}
                        </TD>
                        <TD>
                          <SubmissionBadge status={p.submissionStatus} overdue={p.overdue} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
