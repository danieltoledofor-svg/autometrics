import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { aiEnabled, askJson } from '@/lib/ai/openrouter';
import { MEMORY_KINDS, SUMMARY_LIMIT } from '@/lib/analysis/userMemory';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * Memória da IA do usuário (tela Análise de IA).
 *
 * GET     lista do que ele guardou
 * POST    { kind, title, content, scope } guarda uma decisão, observação ou material
 * DELETE  ?id= apaga
 *
 * Texto longo (aula transcrita, material) é resumido em regras práticas na
 * hora de guardar: é o resumo que entra nos pedidos à IA; o texto inteiro fica
 * guardado.
 */

const MISSING = 'Falta rodar migration_memoria_ia.sql no Supabase.';
const missing = (e: any) => !!e && /ai_memory|schema cache|does not exist/i.test(String(e.message || ''));

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const { data, error } = await supabaseAdmin().from('ai_memory')
    .select('id, kind, title, content, summary, scope, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ ready: false, error: missing(error) ? MISSING : error.message });
  return NextResponse.json({
    ready: true,
    items: (data || []).map(m => ({
      id: m.id, kind: m.kind, title: m.title, scope: m.scope, created_at: m.created_at, chars: String(m.content || '').length,
      summary: String(m.summary || m.content || '').slice(0, SUMMARY_LIMIT), summarized: !!m.summary && m.summary !== m.content,
    })),
  });
}

const SYSTEM = `Você recebe um material de estudo de um afiliado que anuncia no Google Ads (aula transcrita, anotações, guia).
Extraia o que serve para analisar campanhas: regras práticas, números de referência, critérios de decisão e erros a evitar.
Português simples e direto. Não invente nada que não esteja no material. Ignore conversa, cumprimentos e propaganda.
Responda só com JSON: {"resumo": "lista de até 12 linhas começando com '- ', no máximo 1700 caracteres"}`;

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const content = String(body.content || '').trim().slice(0, 200_000);
  const title = String(body.title || '').trim().slice(0, 160) || content.slice(0, 60);
  if (!content) return NextResponse.json({ error: 'Escreva ou envie o texto.' }, { status: 400 });
  const kind = MEMORY_KINDS[body.kind] ? body.kind : 'observacao';

  let summary = content;
  let summarized = false;
  if (content.length > SUMMARY_LIMIT) {
    summary = content.slice(0, SUMMARY_LIMIT);
    if (aiEnabled()) {
      try {
        // Cabe no pedido o começo do material; o resto continua guardado inteiro.
        const raw = await askJson<any>({ fn: 'padroes', userId: user.id, system: SYSTEM, user: `TÍTULO: ${title}\n\nMATERIAL:\n${content.slice(0, 60_000)}`, maxTokens: 1200 });
        const text = String(raw?.resumo || '').trim().slice(0, SUMMARY_LIMIT);
        if (text) { summary = text; summarized = true; }
      } catch { /* fica o começo do texto */ }
    }
  }
  const { data, error } = await supabaseAdmin().from('ai_memory').insert({
    user_id: user.id, kind, title, content, summary, scope: String(body.scope || '').trim().slice(0, 40) || null,
  }).select('id').single();
  if (error) return NextResponse.json({ error: missing(error) ? MISSING : error.message }, { status: missing(error) ? 409 : 500 });
  return NextResponse.json({ ok: true, id: data.id, summarized, cut: content.length > 60_000 });
}

export async function DELETE(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Informe o item.' }, { status: 400 });
  const { error } = await supabaseAdmin().from('ai_memory').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
