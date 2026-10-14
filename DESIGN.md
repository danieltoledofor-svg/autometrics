# Guia visual do Autometrics

Direção escolhida em 14/10/2026: **Linear** (coleção Awesome Design), adaptada para um painel de
campanhas usado por horas, com tema escuro e tema claro.

Este guia é a regra para todas as telas. As cores já existem no código como tokens (`app/globals.css`
e `tailwind.config.ts`); cada tela passa a usá-las na etapa 4, uma por vez, com aprovação.

---

## 1. Princípios

1. **Sóbrio por padrão.** Fundo escuro quase preto, cartões um degrau acima, bordas finas. Nada de
   sombra, brilho ou degradê.
2. **Uma cor de destaque só.** O lavanda (`brand`) é para o botão principal da tela, o item ativo do
   menu, links e o contorno de foco. Nunca para enfeite.
3. **Cor no número só quando ele diz algo.** Receita, custo e cliques ficam neutros. Verde e
   vermelho são para lucro/prejuízo, ROI positivo/negativo e variações boas/ruins.
4. **Hierarquia por tamanho e peso, não por cor.** Título maior, rótulo menor e mais claro.
5. **Números sempre alinhados** (`tabular-nums`), no formato brasileiro (vírgula decimal, ponto de
   milhar), e moeda pelo `Intl.NumberFormat`.

---

## 2. Cores

Nomes dos tokens → classe do Tailwind entre parênteses. Os dois temas usam os mesmos nomes; o valor
muda sozinho com o `<html data-theme>`.

| Token | Escuro | Claro | Uso |
|---|---|---|---|
| `canvas` (`bg-canvas`) | `#08090a` | `#f7f8f9` | Fundo da página |
| `surface-1` (`bg-surface-1`) | `#0f1011` | `#ffffff` | Cartões, tabelas, menu lateral |
| `surface-2` (`bg-surface-2`) | `#141516` | `#f2f3f5` | Cabeçalho de tabela, linha aberta, hover de cartão |
| `surface-3` (`bg-surface-3`) | `#1c1d1f` | `#e9ebef` | Menus suspensos, campo selecionado, botão secundário em hover |
| `line` (`border-line`) | `#23252a` | `#e2e4e8` | Borda de cartão, divisória de tabela |
| `line-strong` (`border-line-strong`) | `#34343a` | `#cfd2d8` | Borda de campo, borda em hover |
| `ink` (`text-ink`) | `#f7f8f8` | `#16171a` | Títulos, números principais |
| `ink-muted` (`text-ink-muted`) | `#d0d6e0` | `#3c4049` | Texto de corpo, valores de tabela |
| `ink-subtle` (`text-ink-subtle`) | `#8a8f98` | `#62666f` | Rótulos, legendas, texto de apoio |
| `ink-faint` (`text-ink-faint`) | `#62666d` | `#9a9fa8` | **Só** item desligado e "—" de vazio (não passa no contraste para texto de leitura) |
| `brand` (`bg-brand`) | `#5e6ad2` | `#5e6ad2` | Botão principal, item ativo do menu |
| `brand-hover` (`bg-brand-hover`) | `#828fff` | `#4b56be` | Hover do botão principal |
| `brand-text` (`text-brand-text`) | `#9aa3ef` | `#4b56be` | Link e texto em destaque |
| `pos` (`text-pos`) | `#27a644` | `#1d7f38` | Lucro, ROI positivo, variação boa |
| `neg` (`text-neg`) | `#eb5757` | `#c93a3a` | Prejuízo, ROI negativo, erro, excluir |
| `warn` (`text-warn`) | `#e2b340` | `#93630f` | Aviso, "não confere", atenção |
| `chart-1` | `#7c86e0` | `#5e6ad2` | Gráfico: receita |
| `chart-2` | `#d9913f` | `#c27a28` | Gráfico: custo |
| `chart-3` | `#27a644` | `#1d7f38` | Gráfico: lucro |

Contraste conferido (WCAG AA, 4,5:1 para texto): todos os tokens de texto passam sobre `canvas`,
`surface-1` e `surface-2`, nos dois temas, exceto `ink-faint`, que é só para itens desligados.
Texto branco no botão `brand`: 4,7:1.

**Fundos coloridos suaves** (selos, avisos): a própria cor com 10–15% de opacidade, texto na cor
cheia. Ex.: `bg-pos/10 text-pos`, `bg-warn/10 text-warn`, `bg-neg/10 text-neg`.

---

## 3. Tipografia

- **Fonte:** Inter (a substituta gratuita mais próxima da fonte do Linear), carregada pelo
  `next/font`. Números com `tabular-nums`.
- **Pesos:** 400 (texto), 500 (rótulos, botões, títulos de cartão), 600 (título da tela e número
  grande dos cartões). Nada de 700/800.
- **Sem CAIXA ALTA nos rótulos.** Rótulos em frase normal ("Receita", "Custo dos anúncios"), em
  `ink-subtle`. A caixa alta com espaçamento largo de hoje sai.

