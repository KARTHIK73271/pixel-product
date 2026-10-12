import * as DM from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end'; className?: string }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={8}
        className={cn(
          'glass edge-light relative z-50 min-w-[200px] animate-fade-in rounded-xl p-1.5 shadow-pop',
          'data-[state=closed]:animate-none',
          className,
        )}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({ children, onSelect, danger, disabled }: { children: ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <DM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] outline-none transition-colors',
        'data-[highlighted]:bg-raised data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        danger ? 'text-bad data-[highlighted]:bg-bad/12' : 'text-ink',
      )}
    >
      {children}
    </DM.Item>
  );
}

export function MenuSeparator() {
  return <DM.Separator className="my-1.5 h-px bg-gradient-to-r from-transparent via-line-strong to-transparent" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="eyebrow px-2.5 py-1.5">{children}</DM.Label>;
}
