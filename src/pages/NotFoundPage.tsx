import { Compass } from 'lucide-react';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { homeFor, useAuth } from '@/lib/auth';

export function NotFoundPage() {
  useBreadcrumbs([{ label: 'Not found' }]);
  const { user } = useAuth();
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      description="The page doesn’t exist or you don’t have access to it."
      action={
        <LinkButton variant="primary" size="sm" to={user ? homeFor(user.role) : '/login'}>
          Go to my dashboard
        </LinkButton>
      }
    />
  );
}
