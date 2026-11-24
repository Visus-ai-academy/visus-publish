# Operação: Meta, variáveis e rotinas

## 1. App da Meta (uma vez)

1. Em developers.facebook.com, crie um app do tipo **Empresa** e adicione o produto **Instagram** → "API do Instagram com login do Instagram".
2. Em "Configurar login comercial do Instagram", cadastre a URL de redirecionamento: `https://SEU-DOMINIO/api/meta/oauth/callback` (igual a `META_REDIRECT_URI`).
3. Copie o **ID do app do Instagram** e a **Chave secreta do app do Instagram** para `META_APP_ID` e `META_APP_SECRET` nas variáveis do servidor (nunca no código, no chat ou em `NEXT_PUBLIC_*`).
4. Até o App Review ser aprovado (Fase 5), só contas com papel no app funcionam: em "Funções do app" → "Testadores do Instagram", adicione a conta profissional de teste e aceite o convite no Instagram (Configurações → Apps e sites).

## 2. Variáveis do servidor

Veja `.env.example`. `OAUTH_STATE_SECRET` e `CRON_SECRET` são valores aleatórios com 32+ caracteres.

## 3. Rotinas

As rotinas rodam no app em `POST /api/jobs/{rotina}` com `Authorization: Bearer $CRON_SECRET`:

| Rotina | Frequência | O que faz |
|---|---|---|
| `publish-due` | a cada minuto | publica posts vencidos (lock com `claim_due_posts`, limite da Meta consultado antes) |
| `refresh-tokens` | 1× por dia | renova tokens que vencem em menos de 10 dias; falha → conta "Reconectar" |

Opção A, pelo próprio Supabase (pg_cron + pg_net). Rode no SQL Editor do projeto, trocando domínio e segredo:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('COLE_O_CRON_SECRET', 'cron_secret');

select cron.schedule('publish-due', '* * * * *', $$
  select net.http_post(
    url := 'https://SEU-DOMINIO/api/jobs/publish-due',
    headers := jsonb_build_object('authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
  );
$$);

select cron.schedule('refresh-tokens', '0 9 * * *', $$
  select net.http_post(
    url := 'https://SEU-DOMINIO/api/jobs/refresh-tokens',
    headers := jsonb_build_object('authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
  );
$$);
```

Opção B: o cron da hospedagem (por exemplo Vercel Cron) chamando as mesmas URLs com o mesmo cabeçalho.

## 4. Mídia

A Meta baixa a mídia por uma URL assinada do Storage (válida por 6 h) no momento da publicação. O Supabase precisa estar acessível pela internet; o Supabase local não serve para publicar de verdade.
