interface IconProps {
  size?: number;
}

const S = ({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);

export const ChevronLeft = (p: IconProps) => (
  <S {...p}>
    <path d="M15 18l-6-6 6-6" />
  </S>
);

export const ChevronRight = (p: IconProps) => (
  <S {...p}>
    <path d="M9 6l6 6-6 6" />
  </S>
);

export const ChevronDown = (p: IconProps) => (
  <S {...p}>
    <path d="M6 9l6 6 6-6" />
  </S>
);

export const Menu = (p: IconProps) => (
  <S {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </S>
);

export const Plus = (p: IconProps) => (
  <S {...p}>
    <path d="M12 5v14M5 12h14" />
  </S>
);

export const SearchIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </S>
);

export const Gear = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </S>
);

export const Bell = (p: IconProps) => (
  <S {...p}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </S>
);

export const BellFilled = ({ size = 12 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a1.5 1.5 0 0 0-1.5 1.5v.6A6.5 6.5 0 0 0 5.5 10.5v4.8l-1.7 2.5c-.45.67.03 1.57.83 1.57h14.74c.8 0 1.28-.9.83-1.57l-1.7-2.5v-4.8a6.5 6.5 0 0 0-5-6.4v-.6A1.5 1.5 0 0 0 12 2zm-2.3 19.4a2.3 2.3 0 0 0 4.6 0z" />
  </svg>
);

export const Clock = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </S>
);

export const Pin = (p: IconProps) => (
  <S {...p}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0z" />
    <circle cx="12" cy="10" r="2.5" />
  </S>
);

export const Notes = (p: IconProps) => (
  <S {...p}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </S>
);

export const Repeat = (p: IconProps) => (
  <S {...p}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </S>
);

export const CalIcon = (p: IconProps) => (
  <S {...p}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M8 2v4M16 2v4M3 9h18" />
  </S>
);

export const Trash = (p: IconProps) => (
  <S {...p}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </S>
);

export const Pencil = (p: IconProps) => (
  <S {...p}>
    <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </S>
);

export const Close = (p: IconProps) => (
  <S {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </S>
);

export const Upload = (p: IconProps) => (
  <S {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M17 8l-5-5-5 5M12 3v12" />
  </S>
);

export const Palette = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="8.5" cy="10" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="10" r="1" fill="currentColor" stroke="none" />
    <path d="M12 21a2.2 2.2 0 0 0 2-3.2 2.2 2.2 0 0 1 2-3.3H19a2 2 0 0 0 2-2" />
  </S>
);

/* view glyphs for the calendar menu (Google Calendar style) */

export const ViewSchedule = (p: IconProps) => (
  <S {...p}>
    <rect x="4" y="4" width="16" height="6" rx="1.5" />
    <rect x="4" y="14" width="16" height="6" rx="1.5" />
  </S>
);

export const ViewDay = (p: IconProps) => (
  <S {...p}>
    <rect x="4" y="4" width="16" height="4" rx="1.5" />
    <rect x="4" y="12" width="16" height="8" rx="1.5" />
  </S>
);

export const View3Day = (p: IconProps) => (
  <S {...p}>
    <rect x="3" y="4" width="4.7" height="16" rx="1.2" />
    <rect x="9.7" y="4" width="4.7" height="16" rx="1.2" />
    <rect x="16.4" y="4" width="4.7" height="16" rx="1.2" />
  </S>
);

export const ViewWeek = (p: IconProps) => (
  <S {...p}>
    <rect x="3" y="4" width="3.2" height="16" rx="1" />
    <rect x="8" y="4" width="3.2" height="16" rx="1" />
    <rect x="13" y="4" width="3.2" height="16" rx="1" />
    <rect x="18" y="4" width="3.2" height="16" rx="1" />
  </S>
);

export const ViewMonth = (p: IconProps) => (
  <S {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M4 10h16M4 15h16M9.3 10v10M14.6 10v10" />
  </S>
);

export const GoogleG = ({ size = 15 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.5 5.5 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.87-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.96H1.29v3.1A12 12 0 0 0 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.29a12 12 0 0 0 0 10.76l3.99-3.1z"
    />
    <path
      fill="#EA4335"
      d="M12 4.77c1.76 0 3.34.6 4.59 1.8l3.44-3.44A12 12 0 0 0 1.29 6.62l3.99 3.1C6.22 6.88 8.87 4.77 12 4.77z"
    />
  </svg>
);
