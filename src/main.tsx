console.info('[pat-build] v1.03', import.meta.url);
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { router } from './App.tsx';
import './index.css';

// Add error boundary and better error handling
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

// DISABLED: Service worker was causing stale data caching issues
// Unregister any existing service workers
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      console.log('[SW] Unregistering service worker to prevent stale data');
      registration.unregister();
    });
  });
}

try {
  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary>
        <Toaster position="top-right" />
        <RouterProvider router={router} />
      </ErrorBoundary>
    </StrictMode>
  );
} catch (error) {
  console.error('Failed to render app:', error);
  rootElement.innerHTML = `
    <div style="padding: 20px; text-align: center; font-family: system-ui; color: black;">
      <h1>Application Error</h1>
      <p>Failed to load the application. Please check the console for details.</p>
      <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; text-align: left; margin-top: 20px; color: black;">${error}</pre>
    </div>
  `;
}