| Papel | Tamanho / peso | Cor |
|---|---|---|
| Título da tela | 22px / 600, espaçamento −0,4px | `ink` |
| Título de cartão ou seção | 15px / 500 | `ink` |
| Número grande do cartão (KPI) | 24px / 600, `tabular-nums` | `ink` (ou `pos`/`neg` se for resultado) |
| Texto de corpo | 14px / 400 | `ink-muted` |
| Célula de tabela | 13px / 400, `tabular-nums` | `ink-muted`; nome da campanha em `ink` |
| Rótulo, cabeçalho de tabela | 12px / 500 | `ink-subtle` |
| Legenda, ajuda | 12px / 400 | `ink-subtle` |
| Selo de status | 11px / 500 | cor do status |

Mínimo de 11px em qualquer texto.

---

## 4. Espaço, cantos e profundidade

- **Base de 4px.** Espaços usados: 4, 8, 12, 16, 24, 32.
- **Cartão:** 16px de respiro interno (24px em cartões grandes). Entre cartões: 12–16px.
- **Página:** 16px de margem no celular, 32px no computador.
- **Cantos:** 4px selos · 6px etiquetas · 8px botões e campos · 12px cartões e tabelas ·
  16px janelas · círculo só em avatar e botão flutuante.
- **Profundidade sem sombra:** um degrau de superfície (`canvas` → `surface-1` → `surface-2`) mais
  a borda `line`. Janela por cima da página: `surface-1` com borda `line-strong` e fundo escurecido
  atrás (`bg-black/60`).

---

## 5. Componentes

**Botões** (altura 32px, 8px × 14px, 14px / 500, canto 8px):
- *Principal:* `bg-brand text-white hover:bg-brand-hover`. **No máximo um por tela.**
- *Secundário:* `bg-surface-1 border border-line text-ink hover:bg-surface-2`.
- *Discreto:* sem fundo, `text-ink-subtle hover:text-ink hover:bg-surface-2`.
- *Perigo:* discreto com `hover:text-neg`; a ação pede confirmação.
- Botão só com ícone: 32×32px, sempre com `aria-label`.

**Campos** (altura 32px, 8px × 12px, 14px, canto 8px): `bg-surface-1 border border-line-strong
text-ink placeholder:text-ink-faint`, foco `focus-visible:ring-2 ring-brand`. Rótulo acima, 12px /
500, `ink-subtle`, ligado ao campo.

**Cartão de número (KPI):** `bg-surface-1 border border-line rounded-xl p-4`. Rótulo 12px
`ink-subtle`; número 24px / 600 `ink`; variação embaixo, 12px, `pos`/`neg` com seta. Sem faixa
colorida no topo.

**Tabelas:** dentro de cartão `rounded-xl border border-line`. Cabeçalho `bg-surface-2`, 12px / 500
`ink-subtle`, sem caixa alta. Linhas de 40px, divisória `line`, hover `bg-surface-2`. Valores
`tabular-nums` alinhados à direita; nome à esquerda. Lucro e ROI com `pos`/`neg`; o resto neutro.
Linha que abre detalhe tem um botão de verdade (teclado).

**Selos de status:** `rounded px-1.5 py-0.5` 11px / 500 com fundo suave: ativa `bg-pos/10 text-pos`,
pausada `bg-surface-3 text-ink-subtle`, suspensa `bg-neg/10 text-neg`, sem veicular / aprendendo
`bg-warn/10 text-warn`.

**Avisos (faixas no alto da tela):** `rounded-xl border` na cor do tipo com 30% (`border-warn/30`),
fundo 5–10%, título 13px / 500 e texto 13px. Venda nova = `pos`; gasto acima do normal = `warn`;
erro = `neg`.

**Abas e filtros de escolha:** grupo `bg-surface-1 border border-line rounded-lg p-1`; item ativo
`bg-surface-3 text-ink`; inativo `text-ink-subtle hover:text-ink`. Sempre com `aria-pressed`.

**Menu lateral:** `bg-surface-1 border-r border-line`, 240px. Item 14px / 500 `ink-subtle`, hover
`bg-surface-2 text-ink`; ativo `bg-surface-2 text-ink` com o ícone em `brand-text` (sem bloco
colorido inteiro).

**Menu de baixo (celular):** `bg-canvas/95 border-t border-line`, 6 itens, 10px / 500; ativo em
`brand-text`. Margem de baixo pela área segura do iPhone.

**Janelas:** `role="dialog"`, título ligado, Esc fecha, foco entra ao abrir. `bg-surface-1 border
border-line-strong rounded-2xl`, 24px de respiro.

**Gráficos:** séries `chart-1` (receita), `chart-2` (custo), `chart-3` (lucro); grade `line`;
eixos 11px `ink-subtle`; dica no padrão de cartão.

---

## 6. Acessibilidade (vale para tudo)

As regras aplicadas na etapa 2 continuam: botão só com ícone tem nome, campo tem rótulo, foco
visível (`focus-visible:ring-2 ring-brand`), linhas que abrem detalhe funcionam pelo teclado,
janelas fecham com Esc, avisos que chegam sozinhos usam `aria-live`, excluir pede confirmação,
nada de informação só no `title`.

---

## 7. Não fazer

- Duas cores de destaque na mesma tela, ou o lavanda como enfeite.
- Número de receita/custo colorido em cartão ou tabela (cor é para resultado).
- Sombra, brilho, degradê, borda colorida no topo do cartão.
- Rótulo em CAIXA ALTA com espaçamento largo.
- Cor escrita na mão (`#hex`, `slate-900`, `isDark ? … : …`) em tela já migrada: use os tokens.
- Texto de leitura em `ink-faint`.
