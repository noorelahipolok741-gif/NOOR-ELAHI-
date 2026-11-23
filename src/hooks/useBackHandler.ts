import { useEffect, useRef } from 'react';

const pendingCleanupTimers = new Map<string, number>();

/**
 * Keeps transient modals/overlays synchronized with browser/Android hardware Back button.
 * Safely deduplicates React StrictMode double-mount effects.
 */
export function useBackOverlay(isOpen: boolean, onClose: () => void, overlayId: string) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const pendingTimer = pendingCleanupTimers.get(overlayId);
    if (pendingTimer !== undefined) {
      window.clearTimeout(pendingTimer);
      pendingCleanupTimers.delete(overlayId);
    }

    const currentState = (window.history.state && typeof window.history.state === 'object'
      ? window.history.state
      : {}) as Record<string, unknown>;

    if (currentState.__noorOverlay !== overlayId) {
      try {
        window.history.pushState(
          {
            ...currentState,
            __noorOverlay: overlayId,
          },
          ''
        );
      } catch {
        // Ignore history push failure
      }
    }

    const handlePopState = () => {
      const st = (window.history.state && typeof window.history.state === 'object'
        ? window.history.state
        : {}) as Record<string, unknown>;
      if (st.__noorOverlay !== overlayId) {
        onCloseRef.current();
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      const timer = window.setTimeout(() => {
        pendingCleanupTimers.delete(overlayId);
        const st = (window.history.state && typeof window.history.state === 'object'
          ? window.history.state
          : {}) as Record<string, unknown>;
        if (st.__noorOverlay === overlayId) {
          window.history.back();
        }
      }, 40);
      pendingCleanupTimers.set(overlayId, timer);
    };
  }, [isOpen, overlayId]);
}
