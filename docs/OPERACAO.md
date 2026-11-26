# Operação: Metricool, Meta, variáveis e rotinas

## 0. Metricool (provedor inicial, enquanto o app da Meta não é liberado)

Cada conta do Instagram publica por um provedor (`ig_accounts.publish_via`): `metricool` ou `meta`. Sem o app da Meta configurado, o app funciona só com o Metricool.

Há dois jeitos de conectar o Metricool de um cliente (tela **Contas do Instagram** → "Publicação pelo Metricool", só para admin da plataforma):

- **Entrar com o Metricool (conector, qualquer plano, inclusive Free):** o app usa o servidor MCP oficial (`https://ai.metricool.com/mcp`) com o login do Metricool (OAuth). No plano Free o Metricool limita a **20 posts agendados por mês**. Bom para a fase de teste.
- **Token da API (planos Advanced ou Custom):** em Configurações da conta → API, copie **userId** e **token** e cole no formulário "Usar o token da API". Sem limite de 20 posts.

Nos dois casos as credenciais ficam no Vault e nunca passam por chat ou e-mail. Depois de conectar, escolha a marca do Metricool, confira o @ do Instagram e se a conta pede aprovação, e clique em **Adicionar conta**. Uma marca só pode estar em um cliente.

Para o login funcionar em produção, defina `APP_URL` com o endereço público do app (o retorno do login é `APP_URL/api/metricool/oauth/callback`).

Como funciona: no horário do post, a rotina `publish-due` manda o post ao Metricool para daqui a 2 minutos no fuso do cliente (com `autoPublish`) e o post fica "Publicando". A cada minuto a rotina consulta o Metricool; quando o Instagram confirma, o post vira "Publicado" com o link. Erro do Metricool → "Falhou" com o motivo. Se em 3 h não houver confirmação, o post vai para "Falhou" pedindo para conferir no Metricool. "Tentar de novo" reaproveita o post já criado no Metricool (nunca publica duas vezes).

Limitações conhecidas do Metricool:
- não envia a marcação de conteúdo gerado por IA (`is_ai_generated`), que só existe na API da Meta;
- o limite de publicações da Meta não é consultado (o Metricool controla);
- o post sai cerca de 2 minutos depois do horário marcado;
- a API do Metricool não documenta tudo (tipos POST/STORY, formato de algumas respostas). Confira o primeiro post real de cada formato.
- pelo conector: o app lê a lista de ferramentas do servidor ao conectar (guardada em `metricool_connections.mcp_tools`) e monta os parâmetros por ela. O conector só lista posts **agendados**; quando o post some da lista depois do horário, o app conclui que saiu e marca "Publicado", sem o link do Instagram. Erro aparece como "Falhou" quando o Metricool o mostra na lista.

**Trocar para a Meta:** quando o app da Meta for liberado (seção 1), o admin do cliente clica em "Conectar conta do Instagram" e entra com a mesma conta. A conta existente passa a publicar pela Meta, sem perder posts nem histórico.


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
| `publish-due` | a cada minuto | publica posts vencidos (lock com `claim_due_posts`, limite da Meta consultado antes) e confirma os enviados ao Metricool |
| `refresh-tokens` | 1× por dia | renova tokens da Meta que vencem em menos de 10 dias; falha → conta "Reconectar". Sem app da Meta, não faz nada |

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

A Meta (ou o Metricool, que copia o arquivo para ele) baixa a mídia por uma URL assinada do Storage (válida por 6 h) no momento da publicação. O Supabase precisa estar acessível pela internet; o Supabase local não serve para publicar de verdade.

## 5. IA (tema e legenda a partir do criativo)

- A chave da OpenAI ou do Gemini é cadastrada pelo admin da plataforma em **Admin → IA** (`/admin/ia`). O app confere a chave no provedor e guarda no Vault (`ai_platform_keys` + `store_platform_ai_key`); ela não volta para a tela.
- Modelos ficam em `ai_models` (`openai:caption`, `gemini:caption`) e podem ser trocados na mesma tela.
- Cliente em `ai_settings.billing_mode = 'own'` usa só as chaves dele (`ai_credentials`); a tela para isso vem na Fase 3.
- Na tela Criativos prontos, o botão manda à IA a imagem reduzida (ou 4 quadros do vídeo, sem áudio) gerada no navegador. Cada geração fica em `generation_jobs`, sem as imagens.
- Marca de saúde (`brand_profiles.is_healthcare`): o servidor confere o texto final e junta os riscos que a IA apontou em `posts.compliance_flags`. Post com alerta vai para aprovação mesmo em conta "publica direto".
- Planejamento (`/[tenant]/planejamento`): temas sugeridos pela IA viram posts `planned` de origem `ai`. "Gerar legendas e criativos" chama uma geração por post (`begin_generation` → `generatePost` → `finish_generation`), cada uma numa chamada de até 300 s. Reels sai só com legenda e volta a `planned` esperando o vídeo da equipe.
- Na tela Admin → IA, a lista de modelos vem da API do provedor com a chave guardada (`read_platform_ai_key`); sem resposta, mostra uma lista de reserva.
- Vídeo em Criativos prontos: o navegador também extrai até 3 min de áudio (WAV 16 kHz). Gemini ouve junto com os quadros; na OpenAI o áudio é transcrito antes (modelo `openai:transcription` em `ai_models`). Se a transcrição falhar, a legenda sai só pelos quadros.
