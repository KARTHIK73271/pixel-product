import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enumerations (mirrors PostgreSQL enum types in 001_schema.sql)
// ---------------------------------------------------------------------------
export const ROLES = ['ADMIN', 'INCHARGE', 'STUDENT'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Examination Admin',
  INCHARGE: 'Examination In-Charge',
  STUDENT: 'Student',
};

export const SESSIONS = ['FN', 'AN'] as const;
export type ExamSession = (typeof SESSIONS)[number];
export const SESSION_LABEL: Record<ExamSession, string> = { FN: 'Forenoon', AN: 'Afternoon' };

export const EXAM_TYPES = ['INTERNAL', 'MIDTERM', 'END_SEMESTER', 'SUPPLEMENTARY'] as const;
export type ExamType = (typeof EXAM_TYPES)[number];
export const EXAM_TYPE_LABEL: Record<ExamType, string> = {
  INTERNAL: 'Internal Assessment',
  MIDTERM: 'Mid-Semester',
  END_SEMESTER: 'End-Semester',
  SUPPLEMENTARY: 'Supplementary',
};

export const EXAM_STATUSES = ['DRAFT', 'ALLOCATED', 'PUBLISHED'] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];
export const EXAM_STATUS_LABEL: Record<ExamStatus, string> = {
  DRAFT: 'Draft',
  ALLOCATED: 'Allocation draft',
  PUBLISHED: 'Published',
};

export const ROOM_STATUSES = ['AVAILABLE', 'MAINTENANCE', 'RETIRED'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const ATTENDANCE_MARKS = ['PRESENT', 'ABSENT'] as const;
export type AttendanceMark = (typeof ATTENDANCE_MARKS)[number];

export const SUBMISSION_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'FINALIZED'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const ALLOCATION_STRATEGIES = ['BALANCED', 'MIN_ROOMS'] as const;
export type AllocationStrategy = (typeof ALLOCATION_STRATEGIES)[number];
export const SEAT_ORDERS = ['ROLL', 'INTERLEAVE'] as const;
export type SeatOrder = (typeof SEAT_ORDERS)[number];

// ---------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------
export const uuid = z.string().uuid('Invalid identifier');
const trimmed = (min: number, max: number, label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(min, min <= 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email address')
  .max(254)
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));
const nanToNull = (v: unknown) => (v === '' || (typeof v === 'number' && Number.isNaN(v)) ? null : v);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  password: z.string().min(1, 'Password is required').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const userCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  fullName: trimmed(2, 120, 'Full name'),
  role: z.enum(['ADMIN', 'INCHARGE']),
  /** Optional: leave blank for a Google-only account (password sign-in disabled). */
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(200)
    .regex(/[A-Za-z]/, 'Password must contain a letter')
    .regex(/[0-9]/, 'Password must contain a number')
    .optional()
    .or(z.literal('').transform(() => undefined)),
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
  fullName: trimmed(2, 120, 'Full name').optional(),
  isActive: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------
export const departmentSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,10}$/, '2–10 capital letters, e.g. CSE'),
  name: trimmed(2, 120, 'Name'),
});
export type DepartmentInput = z.infer<typeof departmentSchema>;

export const courseSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,6}[0-9]{3,4}[A-Z]?$/, 'Format like CS301 or MA2101'),
  name: trimmed(2, 160, 'Course name'),
  departmentId: uuid,
  year: z.number({ invalid_type_error: 'Year is required' }).int().min(1).max(5),
  credits: z.number({ invalid_type_error: 'Credits are required' }).int().min(0).max(10),
});
export type CourseInput = z.infer<typeof courseSchema>;

