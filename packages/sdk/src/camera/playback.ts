/**
 * Starts a muted camera preview. Browsers can still block it (iOS Low Power Mode, strict autoplay
 * policies) with NotAllowedError, which is not a camera-permission failure. The preview then resumes
 * on the user's next tap or key press; `onBlocked` lets the screen ask for one.
 */
export function playPreview(video: HTMLVideoElement, signal: AbortSignal, onBlocked: (blocked: boolean) => void): Promise<void> {
  return video.play().catch((error: unknown) => {
    if ((error as { name?: unknown } | null)?.name !== 'NotAllowedError') throw error;
    if (signal.aborted) throw new DOMException('Camera preview was cancelled.', 'AbortError');
    onBlocked(true);
    return new Promise<void>((resolve, reject) => {
      // play() must run inside the gesture handler for the browser to count it as user-initiated.
      const retry = (): void => { void video.play().then(() => { cleanup(); onBlocked(false); resolve(); }, () => {}); };
      const abort = (): void => { cleanup(); reject(new DOMException('Camera preview was cancelled.', 'AbortError')); };
      const cleanup = (): void => {
        document.removeEventListener('pointerdown', retry, true); document.removeEventListener('keydown', retry, true);
        signal.removeEventListener('abort', abort);
      };
      document.addEventListener('pointerdown', retry, true); document.addEventListener('keydown', retry, true);
      signal.addEventListener('abort', abort, { once: true });
    });
  });
}
