import React from 'react';
import Link from 'next/link';
import { Logo } from '@/app/components/Logo';
import { Inter } from 'next/font/google';

// Fonte do guia visual (DESIGN.md).
const inter = Inter({ subsets: ['latin'], display: 'swap' });

/**
 * Moldura das páginas públicas de política e termos.
 *
 * Fica fora do painel de propósito: o Google precisa abrir estas páginas sem
 * login para aprovar a tela de consentimento e a verificação de marca.
 */
export const CONTACT_EMAIL = 'danieltoledofor@gmail.com';
export const LAST_UPDATE = '14 de outubro de 2026';

export function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${inter.className} am-dark min-h-screen bg-canvas text-ink-muted`}>
      <header className="border-b border-line">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between gap-4">
          <Link href="/" aria-label="Autometrics"><Logo onDark /></Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/privacidade" className="text-ink-subtle hover:text-ink transition-colors">Privacidade</Link>
            <Link href="/termos" className="text-ink-subtle hover:text-ink transition-colors">Termos</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <h1 className="text-[28px] font-semibold tracking-[-0.5px] text-ink">{title}</h1>
        <p className="text-sm text-ink-subtle mt-2">Última atualização: {LAST_UPDATE}</p>
        <div className="mt-10 space-y-8 text-[15px] leading-relaxed">{children}</div>
      </main>

      <footer className="border-t border-line mt-8">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 text-sm text-ink-subtle flex flex-wrap gap-x-6 gap-y-2 justify-between">
          <span>Autometrics — autometrics.cloud</span>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-ink transition-colors">{CONTACT_EMAIL}</a>
        </div>
      </footer>
    </div>
  );
}

/** Seção numerada, no mesmo ritmo nas duas páginas. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}
