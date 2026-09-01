export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="logo-grad" x1="0" y1="22" x2="14" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1D4ED8" />
            <stop offset="100%" stopColor="#3B82F6" />
          </linearGradient>
        </defs>
        <rect x="1"  y="14" width="4" height="7" rx="1" fill="url(#logo-grad)" />
        <rect x="7"  y="10" width="4" height="11" rx="1" fill="url(#logo-grad)" />
        <rect x="13" y="6"  width="4" height="15" rx="1" fill="url(#logo-grad)" />
        <path d="M4 9 L12 3 M12 3 L12 6.5 M12 3 L8.5 3" stroke="#3B82F6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-extrabold tracking-tight leading-none" style={{ fontSize: '1rem', letterSpacing: '-0.02em' }}>
        <span style={{ color: '#ffffff' }}>auto</span><span style={{ color: '#3B82F6' }}>metrics</span>
      </span>
    </div>
  );
}
