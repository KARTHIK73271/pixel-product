import { createHash } from 'node:crypto';
import type { AllocationRequest, RoomStatus } from '../../shared/schemas';
import type { Queryable } from '../db/index';
import { badRequest, conflict } from '../http/errors';
import { planAllocation, nextFreeSeat, type AllocationPlan } from './allocator';
import { audit } from './audit';
import { lockExam } from './exams';

interface CtxStudent {
  id: string;
  rollNo: string;
  fullName: string;
  departmentCode: string;
  section: string;
}
interface CtxRoom {
  id: string;
  roomNo: string;
  block: string;
  capacity: number;
  status: RoomStatus;
}
interface CtxAllocation {
  id: string;
  studentId: string;
  roomId: string;
  seatNo: number;
}

async function loadContext(q: Queryable, examId: string) {
  // Sequential on purpose: queries share one transaction/connection.
  const students = await q.query<CtxStudent>(
    `select s.id, s.roll_no as "rollNo", s.full_name as "fullName", d.code as "departmentCode", s.section
       from exam_students es join students s on s.id = es.student_id join departments d on d.id = s.department_id
      where es.exam_id = $1`,
    [examId],
  );
  const rooms = await q.query<CtxRoom>(
    `select r.id, r.room_no as "roomNo", r.block, r.capacity, r.status
       from exam_rooms er join rooms r on r.id = er.room_id where er.exam_id = $1`,
    [examId],
  );
  const allocations = await q.query<CtxAllocation>(
    `select id, student_id as "studentId", room_id as "roomId", seat_no as "seatNo" from allocations where exam_id = $1`,
    [examId],
  );
  // Rooms where attendance exists (any mark, or a finalized submission) are frozen during reallocation.
  const locked = await q.query<{ room_id: string }>(
    `select room_id from attendance_records where exam_id = $1
     union
     select room_id from attendance_submissions where exam_id = $1 and status = 'FINALIZED'`,
    [examId],
  );
  return {
    students: students.rows,
    rooms: rooms.rows,
    allocations: allocations.rows,
    lockedRoomIds: new Set(locked.rows.map((r) => r.room_id)),
  };
}

export interface AllocationPreview {
  plan: AllocationPlan;
  previewHash: string;
  lockedRooms: { roomId: string; roomNo: string; capacity: number; keptAllocations: number }[];
  unallocatedStudents: { id: string; rollNo: string; fullName: string; departmentCode: string; section: string }[];
  totals: { eligible: number; allocated: number; unallocated: number; remainingSeats: number; roomsUsed: number };
  currentAllocations: number;
  willReplace: number;
}

function buildPreview(ctx: Awaited<ReturnType<typeof loadContext>>, req: Pick<AllocationRequest, 'strategy' | 'order'>) {
  const keptAllocs = ctx.allocations.filter((a) => ctx.lockedRoomIds.has(a.roomId));
  const keptStudents = new Set(keptAllocs.map((a) => a.studentId));
  const toPlace = ctx.students.filter((s) => !keptStudents.has(s.id));
  const candidateRooms = ctx.rooms.filter((r) => !ctx.lockedRoomIds.has(r.id));
  const plan = planAllocation({ students: toPlace, rooms: candidateRooms, strategy: req.strategy, order: req.order });

  const lockedRooms = ctx.rooms
    .filter((r) => ctx.lockedRoomIds.has(r.id))
    .map((r) => ({
      roomId: r.id,
      roomNo: r.roomNo,
      capacity: r.capacity,
      keptAllocations: keptAllocs.filter((a) => a.roomId === r.id).length,
    }));
  if (lockedRooms.length)
    plan.notes.push(
      `${lockedRooms.length} room(s) with recorded attendance keep their existing seating (${keptAllocs.length} seat(s) preserved).`,
    );

  const byId = new Map(ctx.students.map((s) => [s.id, s]));
  const allocated = plan.assignments.length + keptAllocs.length;
  const usedCapacity =
    plan.rooms.filter((r) => r.selected).reduce((a, r) => a + r.capacity, 0) + lockedRooms.reduce((a, r) => a + r.capacity, 0);
  const canonical = JSON.stringify({
    a: [...plan.assignments].sort((x, y) => x.studentId.localeCompare(y.studentId)),
    k: keptAllocs.map((a) => a.id).sort(),
  });
  const preview: AllocationPreview = {
    plan,
    previewHash: createHash('sha256').update(canonical).digest('hex'),
    lockedRooms,
    unallocatedStudents: plan.unallocatedStudentIds.map((id) => byId.get(id)!).filter(Boolean),
    totals: {
      eligible: ctx.students.length,
      allocated,
      unallocated: ctx.students.length - allocated,
      remainingSeats: usedCapacity - allocated,
      roomsUsed: plan.rooms.filter((r) => r.assigned > 0).length + lockedRooms.filter((r) => r.keptAllocations > 0).length,
    },
    currentAllocations: ctx.allocations.length,
    willReplace: ctx.allocations.length - keptAllocs.length,
  };
  return preview;
}

