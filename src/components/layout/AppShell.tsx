import {
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  DoorOpen,
  FileBarChart2,
  GraduationCap,
  History,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Radar,
  ShieldCheck,
  UserCog,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABEL, type Role } from '@shared/schemas';
import { useAuth } from '@/lib/auth';
import { useRealtime, type LiveStatus } from '@/lib/realtime';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../ui/menu';
import { BreadcrumbProvider, Breadcrumbs } from './breadcrumbs';
import { CommandSearch } from './CommandSearch';
import { Notifications } from './Notifications';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: Record<Role, { section: string; items: NavItem[] }[]> = {
  ADMIN: [
    {
      section: 'Operations',
      items: [
        { to: '/dashboard', label: 'Control center', icon: LayoutDashboard },
        { to: '/floor', label: 'Mission control', icon: Radar },
        { to: '/examinations', label: 'Examinations', icon: CalendarDays },
        { to: '/attendance', label: 'Attendance', icon: ClipboardCheck },
        { to: '/reports', label: 'Reports', icon: FileBarChart2 },
      ],
    },
    {
      section: 'Records',
      items: [
        { to: '/rooms', label: 'Rooms', icon: DoorOpen },
        { to: '/students', label: 'Students', icon: GraduationCap },
        { to: '/courses', label: 'Courses & departments', icon: BookOpen },
        { to: '/staff', label: 'Staff accounts', icon: UserCog },
        { to: '/audit', label: 'Audit timeline', icon: History },
      ],
    },
  ],
  INCHARGE: [
    {
      section: 'My duties',
      items: [
        { to: '/duties', label: 'Duty dashboard', icon: LayoutDashboard },
        { to: '/reports', label: 'Absentee reports', icon: FileBarChart2 },
        { to: '/audit', label: 'My activity', icon: History },
      ],
    },
  ],
  STUDENT: [{ section: 'Student', items: [{ to: '/my', label: 'My examinations', icon: CalendarDays }] }],
};

function LiveDot({ status }: { status: LiveStatus }) {
  const label = status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline';
  const dot = status === 'live' ? 'bg-ok' : status === 'connecting' ? 'bg-warn' : 'bg-bad';
  return (
    <span
      className="hidden items-center gap-2 rounded-full border border-line bg-canvas/60 px-2.5 py-1 text-2xs font-medium text-muted lg:inline-flex"
      title="Real-time updates"
    >
      <span className="relative flex h-1.5 w-1.5">
        {status === 'live' && <span className="absolute inset-0 animate-pulse-ring rounded-full" />}
        <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      </span>
      {label}
    </span>
  );
}

function Wordmark() {
  return (
    <div className="flex h-16 items-center gap-3 border-b border-line/70 px-4">
      <div className="relative">
        <span aria-hidden className="absolute inset-0 rounded-xl bg-accent/45 blur-md" />
        <div className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-accent-sweep shadow-inset">
          <ClipboardCheck className="h-[18px] w-[18px] text-on-accent" />
        </div>
      </div>
      <div className="leading-tight">
        <p className="display text-[15px] text-ink">Exam Section</p>
        <p className="text-2xs tracking-wide text-faint">Smart management</p>
      </div>
    </div>
  );
}

function Sidebar({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <Wordmark />
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5" aria-label="Main">
        {NAV[role].map((group) => (
          <div key={group.section}>
            <p className="eyebrow mb-2 px-2">{group.section}</p>
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-all duration-300',
                      isActive
                        ? 'bg-gradient-to-r from-accent/18 via-accent/8 to-transparent text-ink'
                        : 'text-muted hover:bg-raised/60 hover:text-ink',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {/* active marker: a glowing bar on the rail */}
                      <span
                        aria-hidden
                        className={cn(
                          'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-all duration-300',
                          isActive ? 'bg-accent shadow-glow-sm' : 'h-0 bg-transparent',
                        )}
                      />
                      <span
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors duration-300',
                          isActive
                            ? 'border-accent/30 bg-accent/15 text-accent'
                            : 'border-transparent text-faint group-hover:border-line group-hover:bg-raised group-hover:text-muted',
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                      </span>
                      <span className="truncate">{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="m-3 rounded-xl border border-line/80 bg-canvas/50 p-3">
        <div className="flex items-center gap-2 text-2xs font-medium text-muted">
          <ShieldCheck className="h-3.5 w-3.5 text-ok" />
          Server-enforced roles
        </div>
        <p className="mt-1 text-2xs leading-relaxed text-faint">
          Every request re-checked against PostgreSQL row-level security.
        </p>
      </div>
    </div>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const live = useRealtime(!!user);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => setMobileOpen(false), [location.pathname]);
  if (!user) return null;
  const initials = user.fullName
    .replace(/^(Dr|Prof|Mr|Ms|Mrs)\.?\s+/i, '')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <BreadcrumbProvider>
      <div className="flex h-full">
        <aside className="no-print relative hidden w-64 shrink-0 border-r border-line/70 bg-surface/40 backdrop-blur-xl lg:block">
          {/* a lit seam where the rail meets the content */}
          <span
            aria-hidden
            className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-accent/25 to-transparent"
          />
          <Sidebar role={user.role} />
        </aside>

        {mobileOpen && (
          <div className="no-print fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 animate-fade-in bg-[rgb(1_14_10/0.7)] backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <aside className="glass absolute inset-y-0 left-0 w-72 animate-slide-in rounded-r-2xl">
              <Button variant="ghost" size="icon" className="absolute right-2 top-4" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <X className="h-4 w-4" />
              </Button>
              <Sidebar role={user.role} onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line/70 bg-canvas/70 px-4 backdrop-blur-xl lg:px-8">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <MenuIcon className="h-4 w-4" />
            </Button>
            <Breadcrumbs />
            <div className="ml-auto flex flex-1 items-center justify-end gap-2">
              <CommandSearch />
              <LiveDot status={live} />
              <ThemeToggle className="hidden sm:inline-flex" />
              <Notifications />
              <Menu>
                <MenuTrigger asChild>
                  <button
                    className="group relative rounded-full p-0.5 transition-transform duration-300 hover:scale-105"
                    aria-label="Profile menu"
                  >
                    <span aria-hidden className="absolute inset-0 rounded-full bg-accent-sweep opacity-80" />
                    <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-canvas text-2xs font-semibold text-ink">
                      {initials}
                    </span>
                  </button>
                </MenuTrigger>
                <MenuContent className="w-64">
                  <div className="px-2.5 py-2">
                    <p className="truncate text-[13px] font-medium">{user.fullName}</p>
                    <p className="truncate text-xs text-muted">{user.email}</p>
                  </div>
                  <MenuSeparator />
                  <MenuLabel>{ROLE_LABEL[user.role]}</MenuLabel>
                  <MenuSeparator />
                  <MenuItem
                    onSelect={async () => {
                      await logout();
                      navigate('/login', { replace: true });
                    }}
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto">
            {/* keyed on the path so each route fades up on arrival */}
            <div key={location.pathname} className="page-enter mx-auto w-full max-w-[1480px] px-4 py-7 lg:px-8">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
