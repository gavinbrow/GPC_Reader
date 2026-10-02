import type { ReactElement, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const S = ({ size = 16, children, ...rest }: P & { children: React.ReactNode }): ReactElement => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...rest}>
    {children}
  </svg>
);

export const IconExperiment = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="7" fill="#1565c0" />
    <path d="M4.5 11.5 L8 3.8 L11.5 11.5" stroke="#fff" strokeWidth="1.6" fill="none" />
    <path d="M5.9 8.8 H10.1" stroke="#fff" strokeWidth="1.3" />
  </S>
);

export const IconEasi = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="7" fill="#1e88e5" />
    <rect x="4.5" y="4" width="7" height="8" rx="1" fill="#fff" />
    <path d="M6 6h4M6 8h4M6 10h4" stroke="#1e88e5" strokeWidth="1" />
  </S>
);

export const IconGear = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="2.2" stroke="#555" strokeWidth="1.4" />
    <path
      d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
      stroke="#555"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </S>
);

export const IconFolder = ({ open, ...p }: P & { open?: boolean }) => (
  <S {...p}>
    <path d="M1.5 4h4.5l1.5 1.5h7v7.5h-13z" fill={open ? '#f5d77a' : '#e8c35a'} stroke="#a8862a" strokeWidth="0.8" />
    {open && <path d="M1.5 13l2-6h12l-2 6z" fill="#fbe7a1" stroke="#a8862a" strokeWidth="0.8" />}
  </S>
);

export const IconProcedure = (p: P) => (
  <S {...p}>
    <rect x="3" y="1.5" width="10" height="13" fill="#fff" stroke="#3b4a6b" strokeWidth="1" />
    <path d="M5 5h6M5 7.5h6M5 10h4" stroke="#3b4a6b" strokeWidth="1" />
    <rect x="3" y="1.5" width="10" height="2" fill="#3b4a6b" />
  </S>
);

export const IconResult = (p: P) => (
  <S {...p}>
    <rect x="2" y="2" width="12" height="12" fill="#fff" stroke="#3b4a6b" strokeWidth="1" />
    <path d="M3.5 11.5 L6 7 L8.5 9.5 L12.5 4" stroke="#c62828" strokeWidth="1.3" fill="none" />
  </S>
);

export const IconTable = (p: P) => (
  <S {...p}>
    <rect x="2" y="2.5" width="12" height="11" fill="#fff" stroke="#3b4a6b" strokeWidth="1" />
    <path d="M2 6h12M2 9.5h12M6.5 2.5v11" stroke="#3b4a6b" strokeWidth="0.9" />
  </S>
);

export const IconOpen = (p: P) => (
  <S {...p}>
    <path d="M1.5 4h4.5l1.5 1.5h6v2" stroke="#a8862a" fill="#e8c35a" strokeWidth="0.8" />
    <path d="M1.5 13.5l2.5-6h11.5l-2.5 6z" fill="#f5d77a" stroke="#a8862a" strokeWidth="0.8" />
    <path d="M1.5 4v9.5" stroke="#a8862a" strokeWidth="0.8" />
  </S>
);

export const IconSave = (p: P) => (
  <S {...p}>
    <rect x="2" y="2" width="12" height="12" rx="1" fill="#3f51b5" />
    <rect x="4.5" y="2" width="7" height="4.5" fill="#e8eaf6" />
    <rect x="4" y="9" width="8" height="5" fill="#fff" />
  </S>
);

export const IconPrint = (p: P) => (
  <S {...p}>
    <rect x="4" y="1.5" width="8" height="4" fill="#fff" stroke="#555" />
    <rect x="1.5" y="5.5" width="13" height="6" rx="1" fill="#9e9e9e" />
    <rect x="4" y="9.5" width="8" height="5" fill="#fff" stroke="#555" />
  </S>
);

export const IconRun = (p: P) => (
  <S {...p}>
    <path d="M4 2.5 L13 8 L4 13.5z" fill="#2e7d32" />
  </S>
);

export const IconZoomIn = (p: P) => (
  <S {...p}>
    <circle cx="6.5" cy="6.5" r="4.5" stroke="#1f3a6e" strokeWidth="1.4" fill="#e3f2fd" />
    <path d="M10 10l4.5 4.5" stroke="#1f3a6e" strokeWidth="2" />
    <path d="M4.5 6.5h4M6.5 4.5v4" stroke="#1f3a6e" strokeWidth="1.3" />
  </S>
);

export const IconZoomOut = (p: P) => (
  <S {...p}>
    <circle cx="6.5" cy="6.5" r="4.5" stroke="#1f3a6e" strokeWidth="1.4" fill="#e3f2fd" />
    <path d="M10 10l4.5 4.5" stroke="#1f3a6e" strokeWidth="2" />
    <path d="M4.5 6.5h4" stroke="#1f3a6e" strokeWidth="1.3" />
  </S>
);

export const IconZoomRect = (p: P) => (
  <S {...p}>
    <rect x="2" y="3" width="12" height="10" stroke="#1f3a6e" strokeDasharray="2 1.5" strokeWidth="1.2" />
    <path d="M5 8h6M8 5v6" stroke="#1f3a6e" strokeWidth="1" />
  </S>
);

export const IconPan = (p: P) => (
  <S {...p}>
    <path d="M8 1.5v13M1.5 8h13" stroke="#1f3a6e" strokeWidth="1.3" />
    <path d="M8 1.5l-2 2.2M8 1.5l2 2.2M8 14.5l-2-2.2M8 14.5l2-2.2M1.5 8l2.2-2M1.5 8l2.2 2M14.5 8l-2.2-2M14.5 8l-2.2 2" stroke="#1f3a6e" strokeWidth="1.3" />
  </S>
);