export async function previewAllocation(q: Queryable, examId: string, req: Pick<AllocationRequest, 'strategy' | 'order'>) {
  await assertExamExists(q, examId);
  return buildPreview(await loadContext(q, examId), req);
}

async function assertExamExists(q: Queryable, examId: string) {
  const r = await q.query('select 1 from examinations where id = $1', [examId]);
  if (!r.rows[0]) throw badRequest('Examination not found');
}

/**
 * Recomputes the plan inside the write transaction (client plans are never trusted), then replaces
 * the draft allocation atomically. Concurrency: the examination row is locked FOR UPDATE and an
 * advisory lock is taken, so concurrent commits for the same exam serialise; unique constraints
 * (exam, student) and (exam, room, seat) are the final guarantee against duplicates.
 */
export async function commitAllocation(q: Queryable, examId: string, req: AllocationRequest, userId: string) {
  const exam = await lockExam(q, examId);
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [`allocation:${examId}`]);
  if (!exam.is_active) throw conflict('EXAM_INACTIVE', 'This examination is deactivated.');
  if (exam.status === 'PUBLISHED' && !req.confirmUnpublish)
    throw conflict(
      'CONFIRM_REQUIRED',
      'This examination is published. Reallocating will unpublish it until you publish again. Confirm to continue.',
    );
  const ctx = await loadContext(q, examId);
  if (ctx.students.length === 0) throw conflict('NO_STUDENTS', 'Enrol eligible students before allocating.');
  if (ctx.rooms.length === 0) throw conflict('NO_ROOMS', 'Assign at least one room before allocating.');
  const preview = buildPreview(ctx, req);
  if (req.previewHash && req.previewHash !== preview.previewHash)
    throw conflict('PLAN_CHANGED', 'Students, rooms or attendance changed since the preview. Review the updated plan.', {
      preview,
    });

  const locked = [...ctx.lockedRoomIds];
  await q.query('delete from allocations where exam_id = $1 and not (room_id = any($2::uuid[]))', [examId, locked]);
  await q.query(
    `delete from attendance_submissions where exam_id = $1 and status = 'IN_PROGRESS' and not (room_id = any($2::uuid[]))`,
    [examId, locked],
  );
  const a = preview.plan.assignments;
  if (a.length) {
    await q.query(
      `insert into allocations (exam_id, student_id, room_id, seat_no, allocated_by)
       select $1, t.sid, t.rid, t.seat, $5
         from unnest($2::uuid[], $3::uuid[], $4::int[]) as t(sid, rid, seat)`,
      [examId, a.map((x) => x.studentId), a.map((x) => x.roomId), a.map((x) => x.seatNo), userId],
    );
  }
  await q.query(`update examinations set status = 'ALLOCATED', published_at = null, published_by = null where id = $1`, [examId]);
  await audit(q, {
    action: 'ALLOCATION_COMMITTED',
    entityType: 'examination',
    entityId: examId,
    examId,
    summary: `${exam.status === 'DRAFT' ? 'Allocated' : 'Reallocated'} ${preview.totals.allocated} seat(s) using ${
      req.strategy === 'MIN_ROOMS' ? 'minimum rooms' : 'balanced'
    } strategy across ${preview.totals.roomsUsed} room(s)${preview.totals.unallocated ? `; ${preview.totals.unallocated} unallocated` : ''}${
      exam.status === 'PUBLISHED' ? ' — examination unpublished' : ''
    }`,
    metadata: {
      strategy: req.strategy,
      order: req.order,
      totals: preview.totals,
      optimality: preview.plan.optimality,
      rooms: preview.plan.rooms.filter((r) => r.assigned > 0).map((r) => ({ roomNo: r.roomNo, assigned: r.assigned })),
    },
  });
  return preview;
}

