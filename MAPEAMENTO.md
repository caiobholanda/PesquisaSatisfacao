# PesquisaSatisfacaoSPA — Mapeamento Arquitetural Completo

> Regenerado em 2026-07-10 por 50 agentes paralelos. **Foco:** Reservas, Gestão de Salas, Escala de Trabalho.
> Atualizar sempre que alterar o projeto.

**Produção:** pesquisa-satisfacao.fly.dev · **Stack:** Node.js + Express 5 (backend) / Vite + React 18 (frontend `frontend/` → `public/`)
**Persistência:** SQLite `better-sqlite3` (WAL, `/app/data/feedback.db`) · **Deploy:** Fly.io (GRU, volume `feedback_data`)

---

## Sumário
1. Estrutura de arquivos
2. src/server.js — segurança, rotas montadas, SSO
3. src/db.js — schema (24 tabelas) + PRAGMAs + migrações
4. src/db.js — funções (Reservas, Salas, Escala, Clientes, Massagistas)
5. src/qualidade.js — engine de pesquisas
6. src/routes/ — 12 routers, ~100+ endpoints
7. src/middleware/ — auth (6 middlewares) + audit
8. src/utils/ — detectarIdioma + traduzir
9. Frontend React (`frontend/src/`) — SPA de satisfação
10. Public HTMLs — admin, escala-spa, spa-profile, terapeuta, gestao-qualidade, acesso-hub, index
11. public/js/admin.js (8922 linhas) — módulos por view
12. public/js/shared-header.js — bootstrap + tema
13. public/js/spa-profile.js — anamnese
14. Fluxos End-to-End (Reserva · Sala · Escala · Anamnese LGPD)
15. Matriz de endpoints × roles
16. Scripts, seeds, i18n, fontes
17. Infra: Dockerfile, fly.toml, CI/CD, env vars
18. Segurança e LGPD
19. Débitos técnicos e riscos
20. Diagramas de dados

---

## 1. Estrutura de Arquivos

