import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  ROOM_STATUSES,
  SESSIONS,
  allocationRequestSchema,
  courseSchema,
  dashboardFilterSchema,
  departmentSchema,
  eligibleSchema,
  examListQuerySchema,
  examSchema,
  listQuerySchema,
  manualSeatSchema,
  marksSchema,
  publishSchema,
  reopenSchema,
  roomSchema,
  setInchargesSchema,
  setRoomsSchema,
  studentSchema,
  userCreateSchema,
  userUpdateSchema,
  uuid,
} from '../../shared/schemas';
import { ctxOf, requireAuth, requireRole } from '../auth/session';
import { asyncHandler, parse } from '../http/errors';
import { eventStream } from '../http/events';
import { assignSeat, commitAllocation, previewAllocation, unassignSeat } from '../services/allocation';
import { finalizeRoom, getRoomSheet, listDuties, recordMarks, reopenRoom } from '../services/attendance';
import { listAudit } from '../services/audit';
import * as catalog from '../services/catalog';
import { adminDashboard, inchargeDashboard, notificationsFor, studentPortal } from '../services/dashboard';
import * as exams from '../services/exams';
import { absenteeReport, departmentStats, pendingSubmissions, reportIndex } from '../services/reports';

const idParam = (req: Request, name = 'id') => parse(uuid, req.params[name]);
const admin = requireRole('ADMIN');
const staff = requireRole('ADMIN', 'INCHARGE');

