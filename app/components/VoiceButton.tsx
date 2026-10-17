"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

/**
 * Botão de microfone para as caixas da IA: grava, manda para
 * /api/ai/transcribe e devolve o texto (onText) para a pessoa conferir antes
 * de enviar. Nada é enviado à IA da pergunta sem passar pela caixa.
 *
 * O navegador grava no formato dele (webm no Chrome, mp4 no Safari); antes de
 * subir, o áudio é convertido para WAV de 16 kHz em mono, que todo modelo que
 * ouve áudio aceita e pesa pouco (32 KB por segundo).
 */

const MAX_SECONDS = 180;

export function VoiceButton({ onText, disabled, className = '' }: { onText: (text: string) => void; disabled?: boolean; className?: string }) {
  const [stage, setStage] = useState<'' | 'gravando' | 'lendo'>('');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTracks = () => recorder.current?.stream.getTracks().forEach(t => t.stop());
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); stopTracks(); }, []);

  async function start() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('Este navegador não grava áudio.'); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setError('O navegador não liberou o microfone. Libere nas permissões do site e tente de novo.'); return; }
    const rec = new MediaRecorder(stream);
    chunks.current = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
    rec.onstop = () => { stopTracks(); send(new Blob(chunks.current, { type: rec.mimeType })); };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
    setStage('gravando');
    timer.current = setInterval(() => setSeconds(s => {
      if (s + 1 >= MAX_SECONDS) stop();
      return s + 1;
    }), 1000);
  }

  function stop() {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  async function send(blob: Blob) {
    setStage('lendo');
    try {
      const wav = await toWav16k(blob);
      const audio = await toBase64(wav);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ai/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ audio }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.text) throw new Error(body.error || 'Não deu para transformar o áudio em texto.');
      onText(body.text);
    } catch (e: any) {
      setError(e.message || 'Não deu para transformar o áudio em texto.');
    } finally {
      setStage('');
    }
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={stage === 'gravando' ? stop : start} disabled={disabled || stage === 'lendo'}
        aria-label={stage === 'gravando' ? 'Parar a gravação' : 'Falar em vez de digitar'}
        title={stage === 'gravando' ? 'Parar e transformar em texto' : 'Falar em vez de digitar'}
        className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 ${stage === 'gravando' ? 'border-neg/50 bg-neg/10 text-neg' : 'border-line-strong text-ink-subtle hover:text-ink hover:bg-surface-2'} ${className}`}>
        {stage === 'lendo' ? <Loader2 size={13} aria-hidden="true" className="animate-spin" />
          : stage === 'gravando' ? <Square size={12} aria-hidden="true" className="fill-current" />
          : <Mic size={13} aria-hidden="true" />}
        {stage === 'gravando' ? mmss : stage === 'lendo' ? 'Ouvindo…' : 'Áudio'}
      </button>
      {error && <span role="alert" className="text-[11px] text-neg max-w-[220px]">{error}</span>}
    </span>
  );
}

/** Qualquer áudio que o navegador saiba tocar → WAV PCM 16 bits, 16 kHz, mono. */
async function toWav16k(blob: Blob): Promise<Blob> {
  const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new Ctx();
  let decoded: AudioBuffer;
  try { decoded = await ctx.decodeAudioData(await blob.arrayBuffer()); }
  finally { ctx.close().catch(() => {}); }
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const pcm = (await offline.startRendering()).getChannelData(0);

  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Não deu para ler o áudio gravado.'));
    r.readAsDataURL(blob);
  });
}
