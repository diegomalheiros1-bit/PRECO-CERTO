# Integração Mercado Livre — estado atual

O `MarketplaceGateway` separa regras e interface da API externa; `MockMarketplaceGateway` é o único ativo para contas, anúncios e preços. `MercadoLivreGateway` permanece fail-closed. A única chamada externa opcional do backend é a troca do código OAuth, quando `ML_OAUTH_ENABLED=true` for configurado explicitamente.

Próxima etapa concreta:

1. Criar uma aplicação no portal do Mercado Livre e configurar uma URL de redirecionamento segura.
2. Criar ao menos três usuários de teste (vendedores e, se necessário, comprador) seguindo a documentação oficial vigente.
3. Preencher localmente `.env` a partir de `.env.example`, sem versionar segredos.
4. Testar a autorização OAuth local apenas com vendedores de teste permitidos. A renovação de tokens e a revogação ainda não foram implementadas; após expirar, inicie nova autorização.
5. Implementar primeiro contas e anúncios em modo somente leitura e testes de integração opt-in.
6. Antes de cada endpoint de escrita, registrar nesta documentação a URL oficial, método, campos, limites e comportamento para anúncios tradicionais e User Products. Só então considerar escrita, restrita por `ML_WRITE_ENABLED=true` e `ML_TEST_USER_ALLOWLIST` contendo exclusivamente usuários de teste.

Credenciais, callback válido e usuários de teste são dependências externas pendentes. Nenhuma escrita real deve ser ativada para validar a aplicação local.

## Callback HTTPS via GitHub Pages

O portal do Mercado Livre não aceita `localhost` como URI de redirecionamento. Cadastre exatamente:

`https://diegomalheiros1-bit.github.io/PRECO-CERTO/oauth-callback/`

O workflow `Publicar callback OAuth` publica somente a página estática de `oauth-callback-site/index.html` no GitHub Pages, usando GitHub Actions como origem. A aplicação continua local: a página recebe o retorno OAuth e redireciona o navegador para `http://127.0.0.1:3333/oauth/mercadolivre/callback` nesta máquina. Ela não armazena credenciais nem faz a troca do código.

**Limite de privacidade:** os parâmetros `code` e `state` chegam primeiro à hospedagem do GitHub Pages antes de seguirem ao backend local. Eles podem constar em registros de infraestrutura do GitHub. A página remove a query da barra de endereço e não carrega recursos externos, mas isso não elimina a passagem pelo GitHub. Não coloque Client Secret, tokens ou outros segredos na URL ou neste repositório.

O backend agora implementa `POST /api/oauth/mercadolivre/start` e `GET /oauth/mercadolivre/callback`. O início requer a interface local em `http://127.0.0.1:5173`, gera `state` e PKCE S256 aleatórios, vincula a tentativa a um cookie HttpOnly e expira em cinco minutos. O callback rejeita parâmetros ausentes/duplicados, verifica `state` e o cookie, consome o estado antes da troca única do código e envia o mesmo `redirect_uri` e o `code_verifier` ao endpoint oficial. O vendedor retornado deve estar na allowlist de teste. Os tokens são cifrados com AES-256-GCM antes de serem guardados no SQLite local; a interface recebe somente o ID do vendedor e a data de expiração, nunca os tokens. A rota não registra parâmetros do retorno OAuth.

O fluxo é **desabilitado por padrão**. Para testar, configure localmente `.env` com `ML_OAUTH_ENABLED=true`, `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, o `ML_REDIRECT_URI` exato acima, `ML_TEST_USER_ALLOWLIST` com IDs numéricos de vendedores de teste e `ML_ENCRYPTION_KEY` com 32 bytes aleatórios em hexadecimal (64 caracteres). Não versione `.env` nem divulgue a chave: perdê-la impossibilita ler os tokens armazenados. Mantenha `ML_WRITE_ENABLED=false`. Inicie backend e interface e, em “Contas conectadas”, use “Autorizar vendedor de teste”. Se o backend local não estiver rodando, se a tentativa vencer ou se a página de ponte falhar, reinicie a autorização; códigos não podem ser reutilizados.

Esta implementação **não** renova ou revoga tokens, não lê anúncios reais e não permite escrita de preços reais. As três contas DEMO e o histórico de preços continuam fictícios e separados dos vendedores de teste autorizados. O OAuth não foi validado ponta a ponta com credenciais reais nesta etapa; os testes automatizados usam troca de token simulada.

