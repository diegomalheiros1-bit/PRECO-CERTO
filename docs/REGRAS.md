# Regras e decisões

## Modelo de domínio

- Uma combinação de anúncio/variação é candidata após busca, mas nunca é selecionada automaticamente.
- `user_product` pode ser tratado individualmente quando os dados confirmarem esse modelo.
- Um anúncio `traditional` com variações só pode avançar com o grupo completo. A aplicação bloqueia grupos parciais para não correr o risco de remover ou alterar variações omitidas.
- Todos os alvos de uma operação recebem o mesmo novo preço. Essa é uma **decisão do Preço Certo**, não uma regra universal do Mercado Livre.
- Preço deve ser positivo e conter no máximo duas casas decimais. Entradas inválidas não são corrigidas silenciosamente.
- Promoção ativa, preço automático e migração pendente bloqueiam o fluxo simples. O bloqueio de promoções é conservador nesta primeira versão.

## Confirmação e consistência

O navegador mostra a revisão exata e exige confirmação. A API reconsulta o gateway logo antes de executar e compara conta, vendedor, anúncio, SKU, estrutura, moeda, estado e preço padrão com o snapshot revisado. Qualquer diferença gera `stale_data` e exige nova pesquisa/aprovação.

Resultados são independentes por item. A operação só recebe `simulated` quando todos os itens foram simulados; qualquer falha produz `partial_failure`. Bloqueios e falhas são persistidos com motivo.

## Segurança e integração futura

- A API escuta explicitamente em `127.0.0.1`.
- O frontend não contém client secret, tokens nem chave de criptografia.
- Logs do Fastify ocultam cabeçalhos de autorização, cookies e campos de token/segredo.
- `MercadoLivreGateway` existe como limite de integração, mas falha de forma segura. Escrita real não está implementada e `ML_WRITE_ENABLED=false` é o padrão.
- OAuth deverá associar cada token ao `seller_id`, cifrar tokens em repouso e tratar renovação/revogação. O callback público/HTTPS, se exigido, será documentado; nenhum túnel é aberto automaticamente.
- Antes de qualquer escrita, a documentação oficial atual do endpoint deverá ser verificada. A existência de consulta em `/prices` não será interpretada como permissão de edição.

## Persistência

SQLite mantém ID, horário, responsável, critério e resultados JSON completos (identificadores, SKUs, variações, valores, percentual e motivo). O modo atual sempre registra `simulado; nenhum envio ao Mercado Livre`.

