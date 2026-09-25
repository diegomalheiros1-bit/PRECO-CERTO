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