```
PesquisaSatisfacaoSPA/
├── src/
│   ├── server.js                # 17KB — helmet/cors/CSP, SPA gate, SSO, 12 routers
│   ├── db.js                    # 149KB (3072 linhas) — 24 tabelas, ~100 funções
│   ├── qualidade.js             # 57KB — engine pesquisas/perguntas/escalas/metas
│   ├── routes/
│   │   ├── reservas.js          # 26KB — 10 endpoints (criar, listar, detalhe, liberar-pesquisa, gerar-ficha)
│   │   ├── salas.js             # 9.3KB — 9 endpoints (CRUD sala, bloqueios, transfer, disponibilidade)
│   │   ├── cadastros.js         # 19KB — 26 endpoints (massagistas, tipos, escala-spa, férias, PIN, comissão)
│   │   ├── clientes.js          # 23KB — 11 endpoints (busca, 360, anamnese, LGPD, produtos)
│   │   ├── feedback.js          # 14KB — 4 endpoints públicos (POST feedback + stats)
│   │   ├── spa.js               # 26KB — 4 endpoints (documento, historico, perfil, anamnese/config)
│   │   ├── terapeuta.js         # 4.7KB — 7 endpoints (login PIN, agenda, escala, atendimento)
│   │   ├── qualidade.js         # 15KB — ~35 endpoints CRUD survey/perguntas/escalas/metas
│   │   ├── gq.js                # 11KB — 3 endpoints Gestão Qualidade (stats/respostas)
│   │   ├── auth.js              # 5.3KB — login/logout + CRUD usuários
│   │   ├── auditoria.js         # 886B — 2 endpoints (master only)
│   │   ├── relatorios.js        # 1.1KB — 2 endpoints (mensal, cruzamento)
│   │   └── dev.js               # 82B — router vazio
│   ├── middleware/
│   │   ├── auth.js              # 6 middlewares (requireAuth, Master, Write, Spa, Satisfacao, Terapeuta)
│   │   └── audit.js             # auditMiddleware (fail-safe, ignora GET/HEAD/OPTIONS + rotas ruidosas)
│   └── utils/
│       ├── detectarIdioma.js    # Claude Haiku 4.5, maxTokens=8
│       └── traduzir.js          # MyMemory API, 12–18s timeout, 400ms delay
├── frontend/                    # Vite + React 18
│   ├── src/
│   │   ├── App.jsx              # State machine welcome→form→confirm
│   │   ├── main.jsx             # StrictMode + fontsource JetBrains Mono
│   │   ├── index.css            # 16KB — --gold, tema duplo, cubic-bezier(0.16,1,0.3,1)
│   │   └── components/
│   │       ├── WelcomeScreen.jsx
│   │       ├── FormScreen.jsx        # 32KB — form gigante, 7 ratings, i18n, extras
│   │       ├── ConfirmationScreen.jsx
│   │       ├── ErrorBoundary.jsx
│   │       └── shared.jsx
│   └── vite.config.js           # outDir: ../public, emptyOutDir: false
├── public/
│   ├── index.html               # Mount React SPA (`#root`)
│   ├── admin.html               # 202KB (5028 linhas) — 13 views + 12 modais
│   ├── escala-spa.html          # 67KB (1345 linhas) — grid mensal 21→20, JWT sessionStorage
│   ├── spa-profile.html         # 28KB — anamnese (8 seções), canvas assinatura
│   ├── terapeuta.html           # 32KB — mobile PIN + agenda
│   ├── gestao-qualidade.html    # 28KB — proxy GQ dashboard
│   ├── acesso-hub.html          # 4KB — redirect SSO ao Hub
│   ├── js/
│   │   ├── admin.js             # 458KB (8922 linhas)
│   │   ├── shared-header.js     # 13KB — cabeçalho, dropdowns, tema, sair
│   │   └── spa-profile.js       # 62KB — anamnese lógica
│   ├── locales/                 # 7 JSONs (pt-BR, pt-PT, en, es, fr, it, de) — 126 linhas cada, paridade 100%
│   └── assets/                  # 53 fontes woff/woff2 (Cormorant Garamond, Inter, JetBrains Mono)
├── scripts/                     # 14 scripts (seed, migrar, reset, repopular, traduzir, test)
├── seed-data/receita-2026.json  # 24 preços + 5 faixas desconto + lançamentos de teste
├── Dockerfile                   # node:20-alpine + python3/make/g++ (compilar better-sqlite3)
├── fly.toml                     # GRU, 256MB, volume feedback_data → /app/data, health /api/health
├── .env.example                 # PORT, JWT_SECRET, ADMIN_USER, ADMIN_PASS, NODE_ENV
├── .github/workflows/           # fly-deploy.yml + deploy.yml (node --check + flyctl)
├── token_github.txt             # ⚠️ TOKEN FlyV1 REAL COMMITADO — REVOGAR e purgar do histórico
├── tempadm.html, tmpcss.txt, tmpjs.txt  # detritos temp no root — remover
└── CUsersestagio.tiAppData...anamnese.json  # arquivo com nome quebrado (Windows path glob) — checar
```

---

## 2. src/server.js — Cadeia HTTP

**Middlewares em ordem** (linhas 65–283):
```
trust proxy 1 (L69) → helmet+CSP (L70-83) → cors() SEM ORIGEM (L84 ⚠️) → express.json {limit:2mb} (L85)
→ JSON parser error handler (L88-93) → SPA gate (L120-125) → static /public (L127)
→ /api auditMiddleware (L235) → 12 routers (L237-283) → error handler 500 (L381-387)
```

**CSP diretivas** (server.js:71-82):
```
defaultSrc 'self'
scriptSrc  'self' 'unsafe-inline'       ⚠️ (inline scripts em várias .html)
styleSrc   'self' 'unsafe-inline' fonts.googleapis.com
fontSrc    'self' fonts.gstatic.com
imgSrc     'self' data: letsimage.s3.amazonaws.com
connectSrc 'self'
frameSrc   'none'      objectSrc 'none'
```

**Rotas públicas (SPA gate `isPublicPath` L98-119):** `/api/*`, `/assets/*`, `/locales/*`, `/js/*`, `/sso`, `/acesso-hub.html`, `/spa-profile.html`, `/terapeuta*`, `/`, `/index.html`, `/favicon.*`, `/health`
**Autenticadas:** qualquer outra rota exige cookie `spa_admin_sess` ou `spa_user_sess`

**Routers montados:**
| Prefixo | Módulo | Linha |
|---|---|---|
| /api/spa | spa.js | 237 |
| /api/relatorios | relatorios.js | 238 |
| /api/survey, /api/qualidade | qualidade.js | 242-243 |
| /api/feedback | feedback.js | 244 |
| /api/auth | auth.js | 245 |
| /api/clientes | clientes.js | 246 |
| /api/auditoria | auditoria.js | 247 |
| /api/terapeuta | terapeuta.js | 248 |
| /api/gq | gq.js | 251 |
| /api/reservas | reservas.js | 253 |
| /api/admin/salas | salas.js | 254 |
| /api (fallback) | cadastros.js | 283 |

**SSO /sso (L285-367):** verifica `jwt.verify(sso_token, SSO_SECRET)` → decide role via allowlist `SPA_ADMIN_EMAILS` → `payload.site_roles['pesquisa-satisfacao']` → `payload.sites_admin` → `role='user'`. Terapeuta separado (cookie `spa_terapeuta_sess` 12h). Admin/user cookie 8h. Auditoria + redirect `?theme=` preservado.

**Boot (L389-400):** `PORT || 3000`, `0.0.0.0`, `initDb()` + seed idempotente (Qualidade, Anamnese, Receita). **SIGTERM não tratado.**

**Env vars usadas mas AUSENTES no .env.example:** `SSO_SECRET`, `ANTHROPIC_API_KEY`, `MYMEMORY_EMAIL`, `SPA_ADMIN_EMAILS`, `CONSENT_HMAC_SECRET`, `CONSENT_HMAC_SECRETS_LEGACY`, `HUB_URL`.

---

## 3. src/db.js — Schema

**PRAGMAs (getDb L13-20):** `journal_mode=WAL`, `foreign_keys=ON`. Sem `synchronous` explícito.
**Path:** `path.join(__dirname, '..', 'data', 'feedback.db')`.
**Estilo migração:** aditiva, idempotente (`ALTER TABLE ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `try/catch`). Sem `schema_version`.

### 24 tabelas principais

| # | Tabela | Linha CREATE | Uso |
|---|---|---|---|
| 1 | feedback | 26 | Respostas legadas da pesquisa (compat) |
| 2 | massagistas | 58 | Profissionais + `padrao_entrada` JSON + `pin_hash` |
| 3 | tipos_massagem | ~67 | Catálogo de terapias |
| 4 | admin_users | 75-80 | Usuários admin (bcrypt, roles master/admin/spa/satisfacao/normal) |
| 5 | reservas | 82 | Agendamentos SPA (24 colunas incl. pessoa 2 casal) |
| 6 | spa_perfis | 110 | Anamnese/perfil legado (migrado para clientes) |
| 7 | survey_tokens | ~145 | Tokens de pesquisa por pessoa (idempotente, `liberada_em`) |
| 8 | turno_massagista | 178 | Escala mensal (UNIQUE massagista_id + data) |
| 9 | padrao_entrada_log | 188-195 | Auditoria de mudança em padrão semanal |
| 10 | turno_historico | 197-205 | Auditoria célula a célula |
| 11 | anamnese_auditoria | 250-265 | Log de ações em anamnese |
| 12 | receita_lancamentos | 277 | Receita por mês/massagista/terapia + faixa desconto |
| 13 | comissao_config | ~300 | base_rate + tiers (id=1 CHECK) |
| 14 | pesquisa | ~309 | Surveys (spa-locc-v1, spa-anamnese-v1) |
| 15 | pesquisa_secao | ~320 | Seções da pesquisa |
| 16 | pergunta_satisfacao | ~330 | Biblioteca de perguntas |
| 17 | pesquisa_pergunta | ~350 | Associação pergunta↔pesquisa (com ordem, obrigatoria) |
| 18 | escala_semanal, escala_opcao, escala_opcao_traducao | 310-323 | Escalas de resposta |
| 19 | pergunta_opcao(_traducao) | ~370 | Opções + i18n |
| 20 | pergunta_traducao, pesquisa_secao_traducao | ~380 | I18n |
| 21 | resposta_pesquisa, resposta_item | ~410 | Respostas estruturadas (cliente_id, reserva_id, feedback_id, app_origem) |
| 22 | meta_pergunta, meta_questionario | ~440 | Metas (media, pct_recomenda) |
| 23 | clientes | 453 | Cadastro central (cpf/passaporte UNIQUE) |
| 24 | cliente_produto | ~470 | Produtos por cliente (ON DELETE CASCADE) |
| 25 | auditoria | 506-524 | Log geral (ator_username, rota, acao, recurso_id, sucesso, detalhes) |
| 26 | salas | 709-715 | 5 salas seeded (1-4 individual, 5 "Espaço Beleza") |
| 27 | sala_bloqueios | 717-725 | Bloqueios de manutenção (idx composto) |
| 28 | ferias_massagista | ~995 | Períodos de férias |
| 29 | quartos | ~630 | Categoria (gran_class detection) |

**Índices (18 core):** `idx_feedback_submitted`, `idx_feedback_origem`, `idx_reservas_data`, `idx_reservas_sala_data`, `idx_reservas_massagista`, `idx_reservas_cliente`, `idx_reservas_cpf`, `idx_survey_tokens_token UNIQUE`, `idx_spa_perfis_cliente`, `idx_spa_perfis_reserva_pessoa`, `idx_massagistas_email UNIQUE`, `idx_clientes_cpf UNIQUE`, `idx_clientes_passaporte UNIQUE`, `idx_clientes_nome`, `idx_pesquisa_slug_ativo UNIQUE WHERE ativo=1`, `idx_resposta_pesquisa (pesquisa_id, submitted_at)`, `idx_resposta_pesquisa_app`, `idx_resposta_item_resp`, `idx_pergunta_opcao_perg`, `idx_cliente_produto_cli`, `idx_quartos_andar`, `idx_quartos_categoria`, `idx_auditoria_data`, `idx_auditoria_ator`, `idx_auditoria_recurso`, `idx_auditoria_acao`, `idx_turno_hist_cell`, `idx_sala_bloqueios_sala (sala, data_inicio, data_fim)`, `idx_receita_lanc_ano_mes`, `idx_receita_lanc_mass`.

**Migração especial `sala CHECK`** (L532-558): usa `writable_schema=1` + reescreve `sqlite_master` + `integrity_check` (SQLite não suporta ALTER TABLE de CHECK).

**Backfills no boot:** pessoa=2 para registros com `documento_perfil_id2` (L573); consentimento_saude versão='desconhecida' + em=criado_em para legado (L619); funcao='Massoterapeuta' para NULL/vazio (L162).

**Seed users admin (L637-655):** todos com role `master` exceto `spa@granmarquise.com.br` (role `spa`). Bcrypt cost=10.
**Seed massoterapeutas (L875-898):** Germana, Isadora, Karoline, Ana Cristina, Valderlânia, Mayara (com matrícula, especialidade, vínculo Pleno/Part Time, bilingue).
**Seed comissao_config:** base_rate 0.10, tier ≥8.5→+5% ("+5% por excelência ≥94%"), tier ≥7.5→+2% ("+2% por bom desempenho ≥83%").

---

## 4. src/db.js — Funções por Domínio

### 4.1 Reservas (foco principal)

Tabela `reservas` (L82-95): 24 colunas — `sala CHECK 1-5`, dados pessoa 1 + pessoa 2 (casal), `documento_perfil_id[2]` (link anamnese), `documento_token[2]`, `idioma[2]`, `passaporte`, `criado_por`, `cliente_id`, `cpf`, `quarto`.

| Função | Linha | Descrição |
|---|---|---|
| `listarReservasMassagistaData(mid, data)` | 1154-1158 | Reservas do dia por massagista (posição 1 ou 2) |
| `listarReservasSemana(from, to)` | 1637 | JOIN massagistas + quartos, campo nome/nome2 |
| `listarTodasReservas({from,to,sala,salas[],busca,massagista_id,limit,offset})` | 1650 | COUNT + paginação + campo `respondeu_pesquisa` via subquery `survey_tokens` |
| `inserirReserva(sala, cliente, ..., opts)` | 1690-1775 | **Core.** 3 validações críticas: SALA_BLOQUEADA (L1700-1708), CONFLITO_SALA (L1715-1733, salas 3+4 casal share), CONFLITO_PROF 1+2 (L1737-1763). INSERT 24 params |
| `cancelarReserva(id)` | 1777 | DELETE (retorna changes) |
| `buscarReservaById(id)` | 1781 | LEFT JOIN massagistas 1+2 |
| `buscarReservaDetalhe(id)` | 1798 | Compõe: reserva + survey_tokens + spa_perfis + feedback (fallback por email) |
| `criarSurveyToken(rid, pessoa, ativar)` | 1893 | Idempotente. Casal: `ativar=false` (admin ativa manualmente) |
| `listarReservasDaTerapeuta(mid, {from,to})` | 2912 | Agenda mobile |
| `atualizarSalaReserva(reservaId, novaSala)` | 3053 | Re-valida bloqueio + conflito; UPDATE reservas |
| `statusPesquisaPessoa(id, pessoa)` | ~2350 | {respondida, feedback_id} usado no polling 3s casal |
| `gerarDocumentoToken(id, pessoa)` | ~2400 | Token anamnese com expiry = hora_fim + fallback 48h |
| `vincularDocumentoToken(reserva_id, locale)` | ~2410 | Marca token como consumido |
| `buscarDocumentoToken(t)` | ~2420 | Resolução token → reserva |

**Validação sobreposição (L1718):** `NOT (hora_fim <= ? OR hora_inicio >= ?)`
**Regra casal (L1715-1727):** salas 3 e 4 compartilham espaço físico apenas se `cliente2 != null`.
**Estados turno (L1086-1090):** X folga, FE férias, AT atestado, AA afastamento, CF comp. feriado, CH comp. hora, LS licença sindical, LC licença casamento, F falta.
**Jornada default:** entrada + 8h20min, teto 22:00.

### 4.2 Salas

Tabela `salas` (L709-715): id, nome, tipo (individual/conjugada/beleza/evento), ativa, observacao. 5 salas seeded (Salas 1-4 individual + Sala 5 "Espaço Beleza" beleza).
Tabela `sala_bloqueios` (L717-725): sala CHECK 1-5, data_inicio, data_fim, motivo, bloqueado_por, criado_em.

| Função | Linha |
|---|---|
| `listarSalas()` | 2953 |
| `buscarSalaById(id)` | 2957 |
| `atualizarSala(id, {nome,tipo,observacao})` | 2961 (UPDATE dinâmico) |
| `listarBloqueiosSala(sala, {from,to})` | 2975 |
| `criarBloqueioSala({sala,data_inicio,data_fim,motivo,bloqueado_por})` | 2999 |
| `removerBloqueioSala(id)` | 3006 |
| `listarSalasDisponiveis({data,hora_inicio,hora_fim,excluirSalas})` | 3028-3049 |
| `listarReservasNoBloqueio(sala, di, df)` | 3013-3024 |
| `atualizarSalaReserva(reservaId, novaSala)` | 3053-3072 |

Sem vínculo direto sala↔massagista.

### 4.3 Escala / Turnos

Tabela `turno_massagista` (L178-186): UNIQUE (massagista_id, data). Formatos: `HH:MM` ou `HH:MM|HH:MM` ou status.
Tabela `turno_historico` (L197-205): antes, depois, usuario, origem (`manual`, `aplicar-padrao`).
Coluna `massagistas.padrao_entrada` TEXT JSON: `{seg:"10:00", ter:"10:00", ...}` ou `"FOLGA"`.
Tabela `padrao_entrada_log`: auditoria.

| Função | Linha |
|---|---|
| `listarTurnosPeriodo(ano, mes)` | 1023-1031 (período 21→20) |
| `upsertTurno(mid, data, turno)` | 1033-1036 (INSERT ON CONFLICT DO UPDATE) |
| `deletarTurno(mid, data)` | 1038-1041 |
| `buscarTurno(mid, data)` | 1043-1045 |
| `registrarTurnoHistorico(...)` | 1047-1050 |
| `listarTurnoHistorico(mid, data)` | 1052-1055 (top 50 DESC) |
| `listarTurnosDia(data)` | 1071-1072 |
| `contextoEscalaDia(data)` | 1075-1083 (turnos + férias) |
| `avaliarEscalaMassagista(...)` | 1096-1151 (fonte: mensal → ferias → padrao → sem-escala) |
| `setPadraoEntrada(id, padrao)` | 911-913 |
| `seedPadraoEntrada()` | 931-952 (por matrícula fixa) |

**Período 21→20:** `dataIni = ${ano}-${mes+1}-21`, `dataFim = ${a2}-${m2+1}-20`. Ex: nov→dez = 2026-12-21 → 2027-01-20.
**Reserva ↔ turno:** avaliação sem constraint BD. Se `override_escala=true`, backend aceita fora do turno.

### 4.4 Clientes / Anamnese

| Função | Linha |
|---|---|
| `validarCpfMod11(cpf)` | 2557 |
| `validarPassaporte(p)` | 2572 (`^[A-Z0-9]{5,20}$`) |
| `inserirCliente({cpf?, passaporte?, nome, ...})` | 2621 (upsert por cpf/passaporte) |
| `atualizarCliente(id, {...})` | 2641 |
| `buscarCliente360(id)` | 2663 (reservas + anamneses spa_perfis + resposta_pesquisa spa-anamnese + pesquisas satisfação + dedup casal) |
| `inserirSpaPerfil(dados)` | 2218 (upsert por reserva_id+pessoa; 12 campos LGPD consentimento) |
| `inserirSpaPerfilComLock(dados)` | 2323 (BEGIN IMMEDIATE + UPDATE gate único; erro `ANAMNESE_JA_RESPONDIDA`) |

**Preservação data jurídica (L2280):**
```sql
consentimento_saude_em = CASE WHEN hash antigo = hash novo THEN preservar ELSE atualizar END
```

### 4.5 Massagistas / Auditoria / Feedback

- `buscarMassagistaPorNome(nome)` L2896 — retorna pin_hash apenas aqui (whitelist)
- `setMassagistaPinHash(id, hash)` L2907 — bcrypt cost 10
- `listarMassagistas()` L903 — **nunca** retorna pin_hash (auditoria 2026-06-25 confirma)
- `inserirMassagista()` L973, `atualizarMassagista()` L980, `deletarMassagista()`
- `criarFeriasMassagista({data_inicio, data_fim, obs})` L998, `feriasConflito()`
- `inserirFeedback(dados)` L753-772 (15 params)
- `listarFeedback({origem,tipo_cliente,from,to,massoterapeuta,limit,offset})` L779
- `statsFeedback({from,to})` L819-872 (mapping otimo=9, bom=6, regular=3, ruim=0)
- `logAuditoria(evt)` L2844-2867 — INSERT auditoria (11 campos)
- `listarAuditoria({from,to,ator,acao,recurso,sucesso})` L2869

---

## 5. src/qualidade.js — Engine de Pesquisas (57KB)

**Modelo:** pesquisa → secoes → pesquisa_pergunta → pergunta_satisfacao. Escalas: `4pt_qualitativa` (0,3,6,9), `sim_nao` (0,1). Tipos: escala, texto_livre, unica, multipla, sim_nao. Campo `mapeia_campo_legado` para retrocompat.

**Seed padrão `spa-locc-v1` v1:** 12 perguntas (7 qualitativas + recomenda + 4 textos) em 3 seções (Servicos, Instalacoes, Recomendacao).

**Funções principais:**
- `seedQualidadeSpa()` L23, `seedAnamneseSpa()` L152, `seedAnamneseOpcoes()` L984
- `publicarPesquisa(id)` L588 / `despublicarPesquisa(id)` L593 / `clonarPesquisa(...)` L602
- `inserirRespostaPesquisa({pesquisa_slug, pesquisa_versao, app_origem, cliente_id, reserva_id, feedback_id, itens})` L345 — upsert com `DELETE FROM resposta_item WHERE resposta_pesquisa_id=?` antes de INSERT
- `buscarPesquisaPublicada(slug, idioma)` L249, `listarPesquisasPublicadasPorApp(app)` L267
- `montarEstruturaPesquisaAdmin(slug, idioma)` L434 — fallback pt-BR
- CRUD: criar/editar Pesquisa L559-573, Secao L649-673, Pergunta L711/853/831, escalas L868, opcoes L947
- Metas: `salvarMetaPergunta({...})` L894, `salvarMetaQuestionario` L911, `aplicarMetasEmStats(slug, stats)` L401 (retorna `{atingido: true/false/null}`)
- Auditoria: `registrarHistoricoAnamnese({usuario, acao, entidade, dados_antes, dados_depois})` L725, `listarHistoricoAnamnese` L793

Cache: nenhum. Usa `db.prepare()` reutilizados.

---

## 6. src/routes/ — Todos os Endpoints

### 6.1 /api/reservas (`reservas.js`) — 10 endpoints
| Método | Path | Linha | Auth |
|---|---|---|---|
| GET | / | 15 | requireAuth |
| GET | /sem-pesquisa | 11 | requireAuth |
| GET | /historico | 21 | requireAuth |
| GET | /:id/detalhe | 47 | requireAuth |
| GET | /:id/status-pesquisa-casal | 437 | requireAuth (cache no-store) |
| POST | / | 89 | requireSpa+requireWrite |
| POST | /:id/liberar-pesquisa | 387 | requireSpa+requireWrite |
| POST | /:id/pessoa/:pessoa/ativar-pesquisa | 420 | requireSpa+requireWrite |
| POST | /:id/gerar-ficha | 450 | requireSpa+requireWrite |
| DELETE | /:id | 509 | requireSpa+requireWrite |

**POST / criar (L89-385):** ~10 validações — campos obrigatórios, quarto (hospede), telefoneValido, horário 09:00-22:00, data≥hoje (Fortaleza), escala (override_escala flag), CPF/passaporte, pessoa 2 (salas 3-4, mass≠mass2, doc≠doc2). Upsert cliente. `inserirReserva()` com validação SALA_BLOQUEADA/CONFLITO_SALA/CONFLITO_PROF. Response `{ok, id, cliente_id, quarto, gran_class}`. Logging sanitizado sem CPF/passaporte.

**POST /:id/gerar-ficha (L450):** janela `hora_inicio + 10min` (409 `tempo_expirado`). Casal gera 2 tokens; individual 1. Response `{ok, casal, hospede1/2:{nome,telefone,token,url:'spa-profile.html?t=...'}}`

### 6.2 /api/admin/salas (`salas.js`) — 9 endpoints
| Método | Path | Linha |
|---|---|---|
| GET | / | 19 |
| PUT | /:id | 35 |
| GET | /:id/bloqueios | 51 |
| GET | /:id/bloqueios/check | 65 |
| POST | /:id/bloqueios | 83 |
| DELETE | /bloqueios/:bloqueioId | 130 |
| GET | /disponiveis | 146 |
| POST | /:id/bloqueios/:bloqueioId/transferir | 160 |
| PUT | /reservas/:id/sala | 196 |

**POST bloqueios (L83):** se reservas existem e `confirmar!==true` → 409 `reservas_no_periodo`. `bloqueado_por` extraído do JWT `spa_admin_sess`.
**POST transferir (L160):** loop reservas → `listarSalasDisponiveis` excluindo sala bloqueada → `atualizarSalaReserva`. Response `{transferidas, sem_disponibilidade, resultados[]}`.
Erros: `CONFLITO_SALA` 409, `SALA_BLOQUEADA` 409, `NOT_FOUND` 404.

### 6.3 /api (cadastros.js) — 26 endpoints (foco: massagistas, escala, tipos, comissão)

| Método | Path | Linha |
|---|---|---|
| GET | /massagistas | 34 |
| GET | /massagistas/padroes | 37 |
| POST | /massagistas | 41 (requireSpa+Write) |
| PUT | /massagistas/:id | 57 |
| PUT | /massagistas/:id/padrao | 74 (valida 7 dias, `null` / `'FOLGA'` / `HH:MM`) |
| GET | /massagistas/:id/historico | 94 |
| GET | /massagistas/:id/receita | 106 |
| DELETE | /massagistas/:id | 114 |
| GET/POST/PUT/DELETE | /massagistas/:id/ferias[/:fId] | 121/127/141/157 |
| POST | /massagistas/:id/pin | 165 (bcrypt) |
| GET/PUT | /comissao/regras | 180/183 |
| GET/POST/PUT/DELETE | /tipos-massagem[/:id] | 194/196/203/211 |
| **GET** | **/escala-spa?ano&mes** | **235** |
| **PUT** | **/escala-spa/:mId/:data** | **246** — valida `turnoValido`, `dataRealValida`, retorna `reservas_conflitantes[]` |
| DELETE | /escala-spa/:mId/:data | 285 |
| GET | /escala-spa/disponibilidade?data&hora_inicio&hora_fim | 300 |
| GET | /escala-spa/historico/:mId/:data | 321 |
| POST | /escala-spa/aplicar-padrao | 329 — período 21→20, `preview` flag |
| POST | /escala-spa/cf-acumulado | 380 |

