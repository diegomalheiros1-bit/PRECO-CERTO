# Integração Mercado Livre — estado atual

## Atualização do piloto de leitura (2026-09-29)

O vendedor de teste `3715389198` concluiu a autorização OAuth nesta máquina. A consulta de API é opt-in: `ML_READ_ENABLED=true` no `.env` local e reinício do backend. Em "Contas conectadas", o botão "Testar leitura" consulta `GET /users/me` para conferir o ID do token e depois `GET /users/{id}/items/search?limit=20` para mostrar o total e os primeiros IDs de anúncios. O token permanece cifrado no SQLite e não é devolvido ao navegador. A rota local `POST /api/oauth/mercadolivre/test-read` exige a origem local, cabeçalho próprio, vendedor na allowlist e token válido. Não grava os resultados. Zero anúncios também é um teste de leitura válido.

O fluxo de quatro etapas, as três contas DEMO e o histórico continuam simulados. `ML_WRITE_ENABLED=false` deve permanecer assim; nenhuma escrita real foi implementada. Não há renovação nem revogação automática de token; ao expirar, reautorize o vendedor de teste. A leitura real retornou a identidade esperada e zero anúncios no teste de 2026-09-29.

O `MarketplaceGateway` separa regras e interface da API externa; `MockMarketplaceGateway` é o único ativo para contas, anúncios e preços. `MercadoLivreGateway` permanece fail-closed. Fora do simulador, o backend oferece OAuth de teste e uma consulta isolada, somente leitura e opt-in, para o vendedor autorizado.

Preparação e próximos passos:

1. A aplicação no portal, a URL de redirecionamento e a configuração local de teste já foram preparadas nesta máquina. Esses dados não são versionados; em outra instalação, configure `.env` a partir de `.env.example`.
2. A autorização OAuth foi concluída nesta máquina para o vendedor de teste `3715389198`. A renovação de tokens e a revogação ainda não foram implementadas; após expirar, inicie nova autorização.
3. Se forem necessários testes entre contas, criar usuários de teste adicionais conforme a documentação oficial e guardar suas credenciais fora do repositório.
4. Validar a leitura opt-in de identidade e IDs de anúncios do vendedor de teste. Depois, planejar o mapeamento de anúncios sem misturá-los ao simulador.
5. Antes de cada endpoint de escrita, registrar nesta documentação a URL oficial, método, campos, limites e comportamento para anúncios tradicionais e User Products. Só então considerar escrita, restrita por `ML_WRITE_ENABLED=true` e `ML_TEST_USER_ALLOWLIST` contendo exclusivamente usuários de teste.

O callback público está publicado e a autorização ponta a ponta do vendedor de teste foi concluída nesta máquina. Nenhuma escrita real deve ser ativada para validar a aplicação local.

## Callback HTTPS via GitHub Pages

O portal do Mercado Livre não aceita `localhost` como URI de redirecionamento. Cadastre exatamente:

`https://diegomalheiros1-bit.github.io/PRECO-CERTO/oauth-callback/`

O workflow `Publicar callback OAuth` publica somente a página estática de `oauth-callback-site/index.html` no GitHub Pages, usando GitHub Actions como origem. A aplicação continua local: a página recebe o retorno OAuth e redireciona o navegador para `http://127.0.0.1:3333/oauth/mercadolivre/callback` nesta máquina. Ela não armazena credenciais nem faz a troca do código.

**Limite de privacidade:** os parâmetros `code` e `state` chegam primeiro à hospedagem do GitHub Pages antes de seguirem ao backend local. Eles podem constar em registros de infraestrutura do GitHub. A página remove a query da barra de endereço e não carrega recursos externos, mas isso não elimina a passagem pelo GitHub. Não coloque Client Secret, tokens ou outros segredos na URL ou neste repositório.

O backend agora implementa `POST /api/oauth/mercadolivre/start` e `GET /oauth/mercadolivre/callback`. O início requer a interface local em `http://127.0.0.1:5173`, gera `state` e PKCE S256 aleatórios, vincula a tentativa a um cookie HttpOnly e expira em cinco minutos. O callback rejeita parâmetros ausentes/duplicados, verifica `state` e o cookie, consome o estado antes da troca única do código e envia o mesmo `redirect_uri` e o `code_verifier` ao endpoint oficial. O vendedor retornado deve estar na allowlist de teste. Os tokens são cifrados com AES-256-GCM antes de serem guardados no SQLite local; a interface recebe somente o ID do vendedor e a data de expiração, nunca os tokens. A rota não registra parâmetros do retorno OAuth.

Inicie e conclua a autorização no mesmo navegador e perfil, na mesma máquina, em até cinco minutos. Não copie o link de retorno para outro navegador: ele contém um código de uso único e o callback exige o cookie criado no início. Se aparecer a mensagem de cookie ausente, volte à interface local e inicie uma nova tentativa; não reutilize o endereço antigo.

O fluxo é **desabilitado por padrão**. Para testar, configure localmente `.env` com `ML_OAUTH_ENABLED=true`, `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, o `ML_REDIRECT_URI` exato acima, `ML_TEST_USER_ALLOWLIST` com IDs numéricos de vendedores de teste e `ML_ENCRYPTION_KEY` com 32 bytes aleatórios em hexadecimal (64 caracteres). Não versione `.env` nem divulgue a chave: perdê-la impossibilita ler os tokens armazenados. Mantenha `ML_WRITE_ENABLED=false`. Inicie backend e interface e, em “Contas conectadas”, use “Autorizar vendedor de teste”. Se o backend local não estiver rodando, se a tentativa vencer ou se a página de ponte falhar, reinicie a autorização; códigos não podem ser reutilizados.

Esta implementação **não** renova ou revoga tokens e não permite escrita de preços reais. As três contas DEMO e o histórico de preços continuam fictícios e separados dos vendedores de teste autorizados. A autorização ponta a ponta foi confirmada nesta máquina para o vendedor de teste; os testes automatizados continuam usando troca de token simulada.

## Endpoints externos em uso e referências

- `GET https://auth.mercadolivre.com.br/authorization`: inicia a autorização com `response_type=code`, `client_id`, `redirect_uri` exato, `state` e desafio PKCE S256. A opção PKCE deve estar habilitada no aplicativo do portal.
- `POST https://api.mercadolibre.com/oauth/token`: troca o código uma única vez com `grant_type=authorization_code`, `client_id`, `client_secret`, `code`, o mesmo `redirect_uri` e `code_verifier`. A resposta nunca é enviada ao frontend; códigos de erro conhecidos podem ser exibidos sem a descrição bruta do servidor.
- `GET https://api.mercadolibre.com/users/me` e `GET https://api.mercadolibre.com/users/{id}/items/search?limit=20`: somente no diagnóstico de leitura opt-in do vendedor de teste. O gateway ativo de preços não chama esses endpoints. A página GitHub Pages é somente a ponte estática de redirecionamento.

Referências oficiais verificadas em 2026-09-29: [Autenticação e Autorização](https://developers.mercadolivre.com.br/autenticacao-e-autorizacao), [Realização de testes](https://developers.mercadolivre.com.br/pt_br/realizacao-de-testes/realizacao-de-testes) e [workflow personalizado do GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). O erro `invalid_grant` pode ter várias causas, entre elas código expirado/usado, cliente ou URI divergente e pendências do usuário; não identifique a causa apenas por esse código.

