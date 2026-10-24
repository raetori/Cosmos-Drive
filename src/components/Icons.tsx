import type { ReactNode, SVGProps } from 'react'
import { isFolder } from '../lib/paths'

type P = SVGProps<SVGSVGElement>

const base = (props: P) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
})

export const Logo = (p: P) => (
  <svg {...base({ width: 28, height: 28, ...p })} viewBox="0 0 32 32" strokeWidth={1.4}>
    <defs>
      <radialGradient id="cosmos-core" cx="40%" cy="35%" r="70%">
        <stop offset="0" stopColor="#fff6dc" />
        <stop offset=".45" stopColor="var(--accent-2)" />
        <stop offset="1" stopColor="var(--accent)" />
      </radialGradient>
    </defs>
    <circle cx="16" cy="16" r="6.2" fill="url(#cosmos-core)" stroke="none" />
    <ellipse cx="16" cy="16" rx="14" ry="5.2" transform="rotate(-24 16 16)" stroke="var(--text)" opacity=".75" />
    <circle cx="28.2" cy="10.6" r="1.4" fill="var(--text)" stroke="none" />
  </svg>
)

export const Chevron = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
)
export const Back = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
)
export const Forward = Chevron
export const Up = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
)
export const Refresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </svg>
)
export const Search = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </svg>
)
export const Plus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)
export const LinkIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
)
export const Settings = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
)
export const Close = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)
export const CopyDown = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v12M7 10l5 5 5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
)
export const Zip = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M11 3v2h2v2h-2v2h2v2h-2v2" />
    <rect x="10" y="14" width="4" height="4" rx="1" />
  </svg>
)
export const Check = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
)
export const Alert = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l9.5 17h-19z" />
    <path d="M12 10v4M12 17.5v.01" />
  </svg>
)
export const Play = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 5l11 7-11 7z" />
  </svg>
)
export const Logout = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />
  </svg>
)

export const DriveIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8.5 3.5h7l6 10.5-3.5 6h-12l-3.5-6z" />
    <path d="M8.5 3.5l6 10.5M2.5 14h19M15.5 3.5L9.5 14" opacity=".55" />
  </svg>
)
export const SharedDriveIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <circle cx="9.5" cy="11" r="2" />
    <circle cx="15" cy="11" r="2" />
    <path d="M6.5 16.5c.6-1.5 1.8-2.2 3-2.2s2.4.7 3 2.2M12.5 16.5c.5-1.3 1.5-2 2.5-2s2 .7 2.5 2" />
  </svg>
)
export const PeopleIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19c.8-3 3.2-4.6 6-4.6s5.2 1.6 6 4.6" />
    <path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.6c1.6.6 2.6 2 3 4.4" />
  </svg>
)

const FILE_COLORS: Record<string, string> = {
  folder: 'var(--accent)',
  video: '#ff8fb1',
  image: '#7fd6ff',
  audio: '#ffc86b',
  doc: '#8fb2ff',
  sheet: '#7ee0a6',
  slides: '#ffb36b',
  pdf: '#ff7a7a',
  file: 'var(--muted)',
}

function familyOf(mime: string): keyof typeof FILE_COLORS {
  if (isFolder(mime)) return 'folder'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('image/') || mime.endsWith('.drawing')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.endsWith('.document') || mime.includes('wordprocessing') || mime.startsWith('text/')) return 'doc'
  if (mime.endsWith('.spreadsheet') || mime.includes('spreadsheet') || mime.includes('csv')) return 'sheet'
  if (mime.endsWith('.presentation') || mime.includes('presentation')) return 'slides'
  return 'file'
}

export function FileIcon({ mimeType, ...p }: P & { mimeType: string }) {
  const fam = familyOf(mimeType)
  const color = FILE_COLORS[fam]
  if (fam === 'folder') {
    return (
      <svg {...base(p)} stroke={color}>
        <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2h8.8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill={color} fillOpacity=".16" />
      </svg>
    )
  }
  const glyph: Record<string, ReactNode> = {
    video: <path d="M10 11.5v5l4-2.5z" fill={color} />,
    image: <path d="M8 17l2.8-3.4 2 2.2 1.6-1.8L17 17z" fill={color} />,
    audio: <path d="M11 17.5a1.5 1.5 0 1 1-1.5-1.5c.6 0 1.5.3 1.5.3V11l4-1v2" />,
    doc: <path d="M8.5 12.5h7M8.5 15h7M8.5 17.5h4.5" />,
    sheet: <path d="M8.5 11.5h7v6.5h-7zM8.5 14.7h7M12 11.5V18" />,
    slides: <rect x="8.5" y="12" width="7" height="5" rx=".8" />,
    pdf: <path d="M8.5 16.5h7M8.5 13.5h4" />,
    file: null,
  }
  return (
    <svg {...base(p)} stroke={color}>
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill={color} fillOpacity=".1" />
      <path d="M14 3v4h4" />
      {glyph[fam]}
    </svg>
  )
}
