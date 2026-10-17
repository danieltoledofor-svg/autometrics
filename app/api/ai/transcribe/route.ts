import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/googleAds/server';
import { aiEnabled, askJson } from '@/lib/ai/openrouter';

export const dynamic = 'force-dynamic';

/**
 * Áudio vira texto para as caixas da IA (perguntas, regras do Telegram,
 * anotações). O navegador grava, converte para WAV de 16 kHz em mono e manda
 * em base64 (app/components/VoiceButton.tsx). O texto volta para a caixa,
 * onde a pessoa confere antes de enviar.
 *
 * POST { audio: base64 }  →  { text }
 */

// 16 kHz × 16 bits × mono = 32 KB por segundo: 3 minutos dão perto de 6 MB.
const MAX_BYTES = 6_200_000;

const SYSTEM = `Você transcreve áudios curtos em português do Brasil de um afiliado de Google Ads.
Escreva exatamente o que foi dito, com pontuação, sem resumir, sem responder e sem comentar.
Tire só as hesitações ("é…", "tipo", "né", repetições). Mantenha números, siglas (CPA, ROI, CTR, MCC, VSL) e nomes de produtos e campanhas como foram ditos; valores em dinheiro e porcentagens em algarismos.
Se não houver fala, devolva texto vazio.
Formato: {"texto": "..."}`;

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  if (!aiEnabled()) return NextResponse.json({ error: 'A IA está desligada no servidor.' }, { status: 409 });
  const body = await request.json().catch(() => ({}));
  const audio = String(body.audio || '');
  if (!audio || !/^[A-Za-z0-9+/=]+$/.test(audio)) return NextResponse.json({ error: 'Áudio vazio.' }, { status: 400 });
  if (audio.length * 0.75 > MAX_BYTES) return NextResponse.json({ error: 'Áudio longo demais. Grave até 3 minutos.' }, { status: 413 });
  try {
    const out = await askJson<{ texto?: string }>({
      fn: 'audio', userId: user.id, system: SYSTEM, user: 'Transcreva o áudio.', audio: { data: audio, format: 'wav' }, maxTokens: 2000, temperature: 0,
    });
    const text = String(out?.texto || '').trim();
    if (!text) return NextResponse.json({ error: 'Não deu para entender o áudio. Tente de novo, mais perto do microfone.' }, { status: 422 });
    return NextResponse.json({ text });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'A IA não respondeu.' }, { status: 502 });
  }
}
