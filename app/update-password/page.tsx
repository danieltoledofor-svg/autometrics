"use client";

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { Lock, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { Logo } from '@/app/components/Logo';
import { Inter } from 'next/font/google';

// Fonte do guia visual (DESIGN.md).
const inter = Inter({ subsets: ['latin'], display: 'swap' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [success, setSuccess] = useState(false);

  // Check if we actually have a session (user clicked the email link)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        setMsg('Nenhuma sessão de recuperação encontrada. Solicite o link novamente se necessário.');
      }
    });
  }, []);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg('');

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      setMsg('Senha atualizada com sucesso! Redirecionando...');
      setTimeout(() => {
        router.push('/dashboard');
      }, 2000);
    } catch (error: any) {
      setMsg(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`${inter.className} am-dark min-h-screen bg-canvas text-ink-muted flex items-center justify-center p-4`}>
      <div className="w-full max-w-sm bg-surface-1 border border-line rounded-2xl p-6 sm:p-8">
        
        <div className="text-center mb-8 flex flex-col items-center">
          <Logo size="lg" className="mb-4" onDark />
          <p className="text-ink-subtle text-sm">Defina sua nova senha de acesso.</p>
        </div>

        <form onSubmit={handleUpdatePassword} className="space-y-4">
          <div>
            <label htmlFor="new-password" className="block text-xs font-medium text-ink-subtle mb-1.5">Nova senha</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" size={16} aria-hidden="true" />
              <input 
                id="new-password"
                autoComplete="new-password"
                type="password" 
                required 
                disabled={success}
                className="w-full bg-surface-2 border border-line-strong rounded-lg py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint outline-none focus-visible:ring-2 focus-visible:ring-brand transition-colors disabled:opacity-50" 
                placeholder="••••••••" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                minLength={6}
              />
            </div>
          </div>

          <div aria-live="polite">{msg && (
            <div className={`flex items-center gap-2 text-sm p-3 rounded-lg border ${success || msg.includes('sucesso') ? 'bg-pos/10 border-pos/30 text-pos' : 'bg-neg/10 border-neg/30 text-neg'}`}>
              <AlertCircle size={16} aria-hidden="true" className="shrink-0" />{msg}
            </div>
          )}</div>
          
          <button 
            type="submit" 
            disabled={loading || success} 
            className="w-full bg-brand hover:bg-brand-hover text-white text-sm font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 mt-6 disabled:opacity-50"
          >
            {loading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : 'Atualizar senha'} {!loading && <ArrowRight size={16} aria-hidden="true" />}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button onClick={() => router.push('/')} className="text-sm text-ink-subtle hover:text-ink transition-colors">
            Voltar para o login
          </button>
        </div>
      </div>
    </div>
  );
}
