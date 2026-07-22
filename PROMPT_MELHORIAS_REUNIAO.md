# Tarefa: Implementar as melhorias da reunião de 16/07/26 (13 pontos) — Gran SPA

## Contexto
Sistema PesquisaSatisfacaoSPA do Gran Marquise (spa: sauna, massoterapia e espaço
beleza da pousada). Perfis de cliente: hóspede, passante e pax. Stack: Node 20 +
Express 5 + better-sqlite3 (src/db.js), admin em public/admin.html +
public/js/admin.js, anamnese em public/spa-profile.html/.js, React SPA de pesquisa
em frontend/. Mapa completo do sistema em MAPEAMENTO.md (leia antes de codar).
Este documento foi produzido por 13 agentes que analisaram cada ponto contra o
código REAL — os arquivos/linhas citados abaixo foram verificados em 22/07/26.

## ⚠ REGRAS INEGOCIÁVEIS (valem para TODOS os pontos)
1. AUTO-DEPLOY: push na main vai a produção em segundos (2 workflows no
   .github/workflows). Toda edição precisa deixar o app são a cada arquivo salvo;
   migrações de schema SEMPRE idempotentes (ALTER TABLE em try/catch, como as
   existentes em src/db.js).
2. NÃO PODE QUEBRAR: fluxo de reserva casal (salas 3+4, cliente2, survey_tokens
   por pessoa, lock de anamnese p2); cálculo de comissão (calcularComissaoPorMes);
   fluxos públicos (pesquisa com token, anamnese spa-profile); contratos de
   endpoints usados por outras telas — mudanças em respostas de API só ADITIVAS.
3. PROTOCOLO COM AGENTES: para cada ponto, (a) subagente(s) confirmam o mapeamento
   abaixo antes de editar (o código pode ter mudado); (b) implementação em
   mudanças pequenas e isoladas; (c) verificador adversarial independente tenta
   quebrar a regra implementada (API direta sem UI, corrida, campos
   contrabandeados no body, dados legados) — falhou → corrige antes de seguir.
4. TESTES: cada ponto com lógica nova ganha um script em scripts/test-*.js no
   padrão dos existentes (dados taggeados __TEST_, data futura isolada, cleanup,
   3 passagens, tabela passagem × cenário × resultado).
5. Um ponto por vez, na ordem abaixo. Ao final de cada ponto: rodar os testes do
   ponto + smoke dos fluxos vizinhos, e só então passar ao próximo.

## ORDEM DE IMPLEMENTAÇÃO (dependências e risco)
FASE A — prontos para codar (nenhuma decisão externa pendente):
  1º ponto 3  (só confirmar/documentar — NÃO mexer em salas 3+4)
  2º ponto 5  (ortografia — baixo risco, mas cuidado com labels que casam
              respostas históricas por texto)
  3º ponto 7  (blacklist — tabela nova, aditivo)
  4º ponto 4  (fim do desconto automático 10% — semântica NULL=legado obrigatória)
  5º ponto 11 (comissão — revisar DEPOIS do 4, pois o fim do desconto muda a
              discussão da base de cálculo; corrigir scripts/test-receita-local.js)
  6º ponto 8  (relatório hóspede×passante — fase pax só após definição)
  7º ponto 9  (tela Day Use sauna/jacuzzi — tabela própria, NUNCA em reservas;
              integra com o relatório do 8)
  8º ponto 12+13 (escala: status DO + regra de folga — os dois juntos, validação
              NÃO-bloqueante com aviso)
  9º ponto 6  (assinatura acessível — modo digitado+testemunha, preservar selo HMAC)
FASE B — BLOQUEADOS até resposta humana (implementar só o esqueleto se fizer sentido):
  ponto 1  → Richard: o que são W8/Nub + formato de exportação
  ponto 2  → definição da condição de bloqueio (arquitetura genérica já proposta)
  ponto 10 → Georgia: valores Day Use hóspede/Gran Class + fluxo dia da noiva
  transversal → definição de "pax" (afeta pontos 8 e 9; hoje o código só conhece
  hospede/passante em reservas.tipo_cliente)

Responda TODAS as "questões abertas" de um ponto com o usuário ANTES de
implementar a parte que depende delas; o que não depende, implemente já.

---

## PONTO 1 — Importar dados do W8 para o Nub
**Complexidade:** media

### Estado atual (verificado no código)
Não existe NENHUMA referência funcional a "W8" nem a "Nub" no código. O grep encontrou matches apenas em arquivos irrelevantes (package-lock.json, tmp_resp.json, tmpcss.txt, token_github.txt — strings aleatórias/base64), nunca em src/, public/ ou scripts/. Conclusão: W8 e Nub são sistemas EXTERNOS (provavelmente W8 = software de gestão de spa legado em uso no HGM; "Nub" = apelido interno deste sistema — o próprio PesquisaSatisfacaoSPA — ou outro destino; precisa confirmação humana). O que existe hoje de infraestrutura aproveitável: (1) Cadastro central de clientes — tabela `clientes` em C:\Users\estagio.ti\Desktop\ClaudeCode\PesquisaSatisfacaoSPA\src\db.js linhas 462-477 (cpf, passaporte, nome, email, telefone, data_nascimento, locale_pref, nacionalidade, observacao; índice UNIQUE parcial em cpf linha 476); (2) Funções de dedupe prontas em src/db.js: `inserirCliente` (linha 2841 — faz upsert por CPF válido mod-11 ou passaporte, retorna id existente se já cadastrado), `buscarClientePorCpf` (2823), `buscarClientePorPassaporte` (2832), `validarCpfMod11`; (3) Precedente de script de migração com dry-run/--apply: scripts/migrar-clientes.js (popula `clientes` a partir de `spa_perfis` e vincula reservas/feedback órfãos por CPF/email/telefone dentro de uma transação); (4) Tabela `reservas` (src/db.js linha 82) e `cliente_produto` (linha 480) que poderiam receber histórico de atendimentos/consumo; (5) Tabela `system_meta` (linha 494) para flags de migração já executada. NÃO existe: nenhum endpoint de upload/import (sem multer, sem parser CSV/xlsx no package.json), nenhuma tela de importação no admin, nenhuma coluna de origem externa (ex.: `origem` ou `w8_id`) nas tabelas.

### Arquivos afetados
- `scripts/importar-w8.js` — NOVO — script de importação CSV/XLSX com dry-run/--apply, seguindo o padrão de scripts/migrar-clientes.js
- `src/db.js` — Adicionar colunas via ALTER TABLE idempotente: clientes.origem TEXT, clientes.origem_id TEXT (id do registro no W8) + índice; opcionalmente tabela import_log; NÃO alterar inserirCliente
- `package.json` — Adicionar dependência de parsing (csv-parse ou xlsx) como devDependency se o import for só via script local
- `src/routes/clientes.js` — OPCIONAL (fase 2) — endpoint POST /api/clientes/importar (requireMaster) recebendo JSON já parseado do frontend, para importar sem acesso SSH ao Fly
- `public/js/admin.js` — OPCIONAL (fase 2) — UI de upload na view Clientes com preview/relatório de duplicatas antes de confirmar

### Implementação (sem regressão)
FASE 0 — Levantamento (bloqueante): obter do Richard uma exportação real do W8 (CSV/Excel) para conhecer o layout de colunas. Sem isso, só dá para deixar o esqueleto pronto.

FASE 1 — Schema (src/db.js, no bloco de migrações idempotentes): `ALTER TABLE clientes ADD COLUMN origem TEXT` (valores: 'manual'|'anamnese'|'w8') e `ALTER TABLE clientes ADD COLUMN origem_id TEXT` (id/código do cliente no W8), com try/catch para idempotência como as demais migrações do arquivo; criar índice `idx_clientes_origem ON clientes(origem, origem_id)`. Isso permite reimportação incremental (se origem_id já existe, atualiza em vez de duplicar) e rastreabilidade.

FASE 2 — Script scripts/importar-w8.js, clonando o padrão de scripts/migrar-clientes.js: (a) lê o arquivo exportado (csv-parse para CSV; se W8 só exporta .xls, usar lib xlsx); (b) normaliza: CPF → dígitos + validarCpfMod11; telefone → últimos 9 dígitos p/ matching; email → lowercase; datas → ISO YYYY-MM-DD; (c) dedupe em 3 níveis: 1º por clientes.origem_id (reimportação), 2º por CPF via buscarClientePorCpf, 3º por passaporte via buscarClientePorPassaporte; fallback fuzzy por email OU telefone (mesma técnica do REPLACE aninhado de migrar-clientes.js linhas 123-128) — nesses casos NÃO cria novo, marca como "conflito a revisar" no relatório; (d) modo padrão DRY-RUN imprimindo: total lido, novos, já existentes (merge), CPFs inválidos, conflitos; `--apply` roda tudo numa única db.transaction; (e) merge não-destrutivo: para cliente existente, só preenche campos vazios (nunca sobrescreve email/telefone já cadastrados no Nub); (f) grava flag em system_meta (`import_w8_YYYYMMDD`) para evitar dupla execução acidental; (g) se o export do W8 tiver histórico de atendimentos/consumo, gravar em cliente_produto (produto_nome, valor, data_compra) vinculado ao cliente_id — NÃO criar registros em `reservas` (reservas tem CHECK sala IN (1..5), NOT NULL em hora_inicio/hora_fim e alimenta agenda/comissão; dados históricos externos quebrariam esses fluxos).

