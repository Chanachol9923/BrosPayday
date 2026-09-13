type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const Plus = ({ size = 20 }: P) => (
  <svg {...base(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Check = ({ size = 16 }: P) => (
  <svg {...base(size)} strokeWidth={3}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const X = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const Arrow = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const Chevron = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const Dots = ({ size = 20 }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export const Trash = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />
  </svg>
);

export const Copy = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

export const Link = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
  </svg>
);

export const Sparkle = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
  </svg>
);

export const Warn = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
);

export const Users = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 20v-2a4 4 0 0 0-3-3.9" />
  </svg>
);

export const Receipt = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M5 21V4a1 1 0 0 1 1.5-.9L9 4.5l2.5-1.4a1 1 0 0 1 1 0L15 4.5l2.5-1.4A1 1 0 0 1 19 4v17l-2.5-1.4a1 1 0 0 0-1 0L13 21l-2.5-1.4a1 1 0 0 0-1 0Z" />
    <path d="M9 9h6M9 13h4" />
  </svg>
);

export const Scale = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6h6ZM19 7l-3 6h6Z" />
  </svg>
);

export const Party = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M4.5 20.5 9 9l6 6-11.5 4.5a.8.8 0 0 1-1-1Z" />
    <path d="M14 6.5a2.5 2.5 0 0 1 3.5-3M19 11a2 2 0 0 1 2-2M12.5 3.5 13 4M20 15.5l.5.5" />
  </svg>
);

export const Clock = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </svg>
);

export const Bookmark = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z" />
  </svg>
);

export const Share = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M12 3v13M8 7l4-4 4 4" />
    <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
  </svg>
);

export const Calendar = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

export const Pencil = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
  </svg>
);

export const Inbox = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M12 3v11M8 10l4 4 4-4" />
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </svg>
);

export const Swap = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M7 4 4 7l3 3M4 7h11a4 4 0 0 1 4 4" />
    <path d="m17 20 3-3-3-3M20 17H9a4 4 0 0 1-4-4" />
  </svg>
);
