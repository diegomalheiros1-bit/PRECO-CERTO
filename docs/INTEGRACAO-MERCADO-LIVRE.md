# Integração Mercado Livre — estado atual

Não há chamadas externas nesta versão. O `MarketplaceGateway` separa regras e interface da API externa; `MockMarketplaceGateway` é o único ativo. `MercadoLivreGateway` permanece fail-closed.

Próxima etapa concreta:

1. Criar uma aplicação no portal do Mercado Livre e configurar uma URL de redirecionamento segura.
2. Criar ao menos três usuários de teste (vendedores e, se necessário, comprador) seguindo a documentação oficial vigente.
3. Preencher localmente `.env` a partir de `.env.example`, sem versionar segredos.
4. Implementar autorização e renovação OAuth no backend, cifrando tokens em repouso e vinculando-os ao `seller_id` retornado pela API.
5. Implementar primeiro contas e anúncios em modo somente leitura e testes de integração opt-in.
6. Antes de cada endpoint de escrita, registrar nesta documentação a URL oficial, método, campos, limites e comportamento para anúncios tradicionais e User Products. Só então considerar escrita, restrita por `ML_WRITE_ENABLED=true` e `ML_TEST_USER_ALLOWLIST` contendo exclusivamente usuários de teste.

Credenciais, callback válido e usuários de teste são dependências externas pendentes. Nenhuma escrita real deve ser ativada para validar a aplicação local.

## Callback HTTPS via GitHub Pages

O portal do Mercado Livre não aceita `localhost` como URI de redirecionamento. Cadastre exatamente:

`https://diegomalheiros1-bit.github.io/PRECO-CERTO/oauth-callback/`

O workflow `Publicar callback OAuth` publica somente a página estática de `oauth-callback-site/index.html` no GitHub Pages, usando GitHub Actions como origem. A aplicação continua local: a página recebe o retorno OAuth e redireciona o navegador para `http://127.0.0.1:3333/oauth/mercadolivre/callback` nesta máquina. Ela não armazena credenciais nem faz a troca do código.

**Limite de privacidade:** os parâmetros `code` e `state` chegam primeiro à hospedagem do GitHub Pages antes de seguirem ao backend local. Eles podem constar em registros de infraestrutura do GitHub. A página remove a query da barra de endereço e não carrega recursos externos, mas isso não elimina a passagem pelo GitHub. Não coloque Client Secret, tokens ou outros segredos na URL ou neste repositório.

O callback do backend **ainda precisa ser implementado**. Antes de considerar o OAuth funcional, ele deverá validar `state` e PKCE, trocar o `code` imediatamente e de forma única, vincular os tokens ao `seller_id`, proteger tokens em repouso e não registrar parâmetros sensíveis. Se a aplicação local não estiver rodando, a navegação para `127.0.0.1:3333` falhará; inicie um novo fluxo OAuth em vez de reutilizar o código. A escrita de preços reais permanece desabilitada (`ML_WRITE_ENABLED=false`) e o gateway ativo continua fictício.

