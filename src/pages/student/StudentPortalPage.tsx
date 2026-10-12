import { useQuery } from '@tanstack/react-query';
import { Armchair, CalendarClock, Clock, DoorOpen, History, MapPin } from 'lucide-react';
import { EXAM_TYPE_LABEL, type ExamType } from '@shared/schemas';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { AttendancePill, Badge } from '@/components/ui/badges';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { fmtDate, relativeDay, sessionLabel } from '@/lib/utils';

interface PortalExam {
  examId: string;
  examName: string;
  examType: ExamType;
  examDate: string;
  session: string;
  startTime: string;
  durationMinutes: number;
  courseCode: string;
  courseName: string;
  credits: number;
  roomNo: string | null;
  block: string | null;
  floor: number | null;
  seatNo: number | null;
  attendance: 'PRESENT' | 'ABSENT' | null;
}
interface Portal {
  profile: { rollNo: string; fullName: string; email: string | null; year: number; section: string; departmentCode: string; departmentName: string } | null;
  upcoming: PortalExam[];
  history: PortalExam[];
}

export function StudentPortalPage() {
  useBreadcrumbs([{ label: 'My examinations' }]);
  const q = useQuery({ queryKey: ['student', 'portal'], queryFn: () => api.get<Portal>('/student/portal') });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  const { profile, upcoming, history } = q.data;
  if (!profile) return <EmptyState title="No student record linked" description="Contact the examination section to link your account." />;
  const next = upcoming[0];
  return (
    <div>
      <PageHeader
        title={profile.fullName}
        description={`${profile.rollNo} · ${profile.departmentName} · Year ${profile.year}, Section ${profile.section}`}
      />

      {next && next.roomNo && (
        <Card className="mb-5 overflow-hidden border-accent/30">
          <div className="grid gap-0 md:grid-cols-[1.4fr_1fr]">
            <div className="p-5">
              <Badge tone="accent">Next examination · {relativeDay(next.examDate)}</Badge>
              <h2 className="mt-3 text-lg font-semibold">
                {next.courseCode} — {next.courseName}
              </h2>
              <p className="text-[13px] text-muted">{next.examName}</p>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
                <span className="flex items-center gap-1.5">
                  <CalendarClock className="h-4 w-4 text-faint" /> {fmtDate(next.examDate, 'EEEE, dd MMM yyyy')}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-faint" /> {sessionLabel(next.session)} · {next.startTime} · {next.durationMinutes} min
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 border-t border-line bg-raised/40 md:border-l md:border-t-0">
              <div className="flex flex-col items-center justify-center p-5">
                <p className="text-2xs uppercase tracking-wider text-faint">Room</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight">{next.roomNo}</p>
                <p className="mt-1 text-center text-xs text-muted">
                  {next.block}
                  {next.floor !== null ? ` · Floor ${next.floor}` : ''}
                </p>
              </div>
              <div className="flex flex-col items-center justify-center border-l border-line p-5">
                <p className="text-2xs uppercase tracking-wider text-faint">Seat</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-accent">{next.seatNo}</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card className="mb-5">
        <CardHeader title="Published timetable" description="Only schedules published by the examination section are shown here." />
        {upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No published allocations yet"
            description="When the examination section publishes your room and seat, they will appear here."
          />
        ) : (
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {upcoming.map((e) => (
              <div key={e.examId} className="rounded-lg border border-line bg-canvas/40 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold">
                      {e.courseCode} · {e.courseName}
                    </p>
                    <p className="text-xs text-muted">
                      {EXAM_TYPE_LABEL[e.examType]} · {e.credits} credits
                    </p>
                  </div>
                  <Badge>{relativeDay(e.examDate)}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <span className="flex items-center gap-1.5 text-muted">
                    <CalendarClock className="h-3.5 w-3.5" /> {fmtDate(e.examDate, 'EEE dd MMM')}
                  </span>
                  <span className="flex items-center gap-1.5 text-muted">
                    <Clock className="h-3.5 w-3.5" /> {e.session} · {e.startTime}
                  </span>
                  {e.roomNo ? (
                    <>
                      <span className="flex items-center gap-1.5 text-ink">
                        <DoorOpen className="h-3.5 w-3.5 text-faint" /> Room {e.roomNo}
                      </span>
                      <span className="flex items-center gap-1.5 text-ink">
                        <Armchair className="h-3.5 w-3.5 text-faint" /> Seat {e.seatNo}
                      </span>
                      <span className="col-span-2 flex items-center gap-1.5 text-muted">
                        <MapPin className="h-3.5 w-3.5" /> {e.block}
                      </span>
                    </>
                  ) : (
                    <span className="col-span-2 text-warn">Seat pending — contact the examination section.</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Examination history" />
        {history.length === 0 ? (
          <EmptyState icon={History} title="No past examinations" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Course</TH>
                <TH>Date</TH>
                <TH>Room · Seat</TH>
                <TH>Attendance</TH>
              </tr>
            </THead>
            <TBody>
              {history.map((e) => (
                <TR key={e.examId}>
                  <TD>
                    <p className="font-medium">{e.courseCode}</p>
                    <p className="text-xs text-muted">{e.courseName}</p>
                  </TD>
                  <TD>
                    {fmtDate(e.examDate)} · {e.session}
                  </TD>
                  <TD>{e.roomNo ? `${e.roomNo} · ${e.seatNo}` : '—'}</TD>
                  <TD>{e.attendance ? <AttendancePill status={e.attendance} /> : <span className="text-xs text-faint">Not finalized</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
