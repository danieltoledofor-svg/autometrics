"use client";

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { Mail, ArrowRight, Loader2, AlertCircle, Lock } from 'lucide-react';
import { Logo } from '@/app/components/Logo';
import Link from 'next/link';
import { Inter } from 'next/font/google';

// Fonte do guia visual (DESIGN.md).
const inter = Inter({ subsets: ['latin'], display: 'swap' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isResetPassword, setIsResetPassword] = useState(false); 
  const [msg, setMsg] = useState('');
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg('');

    try {
      if (isResetPassword) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${origin}/update-password`,
        });
        if (error) throw error;
        setMsg('E-mail de recuperação enviado! Verifique sua caixa de entrada.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push('/dashboard');
      }
    } catch (error: any) {
      setMsg(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const redirectTo = `${origin}/dashboard`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectTo,
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });
      if (error) throw error;
    } catch (error: any) {
      setMsg('Erro Google: ' + error.message);
      setLoading(false);
    }
  };

  return (
    <div className={`${inter.className} am-dark relative min-h-screen bg-canvas text-ink-muted flex items-center justify-center p-4 pb-20`}>
      <div className="w-full max-w-sm bg-surface-1 border border-line rounded-2xl p-6 sm:p-8">
        
        <div className="text-center mb-8 flex flex-col items-center">
          
          <Logo size="lg" className="mb-4" onDark />
          
          <p className="text-ink-subtle text-sm">Acesse sua central de inteligência.</p>
        </div>

        {!isResetPassword && (
          <button onClick={handleGoogleLogin} type="button" disabled={loading} className="w-full bg-white hover:bg-slate-100 text-slate-900 text-sm font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-3 mb-6 disabled:opacity-70">
            {loading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                Entrar com Google
              </>
            )}
          </button>
        )}

        {!isResetPassword && <div className="flex items-center gap-4 mb-6"><div className="h-px bg-line flex-1"></div><span className="text-xs text-ink-subtle">ou continue com e-mail</span><div className="h-px bg-line flex-1"></div></div>}

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-xs font-medium text-ink-subtle mb-1.5">E-mail</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" size={16} aria-hidden="true" />
              <input id="login-email" type="email" autoComplete="email" required className="w-full bg-surface-2 border border-line-strong rounded-lg py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint outline-none focus-visible:ring-2 focus-visible:ring-brand transition-colors" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>
          
          {!isResetPassword && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <label htmlFor="login-password" className="block text-xs font-medium text-ink-subtle">Senha</label>
                <button type="button" onClick={() => { setIsResetPassword(true); setMsg(''); }} className="text-xs text-brand-text hover:underline">Esqueci a senha</button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" size={16} aria-hidden="true" />
                <input id="login-password" type="password" autoComplete="current-password" required className="w-full bg-surface-2 border border-line-strong rounded-lg py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint outline-none focus-visible:ring-2 focus-visible:ring-brand transition-colors" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
              </div>
            </div>
          )}

          <div aria-live="polite">{msg && <div className={`flex items-center gap-2 text-sm p-3 rounded-lg border ${msg.includes('enviado') ? 'bg-pos/10 border-pos/30 text-pos' : 'bg-neg/10 border-neg/30 text-neg'}`}><AlertCircle size={16} aria-hidden="true" className="shrink-0" />{msg}</div>}</div>
          
          <button type="submit" disabled={loading} className="w-full bg-brand hover:bg-brand-hover text-white text-sm font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 mt-6 disabled:opacity-60">
            {loading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : (isResetPassword ? 'Enviar link de recuperação' : 'Entrar')} {!loading && <ArrowRight size={16} aria-hidden="true" />}
          </button>
        </form>

        {isResetPassword && (
          <div className="mt-6 text-center">
            <button onClick={() => { setIsResetPassword(false); setMsg(''); }} className="text-sm text-ink-subtle hover:text-ink transition-colors">Voltar para o login</button>
          </div>
        )}
      </div>

      {/* Links exigidos pelo Google na tela de consentimento do login. */}
      <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-6 text-xs text-ink-faint">
        <Link href="/privacidade" className="hover:text-ink-muted transition-colors">Política de Privacidade</Link>
        <Link href="/termos" className="hover:text-ink-muted transition-colors">Termos de Uso</Link>
      </div>
    </div>
  );
}