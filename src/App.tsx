import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from '@shared/schemas';
import { AppShell } from './components/layout/AppShell';
import { Spinner } from './components/ui/feedback';
import { homeFor, useAuth } from './lib/auth';
import { AuditPage } from './pages/admin/AuditPage';
import { AttendanceBoardPage } from './pages/admin/AttendanceBoardPage';
import { CoursesPage } from './pages/admin/CoursesPage';
import { DashboardPage } from './pages/admin/DashboardPage';
import { ExamDetailPage } from './pages/admin/ExamDetailPage';
import { ExamsPage } from './pages/admin/ExamsPage';
import { FloorMapPage } from './pages/admin/FloorMapPage';
import { RoomsPage } from './pages/admin/RoomsPage';
import { StaffPage } from './pages/admin/StaffPage';
import { StudentsPage } from './pages/admin/StudentsPage';
import { AttendancePage } from './pages/incharge/AttendancePage';
import { DutiesPage } from './pages/incharge/DutiesPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AbsenteePrintPage } from './pages/print/AbsenteePrintPage';
import { AttendanceSheetPrintPage } from './pages/print/AttendanceSheetPrintPage';
import { ReportsPage } from './pages/ReportsPage';
import { StudentPortalPage } from './pages/student/StudentPortalPage';

function FullScreenSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="h-5 w-5" />
    </div>
  );
}

/** UX-level guard only — every API endpoint and database policy enforces the same rules. */
function RequireRole({ roles }: { roles: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <Outlet />;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenSpinner />;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Home />} />

      <Route element={<RequireRole roles={['ADMIN', 'INCHARGE']} />}>
        <Route path="/print/attendance/:examId/:roomId" element={<AttendanceSheetPrintPage />} />
        <Route path="/print/absentees/:examId" element={<AbsenteePrintPage />} />
      </Route>

      <Route element={<RequireRole roles={['ADMIN', 'INCHARGE', 'STUDENT']} />}>
        <Route element={<AppShell />}>
          <Route element={<RequireRole roles={['ADMIN']} />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/floor" element={<FloorMapPage />} />
            <Route path="/examinations" element={<ExamsPage />} />
            <Route path="/examinations/:id" element={<ExamDetailPage />} />
            <Route path="/attendance" element={<AttendanceBoardPage />} />
            <Route path="/rooms" element={<RoomsPage />} />
            <Route path="/students" element={<StudentsPage />} />
            <Route path="/courses" element={<CoursesPage />} />
            <Route path="/staff" element={<StaffPage />} />
          </Route>
          <Route element={<RequireRole roles={['INCHARGE']} />}>
            <Route path="/duties" element={<DutiesPage />} />
          </Route>
          <Route element={<RequireRole roles={['ADMIN', 'INCHARGE']} />}>
            <Route path="/attendance/:examId/:roomId" element={<AttendancePage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/audit" element={<AuditPage />} />
          </Route>
          <Route element={<RequireRole roles={['STUDENT']} />}>
            <Route path="/my" element={<StudentPortalPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
