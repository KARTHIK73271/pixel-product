import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { EXAM_TYPE_LABEL } from '@shared/schemas';
import { ErrorState, Spinner } from '@/components/ui/feedback';
import { api, qs } from '@/lib/api';
import type { AbsenteeReport } from '@/lib/types';
import { fmtDate, fmtDateTime, sessionLabel } from '@/lib/utils';
import { Meta, PrintFrame, SheetHeader } from './PrintFrame';

export function AbsenteePrintPage() {
  const { examId } = useParams<{ examId: string }>();
  const [params] = useSearchParams();
  const roomId = params.get('roomId') ?? undefined;
  const q = useQuery({
    queryKey: ['report', 'absentees', examId, roomId],
    queryFn: () => api.get<AbsenteeReport>(`/reports/absentees/${examId}${qs({ roomId })}`),
  });
  const r = q.data;
  const statusLabel = r?.reportStatus === 'FINAL' ? 'FINAL' : 'PROVISIONAL';
  return (
    <PrintFrame title={r ? `Absentee statement — ${r.exam.courseCode}` : 'Absentee statement'} ready={!!r}>
      {q.isError ? (
        <ErrorState error={q.error} />
      ) : !r ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : (
        <>
          <SheetHeader
            title={r.scope === 'ROOM' ? 'Room-wise Absentee Statement' : r.scope === 'EXAMINATION' ? 'Consolidated Absentee Statement' : 'Absentee Statement (assigned rooms)'}
            subtitle={`${r.exam.name} · ${EXAM_TYPE_LABEL[r.exam.examType]}`}
            right={
              <div className={`rounded border-2 px-3 py-1 text-[12px] font-bold ${statusLabel === 'FINAL' ? 'border-[#111]' : 'border-dashed border-[#888] text-[#555]'}`}>
                {statusLabel}
              </div>
            }
          />
          <Meta
            items={[
              { k: 'Course', v: `${r.exam.courseCode} — ${r.exam.courseName}` },
              { k: 'Date', v: fmtDate(r.exam.examDate, 'EEEE, dd MMM yyyy') },
              { k: 'Session', v: `${sessionLabel(r.exam.session)} · ${r.exam.startTime}` },
              { k: 'Department', v: r.exam.departmentName ?? 'Multiple' },
              { k: 'Rooms finalized', v: `${r.finalizedRooms} of ${r.occupiedRooms}` },
              { k: 'Generated', v: `${fmtDateTime(r.generatedAt)} by ${r.generatedBy}` },
            ]}
          />
          {r.reportStatus !== 'FINAL' && (
            <p className="mb-3 border border-dashed border-[#888] p-2 text-[11px] text-[#444]">
              Provisional: {r.occupiedRooms - r.finalizedRooms} room(s) have not finalized attendance; {r.totals.unmarked} candidate(s) are still unmarked and are
              not counted as absent.
            </p>
          )}

          <h2 className="mb-2 mt-4 text-[13px] font-bold">Summary by room</h2>
          <table>
            <thead>
              <tr>
                <th>Room</th>
                <th>In-charge</th>
                <th>Allocated</th>
                <th>Present</th>
                <th>Absent</th>
                <th>Unmarked</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {r.rooms
                .filter((x) => x.allocated > 0)
                .map((x) => (
                  <tr key={x.roomId}>
                    <td className="font-semibold">{x.roomNo}</td>
                    <td>{x.inchargeName ?? '—'}</td>
                    <td className="text-center">{x.allocated}</td>
                    <td className="text-center">{x.present}</td>
                    <td className="text-center">{x.absent}</td>
                    <td className="text-center">{x.unmarked}</td>
                    <td>{x.reportStatus === 'FINAL' ? `Final (${fmtDateTime(x.finalizedAt)})` : 'Provisional'}</td>
                  </tr>
                ))}
              <tr>
                <td colSpan={2} className="font-bold">
                  Total
                </td>
                <td className="text-center font-bold">{r.totals.allocated}</td>
                <td className="text-center font-bold">{r.totals.present}</td>
                <td className="text-center font-bold">{r.totals.absent}</td>
                <td className="text-center font-bold">{r.totals.unmarked}</td>
                <td />
              </tr>
            </tbody>
          </table>

          <h2 className="mb-2 mt-6 text-[13px] font-bold">Absentees ({r.absentees.length})</h2>
          {r.absentees.length === 0 ? (
            <p className="text-[12px] text-[#444]">No candidates were marked absent.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: '6%' }}>S.No</th>
                  <th>Roll No.</th>
                  <th>Student name</th>
                  <th>Dept</th>
                  <th>Sec</th>
                  <th>Room</th>
                  <th>Seat</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {r.absentees.map((a, i) => (
                  <tr key={`${a.roomId}${a.rollNo}`}>
                    <td className="text-center">{i + 1}</td>
                    <td className="font-mono">{a.rollNo}</td>
                    <td>{a.fullName}</td>
                    <td>{a.departmentCode}</td>
                    <td className="text-center">{a.section}</td>
                    <td>{a.roomNo}</td>
                    <td className="text-center">{a.seatNo}</td>
                    <td>{a.submissionStatus === 'FINALIZED' ? 'Final' : 'Provisional'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-14 grid grid-cols-2 gap-16 text-[12px]">
            <div className="border-t border-[#111] pt-1">Controller of Examinations</div>
            <div className="border-t border-[#111] pt-1">Chief Superintendent</div>
          </div>
        </>
      )}
    </PrintFrame>
  );
}
