import * as D from '@radix-ui/react-dialog';
import { AlertTriangle, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-[rgb(1_14_10/0.72)] backdrop-blur-[3px]" />
        <D.Content
          className={cn(
            'glass edge-light fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] animate-scale-in flex-col rounded-2xl shadow-pop',
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line/80 px-5 py-4">
            <div>
              <D.Title className="display text-[17px] text-ink">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1 text-[13px] text-muted">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</D.Description>
              )}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </D.Close>
          </div>
          {children && <div className="overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t border-line/80 bg-canvas/30 px-5 py-3.5">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Confirmation dialog for consequential actions. `onConfirm` may return a promise; errors keep it open. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'primary',
  onConfirm,
  children,
  confirmDisabled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => Promise<unknown> | unknown;
  children?: ReactNode;
  confirmDisabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          {tone === 'danger' && <AlertTriangle className="h-4 w-4 text-bad" />}
          {title}
        </span>
      }
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            disabled={confirmDisabled}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch {
                /* caller surfaces the error via toast */
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