export function apiRoutes() {
  const r = Router();
  r.use(requireAuth);

  r.get('/events', eventStream);

  // ------------------------------------------------------------------ meta
  r.get(
    '/meta',
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      const data = await ctx.tx(async (q) => ({
        departments: (await q.query('select id, code, name from departments order by code')).rows,
        courses: (
          await q.query(
            `select c.id, c.code, c.name, c.year, c.department_id as "departmentId" from courses c order by c.code`,
          )
        ).rows,
        rooms: (await q.query(`select id, room_no as "roomNo", block, capacity, status from rooms order by room_no`)).rows,
        incharges:
          ctx.user.role === 'ADMIN'
            ? (
                await q.query(
                  `select id, full_name as "fullName", email from users where role = 'INCHARGE' and is_active order by full_name`,
                )
              ).rows
            : [],
      }));
      res.json(data);
    }),
  );

  r.get(
    '/search',
    asyncHandler(async (req, res) => {
      const { q: term } = parse(z.object({ q: z.string().trim().min(1).max(60) }), req.query);
      const ctx = ctxOf(req);
      res.json(await ctx.tx((q) => catalog.search(q, ctx.user, term)));
    }),
  );

  r.get(
    '/notifications',
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      res.json({ items: await ctx.tx((q) => notificationsFor(q, ctx.user)) });
    }),
  );

  // ------------------------------------------------------------- dashboards
  r.get(
    '/dashboard/admin',
    admin,
    asyncHandler(async (req, res) => {
      const f = parse(dashboardFilterSchema, req.query);
      res.json(await ctxOf(req).tx((q) => adminDashboard(q, f)));
    }),
  );
  r.get(
    '/dashboard/incharge',
    requireRole('INCHARGE'),
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      res.json(await ctx.tx((q) => inchargeDashboard(q, ctx.user)));
    }),
  );
  r.get(
    '/student/portal',
    requireRole('STUDENT'),
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      res.json(await ctx.tx((q) => studentPortal(q, ctx.user)));
    }),
  );

  // ------------------------------------------------------------ catalogue
  r.get('/departments', admin, asyncHandler(async (req, res) => res.json(await ctxOf(req).tx(catalog.listDepartments))));
  r.post(
    '/departments',
    admin,
    asyncHandler(async (req, res) => {
      const input = parse(departmentSchema, req.body);
      res.status(201).json(await ctxOf(req).tx((q) => catalog.createDepartment(q, input)));
    }),
  );
  r.get('/courses', admin, asyncHandler(async (req, res) => res.json(await ctxOf(req).tx(catalog.listCourses))));
  r.post(
    '/courses',
    admin,
    asyncHandler(async (req, res) => {
      const input = parse(courseSchema, req.body);
      res.status(201).json(await ctxOf(req).tx((q) => catalog.createCourse(q, input)));
    }),
  );
  r.put(
    '/courses/:id',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = parse(courseSchema, req.body);
      await ctxOf(req).tx((q) => catalog.updateCourse(q, id, input));
      res.json({ ok: true });
    }),
  );

  r.get(
    '/rooms',
    admin,
    asyncHandler(async (req, res) => {
      const f = parse(
        z.object({
          q: z.string().trim().max(60).optional(),
          status: z.enum(ROOM_STATUSES).optional(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          session: z.enum(SESSIONS).optional(),
        }),
        req.query,
      );
      res.json(await ctxOf(req).tx((q) => catalog.listRooms(q, f)));
    }),
  );
  r.post(
    '/rooms',
    admin,
    asyncHandler(async (req, res) => {
      const input = parse(roomSchema, req.body);
      res.status(201).json(await ctxOf(req).tx((q) => catalog.createRoom(q, input)));
    }),
  );
  r.put(
    '/rooms/:id',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = parse(roomSchema, req.body);
      await ctxOf(req).tx((q) => catalog.updateRoom(q, id, input));
      res.json({ ok: true });
    }),
  );

  r.get(
    '/students',
    admin,
    asyncHandler(async (req, res) => {
      const f = parse(
        listQuerySchema.extend({
          departmentId: uuid.optional(),
          year: z.coerce.number().int().min(1).max(5).optional(),
          section: z.string().regex(/^[A-Z]$/).optional(),
        }),
        req.query,
      );
      res.json(await ctxOf(req).tx((q) => catalog.listStudents(q, f)));
    }),
  );
  r.post(
    '/students',
    admin,
    asyncHandler(async (req, res) => {
      const input = parse(studentSchema, req.body);
      res.status(201).json(await ctxOf(req).tx((q) => catalog.createStudent(q, input)));
    }),
  );
  r.put(
    '/students/:id',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = parse(studentSchema, req.body);
      await ctxOf(req).tx((q) => catalog.updateStudent(q, id, input));
      res.json({ ok: true });
    }),
  );

  r.get('/users', admin, asyncHandler(async (req, res) => res.json(await ctxOf(req).tx(catalog.listStaff))));
  r.post(
    '/users',
    admin,
    asyncHandler(async (req, res) => {
      const input = parse(userCreateSchema, req.body);
      res.status(201).json(await ctxOf(req).tx((q) => catalog.createStaff(q, input)));
    }),
  );
  r.patch(
    '/users/:id',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = parse(userUpdateSchema, req.body);
      const ctx = ctxOf(req);
      await ctx.tx((q) => catalog.updateStaff(q, ctx.user, id, input));
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------- examinations
  r.get(
    '/exams',
    admin,
    asyncHandler(async (req, res) => {
      const f = parse(examListQuerySchema, req.query);
      res.json(await ctxOf(req).tx((q) => exams.listExams(q, f)));
    }),
  );
  r.post(
    '/exams',
    admin,
    asyncHandler(async (req, res) => {
      const input = parse(examSchema.extend({ autoEnroll: z.boolean().optional() }), req.body);
      const ctx = ctxOf(req);
      res.status(201).json(await ctx.tx((q) => exams.createExam(q, input, ctx.user.id)));
    }),
  );
  r.get(
    '/exams/:id',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      res.json(await ctxOf(req).tx((q) => exams.getExamDetail(q, id)));
    }),
  );
  r.put(
    '/exams/:id',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = parse(examSchema, req.body);
      await ctxOf(req).tx((q) => exams.updateExam(q, id, input));
      res.json({ ok: true });
    }),
  );
  r.post(
    '/exams/:id/deactivate',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await ctxOf(req).tx((q) => exams.deactivateExam(q, id));
      res.json({ ok: true });
    }),
  );
  r.post(
    '/exams/:id/reactivate',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await ctxOf(req).tx((q) => exams.reactivateExam(q, id));
      res.json({ ok: true });
    }),
  );
  r.post(
    '/exams/:id/eligible',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const body = parse(eligibleSchema, req.body);
      res.json(await ctxOf(req).tx((q) => exams.changeEligible(q, id, body)));
    }),
  );
  r.put(
    '/exams/:id/rooms',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const { roomIds } = parse(setRoomsSchema, req.body);
      res.json(await ctxOf(req).tx((q) => exams.setExamRooms(q, id, roomIds)));
    }),
  );
  r.put(
    '/exams/:id/incharges',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const { assignments } = parse(setInchargesSchema, req.body);
      const ctx = ctxOf(req);
      res.json(await ctx.tx((q) => exams.setIncharges(q, id, assignments, ctx.user.id)));
    }),
  );
  r.post(
    '/exams/:id/allocation/preview',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const body = parse(allocationRequestSchema, req.body);
      res.json(await ctxOf(req).tx((q) => previewAllocation(q, id, body)));
    }),
  );
  r.post(
    '/exams/:id/allocation/commit',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const body = parse(allocationRequestSchema, req.body);
      const ctx = ctxOf(req);
      res.json(await ctx.tx((q) => commitAllocation(q, id, body, ctx.user.id)));
    }),
  );
  r.post(
    '/exams/:id/allocation/seat',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const body = parse(manualSeatSchema, req.body);
      const ctx = ctxOf(req);
      res.json(await ctx.tx((q) => assignSeat(q, id, body, ctx.user.id)));
    }),
  );
  r.delete(
    '/exams/:id/allocation/seat/:studentId',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const studentId = idParam(req, 'studentId');
      await ctxOf(req).tx((q) => unassignSeat(q, id, studentId));
      res.json({ ok: true });
    }),
  );
  r.post(
    '/exams/:id/publish',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const body = parse(publishSchema, req.body ?? {});
      const ctx = ctxOf(req);
      await ctx.tx((q) => exams.publishExam(q, id, !!body.acknowledgeUnallocated, ctx.user.id));
      res.json({ ok: true });
    }),
  );
  r.post(
    '/exams/:id/unpublish',
    admin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await ctxOf(req).tx((q) => exams.unpublishExam(q, id));
      res.json({ ok: true });
    }),
  );

  // ------------------------------------------------------------ attendance
  r.get(
    '/duties',
    staff,
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      res.json(await ctx.tx((q) => listDuties(q, ctx.user)));
    }),
  );
  r.get(
    '/attendance/:examId/:roomId',
    staff,
    asyncHandler(async (req, res) => {
      const examId = idParam(req, 'examId');
      const roomId = idParam(req, 'roomId');
      const ctx = ctxOf(req);
      res.json(await ctx.tx((q) => getRoomSheet(q, ctx.user, examId, roomId)));
    }),
  );
  r.put(
    '/attendance/:examId/:roomId/marks',
    staff,
    asyncHandler(async (req, res) => {
      const examId = idParam(req, 'examId');
      const roomId = idParam(req, 'roomId');
      const { marks } = parse(marksSchema, req.body);
      const ctx = ctxOf(req);
      res.json(await ctx.tx((q) => recordMarks(q, ctx.user, examId, roomId, marks)));
    }),
  );
  r.post(
    '/attendance/:examId/:roomId/submit',
    staff,
    asyncHandler(async (req, res) => {
      const examId = idParam(req, 'examId');
      const roomId = idParam(req, 'roomId');
      const ctx = ctxOf(req);
      res.json(await ctx.tx((q) => finalizeRoom(q, ctx.user, examId, roomId)));
    }),
  );
  r.post(
    '/attendance/:examId/:roomId/reopen',
    admin,
    asyncHandler(async (req, res) => {
      const examId = idParam(req, 'examId');
      const roomId = idParam(req, 'roomId');
      const { reason } = parse(reopenSchema, req.body);
      const ctx = ctxOf(req);
      await ctx.tx((q) => reopenRoom(q, ctx.user, examId, roomId, reason));
      res.json({ ok: true });
    }),
  );

  // --------------------------------------------------------------- reports
  r.get('/reports', staff, asyncHandler(async (req, res) => res.json(await ctxOf(req).tx(reportIndex))));
  r.get(
    '/reports/absentees/:examId',
    staff,
    asyncHandler(async (req, res) => {
      const examId = idParam(req, 'examId');
      const { roomId } = parse(z.object({ roomId: uuid.optional() }), req.query);
      const ctx = ctxOf(req);
      res.json(await ctx.tx((q) => absenteeReport(q, ctx.user, examId, roomId)));
    }),
  );
  r.get(
    '/reports/departments',
    admin,
    asyncHandler(async (req, res) => {
      const f = parse(dashboardFilterSchema.pick({ examId: true, from: true, to: true }), req.query);
      res.json(await ctxOf(req).tx((q) => departmentStats(q, f)));
    }),
  );
  r.get('/reports/pending', admin, asyncHandler(async (req, res) => res.json(await ctxOf(req).tx(pendingSubmissions))));

  // ----------------------------------------------------------------- audit
  r.get(
    '/audit',
    staff,
    asyncHandler(async (req, res) => {
      const f = parse(
        listQuerySchema.extend({ examId: uuid.optional(), action: z.string().regex(/^[A-Z_]{3,60}$/).optional() }),
        req.query,
      );
      res.json(await ctxOf(req).tx((q) => listAudit(q, { ...f, search: f.q })));
    }),
  );

  return r;
}