### 6.4 /api/clientes (`clientes.js`) — 11 endpoints (todos requireAuth+requireSpa exceto writes)
- GET / (busca) L94
- GET /buscar (por CPF/passaporte) L102
- GET /:id (Cliente 360) L119 — no-cache
- GET /anamnese/:perfilId L134 — whitelist campos + extras enriched
- **GET /anamnese/:perfilId/prova-consentimento** L322 — **master only + audit**. Integridade: `hmac-sha256-composto-v1` (composto texto+doc+reserva_id+ass_hash+data) e `hmac-sha256-v1`. Estados: 'integro'/'adulterado'/'legado-sem-prova'/'sem-consentimento'/'chave-desconhecida'. Cross-canonico: 'bate'/'diverge'/'sem-canonico'
- GET /pesquisa/:respostaId L423 (enriquecido rotulos)
- POST / L448, PUT /:id L456, POST /:id/produtos L464, PUT /produtos/:pid L470, DELETE /produtos/:pid L476

### 6.5 /api/feedback (`feedback.js`) — 4 endpoints (POST público rate-limited)
- POST / L40 — **rateLimit 5/10min** (memória). Validação: notas otimo/bom/regular/ruim, extras chave `^[a-z0-9_]{1,64}$`, max 60 extras, max 4000 chars texto, max 50 opções. Chama `inserirFeedback + marcarSurveyTokenRespondido + inserirRespostaPesquisa`. HTTP 201 + `{ok, id}`
- GET / L237, GET /stats L253 (aplica metas), GET /item/:id L264 (com extras)

### 6.6 /api/spa (`spa.js`) — 4 endpoints (públicos com token)
- GET /documento?t L226 (410 se expirado, 409 se ja_respondida)
- GET /historico L263 (por CPF/passaporte/email/token)
- **POST /perfil L343** — validação HMAC-SHA256 composto v1, keyring `CONSENT_HMAC_SECRET` + `CONSENT_HMAC_SECRETS_LEGACY`. Texto normalizado NFC+trim+remove zero-width. Assinatura PNG base64 max 500KB. Chama `inserirSpaPerfilComLock` (transação) + `inserirRespostaPesquisa` (slug `spa-anamnese-v1`, app_origem `spa-anamnese` ou `spa-anamnese-p2`). Erro 409 `ja_respondida`.
- GET /anamnese/config?idioma L544 (cache no-store)

