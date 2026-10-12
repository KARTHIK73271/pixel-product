import { ChevronRight } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface Crumb {
  label: string;
  to?: string;
}

const Ctx = createContext<{ crumbs: Crumb[]; set: (c: Crumb[]) => void }>({ crumbs: [], set: () => undefined });

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, set] = useState<Crumb[]>([]);
  return <Ctx.Provider value={{ crumbs, set }}>{children}</Ctx.Provider>;
}

/** Pages declare their breadcrumb trail; the top bar renders it. */
export function useBreadcrumbs(crumbs: Crumb[]) {
  const { set } = useContext(Ctx);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(JSON.parse(key));
    document.title = `${(JSON.parse(key) as Crumb[]).at(-1)?.label ?? 'Exam Section'} · Smart Exam Section`;
  }, [key, set]);
}

export function Breadcrumbs() {
  const { crumbs } = useContext(Ctx);
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-[13px] md:flex">
      {crumbs.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint/70" />}
          {c.to && i < crumbs.length - 1 ? (
            <Link to={c.to} className="truncate text-muted transition-colors hover:text-ink">
              {c.label}
            </Link>
          ) : (
            <span
              className="truncate rounded-md border border-line/70 bg-raised/50 px-2 py-0.5 font-medium text-ink"
              aria-current={i === crumbs.length - 1 ? 'page' : undefined}
            >
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
