import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError, type ZodSchema, type z } from 'zod';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);

export function parse<S extends ZodSchema>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw validationError(r.error);
  return r.data;
}

function validationError(err: ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid', { fields });
}

/** Human messages for constraint / index names raised by PostgreSQL. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  users_email_key: 'An account with this email already exists.',
  departments_code_key: 'A department with this code already exists.',
  departments_name_key: 'A department with this name already exists.',
  students_roll_no_key: 'A student with this roll number already exists.',
  students_user_id_key: 'This login is already linked to another student.',
  courses_code_key: 'A course with this code already exists.',
  rooms_room_no_key: 'A room with this number already exists.',
  examinations_course_type_section_uniq:
    'An active examination of this type already exists for this course and section.',
  exam_students_pkey: 'Student is already eligible for this examination.',
  exam_students_slot_uniq: 'A student already has another examination in the same date and session.',
  exam_rooms_pkey: 'Room is already assigned to this examination.',
  exam_rooms_slot_uniq: 'A room is already booked by another examination in the same date and session.',
  incharge_slot_uniq: 'This in-charge already supervises another room in the same date and session.',
  allocations_exam_student_key: 'Student is already allocated a seat in this examination.',
  allocations_exam_room_seat_key: 'That seat is already taken in this room.',
  allocations_eligible_fk: 'Student is not eligible for this examination.',
  allocations_room_fk: 'Room is not assigned to this examination, or still has allocated students.',
  attendance_allocation_fk: 'Attendance has been recorded for this student; the seat cannot be moved or removed.',
  submissions_room_fk: 'This room has an attendance submission and cannot be removed.',
  examinations_publication_chk: 'Publication state is inconsistent.',
};

interface PgLikeError {
  code?: string;
  constraint?: string;
  message?: string;
}

export function mapDatabaseError(err: unknown): AppError | null {
  const e = err as PgLikeError;
  if (!e || typeof e.code !== 'string') return null;
  const constraintMsg = e.constraint ? CONSTRAINT_MESSAGES[e.constraint] : undefined;
  switch (e.code) {
    case '23505':
      return new AppError(409, 'DUPLICATE', constraintMsg ?? 'This record already exists.', { constraint: e.constraint });
    case '23503':
      return new AppError(409, 'REFERENCE_CONFLICT', constraintMsg ?? 'A related record prevents this change.', {
        constraint: e.constraint,
      });
    case '23514':
    case '23502':
      return new AppError(400, 'CONSTRAINT_VIOLATION', constraintMsg ?? 'The submitted values violate a data rule.', {
        constraint: e.constraint,
      });
    case '22P02':
    case '22007':
    case '22008':
      return new AppError(400, 'BAD_REQUEST', 'Malformed value in request.');
    case '42501':
      return new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    case '40001':
    case '40P01':
      return new AppError(409, 'CONCURRENT_UPDATE', 'Another change happened at the same time. Please retry.');
    case 'P0001': {
      const m = /^(ERR_[A-Z_]+):\s*(.*)$/s.exec(e.message ?? '');
      if (m) {
        const code = m[1].slice(4);
        const status = code === 'FORBIDDEN' ? 403 : code === 'UNAUTHENTICATED' ? 401 : 409;
        return new AppError(status, code, m[2]);
      }
      return null;
    }
    default:
      return null;
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let appErr: AppError | null = err instanceof AppError ? err : mapDatabaseError(err);
  if (!appErr && err instanceof ZodError) appErr = validationError(err);
  if (!appErr && (err as { type?: string })?.type === 'entity.parse.failed') appErr = badRequest('Malformed JSON body');
  if (!appErr && (err as { type?: string })?.type === 'entity.too.large') appErr = badRequest('Request body too large');
  if (!appErr) {
    // Never leak internals: log server-side, return a generic message.
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    appErr = new AppError(500, 'INTERNAL', 'Something went wrong. Please try again.');
  }
  res.status(appErr.status).json({ error: { code: appErr.code, message: appErr.message, details: appErr.details } });
};
