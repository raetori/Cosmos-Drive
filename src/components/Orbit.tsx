/**
 * The orb-on-ring from the Creation of Cosmos boot screen: a point of light
 * drifting round a thin ring that fills with progress. It means "working on
 * it" and is never used as a logo.
 */
export function Orbit({ size = 18, progress }: { size?: number; progress?: number }) {
  return (
    <span className="orbit" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24">
        <circle className="orbit-ring" cx="12" cy="12" r="9" />
        {progress !== undefined && (
          <circle className="orbit-fill" cx="12" cy="12" r="9" pathLength={1} strokeDasharray={`${Math.max(0, Math.min(1, progress))} 1`} />
        )}
      </svg>
      <span className="orbit-arm" />
    </span>
  )
}