### 6.7 /api/terapeuta (`terapeuta.js`) — 7 endpoints
- GET /nomes-ativos L20 (público)
- POST /login L26 — bcrypt.compare, cookie `spa_terapeuta_sess` (JWT 12h)
- POST /logout L50
- GET /me L55, /escala?from&to L64, /agenda?from&to L92, /atendimento/:id L102 — **IDOR safe:** escopado ao `req.user.massagista_id` do token, query params ignorados

### 6.8 /api/qualidade + /api/survey (`qualidade.js`) — ~35 endpoints
- Público: /config, /published
- requireAuth: /admin/pesquisas, /admin/perguntas, /admin/escalas, /admin/metas, /admin/visao-geral, /admin/anamnese/historico, /admin/perguntas/:id/opcoes
- **writeChain** (requireAuth+requireSatisfacao+requireWrite): CRUD completo de pesquisa/secao/pergunta/opcao/escala/meta + publicar/despublicar/clonar
- POST /admin/traduzir (Anthropic + MyMemory)

### 6.9 /api/gq (`gq.js`) — 3 endpoints (requireAuth+requireSatisfacao)
- GET /stats?slug&from&to&tipo&origem&massagista L38 — 8 prepared stmts, timezone -3h Fortaleza
- GET /respostas?slug&from&to&q&tipo&origem&page&limit=100 L195
- GET /resposta/:id L262

### 6.10 /api/auth (`auth.js`) — 5 endpoints
- POST /login L20 — 500ms delay em failure (timing-attack mit.), cookie `spa_admin_sess` (JWT 12h, HttpOnly, SameSite=Lax, Secure em prod)
- GET /usuarios L48 — SSO Hub prioritário (`HUB_URL/api/hub/site-admins?sistema_id=pesquisa-satisfacao` com `SSO_SECRET`) → fallback local
- POST/PUT/DELETE /usuarios L75/90/109 — requireMaster, sem self-delete, preserva último master

### 6.11 /api/auditoria (`auditoria.js`) — 2 endpoints (requireMaster)
- GET / (com filtros), GET /recursos

### 6.12 /api/relatorios (`relatorios.js`) — 2 endpoints (requireSatisfacao)
- GET /mensal?ym L9, GET /cruzamento?from&to&status L19

---

## 7. src/middleware/

**auth.js (6 middlewares):**
| Middleware | L | Regra |
|---|---|---|
| requireAuth | 10 | Bearer `Authorization` OU cookies `spa_admin_sess`/`spa_user_sess`; `jwt.verify(JWT_SECRET)`; injeta `req.user` |
| requireMaster | 27 | role === 'master' |
| requireWrite | 36 | roles `master`, `spa`, `satisfacao` (bloqueia `admin` read-only) |
| requireSpa | 43 | `master`, `spa`, `admin` |
| requireSatisfacao | 50 | `master`, `satisfacao`, `admin` |
| requireTerapeuta | 59 | cookie **isolado** `spa_terapeuta_sess`, role='terapeuta', `massagista_id` obrigatório |

**audit.js (L74 auditMiddleware):**
- Captura POST/PUT/DELETE apenas
- Ignora rotas ruidosas: health, auditoria, feedback/stats, survey/live, massagistas-ativas, tipos-massagem-ativos, escala-spa/cf-acumulado
- IP via `x-forwarded-for` ou `req.ip`
- Actions mapeadas: `liberar_pesquisa`, `gerar_ficha_anamnese`, `publicar_pesquisa`, `salvar_anamnese`, `aplicar_padrao_escala`, `login`, `reset_demo`; fallback `criar/atualizar/remover_[recurso]`
- **Fail-safe:** nunca bloqueia response; erro silencioso apenas `console.error`
- Body sanitizado (max 2KB, remove senha/token)

---

## 8. src/utils/

**detectarIdioma.js (701B):** `detectarIdioma(textos)` L5. Modelo `claude-haiku-4-5-20251001`, maxTokens=8. `catch` silencioso → null. Sem retry/cache. Env: `ANTHROPIC_API_KEY`.

**traduzir.js (3.6KB):** `traduzirParaTodos(ptBR, idiomas)` L69. MyMemory API `https://api.mymemory.translated.net/get`, User-Agent `PesquisaSatisfacaoSPA-GranMarquise/1.0`. 2 tentativas (12s→18s), 400ms delay. Env: `MYMEMORY_EMAIL` (fallback `caiobholanda2007@gmail.com` — ⚠️ hardcoded). Fallback silencioso: retorna original.

---

## 9. Frontend React (`frontend/src/`)

**App.jsx:** state machine welcome→form→confirm. Token via `?token=XYZ` → `GET /api/survey/{token}` valida. Sem token: polling 1s `/api/survey/live`. Timer 15min. Tema `localStorage.gm-theme`.

**FormScreen.jsx (32KB):** state: fields (nome, apto, email, tel, tratamento, massoterapeuta), ratings (s0-s3, f0-f2 — 7 obrigatórios), comentarioServicos, comentarioInstalacoes, recommend, recommendText, clientType, extras (pelo admin), fills (progress bar). Validações: email regex, tel `^[\d\s\-\+\(\)]{6,20}$`, ratings obrigatórios, extras obrigatórias. `carregarConfig(idioma)` fetch `/api/survey/config?slug=spa-locc-v1&idioma=X`. Fallback pt-BR hardcoded. Easter egg todos "otimo" → mensagem especial.

**index.css (16KB) — Design Tokens:**
```
--gold: #9C5843 (light) / #C4916A (dark)
--bg: #ECE4D2 / #202C28; --bg-alt, --bg-surf; --fg #1A1A1A / #ECE4D2
--fg-warm #8A7B6A; --err #B85450
Fonts: JetBrains Mono (mono/timer), Cormorant Garamond, Inter
Transition: cubic-bezier(0.16, 1, 0.3, 1) — ease-spa
Tema: [data-theme="dark"], animação 600ms
```

**Vite:** `outDir: '../public'`, `emptyOutDir: false` (não apaga admin.html, etc). Assets `frontend build` → `public/assets/`.

---

## 10. Public HTMLs

### 10.1 admin.html (202KB, 5028 linhas) — 13 Views + 12 Modais

**Views (linha + id + título):**
| # | Linha | ID | Título |
|---|---|---|---|
| 1 | 3431 | view-main | Painel Principal (KPIs + tabela) |
| 2 | 3555 | view-massagistas | Profissionais |
| 3 | 3582 | view-tipos | Tipos de Tratamento |
| 4 | 3640 | view-historico | Histórico Profissional |
| 5 | 3659 | view-reservas | **Reservas de Salas (calendário)** |
| 6 | 3727 | view-qualidade | Gestão da Qualidade (3 abas) |
| 7 | 3848 | view-clientes | Clientes 360 |
| 8 | 3885 | view-historico-clientes | Histórico de Atendimentos |
| 9 | 4002 | view-anamnese-editor | Editor Anamnese |
| 10 | 4042 | view-pesquisa-editor | Editor Pesquisa |
| 11 | 4071 | view-auditoria | Auditoria |
| 12 | 4154 | view-usuarios | Usuários |
| 13 | 4773 | **view-salas** | **Gestão de Salas** |

**⚠️ `view-escala` foi REMOVIDA** (admin.js:172-174): sessões antigas com `_vst.view='view-escala'` são redirecionadas para `view-reservas`. Escala mensal vive apenas em `/escala-spa.html`.

**Header/Nav (shared-header.js):**
- Dropdown SPA (L103-110): Profissionais, Tratamentos, Escala de Trabalho (link para /escala-spa.html)
- Dropdown Administrativo (L111-122): Relatórios, Qualidade, Editor Anamnese, Editor Pesquisa, Clientes 360, Usuários, Gestão de Salas
- Data/hora Fortaleza (`#gm-datahora` — 30s), Tema (`#btn-theme`), Sair (`#btn-sair-hub`)

**Modais (12):**
| Modal | Linha | ID | Finalidade |
|---|---|---|---|
| Nova Reserva | 4234 | res-modal-overlay | Criar reserva (cliente 1+2, sala, horário, tratamento, massagista) |
| Detalhes Reserva | 4534 | resdet-overlay | Ver + Cancelar / Ficha / Liberar Pesquisa |
| Editar Sala | 4906 | modal-sala-edit | Nome/Tipo/Obs |
| Bloquear Sala | 4940 | modal-sala-bloqueio | data_inicio/data_fim/motivo |
| Conflito Reservas | 4974 | modal-bloqueio-conflito | Transferir auto / Manual / Cancelar |
| Transferir Manual | 4992 | modal-reserva-manual | Escolher nova sala p/ reserva |
| Lista Bloqueios | 5015 | modal-lista-bloqueios | Histórico bloqueios sala |
| Conflito Horário | 4511 | conflito-overlay | Escolher outro horário |
| Confirmação Genérica | 4742 | confirm-modal-overlay | Título/msg/OK/Cancelar (perigoso=true) |
| Gerenciar Profissional | 4560 | mgmt-m-overlay | Férias + admin massagista |
| PIN Mobile | 4626 | mgmt-pin-overlay | Gerar/consultar PIN |
| Datepicker | 3678 | (dp custom) | Seleção de data |

**CSS:** ~4900 linhas embedded (nenhum arquivo externo). Design tokens `--gold`, `--bg`, `--surface`, `--border`, `--muted`, `--danger`, `--success`, `--indigo`, `--sala-s1..s5`. Media queries 960/700/480/860/1100px. Animações `fadeUp .35s`, `syncPulse 2s`.
**Scripts:** shared-header.js (bloqueia parse — sem defer), admin.js?v=101 (idem). Google Fonts: Inter, DM Sans, JetBrains Mono.
**Tema:** script inline (L10-35) **ANTES** do CSS: `?theme=` → `localStorage.spa_theme` → `prefers-color-scheme` → `data-theme="dark"` no `<html>`.

### 10.2 escala-spa.html (67KB, 1345 linhas) — Escala Mensal Standalone

**Layout:** grid mensal 21→20 (60 dias). Coluna Profissional 200px sticky + 31 colunas dia 44px. Altura linha 48px, header 54px.

