import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

/** Paper-style preview on screen; the toolbar is hidden when printing / saving as PDF. */
export function PrintFrame({ title, children, ready }: { title: string; children: ReactNode; ready: boolean }) {
  const navigate = useNavigate();
  useEffect(() => {
    document.title = title;
  }, [title]);
  return (
    <div className="min-h-full bg-canvas print:bg-white">
      <div className="no-print sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-canvas/90 px-4 py-2.5 backdrop-blur">
        <Button variant="ghost" size="sm" onClick={() => (window.history.length > 1 ? navigate(-1) : window.close())}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <span className="text-[13px] text-muted">{title}</span>
        <Button variant="primary" size="sm" className="ml-auto" disabled={!ready} onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </Button>
      </div>
      <div className="mx-auto my-6 w-full max-w-[210mm] bg-white px-[12mm] py-[12mm] text-[#111] shadow-pop print:my-0 print:max-w-none print:p-0 print:shadow-none">
        <div className="print-sheet">{children}</div>
      </div>
    </div>
  );
}

export function SheetHeader({ title, subtitle, right }: { title: string; subtitle: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between border-b-2 border-[#111] pb-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#444]">University Examination Cell</p>
        <h1 className="mt-1 text-lg font-bold text-[#111]">{title}</h1>
        <p className="text-[12px] text-[#333]">{subtitle}</p>
      </div>
      {right}
    </div>
  );
}

export function Meta({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <div className="mb-4 grid grid-cols-3 gap-x-6 gap-y-1.5 text-[12px]">
      {items.map((i) => (
        <div key={i.k}>
          <span className="text-[#555]">{i.k}: </span>
          <span className="font-medium text-[#111]">{i.v}</span>
        </div>
      ))}
    </div>
  );
}
