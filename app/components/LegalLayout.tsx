import React from 'react';
import Link from 'next/link';
import { Logo } from '@/app/components/Logo';

/**
 * Moldura das páginas públicas de política e termos.
 *
 * Fica fora do painel de propósito: o Google precisa abrir estas páginas sem
 * login para aprovar a tela de consentimento e a verificação de marca.
 */
export const CONTACT_EMAIL = 'danieltoledofor@gmail.com';
export const LAST_UPDATE = '22 de setembro de 2026';

export function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-slate-300">
      <header className="border-b border-slate-800">
        <div className="max-w-3xl mx-auto px-6 py-6 flex items-center justify-between gap-4">
          <Link href="/" aria-label="Autometrics"><Logo /></Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/privacidade" className="text-slate-400 hover:text-white transition-colors">Privacidade</Link>
            <Link href="/termos" className="text-slate-400 hover:text-white transition-colors">Termos</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-white">{title}</h1>
        <p className="text-sm text-slate-500 mt-2">Última atualização: {LAST_UPDATE}</p>
        <div className="mt-10 space-y-8 leading-relaxed">{children}</div>
      </main>

      <footer className="border-t border-slate-800 mt-8">
        <div className="max-w-3xl mx-auto px-6 py-8 text-sm text-slate-500 flex flex-wrap gap-x-6 gap-y-2 justify-between">
          <span>Autometrics — autometrics.cloud</span>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-white transition-colors">{CONTACT_EMAIL}</a>
        </div>
      </footer>
    </div>
  );
}

/** Seção numerada, no mesmo ritmo nas duas páginas. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      {children}
    </section>
  );
}