**Auth (L644-650):** `sessionStorage.getItem('granspa_token')` → `Authorization: Bearer`. 401 → redirect `/acesso-hub.html`. `credentials: 'include'`.

**State (L707-718):** `periodo{ano,mes}`, `profs[]`, `turnos{"${mid}-${data}": turno}`, `cfAcumulado{}`.
**Boot (L1342):** `loadData()` → `GET /api/escala-spa?ano&mes`.

**Render (L872-956):** `render()` → 60 cabeçalhos de dia com classes `.wk` `.fer` `.hoje`, grupos "Recepcionistas" vs "Massoterapeutas". Cada linha: `cell-prof` sticky + 60 `cell-d`.

**Códigos status (L698-704):** X FE AT AA CF CH LS LC F. **Horários composite (L685-696):** 10 entradas (09:00–17:30). Cálculo saída `entrada + 8h20min`, teto 22:00 (L739). Formatos armazenados: `HH:MM` ou `HH:MM|HH:MM`.

**Edição inline (L978-1044):** click cell → `showPicker()` → escolha (entrada ou status) → optimistic update + PUT `/api/escala-spa/:mid/:data` (L824-826). Se turno vazio → DELETE (L822). `setSaveInd('saved')`.

**Conflitos com reservas (L616-628, L835):** se response `reservas_conflitantes[]` → modal alerta "salvou mas há reservas fora da escala".

**Histórico célula (L1078-1118):** `GET /api/escala-spa/historico/:mid/:data` → popover cronológico `antes → depois · timestamp · usuario · origem` (manual vs aplicar-padrao).

**Aplicar padrão (L1196-1226):** modal confirmação → POST `/api/escala-spa/aplicar-padrao` `{ano, mes, sobrescrever}` → toast "✓ N célula(s) preenchidas".

**CF acumulado (L797-804):** POST `/api/escala-spa/cf-acumulado` `{datas:[allFeriados]}` → `{cf: {mid: N}}`. Badge azulado no nome do prof.

**Tema:** todas siglas monocromáticas verdes (#15705A light, #4dbe8a dark). `.wk-bg` (roxo leve), `.fer-bg` (laranja), `.hoje-bg` (verde). Feriado dot dourado no header do dia com tooltip.

### 10.3 spa-profile.html + spa-profile.js (28KB + 62KB)

**8 seções:** Dados Pessoais (nome, doc CPF/Passport, email, tel, dob, quarto) · Rotina Facial (pills) · Rotina Corporal (pills + texto livre) · Preferência Pressão (leve/média/forte) · Info Médica (textarea obrigatória) · Aviso LGPD · Consentimentos (saúde obrigatório + marketing canais email/sms/whatsapp) · Assinatura (canvas).

**Fluxo:**
1. Token `?t=` → `GET /api/spa/documento?t=TOKEN` (expirado 410, ja_respondida 409)
2. Pré-preenchimento (dados hospede) + pré-preenchimento histórico via `/api/spa/perfil-historico?t=TOKEN` (nunca assinatura/info_medica)
3. Validação: nome, sobrenome, doc (CPF mod11 ou passaporte regex), email regex, tel BR-DDD ou E.164, quarto (lista 230), consentimento saúde ✓, canvas assinado
4. POST `/api/spa/perfil` (13 campos + LGPD)
5. Estados finais: `spa-expired`, `spa-already-answered`

**I18n:** 7 idiomas via `/locales/{lang}.json?v=2`. Persistência `localStorage.spa_lang` (try/catch iOS Safari). Fallback pt-BR com backoff 600ms × 3.

**localStorage:** apenas idioma. Sem auto-save de respostas (segurança).

### 10.4 Outros HTMLs
- **terapeuta.html (32KB):** header sticky + sidebar left (210px desktop). Fetch `/api/terapeuta/me` → login redirect. `/api/terapeuta/agenda?from&to` + `/api/terapeuta/escala?from&to`. Sheet modal com detalhe + `/api/terapeuta/atendimento/:id`. Tags `tx-tag quarto`, `granclass`, `respondida ✓`. Logout POST.
- **gestao-qualidade.html (28KB):** proxy dashboard. `GET /api/gq/stats + /api/gq/respostas`. Período default 30 dias. Chips filtros removíveis. "Ver" abre `admin.html#resposta-{id}`. Sem Chart.js — barras HTML/CSS puras.
- **acesso-hub.html (4KB):** card centrado, botão redirect a `https://hub-granmarquise.fly.dev` (hardcoded).
- **index.html (1.3KB):** `<div id="root"></div>` + build assets versionados. Fallback noscript.

---

## 11. public/js/admin.js (8922 linhas, 458KB)

### Bootstrap (L1-800)
- **Storage:** `sessionStorage.granspa_token` (JWT), `sessionStorage._vst` (view state), `localStorage.spa_theme`
- **Estado global:** `_token`, `_offset`, `_total`, `_filters`, `_calWeekOffset`, `_calDiaSel`, `_modalOpen`, `_langSelected='pt-BR'`, `_massagistas`, `_tipos`, `_reservas`, `_salasData`, `_reservasConflito`, `_bloqueioConflito`, `_QUARTOS_MAP`, `_escalaAvalMap`, `_escalaAvalLancada`
- **Filtro role (L132-164) `aplicarRoleNaUI(role)`:**

| Role | podeSpa | podeSatisfacao | podeUsuarios | podeEscrever |
|---|---|---|---|---|
| master | ✓ | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ | ✗ read-only |
| spa | ✓ | ✗ | ✗ | ✓ |
| satisfacao | ✗ | ✓ | ✗ | ✓ |

- Roteamento hash-like via `_vst`: `showView(id)` esconde/mostra + salva state
- Toast `showToast(msg, 4000ms)` (L733-744) via `#_admin-toast`
- `confirmarAcao({titulo, mensagem, btnConfirmar, perigoso})` L2813-2842 — overlay backdrop-blur, Enter/Escape

### Módulo Reservas (L2400-4091)
- `loadReservas()` L2468: `GET /api/reservas?from=X&to=Y` (7 dias). SessionStorage `calOff, calDay`
- `renderCalDia()` L2595: grid slots 30min, 3 modos adaptativos (compacto/médio/completo). Cores por sala `.s1-.s5` via `CAL_ROOMS[]`. Gran Class badge `★ GC` box-shadow `#9C5843`. Casal badge `🤝 S3+4` split-view (sala 4). Anamnese badge `✓` ou `✓ 1/2` / `✓ 2/2`. Bloqueio `⛔ Bloqueada` dim
- `calOpenModal()` L2906: abre `#res-modal-overlay`. Fetch tratamento (L2409), massagistas (L2317), disponibilidade real-time (L3008-3038: `_atualizarDisponibilidadeSalas()` → `GET /api/admin/salas/disponiveis?data&hora_inicio&hora_fim`)
- **Escala:** `_fetchEscalaAval(data, hi, hf)` L2337 → `GET /api/escala-spa/disponibilidade` → `_escalaAvalMap.set(mid, {disponivel, fonte, motivo, faixa, aviso})`. Filtro `_escalaFiltra(m, ...)` L2359. Fail-open sem escala carregada. Aviso "⚠ Escala mensal não lançada" (L2370)
- **Combobox custom** cliente CPF/passaporte (`_cbInit` L2226), tratamento (categorias Combo/Massagem/Tratamento/Facial/Complementar), massagista (bilingue checkbox `#res-flt-bilingue`), nacionalidade
- **Casal (L2945-2953, L3807 `_syncCasalUI`):** checkbox `#res-chk-casal` só para salas 3/4. Validações espelhadas pessoa 2. Sala grava sempre 3 (espaço 3+4)
- **Conflito detect** L3242 `calDetectarConflito(sala, mid, data, hi, hf, exclId, novaCasal)`: retorna `{tipo, reserva}`
- **Salvar** L4045 `calSalvarReserva()`: POST `/api/reservas`. Trata 409 `escala` (prompt override), 409 `conflito` (modal L3267)
- **Cancelar** L2797 `calCancelar()`: DELETE. Bloqueia se hora_inicio + 30min já passou
- **Anamnese** L3619 `_executarEnvioAnamnese()`: POST `/api/reservas/:id/gerar-ficha`. Modal WhatsApp/Copiar link (L3681-3789). Cache local `documento_token[2]`, `documento_token_expiry` 48h
- **Liberar pesquisa** L888: POST `/api/reservas/:id/liberar-pesquisa`. Casal: L1035 POST `/pessoa/:n/ativar-pesquisa`. Polling casal L1000: 3s `GET /api/reservas/:id/status-pesquisa-casal` (para auto quando ambos respondem)

### Módulo Salas (L8556-8922)
- `loadSalas()` L8556, `renderSalas()` L8581: cards grid + stats (total/disponíveis/bloqueadas)
- Tipos (L8568-8578): individual/conjugada/beleza/evento
- Modal editar sala L8650-8679 (`#modal-sala-edit`): PUT `/api/admin/salas/:id`
- Modal bloqueio L8683-8732 (`#modal-sala-bloqueio`): POST `/api/admin/salas/:sala/bloqueios`. Se 409 `reservas_no_periodo` (L8719-8727): salva `_reservasConflito, _bloqueioConflito` e abre `#modal-bloqueio-conflito`
- Transferir auto L8757-8783: POST bloqueios com `confirmar:true` → POST `/bloqueios/:bId/transferir` → mostra `{transferidas, sem_disponibilidade}`
- Transferir manual L8801-8846: loop reservas → `GET /disponiveis?...&excluir=sala` → select nova sala → PUT `/api/admin/salas/reservas/:id/sala`
- Lista bloqueios L8850-8868, remover L8874-8882 (`DELETE /bloqueios/:id`)
- Desbloqueio rápido L8884-8901 (botão 🔓 no card)
- Delegação eventos L8906-8922: `data-action` switch (reload-salas, editar-sala, bloquear-sala, desbloquear-sala, lista-bloqueios, remover-bloqueio)

### Módulos Diversos

**Massagistas (L1312-1544):** `loadMassagistas()`, cards com stats (média + %recomenda), modal `openEditMassagista` (mgmt-m-*), férias `_loadFerias` L1412-1506 CRUD, PIN `openPinModal` L1512 POST bcrypt, receita `renderReceitaSection` L1697 (KPIs YTD + tabela mensal expandível por terapia + comissão base_rate + tiers). Copiar link mobile: `/terapeuta?nome=X`

**Tipos (L1560-1685):** `loadTipos`, abas Ativos/Inativos, form inline criar, modal editar (mgmt-t-*)

**Clientes 360 (L5073-5872):** `initClienteView` debounce 250ms. `loadClientesLista` `GET /api/clientes?q=`. 4 abas: Tratamentos/Anamneses/Pesquisas/Produtos. `_abrirModalAnamnesePreenchida(perfilId)` L5278 helpers `linhaCampo/Lista/Bool/secaoTitulo`. Consentimento LGPD verde/vermelho. Produtos CRUD

**Histórico atendimentos (L4792-4869):** `loadHistoricoClientes` `GET /api/reservas/historico?offset`, filtro client-side `hc-status`, KPIs `_hcAtualizarKPIs`

**Qualidade (L4129-4543):** `loadQualidade` seleciona pesquisa (versão + slug) → `loadQualidadeVisao` `GET /api/qualidade/admin/visao-geral`. Editor pesquisa L4296 CRUD perguntas via prompt (chave/tipo/rotulo/escala_id). Escalas via `btn-qb-nova-esc` L4510: string "chave:rotulo:valor,..." parseada. Metas pergunta/questionário L4402-4425. Publicar/despublicar/clonar L4274-4288. Semáforos: `atingido===true` ✓ verde, `false` ✗ vermelho, else neutro. Score classes: `score-green ≥7`, `score-yellow ≥4`, `score-red <4`

**Dashboard/Stats:** **sem Chart.js/D3** — HTML/CSS puros. `renderDistBar()` L213-219 (segmentos `.seg-otimo/bom/regular/ruim`), `renderMediaBadge()` L238-242, `_mediaPct()` linear 0-9→0-100. KPI cards grid 5 col desktop. `loadStats()` L275 → `/api/feedback/stats`. Polling 60s `iniciarPollingStats()` L308-332 (pausado se `_modalOpen` ou aba oculta). Massagista histórico L1970-2030 exclui pergunta "explicação" p/ não-bilingues

**Auditoria (view-auditoria):** endpoints `/api/auditoria?filtros&limit=50&offset` + `/recursos`. Tabela 7 col (Data timezone Fortaleza, Ator+role+IP, Ação+método+rota, Recurso badge, ID, Status verde/vermelho, Detalhes `<details><pre>`). Mapeamentos `_AUD_RECURSO_LABEL` (11) e `_AUD_ACAO_LABEL` (49)

**Usuários (view-usuarios):** `GET /api/auth/usuarios`. Card usuário logado (avatar). Tabela 5 col. **Master only**: novo, remover, editar. Roles: master/admin/normal

### Real-time
- **Sem SSE/WebSocket** — polling exclusivo
- Stats dashboard 60s (`_statsPoller` L318)
- Modal casal 3s L1000 (para quando ambos respondem)
- Calendar now-line 60s (`_nowLineInterval` L2881)
- Check reservas 60s L4121 + `visibilitychange`/`focus`
- **Sem retry/backoff** — try/catch silencioso
- Estado: `window.isGranClassCli()`, `window.badgeGranClassHtml()`, singletons closure para modal casal

### shared-header.js (13KB)
- Logo S3 `letsimage.s3.amazonaws.com/editor/granmarquise/imgs/1760033174793-hotelgranmarquise_pos_footer.png`
- Link Hub adaptativo com `?theme=`
- Relógio Fortaleza 30s `Intl.DateTimeFormat`
- Botão sair: GET tema → `localStorage.clear() + sessionStorage.clear()` → POST `/api/admin/logout` keepalive → redirect Hub `?logout=1&from=pesquisa&theme=X`
- CSS vars `--header-bg`, `--logo-filter: brightness(0) invert(1)` (dark)

---

## 12. Fluxos End-to-End

### 12.1 Criar Reserva
```
admin.js:3803 btn-nova-reserva → calOpenModal(1, date, '09:00') L2906
  ↓ Fetch em paralelo: tipos-massagem-ativos, massagistas-ativas, escala/disponibilidade
  ↓ Validação client L3872-4023 (CPF mod11, email, tel BR/E.164, quarto lista, timeframe 09-22, data ≥ hoje Fortaleza)
  ↓ Casal (opcional): valida pessoa 2 sala 3/4, mass≠mass2, doc≠doc2
POST /api/reservas (L4045 calSalvarReserva)
  → server.js middlewares: helmet/CSP, cors, express.json 2mb, auditMiddleware
  → routes/reservas.js:89 requireAuth + requireSpa + requireWrite
  → Normaliza doc, valida quarto, timeframe, data≥hoje, pessoa 2
  → Escala: contextoEscalaDia + avaliarEscalaMassagista (409 escala se fora, override_escala flag)
  → Upsert cliente por CPF/passaporte (L198-310)
  → db.js:1690 inserirReserva
     • Check SALA_BLOQUEADA (L1700 SELECT sala_bloqueios)
     • Check CONFLITO_SALA (L1715 salas 3+4 casal share)
     • Check CONFLITO_PROF pessoa 1 (L1737)
     • Check CONFLITO_PROF pessoa 2 (L1752)
     • INSERT reservas (24 cols) → lastInsertRowid
  → UPDATE cliente_id, cpf, passaporte, quarto (silencioso)
  → auditMiddleware res.on('finish') → logAuditoria criar_reservas
  → Response 201 {ok, id, cliente_id, quarto, gran_class}
UI: calCloseModal() + loadReservas() re-render
Casal: liberar-pesquisa cria 2 tokens INATIVOS → admin ativa individual /pessoa/:n/ativar-pesquisa
```

### 12.2 Bloquear Sala com Reservas Conflitantes
```
admin.html:4941 modal-sala-bloqueio → admin.js:8701 form submit
  → POST /api/admin/salas/:sala/bloqueios SEM confirmar
  → routes/salas.js:83 listarReservasNoBloqueio → 409 {tipo:'reservas_no_periodo', reservas}
UI: renderiza #modal-bloqueio-conflito (3 botões)
Opção A - Transferir automaticamente:
  → POST bloqueios {confirmar:true} → cria bloqueio
  → POST /:bId/transferir → loop reservas → listarSalasDisponiveis → atualizarSalaReserva
  → Response {transferidas, sem_disponibilidade, resultados[]}
Opção B - Manual:
  → POST bloqueios {confirmar:true}
  → Loop client: GET /disponiveis?excluir=sala → select → PUT /reservas/:id/sala
loadSalas() + auditoria (auditMiddleware)
```

### 12.3 Escala — Editar Célula + Aplicar Padrão

**A) Editar célula:**
```
escala-spa.html click cell → showPicker L1047 → choose entrada/status
Optimistic UI update (L1015-1044) → saveTurno async
PUT /api/escala-spa/:mid/:data {turno} (ou DELETE se vazio)
  → cadastros.js:246 turnoValido + dataRealValida + buscarMassagistaById
  → db.js:1033 upsertTurno INSERT ON CONFLICT DO UPDATE
  → registrarTurnoHistorico (antes, depois, usuario, 'manual')
  → _conflitosReservaEscala → listarReservasMassagistaData + avaliarEscalaMassagista
  → Response {ok, reservas_conflitantes?}
UI: setSaveInd('saved') + mostrarConflitosEscala modal + reloadCf()
Histórico opcional: GET /historico/:mid/:data → popover
```

