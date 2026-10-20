/** TrueSight mark: a lens ring with a focused pupil. */
export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.2" />
      <circle cx="12" cy="12" r="6" fill="none" stroke="#8fd8ff" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.2" fill="#8fd8ff" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span className="display text-[21px] leading-none">
        True<span className="italic text-signal">Sight</span>
      </span>
    </span>
  );
}
