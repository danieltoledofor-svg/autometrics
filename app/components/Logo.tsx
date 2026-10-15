"use client";

import { useId } from 'react';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Sobre fundo sempre escuro (páginas públicas): o "auto" fica branco em qualquer tema. */
  onDark?: boolean;
}

export function Logo({ className = '', size = 'md', onDark = false }: LogoProps) {
  const sizes = {
    sm: { svg: 18, font: '0.85rem', gap: 'gap-1' },
    md: { svg: 22, font: '1rem',    gap: 'gap-1.5' },
    lg: { svg: 40, font: '1.75rem', gap: 'gap-3' },
  };
  const { svg, font, gap } = sizes[size];
  // Id próprio por logo: com um id fixo, o degradê some quando o primeiro logo da página está escondido.
  const grad = `logo-grad-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <div className={`flex items-center ${gap} ${className}`}>
      <svg width={svg} height={svg} viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id={grad} x1="0" y1="22" x2="14" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1D4ED8" />
            <stop offset="100%" stopColor="#3B82F6" />
          </linearGradient>
        </defs>
        <rect x="1"  y="14" width="4" height="7" rx="1" fill={`url(#${grad})`} />
        <rect x="7"  y="10" width="4" height="11" rx="1" fill={`url(#${grad})`} />
        <rect x="13" y="6"  width="4" height="15" rx="1" fill={`url(#${grad})`} />
        <path d="M4 9 L12 3 M12 3 L12 6.5 M12 3 L8.5 3" stroke="#3B82F6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-extrabold tracking-tight leading-none" style={{ fontSize: font, letterSpacing: '-0.02em' }}>
        <span className={onDark ? 'text-white' : 'text-ink'}>auto</span><span style={{ color: '#3B82F6' }}>metrics</span>
      </span>
    </div>
  );
}
