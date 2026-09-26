# Google Ads API no Autometrics

Conexão direta com o Google Ads, no lugar dos scripts colados em cada MCC.

- **Custo mais rápido e correto**: uma consulta por conta traz os 30 dias de todas as campanhas. A coleta roda de hora em hora — o mesmo ritmo do script — e relê a janela inteira, então quando o Google estorna cliques inválidos dias depois, a revisão aparece sozinha (registrada em `cost_previous`/`revised_at`).
- **Pausar/ativar campanha** pela tela de Campanhas, com confirmação no Google e registro em `google_ads_actions`.
- **Mais dados**: até 50 termos de pesquisa por campanha/dia (o script trazia 10) e nomes de país vindos do próprio Google.
- **Grupos de anúncios, anúncios e palavras-chave**: abas próprias na campanha, com o desempenho do período, textos dos anúncios, força do anúncio e índice de qualidade. Só a API traz este nível.

O script e a API gravam pelo mesmo código (`lib/googleAds/ingest.ts`) e podem rodar juntos durante a transição.

> **Mudança do Google em 09/09/2026:** o developer token deixou de existir. O nível de acesso agora pertence ao **projeto do Google Cloud** que gera o Client ID do OAuth. Não use a Central de API da MCC — pedidos feitos por lá não são processados.

## 1. Google Cloud

1. Em [console.cloud.google.com](https://console.cloud.google.com), crie um projeto (ex.: *Autometrics*).
2. **APIs e serviços → Biblioteca** → ative a **Google Ads API**.
3. **Acesso à API**: abra a [página do Google Ads API no Cloud Console](https://console.cloud.google.com/google/ads-apis/overview) e peça acesso.
   - **Explorer**: contas reais, **2.880 consultas/dia**. Dá para ~9 contas ativas no ritmo padrão.
   - **Basic**: 15.000/dia. Exige a verificação da marca do projeto; depois disso a análise é automática, em minutos. **Recomendado.**
4. **Google Auth Platform → Branding / Público-alvo**:
   - Tipo de usuário: **Externo**. Domínio autorizado: `autometrics.cloud`.
   - Escopo: `https://www.googleapis.com/auth/adwords`.
   - **Publique o app ("Em produção")**. Em modo *Teste* o Google invalida a autorização a cada **7 dias** e a coleta para.
   - Na hora de conectar vai aparecer "O Google não verificou este app": clique em *Avançado → Acessar*. Para uso próprio isso não é problema.
5. **Clientes → Criar cliente OAuth → Aplicativo da Web**. Em *URIs de redirecionamento autorizados*, adicione:
   ```
   https://autometrics.cloud/api/google-ads/oauth/callback
   https://www.autometrics.cloud/api/google-ads/oauth/callback
   http://localhost:3000/api/google-ads/oauth/callback
   ```
   Copie o **Client ID** e o **Client secret**.

## 2. Variáveis de ambiente no servidor (Hostinger)

| Variável | Valor |
|---|---|
| `GOOGLE_ADS_CLIENT_ID` | Client ID do passo 1.5 |
| `GOOGLE_ADS_CLIENT_SECRET` | Client secret do passo 1.5 |
| `GOOGLE_ADS_TOKEN_KEY` | Chave que criptografa os tokens. Gere com `openssl rand -base64 32`. **Nunca troque depois de conectar** — os tokens salvos ficam ilegíveis e é preciso reconectar. |
| `GOOGLE_ADS_CRON_SECRET` | Senha do agendador. Gere com `openssl rand -hex 24`. |
| `GOOGLE_ADS_DAILY_QUOTA` | `2880` no Explorer (padrão), `15000` depois de liberar o Basic. |
| `SUPABASE_SERVICE_ROLE_KEY` | Já deve existir (o webhook usa). As rotas novas não funcionam sem ela. |

Opcionais: `GOOGLE_ADS_SYNC_INTERVAL_MIN` (60), `GOOGLE_ADS_DEEP_INTERVAL_MIN` (60 — termos/públicos/histórico), `GOOGLE_ADS_IDLE_INTERVAL_MIN` (360 — contas sem campanha ativa), `GOOGLE_ADS_LOOKBACK_DAYS` (30), `GOOGLE_ADS_API_VERSION` (v25), `GOOGLE_ADS_SYNC_BUDGET_SEC` (50).

## 3. Supabase

Rode `migration_google_ads_api.sql` no SQL Editor. Cria `google_ads_connections` (token criptografado, sem acesso pela chave pública), `google_ads_accounts`, `google_ads_actions`, `google_ads_usage` e a coluna `products.google_ads_customer_id`.

Depois, na ordem:
- `migration_google_ads_metricas.sql` — todas as métricas do Google por dia na campanha.
- `migration_google_ads_estrutura.sql` — grupos de anúncios, anúncios e palavras-chave (`google_ads_entities` e `google_ads_entity_metrics`). Sem ela a coleta segue normal e só pula este nível.
- `migration_colunas_filtros.sql` — bloco completo de métricas do Google em grupos, anúncios, palavras-chave, termos, públicos e locais; conversões fracionadas nessas tabelas; e a tabela `custom_columns` das colunas personalizadas.

## Consultas por conta

| Quando | Consultas |
|---|---|
| Toda rodada | status das campanhas + métricas de 30 dias (2) |
| Rodada completa (de hora em hora) | + termos, públicos, dispositivo, local, histórico, URLs (8) + grupos, anúncios e palavras-chave (6: configuração atual e métricas por dia de cada nível) |

A primeira coleta completa de uma conta traz 30 dias de grupos, anúncios e palavras-chave; as seguintes, só os últimos 4 dias, que são os que ainda mudam.

## 4. Conectar

1. **Integração → Google Ads → Conectar Google Ads**, com o login do Google que tem acesso às MCCs. Todas as subcontas entram de uma vez, agrupadas pela MCC.
   Se as MCCs estão em logins diferentes, conecte cada um ("Conectar outra conta Google").
2. **Sincronizar tudo** e compare o custo de hoje/ontem com a interface do Google Ads.
3. Desmarque as contas que não quer coletar.

## 5. Agendamento

No fim de `migration_google_ads_api.sql` está o `cron.schedule` para o Supabase chamar `/api/google-ads/sync` a cada 5 minutos (ative `pg_cron` e `pg_net` em *Database → Extensions* antes). Cada chamada processa só as contas que completaram a hora e desacelera sozinha perto do limite de consultas do dia.

## 6. Desligar os scripts

Depois de alguns dias com os números batendo, remova os scripts das MCCs. Enquanto os dois rodam, o nome da MCC no painel continua sendo o que foi digitado no script — a API não renomeia campanhas que já existem.

## Rotas

| Rota | Uso |
|---|---|
| `POST /api/google-ads/oauth/start` | Link de consentimento (painel) |
| `GET /api/google-ads/oauth/callback` | Volta do Google |
| `GET/POST/DELETE /api/google-ads/connections` | Listar, reler contas, desconectar |
| `PATCH /api/google-ads/accounts` | Ligar/desligar coleta de uma conta |
| `POST /api/google-ads/sync` | Painel: `{ account_id }` · Agendador: `Authorization: Bearer $GOOGLE_ADS_CRON_SECRET` |
| `POST /api/google-ads/campaign-status` | `{ product_id, status: "ENABLED" \| "PAUSED" }` |
