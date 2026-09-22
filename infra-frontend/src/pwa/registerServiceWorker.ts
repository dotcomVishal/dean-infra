// Service Worker Registration for Deanery of Infrastructure PWA

export function registerServiceWorker() {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        console.log('[PWA] Service Worker registered successfully with scope:', registration.scope);

        // Check for updates periodically
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  console.log('[PWA] New content is available; please refresh.');
                  // Dispatch custom event if UI wants to display an update banner
                  window.dispatchEvent(new CustomEvent('pwa-update-available'));
                } else {
                  console.log('[PWA] Content is cached for offline use.');
                }
              }
            });
          }
        });

        // Detect controller change
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing) {
            refreshing = true;
            // Optionally reload or let user choose
          }
        });

      } catch (error) {
        console.warn('[PWA] Service Worker registration failed:', error);
      }
    });
  }
}