**B) Aplicar padrão:**
```
escala-spa.html:1196 btn-ap modal → confirmAp L1205
POST /api/escala-spa/aplicar-padrao {ano, mes, sobrescrever, preview?}
  → cadastros.js:329 loop massagistas → padrao_entrada JSON
  → For each ISO dia 21→20:
     • Extrai dia semana → padrão[dia]
     • Skip se em férias
     • Se já preenchido e !sobrescrever → skip
     • 'FOLGA' → 'X'
  → preview? Return {ok, preview:true, total} : upsertTurno em massa + registrarTurnoHistorico(..., 'aplicar-padrao')
  → Response {ok, total: N}
UI: toast "✓ N célula(s) preenchidas" + loadData()
```

### 12.4 Anamnese LGPD End-to-End
```
1. Admin POST /api/reservas/:id/gerar-ficha (routes/reservas.js:450)
   • Valida janela hora_inicio + 10min (409 tempo_expirado)
   • gerarDocumentoToken(id, pessoa) — expiry = hora_fim + 48h fallback
   • Response {url: 'spa-profile.html?t=TOKEN'} (2 tokens se casal)
2. Admin envia via WhatsApp intent
3. Hóspede abre spa-profile.html → GET /api/spa/documento?t=TOKEN
   • Retorna hospede_nome, email, telefone, cpf, quarto, locale
   • 410 expirado / 409 ja_respondida
4. Pré-preenchimento + fetch histórico /perfil-historico (sem assinatura/info_medica)
5. Formulário: 8 seções, canvas assinatura, consentimentos
6. Client compõe payload + assinatura PNG base64
7. POST /api/spa/perfil (routes/spa.js:343)
   • Valida telefoneValido, quartoValido, locale, texto NFC normalizado
   • HMAC-SHA256 composto v1: sha256(texto+documento+reserva_id+assinatura_hash+consentido_em)
   • Keyring: CONSENT_HMAC_SECRET + CONSENT_HMAC_SECRETS_LEGACY
   • Cross-check canonico
   • Assinatura hash SHA256(data_url PNG)
8. db.js:2323 inserirSpaPerfilComLock BEGIN IMMEDIATE
   • _inserirSpaPerfilCore com 12 campos LGPD
   • UPDATE reservas SET documento_perfil_id=? WHERE id=? AND documento_perfil_id IS NULL
   • Se changes===0 → throw ANAMNESE_JA_RESPONDIDA (409)
   • Preserva consentimento_saude_em se hash igual
9. inserirRespostaPesquisa slug='spa-anamnese-v1', app_origem='spa-anamnese' ou 'spa-anamnese-p2'
10. Response {ok, id, quarto, gran_class}
11. Master consulta prova: GET /api/clientes/anamnese/:perfilId/prova-consentimento
    • Integridade: 'integro'/'adulterado'/'legado-sem-prova'/'sem-consentimento'/'chave-desconhecida'
    • Log auditoria em TODOS paths (200/400/403/404)
```

---

## 13. Matriz Endpoints × Roles (126 endpoints totais)

