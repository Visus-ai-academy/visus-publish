# Visus Publish — Especificação técnica (v0.1)

Plataforma SaaS multi-tenant para planejar, gerar com IA, aprovar, agendar e publicar conteúdo no Instagram, com coleta e análise de insights.

Protótipo de referência visual e de fluxo: `docs/prototipo/Main.dc.html` (telas, textos e estados). As telas reais devem seguir o mesmo design system (seção 11).

---

## 1. Escopo do MVP

| # | Módulo | Inclui |
|---|---|---|
| 1 | Multi-tenant e acesso | Clientes (tenants), convites, papéis, admin da plataforma |
| 2 | Contas do Instagram | Conexão OAuth ilimitada por tenant, renovação de token, desconexão |
| 3 | Planejamento | Itens com dia, horário, tema e formato; sugestão de temas por IA |
| 4 | Geração por IA | Legenda (ChatGPT/Gemini), imagem (OpenAI, Gemini/Nano Banana, Canva), vídeo (Higgsfield, Veo) |
| 5 | Criativos prontos | Upload de imagem/vídeo/carrossel, legenda por IA opcional |
| 6 | Aprovação | Fila por tenant; modo por conta: "pede aprovação" ou "publica direto" |
| 7 | Agendamento e publicação | Fila com horário, retentativas, controle de limite da Meta |
| 8 | Insights | Coleta por post e por conta, público (idade/cidade) |
| 9 | Análise | Heatmap dia × horário, formato, público, achados da IA com ações aplicáveis |
| 10 | Integrações de IA | Provedor padrão por tarefa por tenant; créditos da plataforma ou chaves do cliente |

Fora do MVP: Stories com stickers interativos, resposta a comentários/DMs, anúncios, Facebook/TikTok/LinkedIn (a arquitetura de `channels` deve permitir adicionar depois).

---

## 2. Stack

- **Front + API:** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui (customizado pelos tokens da seção 11).
- **Banco/Auth/Storage:** Supabase (Postgres, Auth, RLS, Storage, Vault para segredos).
- **Jobs:** Supabase Queues (pgmq) + `pg_cron` disparando Edge Functions (Deno). Alternativa aceitável: worker Node num VPS consumindo a mesma fila.
- **IA:** adaptadores por provedor no servidor (nunca no browser).
- **Observabilidade:** tabela `audit_log` + logs das Edge Functions; alertas de falha de publicação por e-mail/WhatsApp (fase 2).

Regra de ouro: **toda chamada à Meta e às IAs roda no servidor** (Route Handler, Server Action ou Edge Function) com `service_role`, sempre filtrando por `tenant_id` explicitamente.

---

## 3. Multi-tenant

- Toda tabela de negócio tem `tenant_id uuid not null` + RLS.
- `memberships (user_id, tenant_id, role)` define acesso. Um usuário pode estar em vários tenants (agência, consultor).
- Papéis: `admin`, `editor`, `approver`, `viewer`. Admin da plataforma em `platform_admins` (vê todos os tenants, cria/suspende clientes).
- Tenant ativo vai num cookie (`vp_tenant`) validado no servidor contra `memberships` a cada request.
- Storage: bucket `media` com caminho `{tenant_id}/{post_id}/{arquivo}` e policies por prefixo.
- Segredos (token da Meta, chaves de IA do cliente) no Supabase Vault; as tabelas guardam só o `secret_id`.
- Filas com `tenant_id` na mensagem; o worker limita concorrência por tenant para um cliente não travar os outros.
- Tenant suspenso: login bloqueado para membros não-admin da plataforma e publicações pausadas (status `paused`).

Matriz de permissões:

| Ação | admin | editor | approver | viewer |
|---|---|---|---|---|
| Ver calendário/insights | ✓ | ✓ | ✓ | ✓ |
| Criar/editar plano, gerar IA, subir criativo | ✓ | ✓ | — | — |
| Aprovar/reprovar | ✓ | — | ✓ | — |
| Publicar agora / cancelar agendamento | ✓ | ✓ | — | — |
| Conectar contas, convidar pessoas, IA e cobrança | ✓ | — | — | — |

