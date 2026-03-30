# AutoMetrics — Design & Code Skill

## Design System

### Paleta de Cores (Semântica)

| Papel | Cor Tailwind | Uso |
|---|---|---|
| **Primário / Ação** | `indigo-500/600` | CTAs, links ativos, botões principais |
| **Receita** | `blue-500` | Valores de faturamento/receita |
| **Custo** | `orange-500` | Gastos com Ads |
| **Lucro positivo** | `emerald-500` | Lucro, status ativo, sucesso |
| **Perda / Erro** | `rose-500` | Prejuízo, status pausado, erro |
| **Reembolso / Alerta** | `amber-500` | Reembolsos, avisos, custos extras |
| **Métrica secundária** | `cyan-500` | CPA, KPI neutro |
| **Texto principal** | `white` (dark) / `slate-900` (light) | Títulos |
| **Texto auxiliar** | `slate-500` | Labels, subtítulos |
| **Bordas** | `slate-800` (dark) / `slate-200` (light) | Separadores |

### Backgrounds por Tema

```tsx
const isDark = theme === 'dark';
const bgMain  = isDark ? 'bg-black text-slate-200'            : 'bg-slate-50 text-slate-900';
const bgCard  = isDark ? 'bg-slate-900 border-slate-800'      : 'bg-white border-slate-200 shadow-sm';
const textHead = isDark ? 'text-white'                        : 'text-slate-900';
const textMuted = 'text-slate-500';
const borderCol = isDark ? 'border-slate-800'                 : 'border-slate-200';
const hoverItem = isDark ? 'hover:bg-slate-800'               : 'hover:bg-slate-100';
```

---

## Padrões de Componentes

### Card KPI (Métrica principal)

```tsx
<div className={`${bgCard} border-t-4 border-t-blue-500 p-5 rounded-xl shadow-sm`}>
  <p className="text-xs font-bold text-slate-500 uppercase mb-2">Receita Total</p>
  <p className="text-2xl font-bold text-blue-500">{formatMoney(valor)}</p>
</div>
```
> A cor `border-t-*` segue a paleta semântica. Lucro usa `emerald` ou `rose` dependendo do sinal.

### Botão Primário

```tsx
<button className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 shadow-lg">
  <Plus size={18} /> Ação
</button>
```

### Botão Destruidor

```tsx
<button className="bg-rose-500/10 text-rose-500 border border-rose-500/20 hover:bg-rose-500/20 px-3 py-1.5 rounded-lg text-xs font-bold">
  Excluir
</button>
```

### Badge de Status (Ativo/Pausado)

```tsx
<span className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase border ${
  status === 'active'
    ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
    : 'bg-rose-500/10 text-rose-500 border-rose-500/20'
}`}>
  {status === 'active' ? <PlayCircle size={12} /> : <PauseCircle size={12} />}
</span>
```

### Input de Formulário

```tsx
<input
  type="text"
  className={`w-full border rounded-xl py-3 pl-4 pr-4 outline-none transition-colors ${
    isDark
      ? 'bg-slate-950 border-slate-800 text-white focus:border-indigo-500'
      : 'bg-slate-50 border-slate-200 text-black focus:border-indigo-500'
  }`}
/>
```

### Modal (overlay)

```tsx
<div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
  <div className={`${bgCard} rounded-xl w-full max-w-lg p-6 shadow-2xl border`}>
    {/* conteúdo */}
  </div>
</div>
```

### Seletor de Data (padrão reutilizado em todas as páginas)

```tsx
<div className={`flex items-center p-1.5 rounded-xl border ${bgCard} shadow-sm`}>
  <div className="flex items-center gap-2 px-2 border-r border-inherit">
    <Calendar size={18} className={isDark ? "text-white" : "text-indigo-600"} />
    <select className={`bg-transparent text-sm font-bold outline-none cursor-pointer ${textHead} w-24`}
      value={dateRange} onChange={(e) => handlePresetChange(e.target.value)}>
      <option value="today">Hoje</option>
      <option value="yesterday">Ontem</option>
      <option value="7d">7 Dias</option>
      <option value="30d">30 Dias</option>
      <option value="this_month">Este Mês</option>
      <option value="last_month">Mês Passado</option>
      <option value="custom">Personalizado</option>
    </select>
  </div>
  <div className="flex items-center gap-2 px-2">
    <input type="date" className={`bg-transparent text-xs font-mono font-medium outline-none cursor-pointer ${textHead}`}
      value={startDate} onChange={(e) => handleCustomDateChange('start', e.target.value)} />
    <span className="text-slate-500 text-xs">até</span>
    <input type="date" className={`bg-transparent text-xs font-mono font-medium outline-none cursor-pointer ${textHead}`}
      value={endDate} onChange={(e) => handleCustomDateChange('end', e.target.value)} />
  </div>
