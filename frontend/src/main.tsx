import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import { AuthProvider } from '@/features/auth/AuthContext';
import { AppRouter } from '@/router';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import './index.css';

// Sentry: solo activo si hay DSN configurado (permite correr sin él en local si se prefiere)
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE, // 'development' | 'production'
    // Activo, no comentado: dato de linaje genético es sensible, minimizamos
    // qué viaja a un servidor externo por default.
    sendDefaultPii: false,
  });
}

// TanStack Query: cache y reintentos de datos del servidor. staleTime corto
// porque los datos de campo cambian durante la jornada.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);