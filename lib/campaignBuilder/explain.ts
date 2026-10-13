import { askJson } from '@/lib/ai/openrouter';
import type { Problem } from './create';

/**
 * A IA explica, em português simples, o que o Google recusou no ensaio ou na
 * criação de uma campanha, e como corrigir. Recebe o código do erro, a resposta
 * do Google (em inglês) e o item que foi recusado.
 *
 * A explicação pronta de lib/campaignBuilder/create continua valendo quando a
 * IA está desligada ou não responde: o usuário nunca fica sem resposta.
 */

const SYSTEM = `Você explica a um afiliado, em português do Brasil simples e direto, por que o Google Ads recusou itens de uma campanha de Pesquisa que ele está criando, e o que ele faz para corrigir.

Para cada item recusado você recebe: onde está na campanha, o texto do item, o código do erro e a resposta do Google em inglês (às vezes com o nome e a descrição da política de anúncios).

Como responder:
- "o_que": uma ou duas frases dizendo o que há de errado com aquele item, citando o texto dele entre aspas. Se for política de anúncios, diga em português qual é a política (saúde, medicamento de receita, marca registrada, conteúdo sensível…) e qual parte do texto costuma causar a recusa.
- "corrigir": uma ou duas frases com o que fazer, de forma concreta: trocar tal trecho, encurtar para tantas letras, tirar o símbolo, tirar o item da campanha. Quando ajudar, dê um exemplo de como o texto poderia ficar. Se a resposta do Google diz que aceita pedido de exceção, diga que também dá para criar esse item direto no Google Ads e pedir a revisão por lá.
- Baseie-se só no código e na resposta do Google. Não invente regra, número ou limite que não esteja ali. Se a resposta do Google não deixa claro o motivo, diga isso e oriente a trocar ou tirar o item.
- Nada em inglês e nada de nome técnico: não repita o código do erro nem palavras como "policy", "criterion", "mutate", "string". Sem promessa de que a correção será aceita.

Responda só com JSON: {"itens": [{"n": número do item, "o_que": "...", "corrigir": "..."}]}`;

/** Troca a explicação pronta pela da IA nos problemas que vieram do Google. Falhou, fica como estava. */
export async function improveProblems(userId: string, problems: Problem[]): Promise<Problem[]> {
  const fromGoogle = problems.map((p, i) => ({ p, i })).filter(x => x.p.google).slice(0, 25);
  if (!fromGoogle.length) return problems;
  const user = fromGoogle.map(({ p }, n) => `ITEM ${n + 1}\nOnde: ${p.onde}\nCódigo: ${p.codigo || '(sem código)'}\nResposta do Google: ${p.google}`).join('\n\n');
  try {
    const raw = await askJson<any>({ fn: 'leitura', userId, system: SYSTEM, user, maxTokens: 2500 });
    const out = [...problems];
    for (const item of Array.isArray(raw?.itens) ? raw.itens : []) {
      const target = fromGoogle[Number(item?.n) - 1];
      const what = String(item?.o_que || '').trim().slice(0, 500), fix = String(item?.corrigir || '').trim().slice(0, 500);
      if (target && what) out[target.i] = { ...target.p, texto: what, corrigir: fix || target.p.corrigir };
    }
    return out;
  } catch {
    return problems;
  }
}