Opcional (fase 2): `approver` restrito a contas específicas (`membership_accounts`).

---

## 4. Integração com o Instagram (Meta)

**API:** Instagram API com login do Instagram (não exige página do Facebook). Permissões: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights` (e `instagram_business_manage_comments` se entrar resposta a comentários).

**Pré-requisitos de negócio:** app da Meta com verificação da empresa e App Review das permissões acima para operar contas de terceiros. Até a aprovação, só contas com papel no app (teste) funcionam.

**Conexão:**
1. Botão "Conectar conta" → OAuth do Instagram com `state` assinado contendo `tenant_id` + `user_id`.
2. Callback troca o code por token curto → token de longa duração → salva no Vault, grava `ig_accounts` (ig_user_id, username, foto, tipo de conta).
3. Job diário renova tokens que vencem em < 10 dias; falha → conta `needs_reauth` + aviso ao admin do tenant.
4. A mesma conta do Instagram não pode estar em dois tenants (unique em `ig_user_id`).

**Publicação** (fluxo de container):
1. Mídia precisa estar em URL pública na hora da chamada → gerar signed URL do Storage com validade de algumas horas.
2. `POST /{ig-id}/media` (imagem, `REELS`, `STORIES`; carrossel = itens com `is_carousel_item=true` + container `CAROUSEL` com até 10 filhos).
3. Vídeo: consultar `GET /{container-id}?fields=status_code` até `FINISHED` (backoff); `ERROR` → falha com mensagem.
4. `POST /{ig-id}/media_publish` com `creation_id`.
5. Gravar `ig_media_id`, `permalink`, `published_at`.
6. Conteúdo gerado por IA: enviar `is_ai_generated=true` na criação do container (rótulo "Informações de IA" do Instagram).

**Limites:** containers expiram em 24 h; limite de posts publicados via API por conta em 24 h móveis (a doc da Meta cita 50 em umas páginas e 100 em outras). **Não fixar o número no código:** consultar `GET /{ig-id}/content_publishing_limit` antes de publicar e bloquear o agendamento no front quando a conta estiver perto do teto.

**Insights:**
- Por post (`GET /{media-id}/insights`): `views`, `reach`, `likes`, `comments`, `saved`, `shares`, `total_interactions`, `profile_visits`, `follows` (validar a lista vigente por tipo de mídia na versão da API usada; `impressions` e `plays` foram descontinuados em favor de `views`).
- Por conta (`GET /{ig-id}/insights`): `views`, `reach`, `profile_views`, `follower_count`, e `follower_demographics` (idade, gênero, cidade). Público exige contas com volume mínimo de seguidores.
- Coleta: 1 h, 24 h, 72 h, 7 d e 28 d após publicar (snapshots), mais 1× por dia para a conta.

---

## 5. Geração por IA

**Interface única de adaptador** (`lib/ai/providers/*`):

```ts
interface CaptionProvider { generateCaption(input: CaptionInput): Promise<CaptionResult> }
interface ImageProvider  { generateImages(input: ImageInput): Promise<AsyncJobOrResult> }
interface VideoProvider  { generateVideo(input: VideoInput): Promise<AsyncJob> }   // sempre assíncrono
```

| Tarefa | Provedores | Observação |
|---|---|---|
| Legenda, hashtags, sugestão de temas, análise | OpenAI (ChatGPT), Google (Gemini) | saída em JSON validado com Zod |
| Imagem/arte | OpenAI Images, Gemini Image ("Nano Banana"), Canva | Canva via Connect API preenchendo modelo da marca (confirmar plano exigido para autofill) |
| Vídeo (Reels) | Higgsfield, Google Veo | jobs longos: polling ou webhook |

- Nomes de modelo ficam em `ai_models` (config), nunca hardcoded.
- **Brief da marca por conta** (`brand_profiles`): tom de voz, público, temas proibidos, hashtags fixas, cores, fontes, logo, exemplos de posts aprovados. Vai em todo prompt.
- Prompt de legenda recebe: tema, formato, brief, CTA desejado, limite de 2.200 caracteres e 30 hashtags.
- Prompt de imagem recebe: tema + brief visual + proporção do formato (1:1 ou 4:5 feed, 9:16 Reels/Stories) + texto curto a sobrepor (título do post).
- Carrossel: a IA gera o roteiro dos slides (JSON) → cada slide vira uma imagem.
- **Saúde (clientes clínicas):** regra no prompt + checagem pós-geração para não prometer resultado, não usar antes/depois e seguir publicidade médica do CFM/CRO. Itens bloqueados vão para aprovação mesmo em contas "publica direto".

**Cobrança de IA por tenant (`ai_settings.billing_mode`):**
- `platform`: usa chaves da Visus; cada geração debita `credit_ledger` (custo estimado por provedor/modelo). Sem saldo → bloqueia geração.
- `own`: tenant cadastra as próprias chaves (Vault); sem débito de crédito.

---

## 6. Máquina de estados do post

```
planned ──gerar──▶ generating ──ok──▶ pending_approval ──aprovar──▶ scheduled ──hora──▶ publishing ──▶ published
   │                    │                    │                          │                    │
   │                    └──erro──▶ generation_failed               cancelar▶ planned     erro▶ failed (retry até 3×)
   │                                         └──reprovar──▶ rejected ──gerar de novo──▶ generating
   └──upload pronto──▶ pending_approval | scheduled (conforme modo da conta)
```

- Modo da conta lido **no momento em que a geração termina**: `require_approval=true` → `pending_approval`; senão → `scheduled`.
- Editar legenda/mídia de um `scheduled` em conta com aprovação → volta para `pending_approval`.
- `publishing` usa lock (`select … for update skip locked`) para não publicar duas vezes.
- Todo evento grava em `post_events` (quem, quando, de → para, motivo).

---

## 7. Jobs

| Job | Frequência | Faz |
|---|---|---|
| `publish-due` | cron a cada minuto | pega `scheduled` com `scheduled_at <= now()`, enfileira `publish` |
| `publish` (fila) | consumidor | fluxo da seção 4; retentativa exponencial (1, 5, 15 min) |
| `generate` (fila) | consumidor | chama provedores, salva mídia no Storage, atualiza post |
| `poll-async-generation` | cron 1 min | verifica jobs de vídeo/imagem assíncronos |
| `collect-media-insights` | cron 15 min | snapshots 1h/24h/72h/7d/28d |
| `collect-account-insights` | diário 06:00 (fuso do tenant) | conta + público |
| `refresh-tokens` | diário | renova tokens da Meta |
| `weekly-analysis` | semanal | recalcula agregados e gera achados com IA |

---

## 8. Análise

Agregados em SQL (views materializadas por tenant/conta, janela 30/90 dias):
- **Taxa de engajamento** = (curtidas + comentários + salvos + compartilhamentos) / alcance.
- **Heatmap** dia da semana × faixa horária (fuso do tenant), com contagem de posts por célula (não mostrar célula com < 3 posts como conclusão).
- **Formato**: Reels × Carrossel × Foto × Stories (engajamento, alcance, visitas ao perfil).
- **Tema**: a IA classifica cada post em categorias (caso, dica, institucional, bastidores…) → desempenho por categoria.
- **Público**: idade, gênero, cidades (último snapshot).

**Achados da IA:** o modelo recebe só os agregados (nunca dados brutos de terceiros) e devolve JSON:

```json
{ "findings": [ { "title": "...", "body": "...", "evidence": {...},
  "action": { "type": "reschedule|change_format|suggest_themes|none", "params": {...} } } ] }
```

Ações aplicáveis com 1 clique (ex.: "Mover posts das 12h para 18h") alteram só posts `planned`/`scheduled` futuros e registram em `post_events`.

---

## 9. Telas (ver protótipo)

Calendário · Planejamento · Aprovações · Criativos prontos · Insights · Contas do Instagram · Integrações de IA · Equipe · Clientes (admin da plataforma). Troca de cliente no topo do menu lateral.

Rotas sugeridas: `/[tenantSlug]/calendario`, `/planejamento`, `/aprovacoes`, `/criativos`, `/insights`, `/contas`, `/ia`, `/equipe`; `/admin/clientes`.

---

## 10. Segurança e LGPD

- RLS em todas as tabelas; testes automatizados de isolamento (usuário do tenant A não lê nada do B).
- Segredos só no Vault; nunca retornam ao client.
- Webhooks/callbacks com verificação de assinatura e `state` anti-CSRF.
- `audit_log` para login, conexão de conta, mudança de papel, aprovação, publicação, exclusão.
- Exclusão de conta do Instagram: revoga token, apaga mídia do Storage após 30 dias, mantém insights agregados anonimizados se o contrato permitir.
- Termos de uso e política de privacidade exigidos pela Meta (URL pública) + endpoint de exclusão de dados (Data Deletion Callback).

---

## 11. Design system (do protótipo)

```css
:root {
  --font-sans: "Plus Jakarta Sans", system-ui, sans-serif;
  --background: #FFFFFF;  --sidebar: #F6F6F3;  --subtle: #FAFAF8;  --muted-bg: #F1F1EE;
  --foreground: #16181D;  --text-2: #3A3D44;   --muted-fg: #5E6168;
  --border: #E6E6E1;      --border-strong: #D4D4CE;  --row-divider: #F0F0EC;
  --primary: #16181D;     --on-primary: #FFFFFF;
  --brand: #4A5D23;       --brand-soft: #EEF1E4;  --brand-dark: #3D4D1C;
  --st-planned: #9A9DA3;  --st-generating: #3B6FD1; --st-pending: #D79A16;
  --st-scheduled: #2E8B57; --st-rejected: #D2493A;  --st-published: #16181D;
  --radius-sm: 6px; --radius: 8px; --radius-card: 10px; --radius-post: 12px;
}
```

Regras: botão primário preto; oliva só em detalhes (selecionado, gráficos); status como ponto + texto; tabelas no lugar de grades de cards; números com `tabular-nums`; sem gradientes, emojis ou sombras fortes; hover 120–160 ms; botão afunda (scale .98) no clique; respeitar `prefers-reduced-motion`; alvos ≥ 40–44 px; contraste ≥ 4.5:1.

---

## 12. Fases

| Fase | Entrega | Critério de pronto |
|---|---|---|
| 0 | Repo, Supabase, auth, tenants, memberships, RLS + testes de isolamento | usuário de A não vê B |
| 1 | Conexão Instagram + upload de criativo + agendamento + publicação real | post agendado sai no horário numa conta de teste |
| 2 | Planejamento + geração de legenda e imagem (1 provedor cada) + aprovação | plano de 1 mês gerado e aprovado |
| 3 | Demais provedores (Gemini, Nano Banana, Higgsfield, Veo; Canva adiado) + cobrança por créditos/BYOK | troca de provedor por tenant funciona |
| 4 | Insights + heatmap + achados com ações | ação "mover horário" aplica no plano |
| 5 | Admin da plataforma, planos, faturamento, App Review da Meta | cliente externo conecta conta em produção |

## 13. Pendências de decisão

1. Planos comerciais (limites de contas por plano? créditos de IA inclusos? preço).
2. Gateway de cobrança dos tenants (Asaas, Stripe, Iugu).
3. Domínio e marca do app na Meta (nome exibido no OAuth).
4. Approver restrito por conta já no MVP?
5. White label para agências (domínio e logo próprios) — fase 2?