function assertAdjustable(exam: { status: string; is_active: boolean }) {
  if (!exam.is_active) throw conflict('EXAM_INACTIVE', 'This examination is deactivated.');
  if (exam.status === 'PUBLISHED')
    throw conflict('EXAM_PUBLISHED', 'Unpublish the examination before adjusting seats manually.');
}

/** Assigns an unallocated student, or moves an allocated one, to a room (and optional seat). */
export async function assignSeat(
  q: Queryable,
  examId: string,
  input: { studentId: string; roomId: string; seatNo?: number },
  userId: string,
) {
  const exam = await lockExam(q, examId);
  assertAdjustable(exam);
  const room = await q.query<{ capacity: number; room_no: string; status: string }>(
    `select r.capacity, r.room_no, r.status from exam_rooms er join rooms r on r.id = er.room_id
      where er.exam_id = $1 and er.room_id = $2`,
    [examId, input.roomId],
  );
  if (!room.rows[0]) throw badRequest('Room is not assigned to this examination.');
  const student = await q.query<{ roll_no: string }>(
    `select s.roll_no from exam_students es join students s on s.id = es.student_id where es.exam_id = $1 and es.student_id = $2`,
    [examId, input.studentId],
  );
  if (!student.rows[0]) throw badRequest('Student is not eligible for this examination.');

  const taken = await q.query<{ seat_no: number }>(
    'select seat_no from allocations where exam_id = $1 and room_id = $2 and student_id <> $3',
    [examId, input.roomId, input.studentId],
  );
  const cap = room.rows[0].capacity;
  if (taken.rows.length >= cap)
    throw conflict('OVER_CAPACITY', `Room ${room.rows[0].room_no} is full (${cap} of ${cap} seats allocated).`);
  const seatNo = input.seatNo ?? nextFreeSeat(cap, taken.rows.map((r) => r.seat_no))!;
  if (seatNo > cap) throw conflict('OVER_CAPACITY', `Seat ${seatNo} exceeds the capacity (${cap}) of room ${room.rows[0].room_no}.`);

  const existing = await q.query<{ id: string; room_id: string; seat_no: number }>(
    'select id, room_id, seat_no from allocations where exam_id = $1 and student_id = $2',
    [examId, input.studentId],
  );
  if (existing.rows[0]) {
    await q.query('update allocations set room_id = $2, seat_no = $3, allocated_by = $4, allocated_at = now() where id = $1', [
      existing.rows[0].id,
      input.roomId,
      seatNo,
      userId,
    ]);
  } else {
    await q.query(
      `insert into allocations (exam_id, student_id, room_id, seat_no, allocated_by) values ($1, $2, $3, $4, $5)`,
      [examId, input.studentId, input.roomId, seatNo, userId],
    );
  }
  if (exam.status === 'DRAFT') await q.query(`update examinations set status = 'ALLOCATED' where id = $1`, [examId]);
  await audit(q, {
    action: existing.rows[0] ? 'SEAT_MOVED' : 'SEAT_ASSIGNED',
    entityType: 'allocation',
    entityId: input.studentId,
    examId,
    summary: `${existing.rows[0] ? 'Moved' : 'Assigned'} ${student.rows[0].roll_no} to ${room.rows[0].room_no} seat ${seatNo}`,
    metadata: { ...input, seatNo, previous: existing.rows[0] ?? null },
  });
  return { seatNo };
}

export async function unassignSeat(q: Queryable, examId: string, studentId: string) {
  const exam = await lockExam(q, examId);
  assertAdjustable(exam);
  const r = await q.query<{ roll_no: string; room_no: string; seat_no: number }>(
    `delete from allocations a using students s, rooms r
      where a.exam_id = $1 and a.student_id = $2 and s.id = a.student_id and r.id = a.room_id
      returning s.roll_no, r.room_no, a.seat_no`,
    [examId, studentId],
  );
  if (!r.rows[0]) throw badRequest('Student has no seat in this examination.');
  await audit(q, {
    action: 'SEAT_RELEASED',
    entityType: 'allocation',
    entityId: studentId,
    examId,
    summary: `Released seat ${r.rows[0].seat_no} in ${r.rows[0].room_no} held by ${r.rows[0].roll_no}`,
  });
}
