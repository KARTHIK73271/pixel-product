import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import { ApiError } from './lib/api';
import { AuthProvider } from './lib/auth';
import { ThemeProvider, useTheme } from './lib/theme';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

// After any successful write (see lib/api.ts), refetch everything visible.
window.addEventListener('data:changed', () => {
  void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
});

/** Toasts are portalled outside the app tree, so they need the theme handed to them. */
function AppToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: '!bg-surface !border !border-line !text-ink !text-[13px]',
          description: '!text-muted',
        },
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <App />
            <AppToaster />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
