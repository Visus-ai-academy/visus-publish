# Visus Publish

SaaS multi-tenant da Visus para planejar, gerar com IA, aprovar, agendar e publicar no Instagram, com insights e análise.

- Especificação: `docs/SPEC.md` (fonte da verdade de regras de negócio, estados, jobs e integrações).
- Protótipo visual e de fluxo: `docs/prototipo/Main.dc.html` (telas, textos, estados e tokens de design).
- Esquema do banco: `supabase/migrations/`.

Idioma: interface, mensagens de erro e textos em **português do Brasil**. Código, nomes de tabelas e commits em inglês.

## Stack

- Next.js (App Router) + TypeScript estrito + Tailwind + shadcn/ui
- Supabase: Postgres, Auth, RLS, Storage, Vault, Queues (pgmq), pg_cron, Edge Functions (Deno)
- Zod para validar toda entrada de usuário e toda saída de IA
- Testes: Vitest (unidade), Playwright (e2e), testes de RLS com usuários de tenants diferentes

## Comandos

```bash
pnpm dev                 # app local (precisa de .env.local, ver .env.example)
pnpm lint && pnpm typecheck
pnpm test                # unidade (lib/**/*.test.ts)
pnpm test:rls            # isolamento e papéis contra o Supabase local (tests/rls)
pnpm test:e2e            # Playwright (precisa de db reset + db:seed e build)
pnpm db:seed             # usuários e clientes de exemplo, só no Supabase local
supabase start           # banco local (pnpm exec supabase …)
supabase db reset        # aplica migrations
supabase gen types typescript --local > lib/supabase/database.types.ts   # após mudar o schema
```

Notas do scaffold:
- Next 16: `proxy.ts` substitui `middleware.ts`; `cacheComponents` está ligado, por isso o cliente Supabase do servidor chama `connection()` e o layout raiz envolve as telas em `<Suspense>`.
- shadcn/ui: o CLI não alcançou o registro na criação; os componentes básicos estão escritos à mão em `components/ui/` no mesmo padrão. Rode `pnpm dlx shadcn@latest init` quando tiver rede e migre.

## Regras inegociáveis

1. **Multi-tenant:** toda tabela de negócio tem `tenant_id` + RLS. Nenhuma query no servidor com `service_role` sem `where tenant_id = …` explícito. Nova tabela = nova policy + teste de isolamento no mesmo PR.
2. **Segredos:** tokens da Meta e do Metricool e chaves de IA só no Supabase Vault. Nunca no client, em logs, em `NEXT_PUBLIC_*` ou em respostas da API.
3. **Chamadas externas** (Meta, Metricool, OpenAI, Google, Higgsfield, Canva) só no servidor ou em Edge Functions.
4. **Estados do post** seguem a máquina da SPEC §6. Mudança de status só por função do domínio (`lib/posts/transitions.ts`), que grava `post_events`. Aprovação usa a função SQL `review_post`; transições de pessoa usam `transition_post`. O trigger `guard_post_columns` bloqueia o papel `authenticated` de mudar status ou colunas de publicação direto.
5. **Publicação idempotente:** usar `claim_due_posts` (skip locked). Nunca publicar duas vezes o mesmo post; guardar `ig_container_id` antes de `media_publish`.
6. **Limite da Meta:** consultar `content_publishing_limit` antes de publicar; não fixar o número no código.
7. **Modelos de IA** vêm da tabela `ai_models`; não hardcodar nomes de modelo.
8. **Conteúdo de saúde** (`brand_profiles.is_healthcare`): aplicar as regras de publicidade médica da SPEC §5 e forçar aprovação quando a checagem marcar risco.
9. **Conteúdo gerado por IA** publica com `is_ai_generated=true`.
10. **Integridade entre clientes:** tabela filha referencia o pai por FK composta `(id, tenant_id)`, para nunca apontar para linha de outro cliente.

## Estrutura

```
app/(auth)/…                    login, convite
app/[tenant]/calendario|planejamento|aprovacoes|criativos|insights|contas|ia|equipe
app/admin/clientes
app/api/meta/oauth/start|callback  OAuth do Instagram (state assinado + nonce em cookie)
app/api/metricool/oauth/start|callback  login do conector do Metricool (PKCE, registro dinâmico)
app/api/jobs/[job]              rotinas chamadas pelo agendador (publish-due, refresh-tokens, collect-insights, weekly-analysis); ver docs/OPERACAO.md
lib/supabase/{server,client}.ts
lib/tenant.ts                   resolve tenant ativo (cookie vp_tenant) e valida membership
lib/posts/transitions.ts        máquina de estados (chama transition_post / review_post no banco)
lib/invitations/                convites (token aleatório; banco guarda só sha256)
lib/meta/                       cliente da Instagram API (container, publish, insights, tokens), contas e state do OAuth
lib/metricool/                  Metricool (provedor inicial; cada conta escolhe em ig_accounts.publish_via): API REST (client.ts)
                                ou conector MCP com OAuth, que funciona no plano Free (mcp.ts, oauth.ts, connector.ts)
lib/publishing/publisher.ts     publicação: claim com lock, limite da Meta, container salvo antes do publish, retentativas;
                                pelo Metricool: envia, guarda external_post_id e confirma depois (sem duplicar)
lib/insights/                   métricas pela Meta (collect.ts; casa posts do Metricool com mídias), agregados e mapa de calor
                                (aggregate.ts), achados da IA (analysis.ts) e ação no plano (apply.ts → função apply_finding)
lib/ai/providers/               openai, gemini, gemini-image, higgsfield, veo (interface única; Canva adiado)
lib/ai/credits.ts               débito de créditos antes da IA e estorno (charge_credits / grant_credits)
lib/ai/video.ts                 vídeo do Reels assíncrono: começa no provedor, poll-generation termina
lib/ai/prompts/                 caption, image, carousel, themes, analysis (+ schemas Zod)
supabase/functions/             (futuro) generate, poll-async-generation, insights, weekly-analysis.
                                Na Fase 1 as rotinas de publicação ficaram em app/api/jobs para reaproveitar
                                lib/ e os testes; migrar para Edge Functions é opcional.
```

## Design

Seguir `docs/prototipo/Main.dc.html` e os tokens da SPEC §11. Plus Jakarta Sans; fundo branco e menu lateral #F6F6F3; botão primário preto; oliva (#4A5D23) só em detalhes; status como ponto + texto; tabelas em vez de grades de cards; `tabular-nums` em números. Sem gradientes, emojis, sombras fortes ou etiquetas em maiúsculas espaçadas. Hover 120–160 ms, clique com scale .98, respeitar `prefers-reduced-motion`. Contraste ≥ 4.5:1, alvos ≥ 40 px, foco visível.

## Ordem de trabalho

Seguir as fases da SPEC §12. Em cada fase: migration → policies → testes de RLS → domínio (`lib/`) → UI → e2e. Não começar a fase seguinte com teste vermelho.

## Definição de pronto

- `pnpm lint`, `pnpm typecheck`, `pnpm test` verdes
- teste de isolamento entre dois tenants cobrindo a feature
- estados vazios, carregando e erro implementados na UI
- textos em pt-BR revisados