export const IconFit = (p: P) => (
  <S {...p}>
    <rect x="2" y="2" width="12" height="12" stroke="#1f3a6e" strokeWidth="1.2" />
    <path d="M4 11 Q6 3 8 9 T12 5" stroke="#c62828" strokeWidth="1.2" fill="none" />
  </S>
);

export const IconCamera = (p: P) => (
  <S {...p}>
    <rect x="1.5" y="4.5" width="13" height="9" rx="1.5" fill="#607d8b" />
    <circle cx="8" cy="9" r="2.6" fill="#fff" />
    <rect x="5" y="2.5" width="6" height="2" fill="#607d8b" />
  </S>
);

export const IconAutofind = (p: P) => (
  <S {...p}>
    <path d="M1.5 13.5 Q5 13.5 6.5 4 Q8 13.5 14.5 13.5" stroke="#c62828" strokeWidth="1.3" fill="none" />
    <path d="M1.5 14.5h13" stroke="#333" strokeWidth="1" />
    <path d="M11 2l1 2 2 .3-1.5 1.4.4 2-1.9-1-1.9 1 .4-2L8 4.3l2-.3z" fill="#fbc02d" />
  </S>
);

export const IconFx = (p: P) => (
  <S {...p}>
    <text x="1" y="12.5" fontSize="11" fontStyle="italic" fontFamily="Georgia, serif" fill="#333">
      fx
    </text>
  </S>
);

export const IconInstrument = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="7" fill="#1565c0" />
    <rect x="4" y="5" width="8" height="6" rx="1" fill="#fff" />
    <circle cx="8" cy="8" r="1.5" fill="#1565c0" />
  </S>
);

export const IconSequence = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="7" fill="#1565c0" />
    <path d="M5 5h6M5 8h6M5 11h6" stroke="#fff" strokeWidth="1.4" />
  </S>
);

export const IconProfile = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="7" fill="#1565c0" />
    <circle cx="8" cy="6.3" r="2" fill="#fff" />
    <path d="M4.5 12c.6-2.3 2-3.2 3.5-3.2s2.9.9 3.5 3.2" fill="#fff" />
  </S>
);

export const IconInfo = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="7" fill="#1565c0" />
    <path d="M8 7v5" stroke="#fff" strokeWidth="1.8" />
    <circle cx="8" cy="4.6" r="1.1" fill="#fff" />
  </S>
);

export const IconWarning = (p: P) => (
  <S {...p}>
    <path d="M8 1.5L15 14H1z" fill="#f9a825" />
    <path d="M8 6v4" stroke="#000" strokeWidth="1.5" />
    <circle cx="8" cy="12" r="0.9" fill="#000" />
  </S>
);

export const IconClose = (p: P) => (
  <S {...p}>
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" />
  </S>
);

export const IconPlus = (p: P) => (
  <S {...p}>
    <path d="M8 3v10M3 8h10" stroke="#2e7d32" strokeWidth="2" />
  </S>
);

export const IconMinus = (p: P) => (
  <S {...p}>
    <path d="M3 8h10" stroke="#c62828" strokeWidth="2" />
  </S>
);

export const IconExport = (p: P) => (
  <S {...p}>
    <rect x="2" y="2" width="9" height="12" fill="#fff" stroke="#3b4a6b" />
    <path d="M7 8h7M11.5 5.5L14 8l-2.5 2.5" stroke="#2e7d32" strokeWidth="1.5" fill="none" />
  </S>
);

/** Draw a range: a shaded band between two edges. */
export const IconRange = (p: P) => (
  <S {...p}>
    <rect x="4" y="2.5" width="8" height="11" fill="#90b4e4" opacity="0.6" />
    <path d="M4 2v12M12 2v12" stroke="#1565c0" strokeWidth="1.4" />
    <path d="M1.5 8h4M10.5 8h4" stroke="#333" strokeWidth="1" />
  </S>
);

export const IconUndo = (p: P) => (
  <S {...p}>
    <path d="M4.5 6.5H10a3.5 3.5 0 0 1 0 7H6" stroke="#2b579a" strokeWidth="1.5" fill="none" />
    <path d="M7 3.5 4 6.5l3 3" stroke="#2b579a" strokeWidth="1.5" fill="none" />
  </S>
);

export const IconRedo = (p: P) => (
  <S {...p}>
    <path d="M11.5 6.5H6a3.5 3.5 0 0 0 0 7h4" stroke="#2b579a" strokeWidth="1.5" fill="none" />
    <path d="M9 3.5l3 3-3 3" stroke="#2b579a" strokeWidth="1.5" fill="none" />
  </S>
);

export const IconPrev = (p: P) => (
  <S {...p}>
    <path d="M10 3.5 5.5 8l4.5 4.5" stroke="#333" strokeWidth="1.6" fill="none" />
  </S>
);

export const IconNext = (p: P) => (
  <S {...p}>
    <path d="M6 3.5 10.5 8 6 12.5" stroke="#333" strokeWidth="1.6" fill="none" />
  </S>
);

export const IconTrash = (p: P) => (
  <S {...p}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" stroke="#b71c1c" strokeWidth="1.2" fill="none" />
    <path d="M7 7v4.5M9 7v4.5" stroke="#b71c1c" strokeWidth="1" />
  </S>
);