FASE 3 — Execução em produção: o banco vive no volume Fly (/app/data/feedback.db). Rodar via `fly ssh console -a pesquisa-satisfacao` + node scripts/importar-w8.js dentro da máquina (subir o CSV via `fly ssh sftp shell`), OU fase 2 opcional: endpoint POST /api/clientes/importar protegido por requireMaster (o middleware requireWrite/requireMaster já existe em src/middleware/auth.js), recebendo JSON parseado no cliente (evita adicionar multer), com resposta = relatório dry-run e um segundo POST com {confirmar:true} para aplicar. A trilha de auditoria já captura POST /api/* via src/middleware/audit.js automaticamente.

O QUE NÃO TOCAR: inserirCliente/atualizarCliente (usados por routes/clientes.js e migrar-clientes.js), índice UNIQUE de cpf, tabela reservas, spa_perfis, fluxo de anamnese.

### Riscos de regressão (checar um a um)
- Índice UNIQUE parcial idx_clientes_cpf (db.js:476): tentar inserir CPF já existente fora de inserirCliente lança exceção e aborta a transação inteira — o script deve sempre passar por inserirCliente ou checar antes
- buscarCliente360 (db.js:2883) junta reservas por cliente_id OU cpf — merge errado de clientes (fuzzy por telefone/email) contaminaria o 360° com atendimentos de outra pessoa; por isso fuzzy match deve só reportar, nunca auto-mesclar
- Não inserir atendimentos históricos do W8 em `reservas`: a tabela tem CHECK de sala 1-5 e alimenta agenda, comissão de massagistas e survey_tokens; dados legados iriam aparecer na agenda e nos cálculos de comissão
- Sobrescrever email/telefone de clientes existentes quebraria vínculos feitos por migrar-clientes.js (matching de reservas/feedback órfãos usa esses campos) — merge deve preencher apenas campos vazios
- Deploy automático no push da main (memória do projeto: auto-commit + 2 workflows competindo): ALTER TABLE em db.js vai a produção em segundos; garantir que a migração seja idempotente (try/catch) antes de commitar, senão o boot do app quebra em produção
- Volume de dados: import grande (milhares de linhas) fora de transação única deixaria o SQLite WAL lento e o banco inconsistente em caso de falha — usar db.transaction como em migrar-clientes.js

### ❓ Questões abertas (perguntar antes de implementar a parte dependente)
- O que são exatamente W8 e Nub? Hipótese: W8 = sistema legado do hotel/spa com a base de clientes; Nub = este sistema (PesquisaSatisfacaoSPA). Precisa confirmação do Richard — nenhum dos dois nomes existe no código
- Qual o formato de exportação que o W8 oferece (CSV, Excel, API, dump SQL)? E quais colunas (tem CPF? passaporte? data de nascimento? histórico de atendimentos/consumo?)
- Importar só cadastro de clientes ou também histórico de atendimentos/compras? Se sim, o destino proposto é cliente_produto — validar se atende
- Importação única (one-shot) ou recorrente/incremental enquanto o W8 continuar em uso? Isso decide se vale construir a UI de upload (fase 2 opcional) ou basta o script via fly ssh
- Clientes do W8 sem CPF nem passaporte: criar mesmo assim (com origem_id como chave) ou descartar?
- Como resolver conflitos de dados divergentes (mesmo CPF, nome/telefone diferentes entre W8 e Nub): W8 vence, Nub vence, ou revisão manual?
- LGPD: a base do W8 tem consentimento para migração? O sistema já tem trilha de consentimento na anamnese (spa.js/HMAC) — clientes importados não terão consentimento registrado

---

## PONTO 2 — Regra de bloqueio automático configurável (condição→ação)
**Complexidade:** media

### Estado atual (verificado no código)
Existem hoje 4 mecanismos de bloqueio, todos hardcoded e independentes entre si:

1. BLOQUEIO DE SALA (manual, por período): tabela `sala_bloqueios` em src/db.js:728-738 (colunas: sala CHECK IN 1..5, data_inicio, data_fim, motivo, bloqueado_por, criado_em; índice na linha 738). CRUD em src/db.js:3193-3227 (listarBloqueiosSala, listarTodosBloqueios, buscarBloqueioById, criarBloqueioSala, removerBloqueioSala). Rotas em src/routes/salas.js: GET /api/admin/salas (19-31), GET/POST /:id/bloqueios (51-126, com fluxo 409 "reservas_no_periodo" + confirmar), DELETE /bloqueios/:bloqueioId (130-141), POST transferir reservas (160-192). ENFORCEMENT: inserirReserva (src/db.js:1776-1785) e atualizarReserva (src/db.js:1870-1873) consultam sala_bloqueios e lançam Error code='SALA_BLOQUEADA'; handlers em src/routes/reservas.js:355,533 e src/routes/salas.js:207 traduzem para HTTP 409. UI em public/js/admin.js:9211-9349+ (cards de sala, modal de bloqueio) e indicadores na agenda (admin.js:2717-2720, 3096).

2. TRAVA DE ANAMNESE (link de uso único): inserirSpaPerfilComLock em src/db.js:2510-2545 — transação BEGIN IMMEDIATE com UPDATE condicional `SET documento_perfil_id=? WHERE id=? AND documento_perfil_id IS NULL`; changes===0 → Error('ANAMNESE_JA_RESPONDIDA'). Testado por scripts/test-trava-anamnese.js (8 cenários x 3 passagens, incluindo corrida concorrente e casal pessoa 1/2).

3. RATE-LIMIT (endpoint público de pesquisa): src/routes/feedback.js:9-40 — Map em memória, 5 submissões/10min por IP, HTTP 429. Não persistente (reinicia no deploy) e usado só em POST /api/feedback.

4. AVALIAÇÃO DE ESCALA (soft-block com filosofia "nunca travar"): avaliarEscalaMassagista em src/db.js:1173-1229 retorna {disponivel, motivo, aviso} mas por design NUNCA impede a operação por falta de escala — apenas avisa. Conflitos duros: CONFLITO_SALA e CONFLITO_PROF em inserirReserva/atualizarReserva (src/db.js:1787-1840, 1875-1895).

Precedente de configuração persistida: tabela singleton `comissao_config` (src/db.js:307-311, get/set em 1544-1563) e o módulo de questionários configuráveis (src/qualidade.js). NÃO existe hoje nenhuma tabela genérica de regras condição→ação nem motor de avaliação de regras.

### Arquivos afetados
- `src/db.js` — Nova tabela `regras_bloqueio` + migração + funções CRUD e motor avaliarRegrasBloqueio(contexto); pontos de enforcement adicionados em inserirReserva/atualizarReserva (após as checagens existentes das linhas 1776-1840)
- `src/routes/salas.js` — Opcional: manter intocado; regras genéricas ganham router próprio para não misturar com bloqueio manual de sala
- `src/routes/regras.js` — NOVO router CRUD /api/admin/regras (montar em src/server.js perto da linha 255, protegido por requireAuth/requireWrite como os demais)
- `src/server.js` — app.use('/api/admin/regras', regrasRouter) junto aos routers existentes (linhas 236-284); ordem antes de cadastrosRouter (linha 284) que tem requireAuth global
- `src/routes/reservas.js` — Tratar novo código de erro REGRA_BLOQUEIO nos catch existentes (linhas 355-361 e 533-535) devolvendo 409 com nome/motivo da regra
- `public/admin.html` — Nova seção/modal de gestão de regras (padrão dos modais de bloqueio de sala já existentes)
- `public/js/admin.js` — CRUD de regras na UI + exibir toast/alerta quando 409 tipo='regra' (padrão dos handlers de SALA_BLOQUEADA em ~9211-9349)

### Implementação (sem regressão)
Como a condição exata ainda será definida na reunião, a arquitetura deve ser genérica (tabela de regras condição→ação) com motor de avaliação plugável. Passo a passo sem regressão:

1. TABELA (src/db.js, nova migração no padrão try/catch das existentes, ex. após a migração de salas linha 748):
```sql
CREATE TABLE IF NOT EXISTS regras_bloqueio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  descricao TEXT,
  evento TEXT NOT NULL,            -- gatilho: 'reserva.criar' | 'reserva.atualizar' | 'anamnese.enviar' | 'feedback.enviar' | ...
  condicao TEXT NOT NULL,          -- JSON declarativo: [{campo, operador, valor}] com AND implícito; operadores: eq, neq, gt, gte, lt, lte, in, between, contains
  acao TEXT NOT NULL DEFAULT 'bloquear',  -- 'bloquear' (409) | 'avisar' (warning não-bloqueante, segue filosofia avaliarEscalaMassagista) | 'exigir_confirmacao' (409 + confirmar:true passa, padrão já usado em salas.js:99-107)
  mensagem TEXT,                   -- texto mostrado ao usuário
  ativa INTEGER NOT NULL DEFAULT 1,
  vigencia_inicio TEXT, vigencia_fim TEXT,  -- opcional, período de validade
  criado_por TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_regras_bloqueio_evento ON regras_bloqueio(evento, ativa);
```
Condição em JSON declarativo (NUNCA eval de código) — ex.: `[{"campo":"sala","operador":"in","valor":[3,4]},{"campo":"hora_inicio","operador":"gte","valor":"18:00"}]`.

2. MOTOR (src/db.js, novas funções exportadas):
- `listarRegrasBloqueio({evento, ativa})`, `criarRegraBloqueio(dados)`, `atualizarRegraBloqueio(id, dados)`, `removerRegraBloqueio(id)` — mesmo padrão CRUD de listarBloqueiosSala/criarBloqueioSala (db.js:3193-3227).
- `avaliarRegrasBloqueio(evento, contexto)` → percorre regras ativas do evento (filtrando vigência), avalia cada condição contra o objeto contexto (ex.: {sala, data, hora_inicio, hora_fim, tipo_cliente, massagista_id, cliente...}), retorna `{bloqueios: [...], avisos: [...], confirmacoes: [...]}`. Campo desconhecido no contexto ou JSON de condição ilegível → regra ignorada com console.warn (fail-open, mesma filosofia "nunca travar por dado ruim" de avaliarEscalaMassagista db.js:1192-1193 e 1212).

3. ENFORCEMENT: dentro de inserirReserva e atualizarReserva (src/db.js), logo APÓS as checagens existentes de SALA_BLOQUEADA/CONFLITO_SALA/CONFLITO_PROF (não antes — preserva a ordem/precedência de erros que a UI já conhece): chamar avaliarRegrasBloqueio('reserva.criar', ctx); se houver bloqueio, throw Object.assign(new Error('REGRA_BLOQUEIO'), {code:'REGRA_BLOQUEIO', regra: r.nome, motivo: r.mensagem}) — mesmíssimo padrão de SALA_BLOQUEADA (db.js:1781-1784). Ação 'exigir_confirmacao' usa opts.confirmarRegras (novo opt em opts, default false) espelhando o fluxo confirmar de salas.js:99-107.

4. ROTAS: novo src/routes/regras.js com GET/POST/PUT/DELETE /api/admin/regras (+ POST /api/admin/regras/testar que recebe um contexto de exemplo e retorna o resultado do motor — dry-run para o admin validar a regra antes de ativar). Montar em server.js junto a app.use('/api/admin/salas', salasRouter) (linha 255); o auditMiddleware da linha 236 já loga POST/PUT/DELETE automaticamente. Escrita protegida por requireWrite (src/middleware/auth.js).

5. HANDLERS HTTP: em src/routes/reservas.js, adicionar aos catch das linhas 355-361 e 533-535: `if (e.code === 'REGRA_BLOQUEIO') return res.status(409).json({ok:false, tipo:'regra', regra:e.regra, error:e.motivo})`. Idem salas.js:206-208 (rota PUT /reservas/:id/sala).

6. UI: nova aba/card "Regras de bloqueio" no admin.html (reusar padrão do modal de bloqueio de sala, admin.js:9340+): lista de regras com toggle ativa/inativa, form com evento (select), builder simples de condições (campo/operador/valor), ação, mensagem, e botão "Testar". No fluxo de reserva, tratar 409 tipo='regra' mostrando a mensagem — mesmo lugar onde SALA_BLOQUEADA já é tratado.

7. FASEAMENTO SEGURO: entregar primeiro com deploy da tabela + motor + CRUD SEM enforcement ligado (nenhuma regra cadastrada = zero mudança de comportamento, pois avaliarRegrasBloqueio com tabela vazia retorna listas vazias). Após a reunião definir a condição real, cadastrar a regra via UI — sem novo deploy se a condição couber no modelo declarativo.

### Riscos de regressão (checar um a um)
- Ordem de checagens em inserirReserva/atualizarReserva: a UI (admin.js) e reservas.js:355-361/533-535 dependem dos codes SALA_BLOQUEADA/CONFLITO_SALA/CONFLITO_PROF com mensagens específicas — a nova checagem deve vir DEPOIS delas e usar code novo (REGRA_BLOQUEIO), nunca reaproveitar os existentes
- inserirReserva é chamada também pelo fluxo de transferência de bloqueio (salas.js:160-192 via atualizarSalaReserva) — uma regra mal configurada pode impedir transferências automáticas; o motor deve ser fail-open em erro de avaliação
- Trava de anamnese (inserirSpaPerfilComLock, db.js:2510-2545) roda dentro de transação IMMEDIATE — se regras forem aplicadas ao evento 'anamnese.enviar', avaliar ANTES de abrir a transação para não segurar write-lock; não tocar na lógica do UPDATE condicional (validada por scripts/test-trava-anamnese.js — rodar o script após qualquer mudança em spa_perfis/reservas)
- Filosofia 'nunca travar' da escala (db.js:1172, 1192, 1212): se a condição da reunião envolver escala de massagista, ação 'bloquear' inverte um comportamento intencional — preferir 'avisar' ou 'exigir_confirmacao' por padrão
- Rate-limit de feedback.js é em memória e por IP; se a regra da reunião for sobre pesquisa pública, não substituir esse mecanismo — apenas complementar, pois o endpoint é público e o motor consulta o DB a cada request
- Deploy automático no push da main (memória do projeto: auto-commit + 2 workflows competindo) — a migração da tabela vai a produção em segundos; usar CREATE TABLE IF NOT EXISTS dentro de try/catch como as migrações existentes (padrão db.js:747) para não derrubar o boot
- auditMiddleware (server.js:236) intercepta POST/PUT/DELETE /api/* — montar o router de regras sob /api garante auditoria de quem criou/alterou regras; montar fora de /api perderia o log
- Índice idx_sala_bloqueios_sala e queries de bloqueio rodam em TODA criação de reserva — o motor adiciona 1 query por evento; com tabela pequena é irrelevante, mas evitar avaliar regras em endpoints de listagem (GET) de alto volume

### ❓ Questões abertas (perguntar antes de implementar a parte dependente)
- QUAL é a condição de bloqueio que a reunião vai definir? (ex.: cliente inadimplente? nº de faltas/no-show? anamnese não preenchida X horas antes? horário-limite? capacidade diária?) — o modelo declarativo cobre comparações sobre campos da reserva/cliente; condições que exigem agregação histórica (ex.: 'cliente com 3 no-shows nos últimos 30 dias') precisam de operadores agregados extras no motor
- A ação é bloqueio duro (409, impossível prosseguir), bloqueio com override por confirmação (padrão confirmar já existente em salas.js:99-107) ou só aviso? Quem pode dar override (qualquer usuário write ou só master)?
- O bloqueio se aplica a quais eventos: criação de reserva no admin, edição, transferência de sala, envio de anamnese pública, envio de pesquisa pública?
- Regras devem ser configuráveis pelo usuário master na UI ou basta 1 regra fixa em código? (a arquitetura proposta suporta ambos, mas se for 1 regra única e estável, uma coluna em comissao_config-like seria mais simples)
- Deve haver log/notificação quando uma regra bloquear alguém (além do audit log automático)? Ex.: contador de bloqueios por regra para a gestão avaliar impacto
- Bloqueios criados por regra devem aparecer visualmente na agenda como os bloqueios de sala aparecem hoje (admin.js:2717-2720), ou só barrar no momento do save?

---

## PONTO 3 — Manter configuração como sala individual
**Complexidade:** baixa · **(processo/decisão, não é código)**

### Estado atual (verificado no código)
Configuração atual exata (seed em src/db.js L740-746, tabela `salas` L720-726 com colunas id, nome, tipo DEFAULT 'individual', ativa, observacao): Sala 1='individual', Sala 2='individual', Sala 3='individual', Sala 4='individual', Sala 5='Espaço Beleza' tipo='beleza'. Ou seja, TODAS as salas de massagem já estão como individuais no banco (seed é INSERT OR IGNORE — valor em produção pode ter sido editado via UI; conferir via GET /api/admin/salas).

O campo `salas.tipo` é PURAMENTE informativo/visual — nenhuma lógica de negócio o lê:
- Conflito de sala e comportamento "casal" são hardcoded para salas 3 e 4 e disparados por `cliente2 != null` na reserva, NÃO pelo tipo da sala: src/db.js L1787-1804 (inserirReserva: "Salas 3 e 4 compartilham espaço físico SOMENTE quando a reserva é CASAL — sinalizado por cliente2 != null. Se ambas forem individuais, 3 e 4 são independentes") e L1875-1886 (atualizarReserva, mesma regra).
- Checkbox "Esta reserva é para um casal?" só aparece quando Sala 3 ou 4 está selecionada: public/admin.html L4523-4527 ("une Sala 3 + Sala 4 — bloqueia as duas"); public/js/admin.js L2343 (_isCasal), L3066, L4380 — tudo hardcoded em (sala===3 || sala===4).
- UI de gestão de salas: CRUD em src/routes/salas.js (PUT /:id L35-47 aceita tipo ∈ ['individual','conjugada','beleza','evento']); modal de edição public/admin.html L5079-5111 com select de tipo (L5094-5099 inclui opção 'conjugada'); cards em public/js/admin.js L9227-9298 usam tipo só para exibir label e capacidade (TIPO_SALA_LABEL/TIPO_SALA_CAP).
- Inconsistência cosmética: o calendário usa a constante hardcoded CAL_ROOMS em public/js/admin.js L2239-2243 que rotula Sala 3 e 4 como tipo 'Dupla', cap 2 — divergente do banco ('individual'). Usada só para exibição (L3891-3894).
- Lock de casal na anamnese (src/routes/spa.js POST /perfil + src/db.js L575-577, trava atômica por token/pessoa 1 e 2; teste em scripts/test-trava-anamnese.js): ZERO referência a salas — grep por 'sala' em src/routes/spa.js retorna vazio. O lock é por pessoa da reserva, independente de configuração de sala.

Não existe nenhum toggle/flag global "modo sala individual" no sistema.

### Arquivos afetados
- `src/db.js` — Seed/DDL da tabela salas (L720-746) — nada a alterar; apenas confirmar tipo='individual' nas salas 1-4
- `src/routes/salas.js` — PUT /:id (L35-47) permite mudar tipo para 'conjugada' — opcional restringir se quiser fixar a decisão
- `public/admin.html` — Select de tipo no modal Editar Sala (L5094-5099) contém opção 'conjugada' — opcional remover
- `public/js/admin.js` — CAL_ROOMS L2239-2243 rotula salas 3/4 como 'Dupla' (cosmético, diverge do banco) — opcional alinhar para 'Individual'

### Implementação (sem regressão)
Este ponto é essencialmente CONFIRMAÇÃO, não implementação: o sistema já opera com todas as salas de massagem como individuais, e o comportamento de casal (unir salas 3+4) é acionado por reserva (checkbox casal → cliente2), nunca por configuração de sala. "Manter como sala individual" = não mudar nada no schema nem na lógica.

Passos mínimos (zero risco):
1. Verificar produção: GET /api/admin/salas e confirmar tipo='individual' nas salas 1-4 (admin pode ter editado via modal). Se alguma estiver 'conjugada', corrigir via PUT /api/admin/salas/:id ou pelo próprio modal Editar Sala.
2. Nada mais a fazer no backend.

Passos opcionais, apenas se a decisão for FIXAR a configuração (impedir mudança futura):
a) Remover a option 'conjugada' do select em public/admin.html L5096.
b) Remover 'conjugada' de TIPOS_VALIDOS em src/routes/salas.js L40.
c) Alinhar rótulo cosmético: em public/js/admin.js L2239-2243 mudar tipo 'Dupla'→'Individual' e cap 2→1 nas salas 3/4 de CAL_ROOMS (afeta só o texto do subtítulo do modal de detalhe da reserva, L3894 — reservas casal continuam exibindo 'Casal · Sala 3+4' pois esse ramo depende de r.cliente2, não de CAL_ROOMS).
Não tocar: lógica de conflito em src/db.js L1787-1810/L1875-1886, checkbox casal (admin.html L4523-4527, admin.js L2343/L3066/L4380), lock de anamnese (src/routes/spa.js, db.js L575-577), transferência de reservas em bloqueio (salas.js L160-192).

### Riscos de regressão (checar um a um)
- Se alguém interpretar o ponto como 'remover o conceito de casal' e mexer na lógica de salas 3+4: o fluxo inteiro de reserva casal quebra — conflito compartilhado 3+4 (db.js L1787-1810), checkbox casal (admin.html L4523), tokens de pesquisa por pessoa (criarSurveyToken pessoa 1/2) e o lock de anamnese p2 dependem de cliente2, não do tipo da sala. NÃO tocar nesses pontos.
- Mudar tipo de alguma sala para 'conjugada' via UI não muda comportamento (campo é só label), mas alteraria capacidade exibida ('2 pessoas') e pode confundir recepcionistas — por isso manter 'individual'.
- Se optar por remover 'conjugada' de TIPOS_VALIDOS (salas.js L40) e alguma sala em produção já estiver salva como 'conjugada', o próximo PUT de edição dessa sala falharia com 'Tipo inválido' — verificar/normalizar dado em produção antes.
- Alterar CAL_ROOMS (admin.js L2239-2243) afeta texto exibido em modal de detalhe (L3891-3894) e classes de cor (cls s3/s4) — mudar apenas os campos tipo/cap, nunca id/cls, senão o calendário perde as cores por sala.
- Deploy automático em push na main (Fly.io) — qualquer edição vira produção quase imediatamente; fazer as mudanças opcionais só após decisão confirmada.

### ❓ Questões abertas (perguntar antes de implementar a parte dependente)
- A anotação 'manter como sala individual' refere-se a qual sala especificamente? Todas já são 'individual' no banco — confirmar se a reunião estava validando o estado atual ou revertendo alguma mudança feita em produção via modal Editar Sala.
- Deseja-se FIXAR a decisão (remover a opção 'conjugada' do select e da API) ou apenas confirmar e deixar o campo editável como está?
- O rótulo 'Dupla · 2 pessoas' que o calendário exibe para salas 3 e 4 (CAL_ROOMS hardcoded) deve ser alinhado para 'Individual · 1 pessoa', ou a equipe quer manter a indicação de que 3/4 comportam casal?
- O fluxo de reserva casal (checkbox que une Sala 3+4) deve permanecer intacto, correto? (Assumido que sim — é independente da configuração de tipo da sala.)

---

## PONTO 4 — Remover desconto automático 10% (Gran Class/Combo) + opt-in "Deseja conceder o desconto?" no fluxo de venda
**Complexidade:** media

### Estado atual (verificado no código)
O desconto automático de 10% existente no código NÃO é específico de Combo: é o benefício Gran Class, aplicado automaticamente a TODOS os tratamentos (combos inclusos) quando o hóspede está em quarto de categoria 'gran_class'. Ele é 100% frontend/display-only — nenhum valor de preço/desconto é persistido na reserva.

Pontos exatos:
1. public/js/admin.js:3592-3610 — função _atualizarComboLinhaPreco(): preview de preço no modal de criação/edição de reserva. Linha 3596-3597: `const ehGC = _resTipo === 'hospede' && aptoVal.length === 4 && quartoCategoria(aptoVal) === 'gran_class'; const desconto = ehGC ? sub * 0.10 : 0;` — desconto aplicado antes de taxa de serviço (TAXA_SERVICO=0.10, admin.js:2565) e ISS (TAXA_ISS=0.05, admin.js:2566).
2. public/js/admin.js:3706-3727 — _precoBloco(tm, ehGC): bloco de preço nos detalhes da reserva (pessoa 1 e 2). Linha 3711: `const desconto = ehGC ? sub * 0.10 : 0`. Chamado por _precoDetHtml (3729-3738) e _precoDetHtml2 (3740-3745), que derivam ehGC de `r.quarto_categoria === 'gran_class'` (vindo do backend: src/routes/reservas.js usa isGranClass/categoriaQuarto de src/db.js:2717).
3. public/js/admin.js:3747-3786 — modal "Benefícios Gran Class": texto "10% de desconto em todas as massagens / Aplicado automaticamente sobre o subtotal antes da taxa de serviço" (linhas 3764-3765).
4. Tabela reservas (src/db.js:82-95 + migrations em ~274): NÃO tem coluna de preço nem de desconto. O POST/PUT de reserva (admin.js:4580-4600 → src/routes/reservas.js → criarReserva/atualizarReserva em src/db.js:1858+) não envia nada de preço.
5. Receita/comissão (src/db.js:1566-1690, agregarReceitaPorMesDoSistema + calcularComissaoPorMes; endpoint GET /api/massagistas/:id/receita em src/routes/cadastros.js:107): usa SEMPRE tipos_massagem.preco cheio — comentário explícito na linha 1570: "Preço = tipos_massagem.preco (tabela base; sem faixas de desconto)". O desconto GC de hoje NÃO afeta receita nem comissão.
6. Faixas de desconto NORMAL/P10/P20/P30/P50 em receita_lancamentos (src/db.js:286-303) e seed-data/receita-2026.json são importação histórica da planilha RECEITA TERAPIAS - SPA 2026.xlsx — sistema paralelo, sem relação com o desconto automático GC do fluxo de venda.
7. Combos em si (src/db.js:1304-1318, tipos_massagem tipo='combo': Gran Sublime 663, Gran Relaxamento 613, Ritual Detox 663) não têm nenhum desconto próprio embutido no código.

### Arquivos afetados
- `public/js/admin.js` — Remover cálculo automático ehGC no preview (3592-3610), trocar por checkbox opt-in; _precoBloco/_precoDetHtml/_precoDetHtml2 (3706-3745) passam a ler flag persistida da reserva; incluir campo no body do submit (4580-4600); pré-carregar checkbox na edição; ajustar copy do modal Benefícios Gran Class (3764-3765)
- `src/db.js` — Migration ALTER TABLE reservas ADD COLUMN desconto_concedido INTEGER (junto às migrations ~linha 274); aceitar o campo em criarReserva e atualizarReserva (1858+) e incluir no INSERT/UPDATE
- `src/routes/reservas.js` — Aceitar desconto_concedido no body do POST/PUT (coagir a 0/1/null) e repassar ao db; garantir que o GET das reservas retorna a coluna
- `public/admin.html` — Somente se o checkbox for colocado no HTML estático do modal em vez de renderizado via JS em res-extra-info; caso contrário não tocar

### Implementação (sem regressão)
1) Banco (src/db.js): adicionar migration idempotente perto da linha 274: `try { db.exec('ALTER TABLE reservas ADD COLUMN desconto_concedido INTEGER'); } catch {}`. Semântica: NULL = reserva legada (anterior à mudança), 0 = desconto não concedido, 1 = concedido. Não recalcular nem backfillar nada.

2) Backend: em criarReserva/atualizarReserva (src/db.js:1858+ e a função de criação correspondente) aceitar `desconto_concedido` em opts (default null no create; no update, usar o valor enviado) e incluir a coluna no INSERT/UPDATE. Em src/routes/reservas.js, no POST e PUT, ler `req.body.desconto_concedido` e normalizar: `const desconto_concedido = req.body.desconto_concedido === 1 || req.body.desconto_concedido === true ? 1 : (req.body.desconto_concedido === 0 || req.body.desconto_concedido === false ? 0 : null)`. Nenhuma validação de elegibilidade no backend além disso (é flag informativa de display, sem efeito financeiro no sistema).

3) Frontend — modal de criação/edição (public/js/admin.js):
   a. Em _atualizarComboLinhaPreco() (3561-3613): remover o cálculo automático `ehGC` (3596-3597). No lugar, quando o tratamento tem preço, renderizar acima do box de preço um checkbox: `<label><input type="checkbox" id="res-inp-desconto" ${_resDescontoConcedido ? 'checked' : ''}> Deseja conceder o desconto de 10%?</label>` (com badge ★ Gran Class quando `_resTipo==='hospede' && quartoCategoria(aptoVal)==='gran_class'`, apenas informativo). Guardar estado em variável de módulo `_resDescontoConcedido` para sobreviver a re-renders (a função reconstrói o innerHTML a cada mudança de tratamento/apto). Listener change no checkbox → atualiza a variável e re-chama _atualizarComboLinhaPreco(). O cálculo do preview vira `const desconto = _resDescontoConcedido ? sub * 0.10 : 0;` com a linha exibida como "Desconto concedido (−10%)".
   b. No submit (4580-4588): adicionar `desconto_concedido: _resDescontoConcedido ? 1 : 0` ao body (POST e PUT).
   c. Na abertura do modal em modo edição: inicializar `_resDescontoConcedido = r.desconto_concedido === 1 || (r.desconto_concedido == null && r.quarto_categoria === 'gran_class')` — legado NULL preserva o que foi mostrado ao cliente na época. Em modo criação: inicializar false (opt-in puro, inclusive Gran Class).
   d. Reset da variável ao fechar/abrir o modal (junto do reset dos demais campos do modal).

4) Frontend — detalhes da reserva: em _precoDetHtml (3729-3738) e _precoDetHtml2 (3740-3745), trocar `const ehGC = r.quarto_categoria === 'gran_class'` por `const comDesconto = r.desconto_concedido === 1 || (r.desconto_concedido == null && r.quarto_categoria === 'gran_class')`. Isso mantém as reservas históricas (NULL) exibindo o −10% GC como sempre exibiram (não recalcular o passado) e faz reservas novas obedecerem exclusivamente ao checkbox. Renomear o rótulo em _precoBloco (3720) de "★ Gran Class (−10%)" para "Desconto concedido (−10%)" quando não for GC (ou manter o rótulo GC quando quarto_categoria==='gran_class', decisão cosmética).

5) Copy do modal Benefícios Gran Class (3747-3786): alterar linha 3765 de "Aplicado automaticamente sobre o subtotal antes da taxa de serviço" para "Concedido no ato da venda, a critério da equipe" (ou texto aprovado). Não remover o benefício da lista sem decisão humana.

6) NÃO tocar: agregarReceitaPorMesDoSistema/calcularComissaoPorMes (src/db.js:1566-1690) — continuam usando preço cheio; receita_lancamentos/faixa_desconto e seed-data/receita-2026.json (histórico da planilha); TAXA_SERVICO/TAXA_ISS (admin.js:2565-2566); terapeuta.html (só exibe badge GC, sem preço).

### Riscos de regressão (checar um a um)
- Exibição histórica: se o detalhe da reserva passar a exigir desconto_concedido===1 sem o fallback NULL→regra GC antiga, todas as reservas Gran Class já criadas deixam de mostrar o −10% com que foram vendidas — usar semântica NULL=legado é obrigatório
- Edição de reserva legada: ao editar uma reserva antiga pelo modal, o PUT gravará 0 ou 1 e a semântica NULL se perde para aquela reserva — aceitável, mas o checkbox deve vir pré-marcado conforme a regra legada (item 3c) para o admin não retirar desconto sem perceber
- Comissão/receita (src/db.js:1570) usa preço cheio da tabela e ignora descontos — a mudança não afeta números, mas se alguém futuramente ligar desconto_concedido ao cálculo de receita, comissões YTD mudarão retroativamente; deixar explícito que este ponto NÃO altera receita/comissão
- _atualizarComboLinhaPreco() reconstrói o innerHTML de res-extra-info a cada mudança de tratamento/quarto/tipo — se o estado do checkbox não for guardado em variável de módulo, ele desmarca sozinho a cada re-render (mesma armadilha do select res-inp-linha)
- Reserva casal: _precoBloco é compartilhado entre pessoa 1 e 2 (comentário linha 3707); a flag é única por reserva — desconto concedido vale para as duas pessoas; confirmar que é o comportamento desejado
- Não confundir com faixa_desconto (NORMAL/P10/...) de receita_lancamentos — é importação de planilha histórica; alterá-la quebraria o seed idempotente (UNIQUE em src/db.js:300)
- Deploy automático no push da main (memória do projeto): a edição vira produção em segundos — fazer a mudança completa (db+rotas+front) em um único commit para não ficar com front enviando campo que o backend rejeita ou vice-versa

### ❓ Questões abertas (perguntar antes de implementar a parte dependente)
- A anotação fala em 'desconto do Combo', mas no código o desconto automático de 10% é o benefício Gran Class sobre TODOS os tratamentos (combos inclusos). Confirmar escopo: remover o automatismo de tudo (interpretação adotada) ou existe algum desconto de combo fora do sistema (planilha/POS) que a reunião referia?
- O checkbox 'Deseja conceder o desconto?' aparece para qualquer venda (dando poder de desconto a qualquer cliente) ou só quando o hóspede é Gran Class (opt-in restrito à elegibilidade atual)?
- Percentual fixo em 10% ou deve ser configurável/informável no ato?
- O benefício '10% em todas as massagens' continua existindo como política Gran Class (só deixa de ser automático) ou foi extinto? Define a copy do modal Benefícios Gran Class (admin.js:3747-3786)
- Quem pode conceder: qualquer usuário com escrita no SPA (requireWrite atual) ou restringir a master?
- O desconto concedido deve passar a impactar receita/comissão da massoterapeuta (hoje usa preço cheio, src/db.js:1570)? Impacta financeiro — precisa de decisão explícita
- Em reserva de casal, o desconto é único para a reserva (duas pessoas) ou por pessoa?

---

## PONTO 5 — Revisão ortográfica do sistema (foco anamnese)
**Complexidade:** media

### Estado atual (verificado no código)
Os textos visíveis da anamnese vivem em 4 camadas distintas:

1) LOCALES JSON (fonte principal do formulário do cliente): public/locales/{pt-BR,pt-PT,en,es,fr,it,de}.json (130 linhas cada, mesma estrutura de chaves). Contêm TODOS os textos estáticos da ficha: labels, pergunta médica (medical.label/placeholder), aviso LGPD (legal.text), consentimentos (consents.*), erros, telas de sucesso/expirado/já-respondida. Carregados por loadLocale() em public/js/spa-profile.js (~L600-640), com fallback pt-BR se o fetch falhar.

2) HTML HARDCODED (pt-BR default pré-carregamento do locale): public/spa-profile.html — título L383-385, seções L393/645/651/661/681/691/697/731, labels L397-437, lista de 196 nacionalidades L444-629, pressão L664-675, botão L761-762, telas finais L769-787; strings em CSS content 'Carregando opções…' (L184-186) e 'Carregando aviso de privacidade…' (L229-232).

3) BANCO (SQLite, perguntas configuráveis): tabelas pergunta_traducao, pesquisa_traducao, pesquisa_secao_traducao, escala_opcao_traducao. Seeds em src/qualidade.js: seedQualidadeSpa() L23-146 (pesquisa de satisfação spa-locc-v1) e seedAnamneseSpa() L152-246 (anamnese spa-anamnese-v1, 16 perguntas). Os textos pt-BR do seed foram gravados SEM ACENTOS de propósito/descuido ('Otimo', 'Nao', 'Informacoes medicas relevantes', 'Pressao preferida na massagem', 'Saude e Rotinas', 'Numero do documento', 'Pesquisa de Satisfacao', 'Servicos', 'Instalacoes', 'Recomendacao', 'Voce recomendaria nossos servicos?', 'roupoes' etc.) e aparecem no editor admin (view-anamnese-editor, admin.html L4097-4135) e como rótulo de fallback no formulário do cliente (montarConfigPesquisa, qualidade.js L279+, faz fallback pt-BR antes da chave técnica). src/traducoes-locc.js (backfill curado pt-PT/es/fr/it/de da pesquisa de satisfação, NÃO cobre anamnese) já corrige acentos nas 5 línguas mas o pt-BR do banco continua sem acento.

4) TRADUÇÃO AUTOMÁTICA de edições do admin: POST /api/qualidade/admin/traduzir (src/routes/qualidade.js L294-299) → src/utils/traduzir.js → MyMemory API, sem revisão humana — qualquer pergunta médica nova criada no editor recebe tradução de máquina não revisada nas 6 línguas.

Fallbacks JS hardcoded: public/js/spa-profile.js L303 ('Resposta obrigatoria'), L259 ('Quarto inexistente'). Mensagens de API user-visible: src/routes/spa.js L228/230/351/357/363/546.

ERROS CONCRETOS ENCONTRADOS:
a) src/qualidade.js (seed → banco → UI): todos os textos pt-BR sem acentuação listados acima (~30 strings). Como o seed já rodou em produção, corrigir o arquivo NÃO corrige o banco de produção.
b) public/js/spa-profile.js L303: 'Resposta obrigatoria' → 'Resposta obrigatória'.
c) public/spa-profile.html: nacionalidade duplicada com grafia errada — 'Kirguiz' (L540) e 'Quirguiz' (L587) são o mesmo país; correto é só 'Quirguiz'. 'Bósnia-herzegovínea' (L476) — grafia usual é 'Bósnia'; 'Sudanesa do Sul' (L605) — usual 'Sul-sudanesa' (também quebra a ordem alfabética).
d) public/locales/en.json L114: 'ex: 0501' → em inglês deve ser 'e.g. 0501'.
e) Desvio semântico nas traduções da tela de sucesso: pt-BR 'O terapeuta confirmará a liberação para o atendimento' virou em en/es/fr/it/de 'will confirm your availability' / 'confirmará su disponibilidad' — inverte o sentido (quem é liberado é o atendimento, não a disponibilidade do cliente).
f) pt-PT.json L98: botão 'Enviar / Liberar atendimento' mantém o brasileirismo 'Liberar' (pt-PT: 'Libertar' ou 'Enviar / Confirmar' como fizeram en/es/fr/it).
g) de.json L9: '(*) Pflichtfelder sind mit (*) markiert' — duplicação redundante do (*).
h) en.json L76 'Is there any medical information you should share with us?' — 'you should share' soa acusatório; melhor 'you would like to share' ou 'we should be aware of'.
Os textos médicos principais (medical.placeholder nas 7 línguas: alergias, cirurgias, gravidez, lesões, condições crônicas) estão corretos ortograficamente.

### Arquivos afetados
- `public/locales/pt-BR.json` — Fonte de verdade dos textos do formulário; revisar primeiro (base das demais línguas)
- `public/locales/en.json` — Corrigir 'ex:' → 'e.g.', frase de sucesso e pergunta médica
- `public/locales/pt-PT.json` — 'Liberar atendimento' → forma europeia
- `public/locales/es.json` — Frase de sucesso ('su disponibilidad')
- `public/locales/fr.json` — Frase de sucesso
- `public/locales/it.json` — Frase de sucesso
- `public/locales/de.json` — required_notice redundante; frase de sucesso
- `public/spa-profile.html` — Remover 'Kirguiz' duplicado (L540); revisar nacionalidades; defaults pt-BR devem espelhar pt-BR.json
- `public/js/spa-profile.js` — L303 'Resposta obrigatoria' sem acento; fallbacks hardcoded
- `src/qualidade.js` — Seeds pt-BR sem acento (L34, L53, L64-75, L88-99, L167-183, L195-206) — corrigir para DBs novos
- `src/traducoes-locc.js` — Padrão de backfill idempotente a replicar para corrigir pt-BR do banco de produção
- `src/utils/traduzir.js` — Tradução de máquina sem revisão para textos médicos criados no editor

### Implementação (sem regressão)
FASE 1 — Extração (novo script scripts/extrair-strings.js, somente leitura): gera um CSV/planilha única (origem, chave, idioma, texto) a partir de: (a) os 7 public/locales/*.json achatados; (b) SELECT das tabelas pergunta_traducao, pesquisa_traducao, pesquisa_secao_traducao, escala_opcao_traducao (JOIN com as chaves técnicas); (c) strings hardcoded de spa-profile.html/spa-profile.js (labels default, telas finais, CSS content). Entregar ao responsável para revisão.

FASE 2 — Revisão pt-BR primeiro (fonte): aplicar as correções já identificadas: (a) spa-profile.js L303; (b) spa-profile.html remover option 'Kirguiz' L540 (manter 'Quirguiz'); (c) conferir pt-BR.json (hoje sem erro ortográfico detectado). Termos médicos: manter a lista do placeholder (alergias, cirurgias, gravidez, lesões, condições crônicas) validada pela equipe do SPA.

FASE 3 — Correção do banco SEM regressão: criar src/backfill-ortografia.js seguindo exatamente o padrão de src/traducoes-locc.js (idempotente, chamado no boot em server.js): UPDATE pergunta_traducao/pesquisa_traducao/pesquisa_secao_traducao/escala_opcao_traducao SET rotulo=<corrigido> WHERE idioma='pt-BR' AND rotulo=<valor exato do seed antigo sem acento>. A cláusula de igualdade exata garante que rótulos já editados pelo admin no editor de anamnese NUNCA sejam sobrescritos. Corrigir também src/qualidade.js (seeds) para DBs novos — par a par com o backfill.

FASE 4 — Demais idiomas: corrigir os 6 JSONs (itens d–h do estado atual). Estrutura de chaves e tamanho dos arrays facial_items/body_items NÃO podem mudar (validação em loadLocale, spa-profile.js ~L612).

FASE 5 — Processo contínuo: no editor de anamnese (admin), marcar traduções vindas de MyMemory (POST /admin/traduzir) com flag 'automática — pendente de revisão' (nova coluna revisado INTEGER DEFAULT 0 em pergunta_traducao, additive-only) e exibir badge no editor, para que perguntas médicas novas não cheguem ao hóspede estrangeiro sem revisão humana. Opcional: trocar MyMemory por revisão via Anthropic SDK já existente em src/utils.

### Riscos de regressão (checar um a um)
- Respostas de rotina facial/corporal são gravadas pelo TEXTO do label no idioma do formulário (spa-profile.js collectData L332-335 usa data-label): mudar o wording de facial_items/body_items quebra o casamento com respostas históricas (prefill/histórico por documento e comparações no admin). Mudanças nesses arrays exigem verificação do fluxo de prefill (setIfEmpty ~L797+).
- Chaves técnicas NUNCA podem mudar: escala_opcao.chave ('otimo','nao','sim') e pergunta_satisfacao.chave alimentam estatísticas do GQ (polaridade/valor_numerico em src/routes/gq.js) e mapeia_campo_legado liga a pergunta ao POST /api/spa/perfil. Só corrigir *_traducao.rotulo.
- UPDATE em massa no banco pode sobrescrever rótulos personalizados pelo admin no editor de anamnese — o backfill deve usar WHERE rotulo = <string exata do seed antigo>.
- loadLocale valida a estrutura do JSON ('locale JSON incompleto ou invalido', spa-profile.js ~L615) e cai para pt-BR se falhar: erro de sintaxe em qualquer locale derruba o idioma inteiro silenciosamente. Validar JSON.parse dos 7 arquivos antes do push.
- Os textos hardcoded de spa-profile.html são o fallback quando o fetch do locale falha e o flash inicial pré-load: devem ficar sincronizados com pt-BR.json, senão o usuário vê textos divergentes por instantes.
- Deploy automático em push na main (memória do projeto: auto-commit + 2 workflows) — qualquer edição vira produção em segundos; revisar tudo em branch antes de mergear.
- legal.text (aviso LGPD) e consents.health têm valor jurídico: reformular texto pode exigir aval do responsável LGPD; a prova de consentimento HMAC guarda o texto aceito na época — mudar o texto não invalida provas antigas, mas cria versões divergentes entre respostas.

### ❓ Questões abertas (perguntar antes de implementar a parte dependente)
- Os textos pt-BR sem acento no seed (ex.: 'Voce recomendaria nossos servicos?') aparecem também em PDFs/relatórios impressos já entregues? Confirmar se a correção deve valer retroativamente na exibição de respostas antigas.
- Quem é o revisor autorizado dos termos médicos e do texto LGPD (L'Occitane/jurídico do hotel)? A anotação da reunião não define o aprovador.
- As traduções automáticas MyMemory de perguntas criadas pelo admin devem ser bloqueadas até revisão ou apenas sinalizadas?
- Padronizar o botão de submit: pt-BR usa 'Enviar / Liberar atendimento', demais línguas usam 'Submit & Confirm'/equivalente — manter a menção a 'liberar atendimento' ou unificar?
- A lista de nacionalidades (196 itens hardcoded no HTML, só em pt) deveria ser traduzida por idioma ou permanece em português para todos?

---

## PONTO 6 — Assinatura acessível na anamnese (sem braço/mão, cegos, outras limitações)
**Complexidade:** media

### Estado atual (verificado no código)
A assinatura hoje é EXCLUSIVAMENTE um canvas de desenho mouse/touch, sem nenhuma alternativa acessível.

1) Frontend (public/spa-profile.html linhas 729-749): seção 8 "Assinatura" com <canvas id="sig-canvas"> dentro de #canvas-wrap, botão "Limpar assinatura" e span de erro #err-sig. Zero ARIA no canvas (único aria-label do form é no select de tipo de documento, linha 414). Cego com leitor de tela não tem como assinar; pessoa sem braço/mão idem.

2) Lógica do canvas (public/js/spa-profile.js linhas 102-205, initCanvas): eventos mousedown/mousemove/touchstart etc., expõe hasSigned() e getDataURL() (PNG base64). Validação nas linhas 276-287: assinatura é OBRIGATÓRIA hardcoded (sigOk = _sig && _sig.hasSigned()) — ignora a flag `obrigatoria` da config dinâmica da anamnese (applyAnamneseConfig, linhas 907-985, só ajusta o marcador visual .req). O campo está mapeado como assinatura_data_url em _LEGADO_DOM (linha 892) e _ANCHOR_LEGACY (linha 1007).

3) Backend (src/routes/spa.js): POST /api/spa/perfil (linha 347) NÃO exige assinatura — sanDataUrl (linhas 211-223) retorna null se ausente, apenas loga warn se base64 <200 chars. A prova LGPD é o selo composto HMAC-SHA256 (CONSENT_ALG_ATUAL='hmac-sha256-composto-v1', linha 92) sobre {texto, documento, reserva_id, assinatura_hash, consentido_em} (linhas 415-475), com keyring CONSENT_HMAC_SECRET/CONSENT_KEY_ID (linhas 7-84). Importante: assinatura_hash = sha256 da data URL, e se não houver assinatura entra STRING VAZIA no selo — ou seja, o selo já é válido juridicamente sem imagem de assinatura; a prova principal é o HMAC sobre texto+documento+timestamp.

4) Banco (src/db.js): tabela spa_perfis (linha 110) com assinatura_data_url TEXT (linha 127), consentimento_saude (linha 124) e colunas de prova consentimento_saude_* (migrations linhas 586-628, padrão try/catch ALTER TABLE). Persistência em inserirSpaPerfilComLock com lógica DUPLICADA de UPDATE (linhas 2437-2463) e INSERT (2467-2487), mais uma réplica em outra função a partir da linha 2532.

5) Admin (public/js/admin.js): exibe "Assinatura registrada ✓" (linha 5595) e a imagem da assinatura só se data URL length>1000 (linhas 5897-5963); versão estruturada grava só '[assinatura presente]' (spa.js linha 497).

6) i18n: 7 locales em public/locales/*.json com bloco signature (label, instruction, clear, date_label) e erro E.signature.

### Arquivos afetados
- `public/spa-profile.html` — Adicionar na seção 8 o toggle 'Não consigo assinar à mão' + input de nome digitado + checkbox de confirmação; adicionar ARIA (role, aria-label, aria-live, fieldset/legend) no canvas, erros e grupos do form
- `public/js/spa-profile.js` — Validação da assinatura (linhas 276-287) passar a aceitar desenho OU assinatura digitada; incluir assinatura_tipo/assinatura_nome_digitado no payload do submit (linha ~362); manter mapeamentos _LEGADO_DOM/_ANCHOR_LEGACY intactos
- `src/routes/spa.js` — POST /perfil: aceitar assinatura_tipo e assinatura_nome_digitado; no selo composto, quando digitada, assinatura_hash = sha256('typed-v1:'+nome_digitado) mantendo alg v1 ou criando alg v2; atualizar registro estruturado (linha 497)
- `src/db.js` — Migrations idempotentes: ALTER TABLE spa_perfis ADD assinatura_tipo TEXT DEFAULT 'desenho', assinatura_nome_digitado TEXT, assinatura_testemunha_nome TEXT, assinatura_testemunha_user_id INTEGER; incluir novas colunas nas DUAS cópias de UPDATE/INSERT (linhas 2437-2487 e réplica ~2532+)
- `public/js/admin.js` — Exibição da anamnese (linhas 5595, 5897-5963): mostrar tipo de assinatura; se digitada, renderizar nome em fonte cursiva + selo 'assinatura digitada' + testemunha; hoje o bloco só renderiza data:image com length>1000
- `public/locales/pt-BR.json` — Novas chaves signature.typed_toggle, typed_label, typed_confirm, typed_hint e erro correspondente — replicar nos 7 locales (pt-PT, en, fr, es, it, de)

### Implementação (sem regressão)
FASE 1 — Assinatura digitada (typed signature), resolve sem-braço/mão e cegos:
1. DB (src/db.js, junto às migrations linha ~620, padrão try/catch): ALTER TABLE spa_perfis ADD COLUMN assinatura_tipo TEXT NOT NULL DEFAULT 'desenho'; assinatura_nome_digitado TEXT; assinatura_testemunha_nome TEXT; assinatura_testemunha_user_id INTEGER. Backfill desnecessário (default cobre legado). Adicionar as colunas nas duas cópias de inserirSpaPerfil (UPDATE linhas 2437-2463, INSERT 2467-2487, e a réplica ~2532+).
2. HTML (spa-profile.html seção 8, DENTRO da mesma .spa-section de #sec-sig para não quebrar _LEGADO_DOM/_reordenarPorOrdem): link/botão "Não consigo assinar à mão" (aria-expanded) que alterna para: input texto "Digite seu nome completo como assinatura" + checkbox "Declaro que digitar meu nome equivale à minha assinatura". Ao ativar o modo digitado, esconder o canvas e desativar sua validação.
3. JS (spa-profile.js): validação linha 276-287 vira sigOk = (modo desenho && _sig.hasSigned()) || (modo digitado && nomeDigitado.length>0 && confirmMarcado). Payload do submit (linha ~358-362) ganha assinatura_tipo e assinatura_nome_digitado; assinatura_data_url segue null no modo digitado.
4. Backend (src/routes/spa.js POST /perfil): assinatura_tipo = san(b.assinatura_tipo) restrito a ['desenho','digitada']; assinatura_nome_digitado = san(...). No bloco do selo (linhas 419-475): se digitada, assinaturaHash = sha256Hex('typed-v1:' + nomeDigitado.trim()) em vez do hash da data URL — o selo composto v1 continua funcionando sem mudança de formato (assinatura_hash é só um componente string); gravar assinatura_tipo junto para o verificador saber recomputar. Atualizar item estruturado linha 497 para '[assinatura digitada]' quando for o caso.
5. Admin (admin.js linhas 5595 e 5897-5963): quando assinatura_tipo='digitada', renderizar o nome digitado (fonte cursiva) + badge "Assinatura digitada" + testemunha se houver, em vez do <img>.
6. i18n: adicionar chaves nos 7 public/locales/*.json (fallback: se chave ausente, esconder o toggle — fail-safe igual ao padrão applyAnamneseConfig).

FASE 2 — Testemunha funcionário (modo assistido): como POST /api/spa/perfil é público via token (sem auth), NÃO aceitar testemunha vinda do cliente. Criar endpoint autenticado PATCH /api/spa/perfil/:id/testemunha (router admin, requireSpa) que grava assinatura_testemunha_nome + assinatura_testemunha_user_id a partir do req.user logado, passando pelo middleware de audit (src/middleware/audit.js já intercepta POST/PUT/DELETE /api/*  — usar POST se PATCH não for interceptado). Botão "Registrar-me como testemunha" na tela de anamnese do admin.

FASE 3 — Acessibilidade do formulário inteiro (leitor de tela): canvas com role="img" e aria-label descritivo + instrução aria-describedby apontando para a alternativa digitada; spans de erro (#err-sig, #err-consent etc.) com role="alert"/aria-live="polite"; grupos de checkbox (rotinas, canais marketing) em fieldset/legend; painel #spa-missing-panel com aria-live. Sem mudança de layout visual.

NÃO TOCAR: função selarComposto e ordem/normalização dos componentes do selo (formato v1), keyring HMAC, fluxo de token de uso único (buscarDocumentoToken / ja_respondida), sanDataUrl, mapeamentos _LEGADO_DOM e reordenação do editor de anamnese.

### Riscos de regressão (checar um a um)
- Selo HMAC composto v1: qualquer mudança em selarComposto/ordem dos campos {texto,documento,reserva_id,assinatura_hash,consentido_em} invalida a verificação de provas antigas — reutilizar o slot assinatura_hash com sha256('typed-v1:'+nome) preserva o formato; se optar por alg novo, gravar consentimento_saude_alg distinto e ensinar o verificador
- inserirSpaPerfil tem a lista de colunas DUPLICADA (UPDATE db.js:2437-2463, INSERT 2467-2487, e réplica a partir de ~2532) — esquecer uma cópia gera perfis com assinatura_tipo errado silenciosamente
- admin.js:5897 só renderiza assinatura se data URL length>1000 — perfis digitados apareceriam como 'sem assinatura' se o novo branch não for adicionado; terapeuta poderia recusar atendimento achando anamnese incompleta
- Editor de anamnese dinâmica: o bloco novo precisa ficar dentro da .spa-section de #sec-sig, senão _reordenarPorOrdem/_LEGADO_DOM (spa-profile.js:876-1008) o deixam órfão ou o escondem ao reordenar
- Validação frontend: afrouxar sigOk sem o gate do checkbox de confirmação permitiria submissão sem nenhuma manifestação de vontade — o backend hoje NÃO valida assinatura, então o frontend é a única barreira
- Locales: chave nova ausente em algum dos 7 JSON quebra applyLocale (setText com undefined) — adicionar em todos ou proteger com fallback
- Deploy: auto-commit + push vai a produção em segundos (memória do projeto) — migrations devem ser ALTER TABLE try/catch idempotentes no padrão existente, nunca destrutivas
- Fluxo casal (pessoa 1/2 por token, spa.js:366-392): novos campos não podem interferir na resolução de reserva_id/pessoa nem no curto-circuito ja_respondida (409 antes do payload pesado)

### ❓ Questões abertas (perguntar antes de implementar a parte dependente)
- Assinatura digitada sem testemunha é aceitável juridicamente para o hotel, ou o modo alternativo deve SEMPRE exigir testemunha funcionário? (definir com jurídico/LGPD)
- Consentimento verbal gravado (áudio): desejado? Voz é dado biométrico/sensível sob LGPD — exige consentimento para a própria gravação, política de retenção e storage seguro; recomendação técnica é NÃO implementar e usar digitada+testemunha, mas é decisão humana
- Quem pode ser testemunha: qualquer usuário logado no admin ou apenas a terapeuta do atendimento? Registrar cargo/perfil junto?
- Quem ativa o modo acessível: o próprio cliente vê o toggle sempre, ou o funcionário habilita caso a caso (evita uso 'preguiçoso' por quem poderia assinar)?
- A assinatura deve virar configurável (obrigatória/opcional) no editor de anamnese? Hoje o front hardcoda obrigatória e ignora a flag obrigatoria da config (spa-profile.js:276-287)
- Manter alg 'hmac-sha256-composto-v1' com hash tipado no slot assinatura_hash, ou versionar para v2 com campo assinatura_tipo dentro do selo? (v1 reaproveitado é mais simples e não quebra nada)
- Retroativo: registrar testemunha em anamneses já enviadas (PATCH posterior) altera a prova? Decidir se testemunha fica FORA do selo (metadado auditado) ou dentro (exige re-selagem)

---

## PONTO 7 — Blacklist de clientes-problema + avaliação/observação pela massoterapeuta
**Complexidade:** media

### Estado atual (verificado no código)
NÃO existe nada de blacklist hoje (grep por "blacklist/black" não retorna nada em src/ nem public/). O que existe e serve de base:

1) Cadastro central `clientes` — src/db.js:462-477: colunas id, cpf, passaporte, nome, email, telefone, data_nascimento, locale_pref, nacionalidade, `observacao` (TEXT livre, campo único, sem autor/timestamp), criado_em, atualizado_em. UNIQUE index em cpf (db.js:476). Identificação do cliente é por CPF normalizado (validarCpfMod11, db.js:2775-2790) ou passaporte uppercase (validarPassaporte, db.js:2792-2794); lookups buscarClientePorCpf/PorPassaporte (db.js:2823-2839) com SELECT de colunas explícitas.

2) Reservas vinculam cliente via colunas `cliente_id`, `cpf`, `passaporte` (migrações db.js:570-571 e 252). Ao salvar reserva, src/routes/reservas.js:280-307 faz upsert do cliente por CPF/passaporte (inserirCliente retorna id existente) e reservas.js:336-341 grava cliente_id/cpf/passaporte na reserva. IMPORTANTE: só a pessoa 1 tem cliente_id na reserva; pessoa 2 é criada como cliente mas não referenciada por FK.

3) Autofill na recepção/reserva: GET /api/clientes/buscar?cpf=|passaporte= (src/routes/clientes.js:102-116) devolve o registro completo do cliente; o modal de reserva consome em public/js/admin.js:6737-6795 (_wireCpfAutofill) e mostra "✓ Cliente já cadastrado — dados preenchidos". É o ponto natural do alerta de blacklist na recepção.

4) Cliente 360: GET /api/clientes/:id → buscarCliente360 (db.js:2883+) devolve {cliente, reservas, anamneses, pesquisas, produtos}; UI em admin.js:5693-5730 (renderClienteDetail, 4 abas), tela read-only por decisão anterior (admin.js:5617-5618).

5) App da terapeuta: rotas em src/routes/terapeuta.js — login por PIN bcrypt (linhas 26-48), cookie isolado spa_terapeuta_sess, middleware requireTerapeuta (src/middleware/auth.js:59-72). O app é 100% read-only hoje: GET /agenda (linha 92, listarReservasDaTerapeuta db.js:3132-3156, sem JOIN em clientes), GET /atendimento/:id (linha 102, buscarReservaDetalheTerapeuta db.js:3159-3167 valida ownership e delega a buscarReservaDetalhe db.js:1943). Frontend public/terapeuta.html: cards da agenda (~linha 1110-1120), detalhe do atendimento (~1138-1187), overlay de anamnese (1190+). Não existe nenhum endpoint de escrita para terapeuta além de login/logout.

6) Permissões admin: roles master/spa/satisfacao/admin(read-only)/user; requireWrite bloqueia 'admin' (auth.js:36-40); rotas /api/clientes exigem requireAuth+requireSpa (clientes.js:14). Auditoria automática de todo POST/PUT/DELETE /api/* via src/middleware/audit.js.

### Arquivos afetados
- `src/db.js` — Migração: colunas blacklist em clientes + tabela nova cliente_observacoes; funções setBlacklistCliente, listarObservacoesCliente, inserirObservacaoCliente; incluir colunas blacklist nos SELECTs de listarClientes/buscarClientePorId/PorCpf/PorPassaporte; incluir observacoes e blacklist no buscarCliente360; JOIN clientes em listarReservasDaTerapeuta para flag na agenda
- `src/routes/clientes.js` — Novos endpoints: PUT /api/clientes/:id/blacklist, POST /api/clientes/:id/observacoes, DELETE /api/clientes/observacoes/:oid (master)
- `src/routes/terapeuta.js` — Novo endpoint POST /api/terapeuta/atendimento/:id/observacao (primeiro write do app da terapeuta), com validação de ownership e resolução do cliente
- `public/js/admin.js` — Badge/toggle de blacklist e nova aba Observações no Cliente 360 (renderClienteDetail ~5693); alerta vermelho de blacklist no autofill do modal de reserva (_wireCpfAutofill ~6757 e ~6781); badge na lista de clientes (loadClientesLista ~5665)
- `public/admin.html` — Markup do modal/controles de blacklist e da aba Observações na view-clientes (se não for gerado inteiramente via JS)
- `public/terapeuta.html` — Indicador de cliente-alerta no card/detalhe do atendimento + botão 'Avaliar cliente / observação' com formulário (texto + nota opcional) chamando o novo endpoint

### Implementação (sem regressão)
FASE 1 — Schema (src/db.js, seguindo o padrão try/catch ALTER das linhas 250/570):
1. `ALTER TABLE clientes ADD COLUMN blacklist INTEGER NOT NULL DEFAULT 0` + `blacklist_motivo TEXT` + `blacklist_em TEXT` + `blacklist_por TEXT` (username de quem marcou). Manter a coluna `observacao` existente intocada (nota de cadastro legada).
2. Nova tabela:
```sql
CREATE TABLE IF NOT EXISTS cliente_observacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  autor_tipo TEXT NOT NULL CHECK (autor_tipo IN ('admin','terapeuta')),
  autor_id INTEGER,            -- massagista_id quando terapeuta
  autor_nome TEXT NOT NULL,    -- username admin ou nome da massagista
  reserva_id INTEGER REFERENCES reservas(id) ON DELETE SET NULL,
  avaliacao INTEGER CHECK (avaliacao BETWEEN 1 AND 5), -- opcional
  texto TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cliente_obs_cli ON cliente_observacoes(cliente_id, criado_em);
```
3. Funções exportadas: `setBlacklistCliente(id,{ativo,motivo,autor})` (atualiza blacklist/motivo/em/por + atualizado_em); `listarObservacoesCliente(clienteId)`; `inserirObservacaoCliente({cliente_id, autor_tipo, autor_id, autor_nome, reserva_id, avaliacao, texto})` com trim e limite de tamanho (ex. 2000 chars).
4. Acrescentar `blacklist, blacklist_motivo` aos SELECTs explícitos de listarClientes (db.js:2806), buscarClientePorId (2816), buscarClientePorCpf (2823), buscarClientePorPassaporte (2832) — isso propaga automaticamente ao /buscar do autofill. Em buscarCliente360, adicionar `observacoes: listarObservacoesCliente(id)` ao objeto retornado.
5. Em listarReservasDaTerapeuta (db.js:3138), adicionar `LEFT JOIN clientes c ON c.id = r.cliente_id` e selecionar `c.blacklist AS cliente_alerta` (apenas o flag, sem motivo — ver questões abertas).

FASE 2 — Endpoints:
6. src/routes/clientes.js (router já tem requireAuth+requireSpa):
   - `PUT /:id/blacklist` com requireWrite: body {ativo:boolean, motivo?:string}; chama setBlacklistCliente com autor=req.user.username. Auditoria já cobre via middleware.
   - `POST /:id/observacoes` com requireWrite: body {texto, avaliacao?, reserva_id?}; grava com autor_tipo='admin', autor_nome=req.user.username.
   - `DELETE /observacoes/:oid` com requireMaster (correção de erro; sem edição para preservar trilha).
   - ATENÇÃO à ordem das rotas: registrar antes de `GET /:id` não é necessário (métodos diferentes), mas o DELETE deve usar path que não colida com `/produtos/:pid` — `/observacoes/:oid` é seguro.
7. src/routes/terapeuta.js:
   - `POST /atendimento/:id/observacao` com requireTerapeuta: valida id; carrega reserva e verifica `massagista_id === req.user.massagista_id || massagista_id2 === ...` (mesma defesa anti-IDOR de buscarReservaDetalheTerapeuta db.js:3159-3166); body {texto, avaliacao?, pessoa?:1|2}. Resolve cliente: pessoa 1 → reservas.cliente_id (fallback: buscarClientePorCpf(reserva.cpf)/PorPassaporte(reserva.passaporte)); pessoa 2 → resolver por reserva.cpf2/passaporte2 se existirem (verificar nomes reais das colunas doc2 em reservas antes de implementar). Se nenhum cliente resolvível, retornar 409 "cliente sem cadastro" em vez de criar registro órfão. Grava autor_tipo='terapeuta', autor_id=massagista_id, autor_nome=req.user.nome. A terapeuta NÃO marca blacklist — só registra observação/avaliação; a promoção a blacklist é decisão do admin ao ler as observações.

FASE 3 — UI admin (public/js/admin.js + admin.html):
8. renderClienteDetail (admin.js:5693): badge vermelho "⛔ Lista restrita" ao lado do nome quando c.blacklist; botão "Marcar/Remover da lista" com prompt de motivo — ocultar quando role==='admin' (read-only; o front já conhece o role da sessão). Nova aba "Observações" (5ª aba, com `(d.observacoes||[]).length`) listando texto, autor (com badge admin/terapeuta), avaliação em estrelas quando houver, data (fmtBRT), + textarea de nova observação (oculta para role admin).
9. _wireCpfAutofill (admin.js:6757-6767 e 6781-6789): quando `d.cliente.blacklist`, trocar o info para `info.style.color='var(--danger)'` com "⛔ ATENÇÃO: cliente em lista restrita" + motivo — o alerta da recepção pedido na reunião. Não bloquear o salvamento (só alertar), salvo decisão contrária.
10. loadClientesLista (admin.js:5665): sufixo "⛔" no card quando c.blacklist.

FASE 4 — UI terapeuta (public/terapeuta.html):
11. Card da agenda (~linha 1110): ícone discreto de alerta quando `r.cliente_alerta` (pessoa 1). Detalhe do atendimento (~1153-1187): banner de alerta + botão "Avaliar cliente" abrindo bottom-sheet (reusar padrão do overlay de anamnese, linhas 1190+) com nota 1–5 opcional + texto obrigatório; POST para o novo endpoint; feedback de sucesso; permitir múltiplas observações (uma por atendimento é razoável, mas não travar).

NÃO TOCAR: cálculo de comissão (cadastros.js/db.js), fluxo de survey_tokens, spa_perfis/consentimento HMAC, coluna `observacao` legada de clientes (semântica diferente), upsert de cliente em reservas.js:280-307 (não passar campos de blacklist por ele), dedup de anamneses no buscarCliente360.

DEPLOY: memória do projeto indica auto-commit/push com deploy imediato — implementar migração + endpoints + UI e só então deixar commitar, num único push, para não expor UI sem backend em produção.

### Riscos de regressão (checar um a um)
- inserirCliente faz upsert e atualizarCliente monta UPDATE dinâmico só com campos passados (db.js:2861-2881) — nunca aceitar 'blacklist' via PUT /api/clientes/:id genérico nem via fluxo de reserva, senão um salvar de reserva poderia limpar o flag; blacklist só muda pelo endpoint dedicado
- SELECTs de cliente usam listas explícitas de colunas em ~6 lugares (listarClientes, buscarClientePorId/PorCpf/PorPassaporte, JOINs em buscarCliente360) — esquecer um deles gera flag ausente/undefined em parte das telas (ex.: alerta funciona no autofill mas não na lista)
- renderClienteDetail destrutura {cliente, reservas, anamneses, pesquisas, produtos} (admin.js:5693) — nova chave observacoes precisa de default [] no front para não quebrar com resposta antiga em cache
- POST /api/terapeuta/atendimento/:id/observacao é o PRIMEIRO endpoint de escrita do app da terapeuta: verificar que src/middleware/audit.js não assume req.user.username/role de admin (token da terapeuta tem massagista_id, role 'terapeuta') e não lança erro ao logar
- Reserva de casal: reservas.cliente_id referencia só a pessoa 1 (reservas.js:336-341); observação da terapeuta sobre a pessoa 2 pode ser anexada ao cliente errado se a resolução por documento 2 não for feita com cuidado — confirmar nomes das colunas de documento da pessoa 2 na tabela reservas antes de implementar
- Clientes sem CPF/passaporte (nome apenas) não têm identidade única (UNIQUE só em cpf, db.js:476) — blacklist neles não re-dispara no autofill de uma futura reserva; o alerta efetivo depende de documento capturado
- listarReservasDaTerapeuta ganha LEFT JOIN em clientes — testar que a agenda não quebra com reservas antigas de cliente_id NULL e que a performance da consulta (mobile, mês inteiro) não degrada
- Auto-deploy no push da main (workflow duplo, ver memória do projeto): migração ALTER roda em produção no primeiro boot após push — o padrão try/catch existente tolera re-execução, mas commits parciais (UI sem endpoint) viram produção em segundos

### ❓ Questões abertas (perguntar antes de implementar a parte dependente)
- Quem pode marcar/desmarcar blacklist: só master, ou spa também (requireWrite permite master/spa/satisfacao)? A reunião não define
- A terapeuta deve ver que o cliente é blacklist (e o motivo), ou apenas um indicador discreto de 'atenção'? Motivos podem conter informação sensível sobre o cliente (LGPD)
- Avaliação da terapeuta: nota estruturada 1–5 + texto, ou só texto livre? A anotação da reunião fala em 'avaliar OU registrar observação'
- Blacklist deve BLOQUEAR a criação de reserva ou apenas alertar a recepção? (proposta atual: só alertar)
- Observações de uma terapeuta são visíveis para as outras terapeutas em atendimentos futuros do mesmo cliente, ou só para o admin/faturamento?
- 'Idem na recepção': a recepção do hotel usa este sistema ou o PMS próprio? Se for o PMS, integração está fora do escopo deste app e o alerta aqui cobre apenas reservas do SPA
- Política LGPD/retenção: observações comportamentais sobre cliente identificado por CPF são dado pessoal — precisa de prazo de retenção e resposta a pedido de exclusão?
- Cliente pessoa 2 sem documento próprio: aceita observação vinculada só ao nome (sem cadastro), rejeita, ou cria cadastro mínimo na hora?

---

## PONTO 8 — Relatório automatizado de receita por perfil de cliente (hóspede/passante/pax)
**Complexidade:** media

### Estado atual (verificado no código)
1) PERFIL DO CLIENTE: a tabela `reservas` JÁ registra o perfil em `tipo_cliente` (pessoa 1) e `tipo_cliente2` (pessoa 2, reservas casal) — colunas criadas via migration em src/db.js:209 e 213. Valores validados em src/routes/reservas.js:123 e 409: apenas `'hospede'` e `'passante'`. **O valor `'pax'` NÃO existe em lugar nenhum do codebase** (grep por \bpax\b retorna zero) — nem no schema, nem na validação, nem na UI. A UI de reserva no admin tem só 2 botões: Hóspede/Passante (public/admin.html:4361 e 4551; seleção obrigatória em public/js/admin.js:4443 e 4547). Obs.: a tabela `feedback` também tem `tipo_cliente` (src/db.js:47), mas com taxonomia DIFERENTE — a pesquisa pública usa lazer/negocios/evento (frontend/src/components/FormScreen.jsx:650-652) — não confundir com o perfil da reserva.

2) RECEITA: existem DUAS fontes. (a) `receita_lancamentos` (src/db.js:286-303) — import histórico da planilha "RECEITA TERAPIAS - SPA 2026.xlsx" via seedReceitaTerapias (src/db.js:1385, lê seed-data/receita-2026.json); colunas: ano, mes, massagista_id, tipo_massagem_id, faixa_desconto, quantidade, preco_base, preco_aplicado, receita, fonte — **NÃO tem dimensão de perfil de cliente**, é agregado por massagista×terapia×faixa; impossível quebrar por hóspede/passante retroativamente. (b) Receita "do sistema", derivada das reservas: `agregarReceitaPorMesDoSistema` (src/db.js:1571-1659) — UNION dos dois lados da reserva (massagista_id/tipo_massagem_id e massagista_id2/tipo_massagem_id2), preço vem de `tipos_massagem.preco` (tabela cheia, sem desconto), filtro `data <= hoje`. Esta é a fonte usada por `calcularComissaoPorMes` (src/db.js:1663) e exposta em GET /api/cadastros/massagistas/:id/receita (src/routes/cadastros.js:107). Como as linhas vêm de `reservas`, o `tipo_cliente`/`tipo_cliente2` está disponível na mesma linha — a agregação por perfil é viável com SQL simples, mas hoje nenhuma query agrupa por perfil.

3) RELATÓRIOS: src/routes/relatorios.js (26 linhas) tem só GET /mensal (estatísticas de feedback via estatisticasMes) e GET /cruzamento (sessões×pesquisa), ambos sob requireAuth+requireSatisfacao. Nenhum relatório de receita agregado existe; a única tela de receita é o modal Receita & Comissão por massagista (public/js/admin.js:1782-1930). Ou seja: a Mari conta manualmente porque não há endpoint nem tela de receita por perfil.

### Arquivos afetados
- `src/db.js` — Nova função exportada agregarReceitaPorPerfil(from, to) — UNION dos dois lados da reserva com tipo_cliente/tipo_cliente2 + JOIN tipos_massagem, GROUP BY perfil (e por mês/terapia para detalhe). Não altera agregarReceitaPorMesDoSistema nem calcularComissaoPorMes.
- `src/routes/relatorios.js` — Novo endpoint GET /api/relatorios/receita-perfil?from&to (ou ?ym). Atenção ao middleware: o router inteiro usa requireSatisfacao (linha 6) — receita é domínio Spa; registrar a rota ANTES do router.use ou criar rota com requireAuth+requireSpa explícito para não bloquear o perfil 'spa' da Mari.
- `public/admin.html` — Novo card/seção 'Receita por Perfil' (view de reservas/relatórios) com seletor de período e botão export CSV; se 'pax' for adotado, adicionar 3º botão res-tipo-pax ao lado de admin.html:4361 e 4551.
- `public/js/admin.js` — Fetch do novo endpoint + render da tabela (perfil × atendimentos × receita × ticket médio, com drill-down por terapia) + export CSV client-side; se 'pax' for adotado, atualizar TIPO_CLIENTE_LABEL (linha 5309), validações (4443/4547) e badges (5383, 3895-3963).
- `src/routes/reservas.js` — SOMENTE se 'pax' for adotado: incluir 'pax' nos arrays de validação das linhas 123 e 409 (e regra de quarto: pax exige quarto? — decisão aberta).

### Implementação (sem regressão)
FASE 1 — Endpoint agregado (sem mudança de schema; `tipo_cliente` já existe em reservas):
1. src/db.js: criar `agregarReceitaPorPerfil({ from, to })` reutilizando o padrão do UNION de agregarReceitaPorMesDoSistema (src/db.js:1576-1598), mas sem filtro de massagista e projetando o perfil: lado 1 = `COALESCE(NULLIF(r.tipo_cliente,''),'nao_informado') AS perfil` com `t ON t.id = r.tipo_massagem_id`; lado 2 (apenas linhas onde pessoa 2 existe, i.e. `r.massagista_id2 IS NOT NULL OR r.tipo_massagem_id2 IS NOT NULL`) = `COALESCE(NULLIF(r.tipo_cliente2,''), r.tipo_cliente, 'nao_informado')` com `t ON t.id = r.tipo_massagem_id2` (fallback igual ao usado em db.js:2111/2279: tipo_cliente2 vazio herda o da pessoa 1). Filtros: `r.data BETWEEN ? AND ?` e `r.data <= hoje` (consistência com a receita de comissão). Retornar: (a) totais por perfil {perfil, atendimentos, receita, ticket_medio}; (b) série mensal por perfil; (c) detalhe por terapia por perfil. Envolver em try/catch com fallback só-lado-1, como já feito em db.js:1603-1615.
2. src/routes/relatorios.js: `router.get('/receita-perfil', ...)` aceitando ?from&to (default: mês corrente em America/Fortaleza, mesmo padrão da rota /mensal). IMPORTANTE: registrar com middleware próprio `requireAuth, requireSpa` (importar de ../middleware/auth.js) ANTES do `router.use(requireAuth, requireSatisfacao)` da linha 6 — ou criar as rotas com stack explícito — senão o perfil 'spa' (Mari) recebe 403.
3. public/js/admin.js + admin.html: seção "Receita por Perfil" com date-range (default mês atual), cards por perfil (Hóspede / Passante / Não informado), tabela mensal e drill-down por terapia (copiar padrão visual das receita-cards/receita-table de admin.js:1815-1905), e botão "Exportar CSV" gerando Blob client-side (perfil;mes;terapia;atendimentos;receita) — sem dependência nova.

FASE 2 — Perfil 'pax' (condicionada à decisão humana sobre o que é 'pax'):
4. src/routes/reservas.js:123 e 409: `['hospede','passante','pax']`. Definir regra de quarto para pax (hoje: hóspede exige quarto válido, linhas 107-108 e 413; passante não).
5. public/admin.html:4361/4551: terceiro botão `data-tipo="pax"`; public/js/admin.js: TIPO_CLIENTE_LABEL (5309), mensagens de validação (4443/4547), classes de badge (3895-3963, 5383) e CSS badge-tipo-pax em admin.html:3290-3299. Reservas antigas permanecem hospede/passante — sem migração de dados.

O QUE NÃO TOCAR: agregarReceitaPorMesDoSistema, calcularComissaoPorMes, comissao_config, receita_lancamentos e o seed seedReceitaTerapias (histórico da planilha, sem dimensão de perfil — deixar como está e sinalizar na UI que o relatório por perfil só cobre dados do sistema, não o histórico importado da planilha); endpoints existentes /mensal e /cruzamento; a taxonomia lazer/negocios/evento do feedback (é outro campo conceitual).

### Riscos de regressão (checar um a um)
- Middleware: relatorios.js aplica requireSatisfacao a TODAS as rotas via router.use (linha 6); adicionar a nova rota depois desse use bloqueia o role 'spa' (403 em auth.js:51 — 'satisfacao' não inclui 'spa'). Registrar a rota com stack próprio requireAuth+requireSpa.
- Comissão: calcularComissaoPorMes (db.js:1663) consome agregarReceitaPorMesDoSistema — qualquer alteração nessa função (em vez de criar uma nova) muda a comissão paga às massagistas. Criar função NOVA, não editar a existente.
- Dupla contagem em casal: no UNION, o lado 2 só deve gerar linha quando a pessoa 2 realmente existe; usar a mesma condição de presença que o cálculo de comissão usa (massagista_id2 preenchido) para que a soma dos perfis bata com a receita total já exibida no modal de comissão — senão a Mari verá dois totais divergentes.
- Se 'pax' for adicionado à validação de reservas.js sem atualizar admin.js (validação em 4443/4547 e labels em 5309), a UI continuará exigindo Hóspede/Passante e o badge cairá no fallback 'passante' (admin.js:3896) — pax apareceria como Passante nas telas.
- Preço vem de tipos_massagem.preco no momento da query (db.js:1578): alterar preço de uma terapia muda retroativamente o relatório por perfil E a comissão (comportamento já existente, mas o novo relatório o torna mais visível — documentar, não 'corrigir').
- tipo_cliente pode ser NULL em reservas antigas (coluna veio de migration, db.js:209) — sem o bucket 'nao_informado' a soma dos perfis não fecharia com o total geral.
- Deploy: push na main vai direto a produção em segundos (memória do projeto: auto-commit + 2 workflows de deploy) — fazer Fase 1 e Fase 2 em commits separados e testados.

### ❓ Questões abertas (perguntar antes de implementar a parte dependente)
- O que é exatamente 'pax' para a Mari? O codebase só conhece hospede/passante. Hipóteses: (a) day-use/pacote (Day SPA, Dia da Noiva); (b) acompanhante de hóspede sem UH própria; (c) sinônimo de passante na planilha dela. Se (c), a Fase 2 inteira é desnecessária — o relatório hóspede×passante já resolve.
- Se 'pax' virar um 3º tipo: exige quarto (como hóspede) ou não (como passante)? Afeta validação em reservas.js:107 e 413 e o formulário de anamnese (spa-profile.js oculta quarto para passante, linha 9).
- Receita do relatório deve usar preço cheio de tipos_massagem (como a comissão) ou considerar descontos/faixas (P10/P20/P30 da planilha)? Hoje o sistema NÃO registra preço/desconto na reserva — se a Mari precisa de receita com desconto por perfil, seria necessário adicionar coluna de preço aplicado na reserva (mudança maior, fora do escopo proposto).
- O relatório deve incluir o histórico da planilha (receita_lancamentos)? Esse histórico não tem perfil de cliente — só é possível por perfil daqui pra frente, a partir das reservas do sistema. Confirmar que isso atende.
- Reservas canceladas/no-show: existe algum status de reserva a excluir do relatório? (agregarReceitaPorMesDoSistema hoje conta toda reserva com data <= hoje, sem noção de comparecimento).
- Quem acessa o relatório: só perfil 'spa' e 'master', ou também 'satisfacao' e 'admin' (read-only)? Proposta assume requireSpa (que já inclui admin read-only, auth.js:44).

---

## PONTO 9 — Tela de Sauna / Day Use (sauna + jacuzzi) para hóspede, passante e pax
**Complexidade:** media

### Estado atual (verificado no código)
Não existe NENHUM modelo de dados, endpoint ou tela de sauna/jacuzzi/day use hoje. Grep por sauna|jacuzzi|day.?use no repositório retorna apenas texto estático no modal de benefícios Gran Class (public/js/admin.js:3747-3794, função _abrirModalGranClass), que exibe "Sauna liberada gratuitamente" e "Jacuzzi liberada gratuitamente" como cortesia para hóspedes Gran Class — puro HTML informativo, sem persistência. O termo "pax" não existe em lugar nenhum do código (só falsos positivos em package-lock.json). O perfil de cliente hoje é binário: reservas.tipo_cliente aceita 'hospede'|'passante' (src/db.js:82-95 schema da tabela reservas; validação em src/routes/reservas.js:105-112, que exige quarto válido via quartoValido() para hóspede e o proíbe inválido para passante; labels no front em public/js/admin.js:5309 TIPO_CLIENTE_LABEL e :3895-3896). Padrões reutilizáveis já mapeados: (a) rota CRUD com escopo — src/routes/reservas.js:6-9 usa requireAuth global + [requireSpa, requireWrite] para escrita (roles em src/middleware/auth.js:36-46); src/routes/salas.js é o exemplo de CRUD pequeno; (b) mount de routers em src/server.js:236-284 — routers específicos ANTES do catch-all app.use('/api', cadastrosRouter) na linha 284, com auditMiddleware automático em POST/PUT/DELETE /api/* (linha 236); (c) views do admin — divs id="view-*" em public/admin.html (view-salas na linha 4946 é o modelo mais recente), navegação por showView(id) com lista hardcoded de views em public/js/admin.js:676, botões btn-open-* ligados em admin.js:1356-1362, item de menu no dropdown em public/js/shared-header.js:106-121, allowlist de deep-link ?open= em admin.js:9589-9593, e delegação de eventos via data-action (admin.js:9562-9581) porque a CSP bloqueia onclick inline; (d) helpers de cliente/quarto exportados de src/db.js e já usados por reservas.js: quartoValido, isGranClass, buscarClientePorCpf, buscarClientePorPassaporte, inserirCliente, telefoneValido; tabela clientes em src/db.js:462-477 e quartos (com categoria gran_class derivada) em :503-510; (e) relatórios — src/routes/relatorios.js expõe /api/relatorios/mensal e /cruzamento (ponto de integração com o relatório do ponto 8); receita_lancamentos (src/db.js:286-303) é a base de receita/comissão de massoterapia e NÃO deve receber day use.

### Arquivos afetados
- `src/db.js` — Adicionar CREATE TABLE IF NOT EXISTS dayuse_utilizacoes (bloco idempotente, additive-only, seguindo o comentário-padrão da linha 315-317) + funções exportadas listarDayuse/inserirDayuse/atualizarDayuse/removerDayuse/resumoDayuse
- `src/routes/dayuse.js` — NOVO arquivo — router CRUD /api/dayuse seguindo o padrão de src/routes/reservas.js (requireAuth + [requireSpa, requireWrite] na escrita) e src/routes/salas.js (estrutura de handlers)
- `src/server.js` — Import + app.use('/api/dayuse', dayuseRouter) junto aos mounts das linhas 236-255, obrigatoriamente ANTES do app.use('/api', cadastrosRouter) da linha 284
- `public/admin.html` — Nova <div id="view-dayuse" class="view-page" style="display:none"> (colocar após view-salas, linha 4946): hero, KPIs, filtros (período/perfil/serviço/busca), tabela e modal de lançamento
- `public/js/admin.js` — Adicionar 'view-dayuse' na lista do showView (linha 676); listener btn-open-dayuse junto à linha 1362; 'btn-open-dayuse' na allowlist ?open= (linhas 9589-9593); funções loadDayuse/renderDayuse/modal CRUD com delegação data-action (padrão das linhas 9562-9581)
- `public/js/shared-header.js` — Adicionar item("btn-open-dayuse", "Sauna / Day Use") no dropdown SPA (linhas 106-109, junto de Profissionais/Tratamentos)
- `src/routes/relatorios.js` — Integração ponto 8: incluir resumoDayuse(ym) na resposta de GET /mensal (ou o relatório do ponto 8 consome GET /api/dayuse/resumo direto)

### Implementação (sem regressão)
1) TABELA (src/db.js, novo bloco db.exec idempotente após o módulo de salas, com o mesmo aviso 'Additive-only' da linha 315): CREATE TABLE IF NOT EXISTS dayuse_utilizacoes ( id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, hora_inicio TEXT, hora_fim TEXT, cliente TEXT NOT NULL, cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL, perfil TEXT NOT NULL CHECK(perfil IN ('hospede','passante','pax')), quarto TEXT, servico TEXT NOT NULL CHECK(servico IN ('sauna','jacuzzi','sauna_jacuzzi')), pessoas INTEGER NOT NULL DEFAULT 1, valor REAL NOT NULL DEFAULT 0, cortesia INTEGER NOT NULL DEFAULT 0, motivo_cortesia TEXT, observacao TEXT, criado_por TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_em TEXT NOT NULL DEFAULT (datetime('now')) ); CREATE INDEX IF NOT EXISTS idx_dayuse_data ON dayuse_utilizacoes(data); CREATE INDEX IF NOT EXISTS idx_dayuse_cliente ON dayuse_utilizacoes(cliente_id); CREATE INDEX IF NOT EXISTS idx_dayuse_perfil ON dayuse_utilizacoes(perfil, data). Funções em db.js: listarDayuse({from,to,perfil,servico,busca,limit=100,offset=0}) com paginação igual listarTodasReservas; inserirDayuse(payload) — se perfil='hospede' valida quartoValido(quarto) e marca cortesia=1 + motivo_cortesia='gran_class' quando isGranClass(quarto) (ambos já exportados e usados em reservas.js); vincula cliente_id opcionalmente via buscarClientePorCpf/buscarClientePorPassaporte + inserirCliente (mesmo fluxo de reservas.js POST /); atualizarDayuse(id, campos) com atualizado_em; removerDayuse(id); resumoDayuse({from,to}) → { total_utilizacoes, total_pessoas, receita, por_perfil: {hospede,passante,pax}, por_servico: {sauna,jacuzzi,sauna_jacuzzi}, cortesias }. 2) ENDPOINTS (novo src/routes/dayuse.js): router.use(requireAuth); const podeEscrever=[requireSpa,requireWrite]; GET / (lista com filtros/paginação), GET /resumo?from&to (para KPIs e para o relatório do ponto 8), POST / (validações: data ^\d{4}-\d{2}-\d{2}$, perfil e servico contra as listas do CHECK, valor>=0 numérico, quarto obrigatório+válido se hóspede — copiar bloco de reservas.js:105-112; telefoneValido se telefone enviado), PUT /:id, DELETE /:id (todos escrita com ...podeEscrever). Mount em src/server.js: app.use('/api/dayuse', dayuseRouter) junto às linhas 236-255 — auditoria vem de graça pelo auditMiddleware da linha 236. 3) UI (admin.html + admin.js): nova view-dayuse copiando a estrutura de view-salas/view-historico-clientes: page-hero com título 'Sauna & Day Use'; linha de KPIs (utilizações no período, receita, hóspedes × passantes × pax, cortesias) alimentada por /api/dayuse/resumo; filtros De/Até (default mês corrente), select Perfil (Todos/Hóspede/Passante/Pax), select Serviço (Sauna/Jacuzzi/Sauna+Jacuzzi), busca por nome; tabela Data|Hora|Cliente|Perfil (pill reutilizando classes resdet-pill-tipo hospede/passante de admin.js:3963)|Quarto|Serviço|Pessoas|Valor|Cortesia|ações; botão '+ Registrar utilização' abre modal com os campos, escondendo/exigindo Quarto conforme perfil (mesma UX do form de reserva, admin.js:4443-4446) e pré-marcando 'Cortesia Gran Class' quando o quarto for GC. Toda interação por data-action (CSP bloqueia onclick inline — comentário em admin.js:9564). Wiring: showView linha 676 + listener btn-open-dayuse + allowlist ?open= + item no dropdown SPA do shared-header.js. 4) INTEGRAÇÃO PONTO 8: expor resumoDayuse no GET /api/relatorios/mensal (spread extra no res.json da linha 15 de relatorios.js, chave dayuse:{...}) para o relatório mensal consolidado consumir; a receita de day use fica FORA de receita_lancamentos — no relatório aparece como linha própria 'Day Use (sauna/jacuzzi)' separada da receita de massoterapia. 5) O QUE NÃO TOCAR: tabela reservas e seu fluxo (survey_tokens, anamnese, conflito de sala/profissional), receita_lancamentos/comissao_config, feedback, e o modal Gran Class existente (apenas informativo, pode continuar como está).

### Riscos de regressão (checar um a um)
- NÃO modelar day use como linha na tabela reservas: a agenda semanal (listarReservasSemana), o detector de conflitos de sala/massagista, survey_tokens, anamnese (spa_perfis.reserva_id), countSessoesSemPesquisa e cruzamentoSessoesPesquisa consomem reservas — qualquer registro extra ali contaminaria agenda, pesquisa de satisfação e relatórios. Tabela nova isola tudo.
- Receita de day use NÃO pode entrar em receita_lancamentos (src/db.js:286-303): essa tabela alimenta o cálculo de comissão das massagistas (comissao_config base_rate 10% + tiers por nota, src/db.js:305-312) — lançar day use lá inflaria comissão indevidamente.
- showView tem lista hardcoded de views (public/js/admin.js:676): esquecer de incluir 'view-dayuse' faz a view nunca aparecer ou nunca ser escondida ao navegar.
- Allowlist de deep-link ?open= (admin.js:9589-9593): sem adicionar 'btn-open-dayuse', o link vindo do Hub/escala-spa.html silenciosamente não abre a tela (padrão do shared-header.js linha 81 gera /admin?open=btn-open-dayuse para contexto não-admin).
- Ordem de mount em src/server.js: registrar /api/dayuse ANTES de app.use('/api', cadastrosRouter) (linha 284) — o comentário da linha 258 já documenta esse gotcha para outro router.
- CSP script-src-attr 'none': handlers inline (onclick=) não executam; usar delegação data-action como em admin.js:9562-9581, senão os botões da view nova ficam mortos.
- CHECK constraints em SQLite não valem para tabelas já criadas: se o conjunto de perfis/serviços mudar depois (ex.: adicionar 'pax_evento'), será preciso migração de tabela nova + cópia, não ALTER do CHECK — melhor validar também no endpoint (fizemos) e considerar o CHECK apenas rede de segurança.
- Deploy automático: push na main vai a produção em segundos (memória do projeto: auto-commit + 2 workflows de deploy) e o SQLite de produção é volume persistente — a migração TEM que ser idempotente (CREATE TABLE IF NOT EXISTS), sem seed destrutivo, e o código novo não pode quebrar se a tabela já existir.
- Vínculo opcional com clientes (cliente_id ON DELETE SET NULL): não tornar CPF obrigatório no day use — reservas já aceita cliente sem CPF; exigir documento quebraria o fluxo rápido de recepção.

### ❓ Questões abertas (perguntar antes de implementar a parte dependente)
- Definição de 'pax': o código só conhece hospede/passante (reservas.tipo_cliente). Pax é acompanhante de hóspede? Participante de evento? Cliente de day use com pacote? Precisa definição de negócio e se pax paga tarifa própria.
- Tabela de preços do day use: valor fixo por serviço (sauna, jacuzzi, combo)? Por pessoa ou por sessão? Onde cadastrar — hardcoded, nova tabela dayuse_precos, ou reaproveitar tipos_massagem com um tipo novo? A anotação da reunião não define valores.
- Gratuidade: o modal Gran Class afirma sauna/jacuzzi grátis para hóspede Gran Class. Hóspede standard paga? Se todo hóspede é cortesia, o campo valor só se aplica a passante/pax — confirmar regra.
- Taxa de serviço 10% e ISS 5% (aplicados nas massagens, admin.js:3722-3723) incidem sobre day use? Afeta o campo valor (bruto vs líquido) e o relatório do ponto 8.
- Day use é agendado (hora marcada, controle de capacidade máxima da sauna/jacuzzi) ou apenas registro de utilização a posteriori? Se houver capacidade/horário, precisa lógica de conflito semelhante à de salas.
- Deve aparecer no Clientes 360 (view-clientes)? Se sim, incluir utilizações de day use na timeline do cliente (hoje só produtos e reservas).
- Permissões: assumido escopo Spa (role spa escreve, admin lê) — confirmar se recepção/portaria terá outro perfil de acesso.
- Formato exato do relatório do ponto 8 (fechamento financeiro): day use entra como bloco próprio no /api/relatorios/mensal ou o relatório novo consome /api/dayuse/resumo separadamente? Depende da definição do ponto 8.

---

## PONTO 10 — Espaço Beleza: dia da noiva e valores Day Use (pendência Georgia)
**Complexidade:** media

### Estado atual (verificado no código)
1) Espaço Beleza existe como sala 5: seed em src/db.js L745 (`INSERT OR IGNORE INTO salas (id, nome, tipo, observacao) VALUES (5, 'Espaço Beleza', 'beleza', ...)`); constraint de reservas `CHECK(sala IN (1,2,3,4,5))` (src/db.js L84). No frontend, public/js/admin.js L2352 `_isEspBeleza()` e L2353-2371 `_aplicarVisibilidadeSala()`: sala 5 esconde os campos tratamento e massoterapeuta e habilita hora_fim manual; L3858-3870 sala 5 não tem anamnese nem pesquisa de satisfação; L4516-4518 massoterapeuta obrigatória exceto sala 5. Backend src/routes/reservas.js L120-121 e L407: sala 5 não exige massagista_id nem tratamento (tratamento vira texto livre, grava massagista_id NULL — L318). Ou seja: reservas do Espaço Beleza hoje são "texto livre + horário", sem vínculo a serviço cadastrado e sem preço.
2) Dia da Noiva existe apenas como tipo_massagem seedado para o módulo Receita: src/db.js L1404-1416 `seedReceitaTerapias` cria 'DIA DA NOIVA OPC. 1' (preco 2898), 'DIA DA NOIVA OPC. 2' (preco 2035.5) e 'DIA DO NOIVO OPC.2' (1046), categoria 'Pacote', duracao NULL. Mesmos valores em seed-data/receita-2026.json L37-38 (precos_base) e lançamentos históricos (ex.: L528). O mapeamento planilha→seed está em PLANILHA_TO_SEED_NOME (src/db.js L1349-1378, entradas L1371-1373 com valor null = criadas com nome da planilha).
3) Modelo de preço atual: tipos_massagem tem UMA coluna `preco REAL` (src/db.js L65-73, + colunas migradas tipo/categoria/componentes/linhas L136-144). Não existe nenhum mecanismo de preço por perfil de cliente. O único conceito de variação de preço é o módulo Receita: receita_lancamentos com `faixa_desconto IN ('NORMAL','P10','P20','P30','P50')` e fatores FAIXAS_FATOR (src/db.js L286-303, L1380) — é registro retroativo de receita, não tabela de venda.
4) Perfis de cliente: reservas.tipo_cliente é texto livre com botões 'hospede'/'passante' no modal (public/admin.html L4360-4361, L4550-4551). Gran Class é derivado do cadastro de quartos: tabela `quartos` com categoria IN ('standard','gran_class') (src/db.js L501-506) e helper `isGranClass(numero)` (~L2565, cf. MAPEAMENTO.md L379); usado hoje só para badge no terapeuta.html L1124 e modal Gran Class Info. Não existe conceito de "Day Use" nem preço diferenciado hóspede/Gran Class/passante em lugar nenhum do código.

### Arquivos afetados
- `src/db.js` — Nova tabela tipos_massagem_precos (variantes por perfil) + funções CRUD + helper de resolução de preço; hoje só existe coluna única preco em tipos_massagem (L65-73) e seed dos pacotes Dia da Noiva (L1404-1416)
- `src/routes/cadastros.js` — Endpoints para gerenciar variantes de preço por perfil no CRUD de tipos_massagem
- `src/routes/reservas.js` — Sala 5 hoje aceita só texto livre (L120-121, L318); permitir opcionalmente vincular tipo_massagem_id de categoria Pacote/Beleza na reserva do Espaço Beleza
- `public/js/admin.js` — _aplicarVisibilidadeSala (L2353) esconde tratamento na sala 5; passar a exibir seletor de pacotes de beleza com preço por perfil; view de cadastro de tipos ganha edição de variantes
- `public/admin.html` — UI do modal de reserva sala 5 e do cadastro de serviços (campos de preço por perfil)
- `seed-data/receita-2026.json` — Contém os únicos valores oficiais conhecidos (DIA DA NOIVA OPC. 1/2, L37-38); valores de Day Use por perfil entrarão aqui ou em seed próprio quando a Georgia responder

### Implementação (sem regressão)
FASE 0 (bloqueada — aguardar Georgia): obter (a) valores de Day Use para hóspede da pousada e para Gran Class, (b) valor para passante/pax se aplicável, (c) o que compõe as opções 1 e 2 do Dia da Noiva e se HGM as venderá, (d) fluxo de reserva do Day Use (quem reserva, canal, antecedência, ocupa Espaço Beleza ou salas de massagem, duração).

FASE 1 — modelo de dados (pode ser feito antes das respostas, sem regressão):
1. Nova tabela em src/db.js (junto às outras DDL, padrão CREATE TABLE IF NOT EXISTS + migrations try/catch):
   `tipos_massagem_precos (id PK, tipo_massagem_id INTEGER NOT NULL REFERENCES tipos_massagem(id), perfil TEXT NOT NULL CHECK(perfil IN ('hospede','gran_class','passante','pax','day_use')), preco REAL NOT NULL, ativo INTEGER DEFAULT 1, UNIQUE(tipo_massagem_id, perfil))`.
   Manter tipos_massagem.preco como preço padrão/fallback — NÃO remover nem renomear a coluna.
2. Helper `getPrecoTipo(tipoId, perfil)` em db.js: busca variante ativa; se não houver, retorna tipos_massagem.preco. Resolução de perfil na reserva: tipo_cliente='hospede' + apto com quartos.categoria='gran_class' (usar isGranClass, ~db.js L2565) → perfil 'gran_class'; hospede standard → 'hospede'; senão 'passante'.
3. Endpoints em src/routes/cadastros.js: GET/PUT `/api/tipos-massagem/:id/precos` (requireWrite), lendo/gravando as variantes.

FASE 2 — Espaço Beleza no fluxo de reserva (após definições):
4. Em reservas.js, aceitar tipo_massagem_id opcional quando sala=5 (hoje o fluxo grava só `tratamento` texto — manter texto livre como fallback para não quebrar reservas existentes). Validar que o tipo é de categoria 'Pacote'/'Beleza'.
5. Em admin.js `_aplicarVisibilidadeSala` (L2353): para sala 5, em vez de esconder tratamento, mostrar combo filtrado por categoria de beleza/pacote; exibir preço resolvido pelo perfil (chamada ao helper via endpoint). Manter hora_fim manual (pacotes têm duracao NULL).
6. Seed das variantes: quando a Georgia passar os valores, adicionar ao seed idempotente (mesmo padrão de seedReceitaTerapias, src/db.js L1385+) ou criar 'DAY USE' como novo tipo categoria 'Pacote' com variantes hospede/gran_class.

O que NÃO tocar: FAIXAS_FATOR e receita_lancamentos (o desconto P10-P50 é conceito do módulo Receita/comissão, não misturar com preço por perfil); os preços seedados de DIA DA NOIVA OPC. 1/2 (usados como precos_base da receita histórica); a lógica sala 5 sem anamnese/pesquisa (admin.js L3858-3870) — Day Use/dia da noiva continuam sem anamnese salvo decisão contrária.

### Riscos de regressão (checar um a um)
- Módulo Receita/comissão: seedReceitaTerapias resolve tipos por nome exato (findByNome, src/db.js L1417, L1430-1434); renomear 'DIA DA NOIVA OPC. 1/2' ou alterar seu preco quebra o upsert de receita_lancamentos e os precos_base do JSON — criar variantes em tabela separada, nunca editar esses registros
- Comissão usa receita_lancamentos.receita (COMMISSION_BASE_RATE, src/db.js L1340): se preço por perfil passar a alimentar receita, o cálculo de comissão muda — decidir explicitamente se serviços do Espaço Beleza geram comissão de massoterapeuta (hoje sala 5 nem tem massagista)
- Sala 5 grava massagista_id NULL (reservas.js L318) e admin.js esconde campos por _isEspBeleza(); tornar tratamento obrigatório na sala 5 quebraria todas as reservas de beleza existentes (texto livre) — manter tipo_massagem_id opcional
- Combos calculam preço somando componentes (src/db.js L1304-1319); se variantes por perfil forem aplicadas a componentes, o preço de combo pode divergir — variantes devem valer só para o tipo vendido, sem propagação
- tipo_cliente é texto livre no schema (src/db.js L86); UI só oferece hospede/passante (admin.html L4360-4361) — resolução de perfil deve tratar NULL/valores antigos com fallback para o preco padrão
- Frontend de pesquisa e anamnese ignoram sala 5 por design (admin.js L3858); qualquer novo fluxo de Day Use que reutilize salas 1-4 dispararia anamnese/pesquisa automaticamente

### ❓ Questões abertas (perguntar antes de implementar a parte dependente)
- Georgia: valores de Day Use para hóspede da pousada e para Gran Class (não existem em nenhum arquivo do repo)
- Georgia: fluxo de reserva do Day Use — canal, antecedência, ocupa qual sala/espaço, duração, inclui quais serviços
- HGM venderá o Dia da Noiva? Se sim, o que diferencia OPC. 1 (R$ 2.898) de OPC. 2 (R$ 2.035,50) em serviços inclusos — hoje são só nomes+preço sem composição
- Passante/pax paga Day Use? Existe perfil 'pax' com preço próprio ou pax = hóspede? (UI atual só tem hospede/passante)
- Dia da noiva/Day Use geram comissão para massoterapeutas? Entram em receita_lancamentos?
- Dia da noiva exige anamnese? (sala 5 hoje não tem anamnese nem pesquisa por design)
- Espaço Beleza tem profissionais próprios a cadastrar (hoje reserva sala 5 não tem profissional)?

---

## PONTO 11 — Revisão do procedimento de cálculo da comissão
**Complexidade:** media

### Estado atual (verificado no código)
FÓRMULA ATUAL (passo a passo):
1) Endpoint: GET /api/massagistas/:id/receita (src/routes/cadastros.js:107-113) chama calcularComissaoPorMes(m.id, m.nome, ano) (src/db.js:1663-1691).
2) BASE DE RECEITA — agregarReceitaPorMesDoSistema (src/db.js:1571-1659): reservas do ano com data <= hoje (hoje = new Date().toISOString().slice(0,10), UTC). UNION ALL de dois lados: reservas onde massagista_id = X (usa tipo_massagem_id) e reservas onde massagista_id2 = X (usa tipo_massagem_id2). Cada lado conta 1 atendimento e soma COALESCE(tipos_massagem.preco, 0) — PREÇO CHEIO DE TABELA, via JOIN no preço ATUAL (sem snapshot na reserva). Nenhum desconto entra: nem faixas P10-P50, nem Gran Class -10%, nem taxa de serviço 10%/ISS 5% (esses só existem como display no admin, public/js/admin.js:3592-3720). Fallback try/catch para schema antigo sem colunas *2 (db.js:1602-1615).
3) NOTA MÉDIA — notaMediaPorMes (src/db.js:1520-1540): feedback WHERE LOWER(nome_massoterapeuta)=LOWER(nome) do ano; por resposta, média de 4 campos (servicos_expectativa, servicos_explicacao, servicos_atitude, servicos_tecnica, db.js:1518) na escala NOTA_MAP {otimo:9, bom:6, regular:3, ruim:0} (db.js:814-816); depois média das respostas por mês (0-9).
4) CONFIG — tabela comissao_config id=1 (db.js:305-312), default base_rate=0.10 e tiers [{min_nota:8.5, bonus:0.05},{min_nota:7.5, bonus:0.02}]. Lida por getComissaoConfig (db.js:1543-1549), editável via PUT /api/comissao/regras (cadastros.js:227-235, exige podeEscreverSpa; setComissaoConfig db.js:1550-1564 valida ranges e ordena tiers desc). Modal no admin (public/js/admin.js:1952+).
5) CÁLCULO MENSAL (db.js:1668-1679): base = receita_mes * base_rate; bonus = primeiro tier com nota >= min_nota (ordem desc, break); se mês sem feedback (nota null) → bonus 0; comissao = base * (1 + bonus). Total YTD = soma dos meses.
LEGADO COEXISTENTE: módulo planilha — tabela receita_lancamentos com faixa_desconto NORMAL/P10/P20/P30/P50 (db.js:286-303), FAIXAS_FATOR {1.0,0.9,0.8,0.7,0.5} (db.js:1380), seedReceitaTerapias (db.js:1385-1465, seed de seed-data/receita-2026.json chamado no boot via server.js) e agregarReceitaPorMes (db.js:1469-1514). Essa função NÃO é mais usada por nenhuma rota — a comissão migrou para reservas do sistema ("fonte: 'sistema'", db.js:1689) mas o seed continua rodando e populando receita_lancamentos.
TESTE: scripts/test-receita-local.js compara calcularComissaoPorMes (que hoje lê RESERVAS) contra totais esperados da PLANILHA (6 massagistas × 5 meses) — ficou desatualizado com a troca de fonte: num banco sem reservas espelhando a planilha, tudo falha.

### Arquivos afetados
- `src/db.js` — calcularComissaoPorMes (1663), agregarReceitaPorMesDoSistema (1571), notaMediaPorMes (1520), get/setComissaoConfig (1543-1564), schema comissao_config (305-312), módulo planilha legado (280-303, 1385-1514)
- `src/routes/cadastros.js` — GET /massagistas/:id/receita (107-113) e GET/PUT /comissao/regras (224-235)
- `public/js/admin.js` — render Receita & Comissão (1782-1950), modal regras (1952+), pricing display com GC -10%/taxas (3592-3720) que divergem da base de comissão
- `scripts/test-receita-local.js` — teste desatualizado: valida fonte planilha, mas função calcula sobre reservas
- `seed-data/receita-2026.json` — seed legado com preços base e divergência FABULOSA KARITE (445 vs 560)

### Implementação (sem regressão)
Revisão proposta, em ordem de segurança (tudo additive, sem tocar no fluxo de reservas/feedback):
1) SNAPSHOT DE PREÇO NA RESERVA: migration idempotente `ALTER TABLE reservas ADD COLUMN preco_snapshot REAL` e `preco_snapshot2 REAL` (mesmo padrão try/catch das migrations existentes em db.js:209-252). Preencher no criarReserva/atualizarReserva com tipos_massagem.preco vigente. Em agregarReceitaPorMesDoSistema, usar COALESCE(r.preco_snapshot, t.preco, 0) — corrige comissão retroativa quando o preço de tabela muda, sem quebrar reservas antigas (fallback ao JOIN atual).
2) STATUS DE ATENDIMENTO: hoje toda reserva passada comissiona, mesmo no-show/cancelada (não existe coluna status). Adicionar `ALTER TABLE reservas ADD COLUMN status TEXT` (NULL = realizada, compat) e filtrar `AND (status IS NULL OR status NOT IN ('cancelada','no_show'))` nos dois SELECTs do UNION (db.js:1576-1598 e 1618-1636). UI: botão cancelar no modal de reserva (admin.js).
3) CORRIGIR O TESTE: reescrever scripts/test-receita-local.js para (a) testar agregarReceitaPorMes (planilha) contra os totais ESPERADO — que é o que aqueles números validam — e (b) adicionar caso sintético para calcularComissaoPorMes: criar reservas + feedback em DB temporário e conferir base/bonus/tiers (incluindo mês sem feedback → bonus 0, e tier desc).
4) VÍNCULO NOTA↔MASSAGISTA: notaMediaPorMes casa por LOWER(nome) (db.js:1524). Não renomear a lógica agora (feedback não tem massagista_id), mas documentar no código e, se ponto correlato existir, gravar massagista_id no feedback novo (coluna additive) e usar OR no WHERE.
5) LEGADO: marcar claramente agregarReceitaPorMes/receita_lancamentos como legado-planilha (comentário) ou desligar seedReceitaTerapias no boot (server.js) atrás de env flag — evita duas "receitas" divergentes no mesmo banco.
6) INTERAÇÃO COM PONTO 4 (fim do desconto automático): a comissão atual JÁ ignora qualquer desconto (base = preço cheio de tabela), então encerrar o desconto automático Gran Class NÃO altera a comissão hoje. Porém, se a decisão do ponto 4 vier acompanhada de "comissionar sobre o valor efetivamente cobrado", será preciso persistir o valor cobrado/desconto na reserva (usar o preco_snapshot do passo 1 + coluna desconto_pct) e trocar a base em agregarReceitaPorMesDoSistema — hoje o desconto GC (-10%), taxa de serviço (10%) e ISS (5%) existem SÓ como display em admin.js:3592-3720 e não são gravados em lugar nenhum.
7) Não tocar: NOTA_MAP/escala 0-9 (usada por relatórios de feedback), endpoint /comissao/regras (funciona), UNIQUE de receita_lancamentos.

### Riscos de regressão (checar um a um)
- scripts/test-receita-local.js já falha por design (valida planilha, função lê reservas) — qualquer mudança precisa vir com o teste corrigido, senão continua sem rede de proteção
- Adicionar filtro de status nas queries de receita muda valores YTD já exibidos/reportados à gestão; aplicar só a reservas novas (status NULL = realizada) preserva histórico
- Snapshot de preço: se backfill preencher errado, comissão histórica muda; fallback COALESCE(snapshot, t.preco, 0) mantém comportamento atual para linhas antigas
- Fallback de schema antigo (db.js:1602-1615) ignora massagista_id2 — alterar o SQL principal sem replicar no fallback quebra deploys com schema velho
- Tela Receita & Comissão do admin (admin.js:1782-1950) consome o shape {meses, total, regras} do endpoint — renomear campos quebra o front
- setComissaoConfig ordena tiers desc e o loop com break depende dessa ordem (db.js:1673-1675); edição manual do JSON em comissao_config sem ordenar daria bônus errado
- Dupla contagem em reserva casal é decisão documentada (db.js:1567-1570): cada massagista recebe preço cheio — somar comissões de todas as massagistas superestima o custo total; não 'corrigir' sem decisão
- Reserva com tipo_massagem_id NULL conta atendimento com receita 0 (COALESCE) — mudar para excluir a linha altera contagem de atendimentos
- Deploy automático em push na main (memória do projeto): qualquer edição vai a produção em segundos; migrations precisam ser idempotentes como as existentes

### ❓ Questões abertas (perguntar antes de implementar a parte dependente)
- A base de comissão deve ser o preço de tabela cheio (atual) ou o valor efetivamente cobrado (com desconto GC/ponto 4, taxas)? Taxa de serviço e ISS entram ou saem da base?
- Reservas canceladas/no-show devem comissionar? Hoje comissionam (não há status de reserva)
- Massagem casal/4 mãos: manter preço cheio para cada massagista (dupla receita) ou ratear 50/50?
- Os tiers de bônus (≥8.5→+5%, ≥7.5→+2%) e a base 10% seguem válidos? Labels citam 94%/83% que só valem para a escala 0-9 atual
- Mês sem nenhum feedback: bônus 0 é o comportamento desejado, ou deveria herdar média YTD/não penalizar?
- Preço divergente FABULOSA KARITE na planilha (445 em 34 blocos vs 560 em 8) — qual vale para o histórico seedado?
- Pode desligar o seed da planilha (receita_lancamentos) agora que a fonte é o sistema, ou 2026-jan-mai ainda precisa vir da planilha (reservas daquele período existem no sistema?)
- Renomear massagista quebra vínculo com feedback antigo (match por nome) — aceitável ou precisa de massagista_id no feedback?

---

## PONTO 12 — Política de Day Off na escala do SPA
**Complexidade:** media

### Estado atual (verificado no código)
Não existe conceito de "Day Off" no sistema. O que existe hoje relacionado a folgas/ausências: (1) Escala mensal em `turno_massagista` (id, massagista_id, data, turno, obs; UNIQUE massagista_id+data) — o campo `turno` é TEXT e aceita horário de entrada ("09:00"), jornada custom ("09:00|17:00") ou siglas de status validadas por whitelist `VALID_STATUS = ['X','FE','AT','AA','CF','CH','LS','LC','F']` em src/routes/cadastros.js:263 (X=folga, FE=férias, AT=atestado, AA=afastamento, CF=comp. feriado, CH=comp. hora, LS=lic. sindical, LC=lic. casamento, F=falta). (2) Resolução de disponibilidade em `avaliarEscalaMassagista` (src/db.js:1173-1229) com hierarquia férias→turno mensal→padrão semanal→sem-escala; o mapa `TURNO_STATUS_MOTIVO` (src/db.js:1163-1167) transforma sigla em motivo de indisponibilidade — qualquer sigla ali torna a profissional indisponível para reservas. (3) Férias programadas em `ferias_massagista` (CRUD em src/routes/cadastros.js:~130-200, funções db.js L995-1011). (4) Padrão semanal em `massagistas.padrao_entrada` (JSON dom..sab, valor "FOLGA" vira turno 'X' ao aplicar padrão — cadastros.js:420). (5) Precedente de saldo/benefício: CF (compensação de feriado) tem saldo calculado em `calcularSaldoCf` (src/db.js:751-762: feriados trabalhados ganhos − turnos 'CF' usados), endpoint POST /api/escala-spa/cf-acumulado (cadastros.js:446-450), badge "N CF" por profissional e modal próprio em public/escala-spa.html (linhas ~421-450 CSS, 859, 995). (6) UI da escala: picker de célula com botões de status em public/escala-spa.html:586-595, mapas SIG_LABEL/SIG_TIP/SIG_CLS nas linhas 748-754, classes CSS .sig-* (~linha 265). (7) App da terapeuta (public/terapeuta.html:826-846) exibe banner com o `motivo` vindo de avaliarEscalaMassagista via GET /api/terapeuta/escala, com mapa MOTIVO_TXT hardcoded (linhas 831-838). (8) Feriados vêm do Hub via src/feriados-hub.js (cache 60s + fallback local). Histórico de alterações de célula em `turno_historico` (registrarTurnoHistorico db.js L1047).

### Arquivos afetados
- `src/routes/cadastros.js` — Adicionar 'DO' ao VALID_STATUS (linha 263); opcionalmente endpoint de saldo/uso de day off no período (espelho do POST /escala-spa/cf-acumulado linha 446)
- `src/db.js` — Adicionar DO:'day off' em TURNO_STATUS_MOTIVO (linha 1163-1167) para vetar reservas no dia; opcionalmente função contarDayOffPeriodo espelhando calcularSaldoCf (linha 751)
- `public/escala-spa.html` — Botão DO no picker (linhas 586-595), entradas em SIG_LABEL/SIG_TIP/SIG_CLS (748-754), classe CSS .sig-DO, item na legenda; opcional badge/contador de DO por período como o de CF (linha 995)
- `public/terapeuta.html` — Adicionar 'day off' ao MOTIVO_TXT (linhas 831-838) para mensagem amigável no banner da terapeuta

### Implementação (sem regressão)
FASE 1 — sigla DO na escala (autossuficiente, sem migração de banco, pois turno_massagista.turno é TEXT livre):
1. src/routes/cadastros.js:263 — acrescentar 'DO' em VALID_STATUS. Sem isso o PUT /api/escala-spa/:mId/:data devolve 400 "turno inválido".
2. src/db.js:1163-1167 — acrescentar `DO: 'day off'` em TURNO_STATUS_MOTIVO. Isso automaticamente: (a) torna a profissional indisponível no seletor de reservas (GET /api/escala-spa/disponibilidade → _escalaFiltra em public/js/admin.js:2465), (b) gera aviso de reservas conflitantes ao lançar DO num dia com reservas (_conflitosReservaEscala, cadastros.js:323 — padrão do sistema: avisa, nunca bloqueia), (c) propaga motivo para o app da terapeuta via GET /api/terapeuta/escala.
3. public/escala-spa.html — botão `<button class="cp-opt" data-turno="DO"><span class="sigla sig-DO">DO</span><span>Day Off</span></button>` na seção "Status especial" (após linha 591); entradas `DO:'DO'` em SIG_LABEL (748), `DO:'Day Off (política de benefício)'` em SIG_TIP (750-752), `DO:'sig-DO'` em SIG_CLS (754); classe CSS .sig-DO com cor própria (seguir padrão .sig-CF linha 265); item na legenda de siglas.
4. public/terapeuta.html:831-838 — `'day off': `${prefixo} é seu day off 🎉`` no MOTIVO_TXT (sem isso cai no fallback genérico, apenas cosmético).
Histórico (turno_historico) e auditoria já funcionam sem mudança — gravam strings brutas.

FASE 2 — política/elegibilidade (só após definições de negócio):
5. Contador de uso: função `contarDayOffPeriodo(dataIni, dataFim)` em src/db.js (SELECT massagista_id, COUNT(*) FROM turno_massagista WHERE turno='DO' AND data BETWEEN ? AND ? GROUP BY massagista_id), exposta no GET /api/escala-spa existente (junto com profs/turnos/ferias) ou endpoint próprio espelhando cf-acumulado.
6. Regra de elegibilidade como AVISO não-bloqueante no PUT /escala-spa quando turno='DO' excede a cota do período 21→20 (ex.: `{ ok:true, aviso_dayoff: 'Fulana já usou N day offs no período' }`), renderizado como toast/confirm no escala-spa.html — seguindo o padrão consolidado do sistema de nunca travar a operação.
7. Se a política tiver parâmetros configuráveis (cota/mês, carência), guardar em tabela nova `config_day_off` (chave TEXT PK, valor TEXT) ou coluna em massagistas se for por profissional — decidir após respostas do negócio.
NÃO TOCAR: calcularSaldoCf (DO não tem ':' então não conta como dia trabalhado nem como CF usado — correto por construção), aplicar-padrao (mapeamento FOLGA→X permanece; só adicionar opção DAY_OFF ao padrão semanal se o negócio pedir), lógica de comissão (baseada em reservas/feedback, não em turnos), ferias_massagista.

### Riscos de regressão (checar um a um)
- Adicionar 'DO' ao VALID_STATUS sem adicionar ao TURNO_STATUS_MOTIVO (db.js:1163) é bug grave: avaliarEscalaMassagista tentaria parsear 'DO' como horário, cairia no fail-open de turno ilegível (db.js:1193) e a profissional apareceria DISPONÍVEL para reservas no dia de day off. Os dois lados devem ir juntos.
- calcularSaldoCf (db.js:751) conta dias trabalhados via turno LIKE '%:%' e CF usados via turno='CF' — 'DO' não colide com nenhum dos dois; qualquer implementação alternativa que reutilize a sigla 'CF' ou mude essa query quebra o saldo CF exibido no badge e modal da escala.
- O picker do escala-spa.html marca botão ativo comparando data-turno com valor atual (linha ~1067) e formata célula via SIG_LABEL/SIG_CLS/SIG_TIP; esquecer qualquer um dos três mapas renderiza a célula com estilo default 'sig-T' de horário, confundindo a grade.
- aplicar-padrao (cadastros.js:385-433) sobrescreve turnos existentes quando sobrescrever=true e só preserva férias (ferias_massagista) — um DO lançado manualmente PODE ser apagado ao reaplicar padrão com sobrescrever. Mesmo comportamento atual de AT/CF/etc (é recuperável via histórico), mas se o negócio exigir que DO seja protegido como férias, precisa de exceção explícita no loop da linha 412-423.
- public/terapeuta.html mostra motivo cru se não mapeado em MOTIVO_TXT — regressão apenas cosmética, mas visível para a terapeuta.
- Deploy é automático na main a cada push (workflows duplos, ver memória do projeto): mudança parcial commitada vai para produção em segundos — fazer as 4 edições da Fase 1 num único commit.

### ❓ Questões abertas (perguntar antes de implementar a parte dependente)
- O que é exatamente o Day Off para o negócio: benefício periódico (ex.: 1/mês), premiação por meta/avaliação, ou benefício de aniversário? Nada disso está definido na anotação.
- Qual a diferença operacional entre DO e a folga 'X' existente? Se for só rótulo, basta a Fase 1; se houver cota/elegibilidade, precisa da Fase 2.
- O Day Off substitui, complementa ou se confunde com o CF (compensação de feriado, que já tem saldo ganho/usado implementado)? Se 'trabalhou feriado → ganha day off', isso JÁ é o CF e o ponto seria só renomear/ajustar a política existente.
- Regras de elegibilidade: tempo de casa mínimo? nota mínima na pesquisa de satisfação? sem faltas ('F') no período? Quem aprova o day off — a coordenação lança direto na escala ou há fluxo de solicitação pela terapeuta (app terapeuta.html hoje é somente leitura de escala)?
- Cota e acúmulo: quantos por período 21→20? Acumula se não usar? Expira?
- Limite operacional: máximo de profissionais em DO no mesmo dia (para não desfalcar a operação)? Deve ser bloqueio ou aviso (padrão do sistema é aviso)?
- Day Off conta como dia trabalhado para fins de escala/relatórios ou como ausência remunerada? Impacta algum relatório de RH externo ao sistema?
- A regra deve valer só para massoterapeutas ou também para outros perfis futuros (Espaço Beleza)?

---

## PONTO 13 — Regra de folga formalizada (folgas semanais por profissional + validação na escala)
**Complexidade:** media

### Estado atual (verificado no código)
Hoje "folga" existe em duas formas, nenhuma delas como regra validável:

1) PADRÃO SEMANAL (padrao_entrada): coluna JSON `massagistas.padrao_entrada` com {seg..dom: 'HH:MM' | 'FOLGA' | null}. Editado no modal "Padrões semanais" de public/escala-spa.html (render pmRenderizar L1419-1459; select com opção 'FOLGA' L1437; save via PUT /api/massagistas/:id/padrao L1395-1404). Backend: src/routes/cadastros.js L72-93 valida cada dia como null|'FOLGA'|hora do set PM_HORAS_VALIDAS, grava com setPadraoEntrada (src/db.js L922) e loga em padrao_entrada_log (registrarLogPadrao L927). Seed de padrões com FOLGA em src/db.js L942-964 (ex.: Germana dom:'FOLGA' L951, Isadora dom:'FOLGA' L954) e recepcionistas L676/L692.

2) ESCALA MENSAL (turno_massagista): turno 'X' = folga do dia, lançado manualmente pelo cell-picker (escala-spa.html L587) via PUT /api/escala-spa/:mId/:data (cadastros.js L302-318, VALID_STATUS inclui 'X' L263), ou gerado automaticamente por "Aplicar padrão" que converte FOLGA→'X' (cadastros.js L420 e db.js aplicarPadraoDatas L1080-1081). Restauração pós-cancelamento de férias também converte FOLGA→'X' (cadastros.js L197).

3) RESOLUÇÃO DE DISPONIBILIDADE: avaliarEscalaMassagista (src/db.js L1173-1229) — turno 'X' → indisponível motivo 'folga' (TURNO_STATUS_MOTIVO L1163-1167); sem turno lançado e padrão do dia = 'FOLGA' → indisponível 'folga (padrão semanal)' (L1221). Consumida pelo seletor de massoterapeuta do modal de reservas (GET /escala-spa/disponibilidade, cadastros.js L356-374) e pela agenda da terapeuta (terapeuta.html L832-839).

O QUE NÃO EXISTE: nenhuma validação impede lançar horário de trabalho num dia que o padrão marca FOLGA — o PUT /escala-spa/:mId/:data aceita qualquer turno válido e apenas retorna aviso pós-save de reservas conflitantes (_conflitosReservaEscala, cadastros.js L323-339). Não há conceito de "X folgas por semana", nenhuma contagem de folgas por período, nenhum alerta de semana sem folga. A folga é convenção visual/manual, não regra de sistema.

### Arquivos afetados
- `src/db.js` — Nova tabela folga_regra (migration aditiva no initDb, junto das migrations try/catch ~L630) + funções getFolgaRegra/setFolgaRegra/analisarFolgasPeriodo; NÃO tocar em avaliarEscalaMassagista nem upsertTurno
- `src/routes/cadastros.js` — GET/PUT /api/massagistas/:id/folga-regra; GET /api/escala-spa/violacoes-folga?ano&mes; enriquecer resposta do PUT /escala-spa/:mId/:data (L302-318) e do aplicar-padrao (L385-433) com avisos de violação de folga (não-bloqueante)
- `public/escala-spa.html` — Coluna 'Folgas/sem' e 'Dia fixo' no modal Padrões semanais (pmRenderizar L1419); destaque visual de células/semanas em violação no renderGrid (~L1000-1022); toast/modal de aviso ao salvar célula reaproveitando o padrão do conf-esc-overlay L634
- `MAPEAMENTO.md` — Atualizar seções 4 e 6 com tabela e endpoints novos (opcional, manutenção do mapa)

### Implementação (sem regressão)
FASE 1 — Modelo (src/db.js):
Criar tabela aditiva (NÃO adicionar colunas em massagistas — listarMassagistas L914 e listarMassagistasParaPadroes L933 são whitelists e o PUT /massagistas/:id ignora campos extras; tabela separada evita regressão):
CREATE TABLE IF NOT EXISTS folga_regra (
  massagista_id INTEGER PRIMARY KEY REFERENCES massagistas(id),
  folgas_semana INTEGER NOT NULL DEFAULT 1 CHECK(folgas_semana BETWEEN 0 AND 7),
  dia_fixo TEXT CHECK(dia_fixo IN ('dom','seg','ter','qua','qui','sex','sab') OR dia_fixo IS NULL),
  ativo INTEGER NOT NULL DEFAULT 1,
  atualizado_em TEXT DEFAULT (datetime('now')),
  atualizado_por TEXT
);
Seed opcional: derivar dia_fixo do padrao_entrada existente (dia com 'FOLGA') para as 8 profissionais ativas, guardado por flag em system_meta (mesmo padrão de seedPadraoEntrada L942).

Funções novas: getFolgaRegra(mId) (fallback default {folgas_semana:1, dia_fixo:null} quando sem registro), setFolgaRegra(mId, regra, usuario), e analisarFolgasPeriodo(ano, mes) que: monta o período 21→20 (mesma aritmética de listarTurnosPeriodo L1090-1099), agrupa dias por semana civil dom→sáb, e para cada massagista ativa conta folgas da semana = turnos 'X' + (dias sem turno cujo padrao_entrada do dia === 'FOLGA', pois a grade exibe padrão como fallback — escala-spa.html L1006-1012). Retorna violações: {tipo:'semana_sem_minimo', massagista_id, semana_ini, semana_fim, folgas, minimo} e {tipo:'trabalho_no_dia_fixo', massagista_id, data, turno}. Semanas parciais (começo/fim do período) só alertam se totalmente contidas no range consultado, para evitar falso positivo na borda 21/20.

FASE 2 — Endpoints (src/routes/cadastros.js):
- GET /api/massagistas/:id/folga-regra → requireAuth (leitura livre, como /massagistas/padroes L38).
- PUT /api/massagistas/:id/folga-regra → ...podeEscreverSpa (L23), validar shape, registrar usuario (req.user?.username).
- GET /api/escala-spa/violacoes-folga?ano&mes → requireAuth, retorna analisarFolgasPeriodo. ATENÇÃO Express 5: registrar ANTES de rotas com params se houver ambiguidade — aqui /escala-spa/violacoes-folga não colide com /escala-spa/:mId/:data (PUT/DELETE) por método, mas seguir o exemplo de /escala-spa/disponibilidade L356 que já convive com elas.
- No PUT /escala-spa/:mId/:data (L302-318): após salvar, além de _conflitosReservaEscala, calcular violação de folga da semana daquela data e do dia_fixo e devolver `folga_violacoes: [...]` no JSON. NUNCA bloquear o save — mesma filosofia documentada em L320-322 ("A alteração NUNCA é bloqueada").
- No POST /escala-spa/aplicar-padrao (L385-433): incluir no retorno (e no preview) o resumo de violações pós-aplicação.

FASE 3 — UI (public/escala-spa.html):
- Modal Padrões semanais: adicionar por profissional um select "Folgas/sem" (0-7, default 1) e select "Dia fixo" (—/dom..sab), carregados de GET folga-regra e salvos junto do fluxo pmSalvar existente (L1395) porém em endpoint próprio.
- Grade: após loadData, chamar /escala-spa/violacoes-folga e aplicar classe de alerta (ex.: borda tracejada laranja) nas células de trabalho em dia_fixo e um badge por linha/semana quando a semana ficou abaixo do mínimo; tooltip explicando.
- Ao salvar célula: se a resposta trouxer folga_violacoes, exibir toast/modal de aviso reaproveitando o padrão visual do conf-esc-overlay (L634-639) — "salvo, mas viola a regra de folga".

NÃO TOCAR: avaliarEscalaMassagista (db.js L1173) — a regra de folga é de MONTAGEM de escala, não de disponibilidade de reserva; upsertTurno (L1100) — é chamado por aplicar-padrao, restore de férias (cadastros.js L182/197/198) e seeds; validação dentro dele quebraria esses fluxos. Não alterar VALID_STATUS/turnoValido (L262-270).

### Riscos de regressão (checar um a um)
- Bloquear o PUT /escala-spa/:mId/:data em vez de só avisar quebraria a filosofia existente (cadastros.js L320-322) e travaria fluxos legítimos (troca de folga na semana, volta antecipada de férias) — a validação DEVE ser não-bloqueante
- Colocar validação dentro de upsertTurno (db.js L1100) afetaria aplicar-padrao, restauração pós-cancelamento de férias (cadastros.js L178-203) e seeds do initDb (L673-705), que inserem turnos em lote
- Adicionar colunas em massagistas exigiria revisar as whitelists listarMassagistas (db.js L914), listarMassagistasParaPadroes (L933) e o strip de pin_hash em /escala-spa (cadastros.js L296) — por isso tabela separada folga_regra
- Contagem de folga deve considerar o fallback de padrão exibido na grade (escala-spa.html L1006-1012): contar só turno_massagista='X' geraria falsos alertas em períodos onde o padrão não foi aplicado
- Semana civil vs período 21→20: semanas cortadas na borda do período podem gerar falso 'semana sem folga' se contadas parcialmente
- Status especiais FE/AT/AA/CF/CH/LS/LC/F não são folga — se contados como folga, a regra silenciaria semanas de férias/atestado; se exigir folga em semana de férias integral, gera alerta absurdo (semana 100% FE deve ser isenta)
- terapeuta.html (L832-839) e o seletor de reservas consomem avaliarEscalaMassagista — qualquer mudança acidental nessa função altera disponibilidade real de agendamento
- Deploy automático em push na main (Fly.io): a migration CREATE TABLE roda em produção imediatamente — manter idempotente (IF NOT EXISTS + try/catch) como as demais em initDb

### ❓ Questões abertas (perguntar antes de implementar a parte dependente)
- Quantas folgas por semana é o default? (CLT prevê 1 DSR semanal; a reunião não especificou se alguém tem 2, ex.: recepcionistas)
- Dia fixo é obrigatório por profissional ou opcional? Hoje o padrao_entrada já expressa um dia FOLGA — a regra nova substitui isso ou convive (e qual vence em divergência)?
- Definição de 'semana': civil dom→sáb, seg→dom, ou janela móvel de 7 dias corridos (CLT/jurisprudência usa 7 dias corridos sem folga como violação)?
- Status especiais contam para a regra? Proposta: semana com FE/AT/AA/LS/LC em todos os dias fica isenta; CF conta como folga? Decisão de RH/gestão do SPA
- A validação deve algum dia virar bloqueante (hard stop) para usuários role 'spa' (recepcionistas) mantendo override para master?
- Exigência legal de domingo periódico (escala de revezamento — 1 domingo a cada N semanas)? Se sim, N e a quem se aplica (definição RH, não código)
- Quem pode editar a regra de folga: mesmo escopo podeEscreverSpa (master+spa) ou só master?
- Relação com o ponto 12: se o ponto 12 criar troca/compensação de folga, a violação de 'trabalho no dia fixo' deve ser suprimida quando houver folga compensatória na mesma semana?

---

## ENTREGA POR PONTO
Arquivos alterados, migrações aplicadas, script de teste com a tabela de
resultados (3 passagens), relatório do verificador adversarial e confirmação de
que os fluxos vizinhos seguem intactos. Deploy só com tudo verde.
