'use client';

import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * Renders a QR as inline SVG on a light plate. Cameras want dark modules on a
 * light ground with a quiet zone around them, so this stays light even though
 * the rest of the app is dark — a QR drawn in the page's own colours is
 * noticeably harder to scan.
 */
export function QrCode({
  value,
  size = 248,
  level = 'M',
}: {
  value: string;
  size?: number;
  level?: 'L' | 'M' | 'Q' | 'H';
}) {
  const { count, path } = useMemo(() => {
    const qr = qrcode(0, level); // 0 = pick the smallest version that fits
    qr.addData(value);
    qr.make();

    const modules = qr.getModuleCount();
    const parts: string[] = [];

    for (let row = 0; row < modules; row++) {
      let runStart = -1;
      for (let col = 0; col <= modules; col++) {
        const on = col < modules && qr.isDark(row, col);
        if (on && runStart === -1) runStart = col;
        if (!on && runStart !== -1) {
          parts.push(`M${runStart} ${row}h${col - runStart}v1h-${col - runStart}z`);
          runStart = -1;
        }
      }
    }

    return { count: modules, path: parts.join('') };
  }, [value, level]);

  const quiet = 4;
  const span = count + quiet * 2;

  return (
    <svg
      className="qr"
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Payment QR code"
    >
      <rect width={span} height={span} fill="#ffffff" />
      <g transform={`translate(${quiet} ${quiet})`}>
        <path d={path} fill="#000000" />
      </g>
    </svg>
  );
}
