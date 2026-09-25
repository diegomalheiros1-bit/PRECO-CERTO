# Preço Certo

Primeira versão local de gestão de preços para múltiplas contas do Mercado Livre. O fluxo funcional usa dados fictícios, executa somente simulações e mantém histórico em SQLite. A API aceita conexões apenas em `127.0.0.1`.

Projeto de Diego Stanisci Malheiros.

## Pré-requisitos

- Node.js 20 ou superior
- npm 10 ou superior

## Instalação e execução

No PowerShell, Prompt de Comando, macOS ou Linux, a partir da raiz:

```sh
npm install
copy .env.example .env
npm run dev
```

No macOS/Linux, substitua `copy` por `cp`. Abra `http://127.0.0.1:5173`. A API fica em `http://127.0.0.1:3333`; dados são criados em `data/preco-certo.sqlite`.

Na etapa **Informar alterações**, pesquise `Capacete Norisk` e informe um preço de referência. A massa inclui sete combinações, três contas DEMO, User Products, um grupo tradicional com três variações e itens bloqueados por promoção, preço automático e migração pendente. Também é possível buscar por SKU exato ou por uma lista separada por linhas, vírgulas ou ponto e vírgula. Na lista, SKUs existentes são comparados exatamente; os demais termos buscam nome/modelo. Um SKU de anúncio tradicional exibe todas as variações do grupo.

Em **Revisar anúncios**, selecione combinações liberadas individualmente, por conta ou todas. O preço pode ser editado por linha; uma alteração em anúncio tradicional ajusta todas as suas variações. O avanço exige ao menos um alvo e um novo preço válido e uniforme. Em **Aprovação final**, confira os dados e marque o checkbox antes da confirmação final. **Resultado** mostra o protocolo e o estado de cada combinação, com acesso ao histórico local.

## Verificação

```sh
npm test
npm run build
```

## Estrutura

- `apps/web`: React/Vite, menu lateral, fluxo em quatro etapas, revisão por linha, histórico filtrável e temas claro/escuro.
- `apps/api`: Fastify e repositório SQLite.
- `packages/domain`: regras puras, tipos e gateways testáveis.
- `docs/REGRAS.md`: decisões de produto e segurança.
- `docs/INTEGRACAO-MERCADO-LIVRE.md`: fronteira e próxima etapa da integração.

## Garantias da simulação

- Itens bloqueados não podem ser selecionados; qualquer variação bloqueada indisponibiliza o grupo tradicional inteiro.
- Antes da simulação, a API reconsulta os alvos e todas as variações dos anúncios tradicionais selecionados. Ela compara identificadores e condições atualizadas e bloqueia mudanças que exijam nova revisão.
- O preço pretendido aparece separado do preço aplicado. Na demonstração, o preço aplicado é sempre `não aplicado`.
- Bloqueios e falhas são associados à combinação exata; erros globais ficam separados no histórico. Um bloqueio impede a chamada de atualização do gateway.
- A interface começa em tema claro, respeita a preferência de tema salva e adapta a revisão para telas estreitas sem cobrir a tabela. A importação de planilha aparece desabilitada como função em desenvolvimento.

## Limitações atuais

- Apenas gateway fictício; OAuth e leitura real dependem de credenciais e usuários de teste.
- Nenhum endpoint de escrita real foi implementado ou chamado.
- O usuário responsável é local e configurável por `APP_USER`; ainda não há autenticação multiusuário.
- O banco local não é cifrado. Tokens futuros exigirão proteção em repouso separada antes de serem armazenados.
- Ainda não há sessão de usuário ou assinatura do snapshot aprovado. O gateway real deverá fornecer leitura completa e atualizada de grupos antes de qualquer escrita futura.

Consulte [.env.example](.env.example) para configuração sem segredos e [docs/REGRAS.md](docs/REGRAS.md) para as garantias da operação.