</div>
```

### Toggle de Moeda (BRL/USD)

```tsx
<div className={`flex p-1 rounded-md ${isDark ? 'bg-black' : 'bg-slate-100'}`}>
  <button onClick={() => setViewCurrency('BRL')}
    className={`px-3 py-1 rounded text-xs font-bold transition-all ${viewCurrency === 'BRL' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>
    R$
  </button>
  <button onClick={() => setViewCurrency('USD')}
    className={`px-3 py-1 rounded text-xs font-bold transition-all ${viewCurrency === 'USD' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>
    $
  </button>
</div>
```

---

## Padrões de Código

### Autenticação (toda página protegida)

```tsx
useEffect(() => {
  async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }
    setUser(session.user);
    // ... carregar dados
  }
  init();
}, []);
```

### Formatação de Dinheiro

```tsx
const formatMoney = (val: number) =>
  new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : 'en-US', {
    style: 'currency',
    currency: viewCurrency
  }).format(val);
```

### Datas no fuso local (evitar bug UTC)

```tsx
function getLocalYYYYMMDD(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

### Conversão de Moeda (padrão do processamento)

```tsx
// Custo: usa cotação ao vivo (liveDollar - Google cobra em dólar)
// Receita: usa cotação manual (manualDollar - plataformas têm spread próprio)
if (viewCurrency === 'BRL' && rowCurrency === 'USD') {
  cost    *= liveDollar;
  revenue *= manualDollar;
  refunds *= manualDollar;
}
```

### Toggle de Tema

```tsx
const toggleTheme = () => {
  const newTheme = theme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
  localStorage.setItem('autometrics_theme', newTheme);
};
```

### Upsert no Supabase (evitar duplicatas)

```tsx
await supabase
  .from('daily_metrics')
  .upsert(payload, { onConflict: 'product_id, date' });
```

---

## Estrutura de Navegação

```
Sidebar (w-16 mobile / w-64 desktop, sticky, h-screen)
  Logo
  Nav Links: Dashboard | Planejamento | Meus Produtos | Integração
  Botão Sair (text-rose-500)
```

Páginas sem sidebar: `/integration`, `/products/[id]`, `/planning`
(usam botão de voltar `<ArrowLeft>` no header)

---

## Tabelas de Dados

- Header: `text-xs uppercase font-bold bg-slate-950/bg-slate-100`
- Linhas: `hover:bg-slate-800/50` (dark) / `hover:bg-slate-50` (light)
- Separador: `divide-y divide-slate-800/divide-slate-200`
- Primeira coluna: sticky left com `z-30`
- Valores monetários: alinhados à direita, coloridos por semântica

---

## Tabelas do Banco de Dados (Supabase)

| Tabela | Colunas-chave | Notas |
|---|---|---|
| `products` | `id, user_id, name, google_ads_campaign_name, mcc_name, account_name, currency, status, is_hidden` | Vincular por `google_ads_campaign_name` |
| `daily_metrics` | `product_id, date, cost, conversion_value, refunds, clicks, impressions, visits, checkouts, conversions` | Unique: `(product_id, date)` |
| `financial_goals` | `user_id, month_key, revenue_target, profit_target, ad_spend_limit` | Unique: `(user_id, month_key)` |
| `additional_costs` | `user_id, date, description, amount, currency` | Custos extras manuais |

---

## Regras Gerais

1. **Sempre suportar dark/light mode** — usar as variáveis `isDark`, `bgCard`, `textHead`, etc.
2. **Nunca usar cores fixas** — sempre semânticas (indigo=ação, blue=receita, orange=custo, etc.)
3. **Textos em português (pt-BR)** — a interface é 100% em português brasileiro.
4. **Ícones: lucide-react** — usar `size={18}` ou `size={20}` para ícones de UI, `size={14}` para ícones inline.
5. **Autenticação obrigatória** — toda nova página deve verificar sessão e redirecionar para `/` se não estiver logado.
6. **Upsert, nunca insert puro** — dados de métricas devem usar `upsert` com `onConflict: 'product_id, date'`.
7. **Nunca sobrescrever dados manuais com dados automáticos** — o webhook do Google Ads não deve incluir `conversion_value`, `visits`, `checkouts` ou `refunds`.
