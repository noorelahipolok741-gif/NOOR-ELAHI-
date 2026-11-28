import { useEffect, useRef } from 'react';

const pendingCleanupTimers = new Map<string, number>();

interface OverlayEntry {
  id: string;
  onClose: () => void;
}

const activeOverlayStack: OverlayEntry[] = [];

/**
 * Closes the topmost open transient overlay registered via useBackOverlay.
 * Returns true if an overlay was closed, false if none are open.
 */
export function handleTopOverlayBack(): boolean {
  const top = activeOverlayStack[activeOverlayStack.length - 1];
  if (!top) return false;
  try {
    top.onClose();
  } catch {
    // Ignore close callback error
  }
  return true;
}

/**
 * Keeps transient modals/overlays synchronized with browser/Android hardware Back button.
 * Safely deduplicates React StrictMode double-mount effects and works natively via OnBackPressedDispatcher.
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

    const entry: OverlayEntry = {
      id: overlayId,
      onClose: () => onCloseRef.current(),
    };
    const existingIdx = activeOverlayStack.findIndex((o) => o.id === overlayId);
    if (existingIdx !== -1) {
      activeOverlayStack.splice(existingIdx, 1);
    }
    activeOverlayStack.push(entry);

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
      const idx = activeOverlayStack.indexOf(entry);
      if (idx !== -1) {
        activeOverlayStack.splice(idx, 1);
      }
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
