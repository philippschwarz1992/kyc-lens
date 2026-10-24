import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const animationId = 'kyc-screen-transition';
const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Animate existing screen regions without remounting the camera or delaying navigation. */
export function useScreenTransition(container: RefObject<HTMLElement | null>, screen: string) {
  const previousScreen = useRef(screen);

  useBrowserLayoutEffect(() => {
    // Also avoids an initial animation when StrictMode replays mount effects.
    if (previousScreen.current === screen) return;
    previousScreen.current = screen;
    const root = container.current;
    if (!root || typeof root.animate !== 'function') return;
    const motion = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined;
    if (motion?.matches) return;

    // Theme motion tokens; the classic values apply when the stylesheet is missing.
    const tokens = getComputedStyle(root);
    const themeEasing = tokens.getPropertyValue('--kyc-motion-easing').trim() || easing;
    const scale = Number.parseFloat(tokens.getPropertyValue('--kyc-motion-duration-scale')) || 1;
    const entrance = tokens.getPropertyValue('--kyc-motion-entrance').trim() || 'rise';
    const animations: Animation[] = [];
    const animate = (selector: string, distance: number, duration: number) => {
      for (const target of root.querySelectorAll<HTMLElement>(selector)) {
        // A child stage can change while the parent entry animation is still finishing.
        for (const current of target.getAnimations()) if (current.id === animationId) current.cancel();
        const frames: Keyframe[] = distance <= 0 ? [{ opacity: 0.35 }, { opacity: 1 }]
          : entrance === 'fade' ? [{ opacity: 0 }, { opacity: 1 }]
          : entrance === 'scale' ? [{ opacity: 0, transform: `translateY(${distance / 2}px) scale(.96)` }, { opacity: 1, transform: 'translateY(0) scale(1)' }]
          : [{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: 'translateY(0)' }];
        let animation: Animation;
        try { animation = target.animate(frames, { duration: duration * scale, easing: themeEasing }); }
        catch { animation = target.animate(frames, { duration: duration * scale, easing }); }
        animation.id = animationId;
        animations.push(animation);
      }
    };

    animate('.kyc-screen > .kyc-screen-heading', 8, 260);
    animate('.kyc-screen > .kyc-media, .kyc-screen > .kyc-document-body, .kyc-screen > .kyc-face-body', 12, 320);
    // Bottom controls fade in place: their position never moves between screens.
    animate('.kyc-screen > .kyc-actions', 0, 220);

    const stop = () => { for (const animation of animations) animation.cancel(); };
    const preferenceChanged = () => { if (motion?.matches) stop(); };
    motion?.addEventListener('change', preferenceChanged);
    return () => { stop(); motion?.removeEventListener('change', preferenceChanged); };
  }, [container, screen]);
}
