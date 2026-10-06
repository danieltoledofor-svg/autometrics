/**
 * Telegram: um bot do Autometrics manda os alertas para a conversa de cada
 * usuário. O token do bot fica em TELEGRAM_BOT_TOKEN, no servidor. Sem ele,
 * nada é enviado e a tela avisa que falta configurar.
 */

export const telegramEnabled = () => !!process.env.TELEGRAM_BOT_TOKEN;

export async function tg<T = any>(method: string, body: Record<string, any> = {}): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN não configurado');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(json.description || `Telegram ${res.status}`);
  return json.result as T;
}

let botName: { at: number; name: string } | null = null;

/** Nome de usuário do bot (para o link t.me), guardado por uma hora. */
export async function botUsername(): Promise<string> {
  if (botName && Date.now() - botName.at < 60 * 60 * 1000) return botName.name;
  const me = await tg<{ username: string }>('getMe');
  botName = { at: Date.now(), name: me.username };
  return me.username;
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Mensagem em HTML simples (<b>, <a>). O texto variável precisa passar por escapeHtml. */
export function sendTelegram(chatId: string, html: string) {
  return tg('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true });
}
