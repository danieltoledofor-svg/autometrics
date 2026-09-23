"use client";

import { useEffect, useState } from 'react';

/**
 * Campo de data que não quebra enquanto está sendo digitado.
 *
 * Um <input type="date"> dispara onChange a cada segmento preenchido. Quem
 * digita o dia primeiro passa por valores como "" e "0002-10-26" antes de
 * chegar na data real — e esses valores iam direto para as consultas do banco
 * e para as contas de período, que então falhavam.
 *
 * Aqui o que a pessoa digita fica num estado próprio, e só uma data completa e
 * plausível é entregue à tela. Guardar o texto digitado também evita o pulo do
 * cursor: devolver o valor antigo ao input faria o navegador reescrever os
 * segmentos no meio da digitação.
 */

export function isValidDay(value?: string | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2100) return false;
  // Meio-dia em UTC: em fuso muito adiantado, meio-dia local cairia no dia
  // anterior em UTC e a data válida seria recusada.
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  // 31/02 vira 03/03 no construtor: só é válida se voltar igual.
  return d.toISOString().slice(0, 10) === value;
}

/** Data segura para contas de período: a informada, ou a alternativa. */
export function safeDay(value: string | null | undefined, fallback: string): string {
  return isValidDay(value) ? (value as string) : fallback;
}

export function useDayInput(committed: string, commit: (value: string) => void) {
  const [typed, setTyped] = useState(committed);

  // Presets ("7 dias", "Este mês") mudam a data por fora: o campo acompanha.
  useEffect(() => { setTyped(committed); }, [committed]);

  return {
    value: typed,
    onChange: (value: string) => {
      setTyped(value);
      if (isValidDay(value)) commit(value);
    },
  };
}
