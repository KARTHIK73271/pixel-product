import type { AllocationStrategy, ExamSession, ExamStatus, ExamType, RoomStatus, SeatOrder } from '@shared/schemas';

export type SubmissionState = 'NOT_STARTED' | 'IN_PROGRESS' | 'FINALIZED';
export type Severity = 'critical' | 'warning' | 'info';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Meta {
  departments: { id: string; code: string; name: string }[];
  courses: { id: string; code: string; name: string; year: number; departmentId: string }[];
  rooms: { id: string; roomNo: string; block: string; capacity: number; status: RoomStatus }[];
  incharges: { id: string; fullName: string; email: string }[];
}

export interface ExamRow {
  id: string;
  name: string;
  examType: ExamType;
  courseId: string;
  courseCode: string;
  courseName: string;
  departmentId: string | null;
  departmentCode: string | null;
  departmentName: string | null;
  year: number;
  section: string | null;
  examDate: string;
  session: ExamSession;
  startTime: string;
  durationMinutes: number;
  status: ExamStatus;
  isActive: boolean;
  publishedAt: string | null;
  eligibleCount: number;
  allocatedCount: number;
  roomCount: number;
  capacity: number;
  finalizedRooms: number;
}

export interface ExamRoom {
  id: string;
  roomNo: string;
  block: string;
  floor: number | null;
  capacity: number;
  status: RoomStatus;
  allocated: number;
  marked: number;
  present: number;
  absent: number;
  /** Up to two faculty in-charges for this hall. */
  inchargeIds: string[];
  /** Their names, comma separated. */
  inchargeName: string | null;
  submissionStatus: SubmissionState;
  finalizedAt: string | null;
  reopenedCount: number | null;
}

export interface ExamStudent {
  id: string;
  rollNo: string;
  fullName: string;
  departmentCode: string;
  section: string;
  year: number;
  allocationId: string | null;
  roomId: string | null;
  roomNo: string | null;
  seatNo: number | null;
  attendance: 'PRESENT' | 'ABSENT' | null;
}

export interface ExamDetail {
  exam: ExamRow;
  rooms: ExamRoom[];
  students: ExamStudent[];
  warnings: { severity: Severity; message: string }[];
}

export interface RoomPlan {
  roomId: string;
  roomNo: string;
  capacity: number;
  selected: boolean;
  assigned: number;
  utilization: number;
  reason: string;
}

export interface AllocationPreview {
  plan: {
    strategy: AllocationStrategy;
    order: SeatOrder;
    studentCount: number;
    usableCapacity: number;
    selectedCapacity: number;
    feasible: boolean;
    minRoomsRequired: number | null;
    optimality: 'OPTIMAL' | 'HEURISTIC' | 'NOT_APPLICABLE';
    rooms: RoomPlan[];
    assignments: { studentId: string; roomId: string; seatNo: number }[];
    unallocatedStudentIds: string[];
    notes: string[];
  };
  previewHash: string;
  lockedRooms: { roomId: string; roomNo: string; capacity: number; keptAllocations: number }[];
  unallocatedStudents: { id: string; rollNo: string; fullName: string; departmentCode: string; section: string }[];
  totals: { eligible: number; allocated: number; unallocated: number; remainingSeats: number; roomsUsed: number };
  currentAllocations: number;
  willReplace: number;
}

export interface Room {
  id: string;
  roomNo: string;
  block: string;
  floor: number | null;
  capacity: number;
  status: RoomStatus;
  notes: string | null;
  upcomingBookings: number;
  allocated: number;
  remaining: number;
  bookings: { examId: string; name: string; examDate: string; session: ExamSession; allocated: number }[];
}

export interface Student {
  id: string;
  rollNo: string;
  fullName: string;
  email: string | null;
  year: number;
  section: string;
  isActive: boolean;
  departmentId: string;
  departmentCode: string;
  hasLogin: boolean;
  googleLinked: boolean;
  examCount: number;
}

export interface Duty {
  examId: string;
  examName: string;
  examDate: string;
  session: ExamSession;
  startTime: string;
  examStatus: ExamStatus;
  courseCode: string;
  courseName: string;
  roomId: string;
  roomNo: string;
  block: string;
  capacity: number;
  inchargeName: string | null;
  allocated: number;
  present: number;
  absent: number;
  unmarked: number;
  submissionStatus: SubmissionState;
  finalizedAt: string | null;
  reopenedCount: number | null;
  timing: 'PAST' | 'TODAY' | 'UPCOMING';
}