**Categorias auth:** público (26) · requireAuth (31) · requireAuth+Master (8) · requireAuth+Spa (13) · requireAuth+Satisfacao (10) · requireAuth+Spa+Write (23) · requireAuth+Write (6) · requireTerapeuta (5) · s2sAuth (2 rotas Hub /api/hub/* server.js:268-272) · rateLimit público (1) · misc (2).

**Endpoints "misc" no server.js diretos (não em routes/):** GET /api/massagistas-ativas (L129), GET /api/tipos-massagem-ativos (L145), GET /api/health (L168), GET /api/survey/live (L176 polling), GET /api/survey/:token (L197), GET /api/quartos (L227) — todos públicos.

**Resumo por prefixo:**

| Prefixo | Endpoints | Auth default |
|---|---|---|
| /sso (server.js) | GET /sso | público (JWT SSO_SECRET) |
| /health | GET | público |
| /api/spa | 4 | público (token URL) |
| /api/feedback | 4 | 1 público rate-limited + 3 requireAuth |
| /api/survey (via qualidade) | público | GET config, GET published |
| /api/qualidade/admin/* | 35 | requireAuth (leitura), writeChain (mutações) |
| /api/gq | 3 | requireAuth+requireSatisfacao |
| /api/clientes | 11 | requireAuth+requireSpa; 1 master-only (prova-consentimento) |
| /api/reservas | 10 | requireAuth (GET) / requireSpa+requireWrite (mutações) |
| /api/admin/salas | 9 | requireAuth (aparentemente sem middleware específico!) — ⚠️ verificar |
| /api (cadastros) | 26 | requireAuth (GET) / requireSpa+requireWrite (mutações) |
| /api/auth | 5 | público login; requireMaster CRUD usuários |
| /api/auditoria | 2 | requireMaster |
| /api/relatorios | 2 | requireAuth+requireSatisfacao |
| /api/terapeuta | 7 | 3 públicos + 4 requireTerapeuta (cookie isolado) |

---

## 14. Scripts (14) e Seed Data

**npm scripts:** `start`, `dev` (--watch), `seed`
**Scripts backend (`scripts/*`):**
| Script | Categoria | Idempotente | `--apply`? |
|---|---|---|---|
| seed.js | seed 20 feedbacks | NÃO | — |
| seed-traducoes-locc.js | UPSERT 160 traduções | SIM | dry-run default |
| seed-duo-test.cjs | 1 reserva DUO teste | NÃO | via flyctl ssh |
| seed-idioma-test.cjs | 2 feedbacks EN/ES | NÃO | via flyctl ssh |
| migrar-clientes.js | spa_perfis → clientes | NÃO (1 vez) | SIM |
| reset-completo.js | zera 23 tabelas (preserva admin_users, massagistas) | SIM | SIM |
| reset-perguntas-tratamentos.js | limpa perguntas+tipos | SIM | SIM |
| repopular-anamnese.js | reseed pesquisas | SIM | SIM |
| repopular-tratamentos.js | reseed tipos_massagem | SIM | SIM |
| traduzir-pesquisa-satisfacao.js | Anthropic → 6 idiomas | SIM | SIM (requer ANTHROPIC_API_KEY) |
| retraduzir-perguntas.js | MyMemory retraduz | SIM | SIM |
| test-janela-anamnese.js | valida janela +10min UTC-3 | SIM | — |
| test-receita-local.js | valida comissão 6 mass × 5 meses | SIM | — |
| test-trava-anamnese.js | 8 cenários corrida + cleanup `__TEST_TRAVA_*` | SIM | — |

**Seed data:** `receita-2026.json` — 24 preços base (R$ 218 – R$ 2898), 5 faixas desconto (0/10/20/30/50%), lançamentos exemplo.

**Locales:** 7 arquivos (pt-BR, pt-PT, en, es, fr, it, de) — 126 linhas cada, paridade 100%, estrutura idêntica.

**Fontes:** ~53 arquivos woff/woff2. Cormorant Garamond (18 woff + 7 woff2, 5 scripts Latin/Latin-Ext/Cyrillic/Cyrillic-Ext/Vietnamese, weights 300/400/500, normal+italic). Inter (16 woff + 12 woff2, 7 scripts, weights 300/400/500/600).

---

## 15. Infra: Docker, Fly, CI

**Dockerfile:** node:20-alpine + python3+make+g++ (`better-sqlite3` native build). `WORKDIR /app`, `NODE_ENV=production`, `EXPOSE 3000`, `CMD ["node","src/server.js"]`. **USER não configurado — roda como root** ⚠️. `mkdir /app/data`.

**fly.toml:** app `pesquisa-satisfacao`, região `gru`, machine 256MB / 1 vCPU shared, release timeout 180s, volume `feedback_data` → `/app/data`. HTTP force_https, auto_stop_machines false, min_machines_running 1. Health `GET /api/health` (30s interval, 5s timeout, 10s grace).

**GitHub Workflows:** `fly-deploy.yml` + `deploy.yml` (duplicados). Trigger push main + manual. Node 20 + `npm ci --production`. Valida sintaxe `node --check src/routes/*.js`. `flyctl deploy --remote-only`. Health-check loop 30×5s. `FLY_API_TOKEN` via GitHub Secrets ✓.

**Package.json:**
- Backend: express ^5.2.1, helmet ^8.2.0, cors ^2.8.6, better-sqlite3 ^12.10.0, bcryptjs ^3.0.3, jsonwebtoken ^9.0.3, dotenv ^17.4.2, @anthropic-ai/sdk ^0.101.0 (8 deps, ESM, sem engines definido, sem dev deps)
- Frontend: react/react-dom ^18.3.1, @fontsource/inter/cormorant-garamond/jetbrains-mono. Dev: vite ^5.4.19, @vitejs/plugin-react ^4.3.4, tailwindcss ^3.4.17, autoprefixer, postcss

---

## 16. Segurança e LGPD — Achados

| # | Severidade | Descrição | file:linha | Mitigação |
|---|---|---|---|---|
| 1 | **CRÍTICA** | `token_github.txt` commitado com token Fly.io real | root/token_github.txt | Revogar token no Fly + `git filter-repo` + rotacionar |
| 2 | Alta | CORS sem restrição de origem | server.js:84 | `cors({origin: [...whitelist], credentials:true})` |
| 3 | Alta | Dockerfile roda como root | Dockerfile | Adicionar `USER node` |
| 4 | Alta | CSP `scriptSrc 'unsafe-inline'` | server.js:71-82 | Migrar inline scripts para nonce ou arquivos externos |
| 5 | Alta | `SSO_SECRET`, `ANTHROPIC_API_KEY`, `CONSENT_HMAC_SECRET`, `MYMEMORY_EMAIL`, `SPA_ADMIN_EMAILS`, `HUB_URL` **ausentes do .env.example** | .env.example | Documentar todas + validar boot com `assert(process.env.X)` |
| 6 | Alta | MyMemory email hardcoded `caiobholanda2007@gmail.com` | utils/traduzir.js | Env-only, fail se ausente em prod |
| 7 | Alta | Rate limit apenas em POST /api/feedback (memória, 5/10min) — restante desprotegido | feedback.js | Aplicar `express-rate-limit` global + Redis em multi-instance |
| 8 | Média | `/api/admin/salas/*` **sem middleware auth explícito nos endpoints** (herda gate /api?) | routes/salas.js | Adicionar `requireAuth+requireSpa+requireWrite` explícito |
| 9 | Média | SIGTERM não tratado → conexões cortadas em rolling deploy | server.js:389 | `process.on('SIGTERM', ...)` graceful shutdown |
| 10 | Média | Sem `PRAGMA synchronous` explícito (default FULL ok, mas confirmar) | db.js:16 | Documentar decisão |
| 11 | Média | Nenhuma auditoria em SSE polling `/api/reservas/:id/status-pesquisa-casal` | audit.js ignora GET | OK design decision |
| 12 | Média | JWT stored em sessionStorage (XSS acessível) | admin.js:1 | Preferir cookies HttpOnly (já usa alternativa) |
| 13 | Média | LGPD PII em detalhes de auditoria — sanitizado max 2KB, mas revisar | audit.js:110 | Explicit whitelist de campos |
| 14 | Baixa | Timing-attack mit login apenas 500ms fixo | auth.js:26 | `constant-time compare` bcrypt já protege |
| 15 | Baixa | JSON parser 2MB → risco DoS moderado | server.js:85 | Reduzir para 512KB (assinatura PNG apenas 500KB) |

**LGPD:** prova de consentimento (HMAC composto v1, keyring, cross-check canonico) implementado. Log de auditoria em prova-consentimento em todos paths (200/400/403/404). Whitelist strict em GET /anamnese. Dados de saúde protegidos em `resposta_pesquisa app_origem='spa-anamnese[-p2]'`.

---

## 17. Débitos Técnicos / Lacunas

**P0 (bloqueadores segurança):**
- Revogar token_github.txt (item #1 acima)
- Migrar admin.html inline scripts para arquivos externos (habilita nonce CSP)
- USER não-root no Dockerfile

**P1 (importantes):**
- Deletar detritos root: `tempadm.html`, `tmpcss.txt`, `tmpjs.txt`, `CUsersestagio.tiAppDataLocalTempanamnese.json` (arquivo com nome corrompido por Windows path)
- Adicionar auth explícito em `/api/admin/salas/*` (herança de `/api` parece existir mas inconsistente com outras routes)
- Testes automatizados: **inexistentes** (sem test/, spec/, __tests__). Apenas scripts `test-*.js` como validação manual
- SIGTERM handler + graceful shutdown
- Documentar env vars completas
- Rate limit global
- Backup automático DB (`fly-toml` volume mas sem rotina de snapshot documentada)
- Duplicação de `.github/workflows/*.yml` (fly-deploy.yml e deploy.yml quase idênticos)

**P2 (nice-to-have):**
- ~85% do CSS em admin.html poderia ir para arquivo externo (5028 linhas)
- Chart.js/ApexCharts para gráficos mais ricos (hoje HTML/CSS puro)
- SSE para eliminar polling 60s/3s
- Migração para PostgreSQL quando escalar além de 1 instance
- i18next para tornar o form React totalmente i18n
- TypeScript no backend

**Modo temporário ativo:**
- `feedback_pesquisa_modo_temp_sem_janela` (memory): janelas 15min (pesquisa) e expiry (anamnese) desativadas em db.js. Reverter quando user pedir.

---

## 18. Diagramas de Dados

### 18.1 Jornada Hóspede: Reserva → Anamnese → Pesquisa
```
[Admin cria reserva]
     ↓
reservas (id, cliente_id, sala, hora_inicio)
     ↓                                        ↘
[gerar-ficha]                              [liberar-pesquisa]
     ↓                                             ↓
gerarDocumentoToken(id, pessoa)          criarSurveyToken(id, pessoa, ativar)
     ↓                                             ↓
reservas.documento_token[2] + expiry     survey_tokens(token, reserva_id, pessoa, liberada_em)
     ↓                                             ↓
[WhatsApp] spa-profile.html?t=TOKEN      Tablet polling 1s /api/survey/live
     ↓                                             ↓
GET /api/spa/documento?t                 URL vira ativa → Cliente abre
     ↓                                             ↓
Formulário anamnese (canvas assinatura)  index.html React SPA
     ↓                                             ↓
POST /api/spa/perfil (HMAC valid)        FormScreen preenche 7 ratings + extras
     ↓                                             ↓
inserirSpaPerfilComLock TRANSACAO        POST /api/feedback (rate-limited 5/10min)
     ↓                                             ↓
UPDATE reservas SET documento_perfil_id  marcarSurveyTokenRespondido
= gate único (ANAMNESE_JA_RESPONDIDA)             ↓
     ↓                                       inserirFeedback + inserirRespostaPesquisa
spa_perfis (12 campos LGPD)                 (slug=spa-locc-v1, feedback_id link)
     ↓                                             ↓
inserirRespostaPesquisa                  Dashboard /api/feedback/stats
(slug=spa-anamnese-v1)                          + /api/gq/stats
```

### 18.2 Escala Mensal Data Flow
```
massagistas.padrao_entrada JSON  {seg:"10:00", ter:"FOLGA", ...}
              ↓
[Admin clica Aplicar Padrão]
              ↓
POST /api/escala-spa/aplicar-padrao {ano, mes, sobrescrever, preview?}
              ↓
cadastros.js:329 loop massagistas × dias 21→20
              ↓
Skip se ferias_massagista OU (célula existe && !sobrescrever)
              ↓
upsertTurno(mid, data, turno) INSERT ON CONFLICT DO UPDATE
              ↓
registrarTurnoHistorico(..., 'aplicar-padrao')
              ↓
turno_massagista (UNIQUE mid+data)
              ↓                              [Admin cria reserva]
[avaliarEscalaMassagista]              [_fetchEscalaAval]
Fonte hierárquica:                            ↓
  1. turno_massagista mensal             GET /api/escala-spa/disponibilidade
  2. ferias_massagista                    → items[{mid, disponivel, fonte, motivo, faixa}]
  3. padrao_entrada semanal                     ↓
  4. sem-escala (fallback livre)         Filtro _escalaFiltra em modal
              ↓                                 ↓
Retorna {disponivel, fonte, motivo, faixa}    Aviso "Escala mensal não lançada"
              ↓
Backend valida em POST /api/reservas (override_escala flag)
```

### 18.3 Salas — Bloqueio + Transferência
```
reservas (sala CHECK 1-5) ← inserirReserva valida SALA_BLOQUEADA + CONFLITO_SALA
       ↓
[Admin bloqueia sala X: data_i, data_f, motivo]
       ↓
GET /api/admin/salas/:X/bloqueios/check → listarReservasNoBloqueio
       ↓
Se reservas > 0 && !confirmar → 409 {tipo: 'reservas_no_periodo', reservas}
       ↓
[Usuário escolhe: Transferir auto / Manual / Cancelar]
       ↓                    ↓
[Auto:]              [Manual:]
POST bloqueios       POST bloqueios {confirmar:true}
{confirmar:true}     Loop reservas UI:
POST /:bId/          GET /disponiveis?excluir=X
transferir           Select nova sala
       ↓             PUT /reservas/:id/sala
db.js: for r in reservas
  listarSalasDisponiveis(r.data, r.hora_inicio, r.hora_fim, excluir=[X])
  if sala livre:
    atualizarSalaReserva(r.id, novaSala)
      • Check SALA_BLOQUEADA novaSala
      • Check CONFLITO_SALA novaSala
      • UPDATE reservas SET sala=?
       ↓
Response {transferidas, sem_disponibilidade, resultados[]}
       ↓
sala_bloqueios (idx composto sala+data_inicio+data_fim)
```

---

## Changelog

**2026-07-10 · Fix Nova Reserva — auto-seleção de sala + popup lotadas**

Arquivos: `public/js/admin.js`, `public/admin.html`.

- `_atualizarDisponibilidadeSalas` (admin.js:3008): parou de usar probe fixo de `+30min`; agora consulta `/api/admin/salas/disponiveis` apenas quando `_resHoraFim` real (derivado do tratamento em `calAtualizarHoraFim`) está definido. Sem tratamento escolhido → nenhuma sala é marcada `.ocupada`. Corrige bug em que todas as salas mostravam "⏱ Em uso" à toa.
- `calAtualizarHoraFim` (admin.js:3112): dispara `_atualizarDisponibilidadeSalas()` em cada saída, garantindo re-check quando tratamento/hora-fim manual muda.
- `_selecionarSalaAutomatica` (admin.js:3040): pré-check exige data+hora+tratamento; troca `showToast` por `_abrirModalSalasLotadas(tipo)` quando lotado. Ordem de busca preservada: 1→2→3→4 (individual), 3→4 (dupla).
- Novo modal `#modal-salas-lotadas` (admin.html após `#confirm-modal-overlay`) com design coerente com tokens `--gold`/`--danger`, backdrop-blur, animação de entrada, foco automático no botão primário e backdrop-click fecha.
- Micro-texto no label "Sala" indicando que a seleção é automática mas trocável manualmente.

Bugs pré-existentes achados (não corrigidos a pedido):
- `fmtDate` declarado 2× em admin.js:361 e 8678 (sloppy mode: 2º vence sem erro, mas é code smell).
- Fluxo Casal: ao auto-marcar `#res-chk-casal`, `_cbTrat2` fica vazio até o admin preencher tratamento 2 (comportamento antigo).
- Handler duplicado em admin.js:3430-3434 (chama `calAtualizarHoraFim` e `_atualizarDisponibilidadeSalas` separadamente no `change` de hora-inicio → 1 request extra por mudança). Sem impacto funcional.

---

## Notas Operacionais

- **Deploy:** Fly.io — sempre `flyctl deploy --remote-only` (não Railway, memory feedback_deploy_fly)
- **Verificação pós-deploy:** aguardar GH Actions + validar URL (memory feedback_aguardar_deploy)
- **Testes:** rodar em produção conforme instruções (sem test suite local)
- **Backup manual DB:** `flyctl ssh sftp` para `/app/data/feedback.db`

---

## 19. Anexo — Achados dos Últimos Agentes (Wave 3)

**`.claude/settings.json`:** hook customizado Write/Edit → auto-commit + push para GitHub via PowerShell (timeout 120s, apenas branch `main`).
**`.claude/settings.local.json`:** permissão `Bash(node -e '...')` para validação inline.

**`referencia/frontend-original.html`:** legado do frontend antes de modularizar. Cores gold `#D4953D` (versão antiga vs. `#9C5843` atual), modo colaborador azul `#2A5A6B`. Contém React/Babel/Tailwind CDN inline.

**Detritos root a remover:**
- `tempadm.html`, `tmpcss.txt`, `tmpjs.txt` — assets bundled/processados. Nome `CUsersestagio.tiAppDataLocalTempanamnese.json` = artefato de path Windows corrompido (não abre).
- `token_github.txt` inicia com `FlyV1 fm2_lJPECAAAAA…` — token real Fly.io (não GitHub apesar do nome). **REVOGAR e remover do histórico Git.**

**Empty catches problemáticos (feedback.js L87, 93, 104, 113, 124):** silencia falhas em `marcarSurveyTokenRespondido`, upsert vinculação, gravação estruturada. Adicionar `console.error` estruturado.

**Modo temporário ativo (db.js:1933, 1978):** janela 15min de survey_token e expiry anamnese desativadas "a pedido do usuário". Blocos comentados de 40+ linhas duplicando lógica antiga. Reverter quando pedido "volte o tempo como era antes".

**Timeouts/janelas confirmados:**
- Ficha anamnese: `hora_inicio + 15min` (verificado em `reservas.js:463-475`, timezone UTC-3 Fortaleza fixo)
- Cookies: admin/user 8h, terapeuta 12h
- Bloqueios auto polling stats: 60s
- Cookie regen `login`: delay 500ms fixo em falha (timing-attack básico)

**HMAC composto v1 detalhes (spa.js:126-146):** serialização fixa `chave\x1Fvalor\x1Ecomponente`. Componentes: texto (NFC/normalizado) + documento + reserva_id + assinatura_hash SHA256 + consentido_em. Keyring com `CONSENT_HMAC_SECRET` + `CONSENT_KEY_ID` + `CONSENT_HMAC_SECRETS_LEGACY` (rotação de segredo).

**Prova de consentimento (`clientes.js:322-380`):** só role='master'. Recalcula HMAC via `recalcularSeloComposto()`. Retorna estados: `integro`, `adulterado`, `chave-desconhecida`, `algoritmo-desconhecido`, `legado-sem-prova`, `sem-consentimento`. **Log em TODOS paths (200/400/403/404)**.

**Testes:** ausência total de suite (nem `test/`, `spec/`, `__tests__`, nem `jest`/`vitest`/`mocha` em package.json). Apenas 3 scripts `test-*.js` como validação manual isolada.

**Backup DB:** nenhuma rotina automática documentada. Volume Fly.io persistente sem snapshot/replicação. **Solução urgente:** cron backup + offsite (S3/similar).

**Padrões inconsistentes de código (top 5):**
1. `setAdminCookie` duplicada em `server.js:37-45` e `auth.js:7-10`
2. `res.setHeader('Set-Cookie',...)` vs `res.appendHeader` — comportamentos diferentes
3. Error handling misturado: `res.status(400).json({ok:false})` vs `throw new Error()` vs `return {ok:false, motivo}`
4. Hardcoded `'pt-BR'` em 40+ locais (falta constante `DEFAULT_LOCALE`)
5. Console.log/error sem filtro `NODE_ENV` em server.js:382, feedback.js:223, spa.js:30-68

**Ordem de leitura recomendada para novos devs:**
1. `README.md` + este `MAPEAMENTO.md`
2. `src/server.js` (bootstrap + rotas montadas)
3. `src/db.js` (schema + migrações)
4. Foco: `src/routes/reservas.js` → `src/db.js:1690 inserirReserva`
5. Foco: `public/js/admin.js` L2468 loadReservas + L8556 loadSalas
6. Foco: `public/escala-spa.html` (standalone)

---

**Fim do MAPEAMENTO.md** — 989 linhas / consolidação de 50 agentes paralelos executados em 2026-07-10 com foco em Reservas, Gestão de Salas e Escala de Trabalho.
