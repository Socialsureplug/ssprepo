import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminRoutes } from './routes';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: (n, e: any) => n < 2 && (e?.status ?? 500) >= 500, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AdminRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
