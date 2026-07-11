/**
 * ADHD Calendar mark: a bell mid-swing on a calendar tile — the app in one
 * image: a calendar that rings. The spark is the "now!" moment.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="adhd-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2b8a72" />
          <stop offset="1" stopColor="#175a4c" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#adhd-logo-bg)" />
      {/* calendar binding rings */}
      <rect x="13" y="6" width="4" height="8" rx="2" fill="#fafaf8" opacity="0.9" />
      <rect x="31" y="6" width="4" height="8" rx="2" fill="#fafaf8" opacity="0.9" />
      {/* bell, mid-swing */}
      <g transform="rotate(14 24 27)">
        <path
          d="M24 14c-1.2 0-2.1.9-2.1 2.1v.8c-4.3 1-7.4 4.8-7.4 9.3v5.6l-2.2 3.2c-.6.9 0 2 1.1 2h21.2c1.1 0 1.7-1.1 1.1-2l-2.2-3.2v-5.6c0-4.5-3.1-8.3-7.4-9.3v-.8c0-1.2-.9-2.1-2.1-2.1z"
          fill="#fafaf8"
        />
        <path d="M20.8 38.5a3.2 3.2 0 0 0 6.4 0z" fill="#fafaf8" />
      </g>
      {/* motion lines */}
      <path d="M10 20c-1.4 1.8-2.2 4-2.4 6.3" stroke="#fafaf8" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.55" />
      {/* the "now!" spark */}
      <path d="M37.5 13.5l1.1 2.7 2.7 1.1-2.7 1.1-1.1 2.7-1.1-2.7-2.7-1.1 2.7-1.1z" fill="#f6b93b" />
    </svg>
  );
}