export interface SheetStudent {
  allocationId: string;
  seatNo: number;
  studentId: string;
  rollNo: string;
  fullName: string;
  departmentCode: string;
  departmentName: string;
  section: string;
  status: 'PRESENT' | 'ABSENT' | null;
  markedAt: string | null;
  markedByName: string | null;
}

export interface RoomSheet {
  examId: string;
  examName: string;
  examType: ExamType;
  examDate: string;
  session: ExamSession;
  startTime: string;
  durationMinutes: number;
  examStatus: ExamStatus;
  year: number;
  examSection: string | null;
  courseCode: string;
  courseName: string;
  departmentName: string | null;
  roomId: string;
  roomNo: string;
  block: string;
  floor: number | null;
  capacity: number;
  inchargeName: string | null;
  submissionStatus: SubmissionState;
  finalizedAt: string | null;
  finalizedByName: string | null;
  reopenedCount: number | null;
  lastReopenReason: string | null;
  students: SheetStudent[];
  counts: { allocated: number; present: number; absent: number; unmarked: number };
}

export interface AbsenteeReport {
  exam: {
    id: string;
    name: string;
    examType: ExamType;
    examDate: string;
    session: ExamSession;
    startTime: string;
    status: ExamStatus;
    courseCode: string;
    courseName: string;
    departmentName: string | null;
    year: number;
    section: string | null;
  };
  rooms: {
    roomId: string;
    roomNo: string;
    block: string;
    inchargeName: string | null;
    allocated: number;
    present: number;
    absent: number;
    unmarked: number;
    submissionStatus: SubmissionState;
    finalizedAt: string | null;
    reportStatus: 'FINAL' | 'PROVISIONAL';
  }[];
  absentees: {
    roomId: string;
    roomNo: string;
    seatNo: number;
    rollNo: string;
    fullName: string;
    departmentCode: string;
    section: string;
    submissionStatus: SubmissionState;
  }[];
  totals: { allocated: number; present: number; absent: number; unmarked: number };
  finalizedRooms: number;
  occupiedRooms: number;
  reportStatus: 'FINAL' | 'PROVISIONAL';
  scope: 'ROOM' | 'EXAMINATION' | 'ASSIGNED_ROOMS';
  generatedAt: string;
  generatedBy: string;
}

export interface AuditItem {
  id: number;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  examId: string | null;
  examName: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Alert {
  id: string;
  severity: Severity;
  kind: string;
  title: string;
  detail: string;
  examId?: string;
  examDate?: string;
  href: string;
}

export interface AdminDashboardData {
  generatedAt: string;
  today: string;
  kpis: {
    totalExams: number;
    examsByStatus: { published: number; allocated: number; draft: number };
    upcomingExams: number;
    activeRooms: number;
    unavailableRooms: number;
    seatingCapacity: number;
    eligible: number;
    allocated: number;
    unallocated: number;
    bookedCapacity: number;
    utilization: number;
    capacityIssues: number;
    capacityBreakdown: { shortageExams: number; unavailableBookings: number; overCapacitySeats: number };
    attendance: {
      allocated: number;
      marked: number;
      present: number;
      absent: number;
      finalPresent: number;
      finalAbsent: number;
      unmarked: number;
      completion: number;
    };
    pendingRooms: number;
    overdueRooms: number;
    pendingReports: number;
  };
  charts: {
    roomUtilization: {
      roomId: string;
      roomNo: string;
      capacity: number;
      status: RoomStatus;
      bookings: number;
      allocated: number;
      offered: number;
      utilization: number;
    }[];
    attendanceByExam: {
      examId: string;
      label: string;
      name: string;
      examDate: string;
      allocated: number;
      present: number;
      absent: number;
      unmarked: number;
    }[];
    departments: {
      departmentCode: string;
      departmentName: string;
      eligible: number;
      allocated: number;
      present: number;
      absent: number;
    }[];
  };
  timeline: {
    id: string;
    name: string;
    courseCode: string;
    examDate: string;
    session: ExamSession;
    startTime: string;
    status: ExamStatus;
    eligible: number;
    allocated: number;
    rooms: number;
  }[];
  controlCenter: {
    date: string | null;
    rooms: {
      examId: string;
      examName: string;
      courseCode: string;
      session: ExamSession;
      startTime: string;
      roomId: string;
      roomNo: string;
      block: string;
      capacity: number;
      inchargeName: string | null;
      allocated: number;
      present: number;
      absent: number;
      unmarked: number;
      submissionStatus: SubmissionState;
    }[];
  };
  alerts: Alert[];
  activity: { id: number; actorName: string; actorRole: string; action: string; summary: string; examId: string | null; createdAt: string }[];
}
