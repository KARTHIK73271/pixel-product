import * as D from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, DoorOpen, GraduationCap, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, fmtDate } from '@/lib/utils';
import { ExamStatusBadge, RoomStatusBadge } from '../ui/badges';
import { Spinner } from '../ui/feedback';
import type { ExamStatus, RoomStatus } from '@shared/schemas';

interface SearchResult {
  exams: { id: string; name: string; courseCode: string; examDate: string; session: string; status: ExamStatus }[];
  students: { id: string; rollNo: string; fullName: string; departmentCode: string; section: string }[];
  rooms: { id: string; roomNo: string; block: string; capacity: number; status: RoomStatus }[];
}

function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandSearch() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounced(term.trim());
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResult>(`/search${qs({ q: debounced })}`),
    enabled: open && debounced.length > 0,
    staleTime: 10_000,
  });

  const items = useMemo(() => {
    if (!data) return [];
    const examHref = (id: string) => (user?.role === 'ADMIN' ? `/examinations/${id}` : user?.role === 'INCHARGE' ? '/duties' : '/my');
    return [
      ...data.exams.map((e) => ({
        key: `e${e.id}`,
        group: 'Examinations',
        icon: CalendarDays,
        title: e.name,
        sub: `${e.courseCode} · ${fmtDate(e.examDate)} · ${e.session}`,
        badge: <ExamStatusBadge status={e.status} />,
        href: examHref(e.id),
      })),
      ...data.students.map((s) => ({
        key: `s${s.id}`,
        group: 'Students',
        icon: GraduationCap,
        title: s.fullName,
        sub: `${s.rollNo} · ${s.departmentCode}-${s.section}`,
        badge: null,
        href: `/students?q=${encodeURIComponent(s.rollNo)}`,
      })),
      ...data.rooms.map((r) => ({
        key: `r${r.id}`,
        group: 'Rooms',
        icon: DoorOpen,
        title: `Room ${r.roomNo}`,
        sub: `${r.block} · ${r.capacity} seats`,
        badge: <RoomStatusBadge status={r.status} />,
        href: `/rooms?q=${encodeURIComponent(r.roomNo)}`,
      })),
    ];
  }, [data, user?.role]);

  useEffect(() => setActive(0), [debounced]);

  const go = (href: string) => {
    setOpen(false);
    setTerm('');
    navigate(href);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group flex h-9 w-full max-w-xs items-center gap-2 rounded-lg border border-line bg-canvas/60 px-3 text-[13px] text-faint shadow-[inset_0_1px_2px_rgb(1_14_10/0.4)] transition-all duration-300 hover:border-accent/40 hover:text-muted"
        aria-label="Search"
      >
        <Search className="h-4 w-4 transition-colors group-hover:text-accent" />
        <span className="hidden flex-1 truncate whitespace-nowrap text-left sm:inline">
          {user?.role === 'ADMIN' ? 'Search exams, students, rooms…' : 'Search my examinations…'}
        </span>
        <kbd className="hidden rounded border border-line bg-raised/60 px-1.5 py-0.5 font-mono text-2xs sm:inline">Ctrl K</kbd>
      </button>
      <D.Root open={open} onOpenChange={setOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-[rgb(1_14_10/0.72)] backdrop-blur-[3px]" />
          <D.Content className="glass edge-light fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 animate-fade-in overflow-hidden rounded-2xl shadow-pop">
            <D.Title className="sr-only">Global search</D.Title>
            <D.Description className="sr-only">Search across records you are allowed to see</D.Description>
            <div className="flex items-center gap-2.5 border-b border-line/80 px-4">
              <Search className="h-4 w-4 text-accent" />
              <input
                autoFocus
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((a) => Math.min(items.length - 1, a + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((a) => Math.max(0, a - 1));
                  } else if (e.key === 'Enter' && items[active]) go(items[active].href);
                }}
                placeholder="Type a course code, exam, roll number or room…"
                className="h-14 flex-1 bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
              />
              {isFetching && <Spinner />}
              <kbd className="hidden rounded border border-line bg-raised/60 px-1.5 py-0.5 font-mono text-2xs text-faint sm:inline">Esc</kbd>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-1.5">
              {!debounced && <p className="px-3 py-6 text-center text-[13px] text-faint">Start typing to search. Results respect your role’s access.</p>}
              {debounced && !isFetching && items.length === 0 && (
                <p className="px-3 py-6 text-center text-[13px] text-faint">No matches for “{debounced}”.</p>
              )}
              {items.map((it, i) => (
                <div key={it.key}>
                  {(i === 0 || items[i - 1].group !== it.group) && (
                    <p className="eyebrow px-2.5 pb-1 pt-2.5">{it.group}</p>
                  )}
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(it.href)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                      i === active && 'bg-raised shadow-[inset_2px_0_0_0_rgb(var(--accent))]',
                    )}
                  >
                    <it.icon className={cn('h-4 w-4 shrink-0', i === active ? 'text-accent' : 'text-faint')} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{it.title}</span>
                      <span className="block truncate text-xs text-muted">{it.sub}</span>
                    </span>
                    {it.badge}
                  </button>
                </div>
              ))}
            </div>
          </D.Content>
        </D.Portal>
      </D.Root>
    </>
  );
}
