'use client';

import { useEffect } from 'react';

/**
 * Keeps the on-screen keyboard from sitting on top of whatever you are typing in.
 *
 * The two platforms solve this differently, so both are used and they do not
 * fight:
 *
 *   Android Chrome honours `interactive-widget=resizes-content` in the viewport
 *   meta — the layout viewport itself shrinks, so dvh units and fixed bottom
 *   elements move up on their own and the measurement below comes out as zero.
 *
 *   iOS Safari leaves the layout alone and only moves the *visual* viewport, so
 *   nothing reflows and a fixed footer stays underneath the keyboard. There the
 *   measurement is the keyboard's height, and `--kb` lifts things clear.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;

    const apply = () => {
      // What the keyboard covers: the window minus what is actually visible,
      // less however far the visual viewport has been scrolled.
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Ignore a few pixels of browser chrome jitter.
      root.style.setProperty('--kb', covered > 40 ? `${Math.round(covered)}px` : '0px');
    };

    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    apply();

    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      root.style.setProperty('--kb', '0px');
    };
  }, []);
}
