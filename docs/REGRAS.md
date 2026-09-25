# Regras e decisões

## Modelo de domínio

- Uma combinação de anúncio/variação é candidata após busca, mas nunca é selecionada automaticamente.
- `user_product` pode ser tratado individualmente quando os dados confirmarem esse modelo.
- A busca expande um anúncio `traditional` para mostrar todas as suas variações, mesmo quando só um SKU corresponde ao critério. A interface seleciona ou remove o grupo inteiro. Se a resposta não trouxer o grupo completo e seus IDs, a seleção fica desabilitada.
- A API reconsulta separadamente os alvos e todas as variações atuais de cada anúncio tradicional envolvido. A composição é delimitada por `accountId`, `sellerId` e ID do anúncio. IDs de variação são comparados como conjuntos: duplicatas, ausências, trocas e acréscimos bloqueiam a operação.
- Todos os alvos de uma operação recebem o mesmo novo preço. Essa é uma **decisão do Preço Certo**, não uma regra universal do Mercado Livre.
- Preço deve ser positivo e conter no máximo duas casas decimais. Entradas inválidas não são corrigidas silenciosamente.
- Promoção ativa, preço automático e migração pendente desabilitam a seleção na busca e bloqueiam a operação se aparecerem na reconsulta. Se uma variação tradicional estiver bloqueada, o grupo inteiro fica indisponível. O bloqueio de promoções é conservador nesta primeira versão.

## Confirmação e consistência

O navegador mostra a revisão exata e exige confirmação. A API reconsulta o gateway logo antes de executar e compara conta, vendedor, anúncio, ID da variação ou User Product, SKU, estrutura, moeda, estado, preço padrão, promoção, preço automático, título, tamanho, cor e grupo com o snapshot revisado. Qualquer diferença gera `stale_data` e exige nova pesquisa/aprovação. Os bloqueios por condições ativas usam o estado reconsultado, não as flags do navegador. Preços inválidos ou divergentes são recusados novamente no servidor.

Cada combinação é identificada por uma chave composta de conta, vendedor, anúncio, estrutura e ID da variação ou User Product. Essa chave relaciona seleção, divergência, resposta do gateway, resultado e histórico. Um problema global aparece em `issues` com `targetKey: null`; uma variação sem problema específico recebe apenas a indicação de que outra bloqueou a operação. Nenhum alvo é enviado ao gateway de atualização quando há bloqueio. A operação só recebe `simulated` quando todos os itens foram simulados; qualquer falha produz `partial_failure`.

## Segurança e integração futura

- A API escuta explicitamente em `127.0.0.1`.
- O frontend não contém client secret, tokens nem chave de criptografia.
- Logs do Fastify ocultam cabeçalhos de autorização, cookies e campos de token/segredo.
- `MercadoLivreGateway` existe como limite de integração, mas falha de forma segura. Escrita real não está implementada e `ML_WRITE_ENABLED=false` é o padrão.
- OAuth deverá associar cada token ao `seller_id`, cifrar tokens em repouso e tratar renovação/revogação. O callback público/HTTPS, se exigido, será documentado; nenhum túnel é aberto automaticamente.
- Antes de qualquer escrita, a documentação oficial atual do endpoint deverá ser verificada. A existência de consulta em `/prices` não será interpretada como permissão de edição.

## Persistência

SQLite mantém ID, horário, responsável, critério, motivos globais e por combinação, e resultados JSON completos (identificadores, SKUs, variações, preço anterior, pretendido, efetivamente aplicado e percentual). No modo atual `appliedPrice` é sempre `null` e a operação registra `simulado; nenhum envio ao Mercado Livre`. Bancos criados pela versão anterior recebem a coluna `issues_json` automaticamente; registros antigos continuam legíveis.

## Limitação da demonstração

O gateway fictício entrega grupos completos a partir da massa local. O gateway real ainda não consulta a API do Mercado Livre. Antes de habilitar escrita futura, sua implementação terá de comprovar que a leitura reúne todas as variações exigidas pelo endpoint oficial, além de tratar concorrência, timeout e reconsulta pós falha. O snapshot aprovado é transportado pelo navegador; esta versão local não implementa sessão de autenticação ou assinatura do snapshot.

