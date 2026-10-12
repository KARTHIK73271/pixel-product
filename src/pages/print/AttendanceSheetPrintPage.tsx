import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { EXAM_TYPE_LABEL } from '@shared/schemas';
import { ErrorState, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import type { RoomSheet } from '@/lib/types';
import { fmtDate, fmtDateTime, sessionLabel } from '@/lib/utils';
import { Meta, PrintFrame, SheetHeader } from './PrintFrame';

export function AttendanceSheetPrintPage() {
  const { examId, roomId } = useParams<{ examId: string; roomId: string }>();
  const q = useQuery({ queryKey: ['sheet', examId, roomId], queryFn: () => api.get<RoomSheet>(`/attendance/${examId}/${roomId}`) });
  const s = q.data;
  return (
    <PrintFrame title={s ? `Attendance sheet — ${s.courseCode} ${s.roomNo}` : 'Attendance sheet'} ready={!!s}>
      {q.isError ? (
        <ErrorState error={q.error} />
      ) : !s ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : (
        <>
          <SheetHeader
            title="Examination Attendance Sheet"
            subtitle={`${s.examName} · ${EXAM_TYPE_LABEL[s.examType]}`}
            right={
              <div className="text-right text-[12px]">
                <p className="text-2xl font-bold leading-none">{s.roomNo}</p>
                <p className="text-[#444]">{s.block}</p>
              </div>
            }
          />
          <Meta
            items={[
              { k: 'Course', v: `${s.courseCode} — ${s.courseName}` },
              { k: 'Date', v: fmtDate(s.examDate, 'EEEE, dd MMM yyyy') },
              { k: 'Session', v: `${sessionLabel(s.session)} · ${s.startTime} (${s.durationMinutes} min)` },
              { k: 'Department', v: s.departmentName ?? 'Multiple' },
              { k: 'Year / Section', v: `${s.year} / ${s.examSection ?? 'All'}` },
              { k: 'Room capacity', v: s.capacity },
              { k: 'Candidates', v: s.counts.allocated },
              { k: 'In-charge', v: s.inchargeName ?? '—' },
              { k: 'Status', v: s.submissionStatus === 'FINALIZED' ? `Finalized ${fmtDateTime(s.finalizedAt)}` : 'Not finalized' },
            ]}
          />
          <table>
            <thead>
              <tr>
                <th style={{ width: '6%' }}>S.No</th>
                <th style={{ width: '13%' }}>Roll No.</th>
                <th>Student name</th>
                <th style={{ width: '9%' }}>Dept</th>
                <th style={{ width: '6%' }}>Sec</th>
                <th style={{ width: '7%' }}>Seat</th>
                <th style={{ width: '11%' }}>Attendance</th>
                <th style={{ width: '18%' }}>Signature</th>
              </tr>
            </thead>
            <tbody>
              {s.students.map((st, i) => (
                <tr key={st.allocationId}>
                  <td className="text-center">{i + 1}</td>
                  <td className="font-mono">{st.rollNo}</td>
                  <td>{st.fullName}</td>
                  <td>{st.departmentCode}</td>
                  <td className="text-center">{st.section}</td>
                  <td className="text-center font-semibold">{st.seatNo}</td>
                  <td className="text-center">{st.status === 'PRESENT' ? 'P' : st.status === 'ABSENT' ? 'AB' : ''}</td>
                  <td style={{ height: 26 }} />
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 grid grid-cols-3 gap-4 text-[12px]">
            <p>
              Present: <b>{s.counts.present || '______'}</b>
            </p>
            <p>
              Absent: <b>{s.counts.absent || '______'}</b>
            </p>
            <p>
              Total: <b>{s.counts.allocated}</b>
            </p>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-16 text-[12px]">
            <div className="border-t border-[#111] pt-1">Signature of Room In-Charge</div>
            <div className="border-t border-[#111] pt-1">Signature of Chief Superintendent</div>
          </div>
          <p className="mt-6 text-[10px] text-[#666]">Generated {fmtDateTime(new Date().toISOString())} · Smart Examination Section</p>
        </>
      )}
    </PrintFrame>
  );
}