export const roomSchema = z.object({
  roomNo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,12}$/, 'Letters, digits and dashes only (max 12), e.g. A-101'),
  block: trimmed(1, 40, 'Block'),
  floor: z.preprocess(nanToNull, z.number().int().min(-2).max(50).nullable()).optional(),
  capacity: z
    .number({ invalid_type_error: 'Capacity must be a number' })
    .int('Capacity must be a whole number')
    .min(1, 'Capacity must be at least 1')
    .max(500, 'Capacity cannot exceed 500'),
  status: z.enum(ROOM_STATUSES),
  notes: z.string().trim().max(300).nullable().optional(),
});
export type RoomInput = z.infer<typeof roomSchema>;

export const studentSchema = z.object({
  rollNo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4,20}$/, '4–20 letters/digits, e.g. 23CSE001'),
  fullName: trimmed(2, 120, 'Full name'),
  email: optionalEmail,
  departmentId: uuid,
  year: z.number({ invalid_type_error: 'Year is required' }).int().min(1).max(5),
  section: z.string().trim().toUpperCase().regex(/^[A-Z]$/, 'Single letter section, e.g. A'),
  isActive: z.boolean().default(true),
});
export type StudentInput = z.infer<typeof studentSchema>;

// ---------------------------------------------------------------------------
// Examinations
// ---------------------------------------------------------------------------
export const examSchema = z.object({
  name: trimmed(3, 160, 'Examination name'),
  examType: z.enum(EXAM_TYPES),
  courseId: uuid,
  departmentId: uuid.nullable(),
  year: z.number({ invalid_type_error: 'Year is required' }).int().min(1).max(5),
  section: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]$/, 'Single letter section')
    .nullable(),
  examDate: isoDate,
  session: z.enum(SESSIONS),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)'),
  durationMinutes: z
    .number({ invalid_type_error: 'Duration is required' })
    .int()
    .min(30, 'At least 30 minutes')
    .max(300, 'At most 300 minutes'),
});
export type ExamInput = z.infer<typeof examSchema>;

export const examListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(EXAM_STATUSES).optional(),
  departmentId: uuid.optional(),
  session: z.enum(SESSIONS).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  sort: z.enum(['date_asc', 'date_desc', 'name']).default('date_asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export const eligibleSchema = z.union([
  z.object({ mode: z.literal('criteria') }),
  z.object({ mode: z.literal('add'), studentIds: z.array(uuid).min(1).max(1000) }),
  z.object({ mode: z.literal('remove'), studentIds: z.array(uuid).min(1).max(1000) }),
]);

export const setRoomsSchema = z.object({ roomIds: z.array(uuid).max(50) });
/** Up to two faculty in-charges per exam hall; an empty list unassigns the hall. */
export const setInchargesSchema = z.object({
  assignments: z
    .array(
      z.object({
        roomId: uuid,
        inchargeIds: z
          .array(uuid)
          .max(2, 'An exam hall can have at most 2 faculty in-charges')
          .refine((ids) => new Set(ids).size === ids.length, 'The same faculty member was selected twice'),
      }),
    )
    .max(50),
});

export const allocationRequestSchema = z.object({
  strategy: z.enum(ALLOCATION_STRATEGIES),
  order: z.enum(SEAT_ORDERS),
  previewHash: z.string().max(128).optional(),
  confirmUnpublish: z.boolean().optional(),
});
export type AllocationRequest = z.infer<typeof allocationRequestSchema>;

export const manualSeatSchema = z.object({
  studentId: uuid,
  roomId: uuid,
  seatNo: z.number().int().min(1).max(500).optional(),
});

export const publishSchema = z.object({ acknowledgeUnallocated: z.boolean().optional() });

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
export const marksSchema = z.object({
  marks: z
    .array(z.object({ allocationId: uuid, status: z.enum(ATTENDANCE_MARKS).nullable() }))
    .min(1)
    .max(500),
});
export const reopenSchema = z.object({
  reason: trimmed(10, 500, 'Reason'),
});

// ---------------------------------------------------------------------------
// Dashboard / reports filters
// ---------------------------------------------------------------------------
export const dashboardFilterSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  examId: uuid.optional(),
  courseId: uuid.optional(),
  departmentId: uuid.optional(),
  roomId: uuid.optional(),
});
export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(25),
});
