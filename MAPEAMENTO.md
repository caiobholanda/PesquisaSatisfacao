# MAPEAMENTO — PesquisaSatisfacaoSPA
> Gerado em 2026-07-10 · 3 agentes paralelos (backend, frontend, infra)  
> **Produção:** https://pesquisa-satisfacao.fly.dev · Fly.io GRU · SQLite WAL `/app/data/feedback.db`

---

## ÍNDICE
1. [Árvore de Arquivos](#1-árvore-de-arquivos)
2. [Stack & Dependências](#2-stack--dependências)
3. [Infraestrutura & Deploy](#3-infraestrutura--deploy)
4. [Banco de Dados (db.js)](#4-banco-de-dados-dbjs)
5. [Backend — server.js](#5-backend--serverjs)
6. [Routers & Endpoints](#6-routers--endpoints)
7. [Middlewares de Auth](#7-middlewares-de-auth)
8. [Frontend — Páginas HTML](#8-frontend--páginas-html)
9. [Frontend — JavaScript](#9-frontend--javascript)
10. [Fluxos Principais](#10-fluxos-principais)
11. [Segurança — Achados](#11-segurança--achados)
12. [Scripts Utilitários](#12-scripts-utilitários)

---

## 1. ÁRVORE DE ARQUIVOS

```
PesquisaSatisfacaoSPA/
├── package.json                   (31L)  — deps npm, scripts start/dev/seed
├── Dockerfile                           — node:20-alpine, build frontend, prod-only deps
├── fly.toml                             — app=pesquisa-satisfacao, gru, volume feedback_data
├── .env.example                         — PORT, JWT_SECRET, ADMIN_USER, ADMIN_PASS, NODE_ENV
│
├── src/
│   ├── server.js                 (401L) — Express entry: middlewares, routers, SSO, rotas HTML
│   ├── db.js                    (3140L) — SQLite driver + schema DDL + 90+ funções exportadas
│   ├── qualidade.js                     — lógica Gestão da Qualidade (questionários configuráveis)
│   ├── middleware/
│   │   ├── auth.js               (73L)  — requireAuth, requireMaster, requireWrite, requireSpa, requireSatisfacao, requireTerapeuta
│   │   └── audit.js                     — intercepta POST/PUT/DELETE /api/*, grava log auditoria
│   ├── routes/
│   │   ├── auth.js              (122L)  — login local, CRUD admin_users
│   │   ├── feedback.js          (315L)  — pesquisa pública, stats, rate-limit
│   │   ├── cadastros.js                 — massagistas, tipos, turnos, padrões, férias, comissão
│   │   ├── reservas.js                  — CRUD reservas, survey_token, ficha anamnese
│   │   ├── spa.js                       — anamnese pública (perfil, documento, consentimento LGPD)
│   │   ├── clientes.js                  — cadastro central clientes, 360°, produtos
│   │   ├── salas.js                     — CRUD salas, bloqueios, transferência reservas
│   │   ├── qualidade.js                 — admin pesquisas/perguntas/escalas/metas/traduções
│   │   ├── gq.js                        — Gestão Qualidade: stats, respostas estruturadas
│   │   ├── auditoria.js          (28L)  — GET auditoria (master only)
│   │   ├── terapeuta.js         (117L)  — login PIN, agenda, escala mobile
│   │   ├── relatorios.js         (26L)  — mensal, cruzamento sessões/pesquisa
│   │   └── dev.js                       — seed, reset (dev only)
│   └── utils/
│       ├── traduzir.js                  — tradução via Anthropic SDK + MyMemory fallback
│       └── detectarIdioma.js            — detecção de idioma em texto livre
│
├── public/
│   ├── index.html                (24L)  — React SPA entry (pesquisa de satisfação)
│   ├── admin.html               (5108L) — painel admin completo (14 views)
│   ├── spa-profile.html          (649L) — formulário anamnese multiidioma (7 idiomas)
│   ├── escala-spa.html          (1345L) — grade escala mensal (profissionais × dias)
│   ├── acesso-hub.html           (132L) — redirect de login para Hub
│   ├── assets/                          — bundle React (Vite build)
│   ├── js/
│   │   ├── admin.js             (9349L) — toda lógica admin (state, API calls, UI)
│   │   ├── spa-profile.js       (1463L) — lógica anamnese (validação, submit, l10n)
│   │   └── shared-header.js      (251L) — header reutilizável (logo, dropdowns, tema, hora BRT)
│   ├── locales/                         — JSONs de localização (pt-BR, pt-PT, en, fr, es, it, de)
│   └── images/
│
├── frontend/                            — Vite + React 18 (pesquisa de satisfação)
│   ├── package.json                     — react, react-dom, vite, tailwindcss
│   └── src/
│
├── scripts/
│   ├── seed.js                          — 20 feedbacks fake
│   ├── migrar-clientes.js               — popula tabela clientes a partir de spa_perfis
│   ├── reset-completo.js                — zera 23 tabelas (preserva admin_users, massagistas)
│   ├── traduzir-pesquisa-satisfacao.js  — UPSERT traduções 6 idiomas via Claude Haiku
│   ├── retraduzir-perguntas.js          — retraduz via MyMemory API
│   ├── seed-traducoes-locc.js           — UPSERT 160 traduções manuais
│   ├── test-janela-anamnese.js          — 11 cenários de janela +10min UTC-3
│   ├── test-trava-anamnese.js           — 8 cenários race condition lock casal
│   └── test-receita-local.js            — valida comissão 6 massagistas × 5 meses
│
├── seed-data/
│   └── receita-2026.json                — 24 preços base, 5 faixas desconto, lançamentos
│
├── .github/workflows/
│   ├── fly-deploy.yml                   — push main → node --check → flyctl deploy
│   └── deploy.yml                       — duplicado (consolidar em 1)
│
├── MAPEAMENTO.md                        — este arquivo
├── token_github.txt             ⚠️ CRÍTICO — FlyV1 token real (revogar + git filter-repo)
├── tempadm.html                 🗑️ detrito
├── tmpcss.txt                   🗑️ detrito
└── tmpjs.txt                    🗑️ detrito
```

---

## 2. STACK & DEPENDÊNCIAS

**Runtime:** Node 20 LTS · ESM (`"type": "module"`) · Express 5

### Backend (produção)
| Pacote | Versão | Papel |
|--------|--------|-------|
| express | ^5.2.1 | HTTP/REST, routers, middlewares |
| better-sqlite3 | ^12.10.0 | SQLite3 síncrono, WAL mode |
| jsonwebtoken | ^9.0.3 | JWT admin + terapeuta + SSO |
| bcryptjs | ^3.0.3 | Hash senha admin e PIN mobile |
| helmet | ^8.2.0 | CSP, HSTS, X-Frame-Options |
| cors | ^2.8.6 | CORS (sem restrição de origem ⚠️) |
| dotenv | ^17.4.2 | Carrega `.env` |
| @anthropic-ai/sdk | ^0.101.0 | Tradução perguntas (Claude Haiku 4.5) |

### Frontend (Vite build)
| Pacote | Papel |
|--------|-------|
| react + react-dom ^18.3.1 | SPA pesquisa satisfação |
| vite ^5.4.19 | Bundler → `/app/public/assets/` |
| tailwindcss ^3.4.17 | Estilo React |
| @fontsource/inter, cormorant-garamond, jetbrains-mono | Fontes |

### Scripts npm
| Script | Comando | Uso |
|--------|---------|-----|
| `start` | `node src/server.js` | Produção |
| `dev` | `node --watch src/server.js` | Desenvolvimento |
| `seed` | `node scripts/seed.js` | Popula 20 feedbacks fake |

---

## 3. INFRAESTRUTURA & DEPLOY

### Fly.io
```
app     = "pesquisa-satisfacao"
região  = gru (São Paulo)
máquina = 256 MB RAM, 1 vCPU shared, 1 instância
volume  = feedback_data → /app/data (1 GB)
health  = GET /api/health (grace 10s, interval 30s, timeout 5s)
HTTPS   = forçado (force_https = true)
```

### Dockerfile
```dockerfile
FROM node:20-alpine
RUN apk add --no-cache python3 make g++   # compila better-sqlite3
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev                      # deps backend prod-only
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci                  # deps frontend (incl. devDeps)
COPY . .
RUN cd frontend && npm run build           # → /app/public/assets/
RUN mkdir -p /app/data
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
# ⚠️ Roda como root — falta: USER node
# ⚠️ Não multistage — devDeps ficam na imagem final
```

### GitHub Actions (`fly-deploy.yml`)
```
Trigger: push main + workflow_dispatch
Concurrency: deploy-group (serializa runs)
Steps:
  1. Checkout v4
  2. Setup Node 20
  3. npm ci --omit=dev
  4. node --check (server.js, db.js, feedback.js, reservas.js, cadastros.js, auth.js, dev.js)
  5. flyctl deploy --remote-only
```
> ⚠️ `deploy.yml` é duplicado quase idêntico — consolidar em um.

### Variáveis de Ambiente
| Variável | Obrigatória | Default | Onde usada |
|----------|-------------|---------|-----------|
| `JWT_SECRET` | ✅ | — | assina todos os JWTs |
| `SSO_SECRET` | ✅ | — | valida Bearer do Hub |
| `CONSENT_HMAC_SECRET` | ✅ | `dev-fallback-...` ⚠️ | prova LGPD |
| `CONSENT_KEY_ID` | — | `k1` | keyring rotação |
| `CONSENT_HMAC_SECRETS_LEGACY` | — | — | JSON{key_id: secret} legado |
| `PORT` | — | `3000` | server.js |
| `NODE_ENV` | — | — | cookies Secure, error details |
| `ADMIN_USER` | — | `admin` | seed admin local |
| `ADMIN_PASS` | — | `TrocarEmProducao!` ⚠️ | fallback senha admin |
| `HUB_URL` | — | `https://hub-granmarquise.fly.dev` | SSO e lista users |
| `MYMEMORY_EMAIL` | — | `caiobholanda2007@gmail.com` ⚠️ hardcoded | traduzir.js |
| `ANTHROPIC_API_KEY` | — | — | scripts/traduzir-pesquisa-satisfacao.js |

> Faltam no `.env.example`: SSO_SECRET, CONSENT_HMAC_SECRET, HUB_URL, MYMEMORY_EMAIL, ANTHROPIC_API_KEY, CONSENT_HMAC_SECRETS_LEGACY

---

## 4. BANCO DE DADOS (db.js)

**3140 linhas · SQLite WAL · foreign_keys = ON**

### Tabelas (40+)

#### Core Feedback
| Tabela | Colunas Principais | FKs |
|--------|-------------------|-----|
| `feedback` | id, nome, apto, email, telefone, data_tratamento, tratamento_realizado, nome_massoterapeuta, servicos_* (5 campos), instalacoes_* (4 campos), recomenda, tipo_cliente, origem, submitted_at, cliente_id, reserva_id, idioma_detectado | nenhuma |

#### Profissionais & Escala
| Tabela | Colunas Principais | FKs |
|--------|-------------------|-----|
| `massagistas` | id, nome, ativo, matricula, funcao, vinculo, bilingue, disponibilidade, excecoes, email, padrao_entrada (JSON), pin_hash | — |
| `turno_massagista` | id, massagista_id, data, turno (09:00/14:00/17:30/X/FE/AT/AA/CF/CH/LS/LC), obs — UNIQUE(massagista_id, data) | massagistas |
| `turno_historico` | id, massagista_id, data, antes, depois, usuario, origem | massagistas |
| `ferias_massagista` | id, massagista_id, data_inicio, data_fim, observacao | massagistas |
| `padrao_entrada_log` | id, massagista_id, antes, depois, usuario | massagistas |

#### Agendamentos
| Tabela | Colunas Principais | FKs |
|--------|-------------------|-----|
| `reservas` | id, sala(1-5), cliente, tipo_cliente, apto, email, telefone, tratamento, data, hora_inicio, hora_fim, massagista_id, cliente_id, cpf, quarto, cliente2+opts (casal), documento_token+expiry+perfil_id (pessoa 1 e 2), criado_em | massagistas, tipos_massagem |
| `survey_tokens` | id, token(UNIQUE), reserva_id, liberada_em, respondida_em, pessoa(1/2), feedback_id, cliente_id, idioma | reservas |
| `tipos_massagem` | id, nome, descricao, duracao_min, preco, ativo, tipo(individual/casal/grupo), categoria, componentes, linhas | — |

#### Anamnese & Clientes
| Tabela | Colunas Principais | FKs |
|--------|-------------------|-----|
| `spa_perfis` | id, nome, sobrenome, tipo_documento, documento, email, telefone, data_nascimento, rotina_facial, rotina_corporal, pressao_massagem, info_medica, consentimento_saude, canais_marketing, assinatura_data_url, idioma, reserva_id, cliente_id, quarto, pessoa, consentimento_saude_hash/versao/key_id — UNIQUE(reserva_id, pessoa) | reservas, clientes |
| `clientes` | id, cpf(UNIQUE), passaporte(UNIQUE), nome, email, telefone, data_nascimento, locale_pref, nacionalidade, observacao | — |
| `cliente_produto` | id, cliente_id, produto_nome, categoria, valor, data_compra, reserva_id | clientes, reservas |

#### Gestão da Qualidade
| Tabela | Propósito |
|--------|-----------|
| `pesquisa` | Questionários configuráveis (slug, versao, app_escopo, publicada_em) |
| `pesquisa_traducao` | Traduções título/descrição por idioma |
| `pesquisa_secao` | Seções dentro de pesquisas |
| `pesquisa_secao_traducao` | Traduções seções |
| `pesquisa_pergunta` | Associação pesquisa ↔ pergunta (ordem, ativo, obrigatória) |
| `pergunta_satisfacao` | Biblioteca de perguntas (chave UNIQUE, tipo, escala_id, mapeia_campo_legado) |
| `pergunta_traducao` | Labels por idioma |
| `pergunta_opcao` | Opções de múltipla escolha |
| `pergunta_opcao_traducao` | Traduções opções |
| `escala` | Escalas (si_nao, 4pt_qualitativa, etc) |
| `escala_opcao` | Opções da escala (chave, valor_numerico, polaridade, ordem) |
| `escala_opcao_traducao` | Traduções opções escala |
| `resposta_pesquisa` | Resposta completa (pesquisa_id, app_origem, cliente_id, reserva_id, feedback_id) |
| `resposta_item` | Item individual (pergunta_chave, valor_texto, valor_numerico, escala_opcao_chave) |
| `meta_pergunta` | Meta por pergunta (valor_alvo, valido_de/ate) |
| `meta_questionario` | Meta global por questionário |
| `anamnese_auditoria` | Log edições de anamnese/pesquisa |

#### Infraestrutura
| Tabela | Propósito |
|--------|-----------|
| `admin_users` | username(UNIQUE), password_hash, nome, role(master/admin/spa/satisfacao) |
| `salas` | id(1-5), nome, tipo, ativa, observacao |
| `sala_bloqueios` | sala, data_inicio, data_fim, motivo, bloqueado_por |
| `quartos` | numero(PK), andar, categoria(standard/gran_class), ativo |
| `receita_lancamentos` | ano, mes, massagista_id, tipo_massagem_id, faixa_desconto, quantidade, preco_base, receita — UNIQUE(ano,mes,massagista_id,tipo_massagem_id,faixa_desconto) |
| `comissao_config` | id(CHECK=1), base_rate, tiers(JSON), singleton |
| `system_meta` | chave(PK), valor — KV store para flags internos |
| `auditoria` | ator_username, ator_role, ator_ip, metodo, rota, acao, recurso, status, sucesso |

### Funções Exportadas (90+)

**Inicialização**
- `getDb()` L12 — singleton SQLite
- `initDb()` L22 — schema DDL + migrations + seeds

**Feedback**
- `inserirFeedback(dados)` L753
- `getFeedbackById(id)` L775
- `listarFeedback({origem, tipo_cliente, from, to, massoterapeuta, limit, offset})` L779
- `statsFeedback({from, to, ...})` L819 — média, distribuição, textos livres
- `atualizarIdiomaFeedback(id, idioma)` L2073

**Massagistas**
- `listarMassagistas()` L903
- `listarMassagistasComStats()` L959
- `listarMassagistasParaPadroes()` L922
- `buscarMassagistaById(id)` L955
- `buscarMassagistaPorNome(nome)` L2964
- `inserirMassagista(nome, opts)` L973
- `atualizarMassagista(id, nome, ativo, opts)` L980
- `deletarMassagista(id)` L990
- `setMassagistaPinHash(id, pinHash)` L2975
- `setPadraoEntrada(id, padrao)` L911 — padrão semanal {seg..dom}
- `registrarLogPadrao(mId, antes, depois, usuario)` L916

**Férias**
- `listarFeriasMassagista(id)` L995
- `criarFeriasMassagista(id, data_inicio, data_fim, obs)` L998
- `atualizarFeriasMassagista(id, ...)` L1003
- `excluirFeriasMassagista(id)` L1008
- `feriasConflito(id, data_inicio, data_fim, excludeId)` L1011

**Turnos (Escala Diária)**
- `listarTurnosPeriodo(ano, mes)` L1023 — período 21→20
- `upsertTurno(massagista_id, data, turno)` L1033 — INSERT OR REPLACE
- `deletarTurno(massagista_id, data)` L1038
- `buscarTurno(massagista_id, data)` L1043
- `registrarTurnoHistorico(mId, data, antes, depois, usuario, origem)` L1047
- `listarTurnoHistorico(mId, data, limit)` L1052
- `listarTurnosDia(data)` L1071
- `contextoEscalaDia(data)` L1075 — feriado, dia semana
- `avaliarEscalaMassagista(m, data, horaInicio, horaFim, ctx)` L1096 — hierarquia: férias → turno_massagista → padrao_entrada → sem-escala
- `calcularSaldoCf(datas)` L740 — saldo CF por massagista

**Tipos de Massagem**
- `listarTiposMassagem()` L1162
- `inserirTipoMassagem(...)` L1165
- `atualizarTipoMassagem(...)` L1171
- `deletarTipoMassagem(id)` L1616
- `seedTratamentosGranSpa()` L1184

**Receita & Comissão**
- `seedReceitaTerapias({jsonPath})` L1308 — upsert idempotente
- `agregarReceitaPorMes(massagistaId, ano)` L1392
- `calcularComissaoPorMes(massagistaId, nome, ano)` L1586 — % por tier
- `getComissaoConfig()` L1466
- `setComissaoConfig({base_rate, tiers})` L1473
- `notaMediaPorMes(massagistaNome, ano)` L1443

**Reservas**
- `listarReservasSemana(from, to)` L1637
- `listarTodasReservas({from, to, sala, salas, busca, massagista_id, limit, offset})` L1650
- `listarReservasMassagistaData(massagista_id, data)` L1154
- `inserirReserva(sala, cliente, tipo_cliente, apto, email, telefone, tratamento, data, horaInicio, horaFim, opts)` L1690 — 3 checks: SALA_BLOQUEADA L1700, CONFLITO_SALA L1715 (casal salas 3+4 share), CONFLITO_PROF L1737
- `buscarReservaById(id)` L1847
- `buscarReservaDetalhe(id)` L1866 — inclui survey_tokens + spa_perfis + feedback
- `atualizarReserva(id, ...)` L1781
- `cancelarReserva(id)` L1777 — soft delete
- `listarReservasDaTerapeuta(massagistaId, {from, to})` L2980
- `buscarReservaDetalheTerapeuta(reservaId, massagistaId)` L3007 — IDOR-safe

**Survey Tokens**
- `criarSurveyToken(reservaId, pessoa, ativar)` L1961 — casal: ativar=false até admin ativar individual
- `buscarSurveyToken(token)` L2140
- `buscarSurveyTokenAtivo()` L2000 — tablet público
- `marcarSurveyTokenRespondido(token, feedbackId)` L2033
- `statusPesquisaPessoa(reservaId, pessoa)` L1985
- `countSessoesSemPesquisa()` L2126

**Documentos (Anamnese)**
- `gerarDocumentoToken(reservaId, pessoa)` L2215
- `buscarDocumentoToken(token)` L2247 — valida expiry
- `vincularDocumentoToken(reservaId, locale)` L2505

**Spa Perfis**
- `inserirSpaPerfil(dados)` L2286 — com HMAC consentimento LGPD
- `inserirSpaPerfilComLock(dados)` L2391 — BEGIN IMMEDIATE + gate atômico → ANAMNESE_JA_RESPONDIDA 409

**Clientes**
- `listarClientes({q, limit, offset})` L2644
- `buscarClientePorId(id)` L2664
- `buscarClientePorCpf(cpf)` L2671
- `buscarClientePorPassaporte(passaporte)` L2680
- `inserirCliente({cpf, passaporte, nome, email, telefone, ...})` L2689
- `atualizarCliente(id, {...})` L2709
- `buscarCliente360(id)` L2731 — cliente + reservas + feedback + anamneses + produtos
- `inserirProdutoCliente(clienteId, {...})` L2883
- `atualizarProdutoCliente(id, {...})` L2892
- `removerProdutoCliente(id)` L2906

**Admin Users**
- `buscarAdmin(username)` L2179 · `listarAdmins()` L2183 · `buscarAdminById(id)` L2187
- `inserirAdmin(username, passwordHash, nome, role)` L2191
- `atualizarAdmin(id, {...})` L2197 · `deletarAdmin(id)` L2208

**Auditoria**
- `logAuditoria(evt)` L2912
- `listarAuditoria({from, to, ator, acao, recurso, sucesso, limit, offset})` L2937
- `listarRecursosAuditoria()` L2959

**Quartos**
- `seedQuartosGranMarquise()` L2512 · `buscarQuarto(numero)` L2554
- `quartoValido(numero)` L2560 · `isGranClass(numero)` L2565
- `categoriaQuarto(numero)` L2570 · `listarQuartos({categoria, andar, ativo})` L2575

**Validação**
- `telefoneValido(tel)` L2601 · `validarCpfMod11(cpf)` L2625 · `validarPassaporte(p)` L2640

**Salas**
- `listarSalasDisponiveis(data, horaInicio, horaFim)` L3028
- `atualizarSalaReserva(reservaId, novaSala)` L3053

---

## 5. BACKEND — server.js

**401 linhas · ESM · Express 5**

### Ordem de Middlewares
1. `helmet(contentSecurityPolicy: {...})` — CSP, X-Frame-Options, HSTS
2. `cors()` — permissivo (sem whitelist ⚠️)
3. `express.json({ limit: '2mb' })` + handler 400 malformed
4. Auth gate HTML: bloqueia páginas sem cookie (spa_admin_sess / spa_user_sess)
5. `express.static('public')` — arquivos estáticos
6. `auditMiddleware` — POST/PUT/DELETE /api/* → log

### Routers Montados
| Prefixo | Arquivo |
|---------|---------|
| `/api/spa` | routes/spa.js |
| `/api/relatorios` | routes/relatorios.js |
| `/api/survey`, `/api/qualidade` | routes/qualidade.js |
| `/api/feedback` | routes/feedback.js |
| `/api/auth` | routes/auth.js |
| `/api/clientes` | routes/clientes.js |
| `/api/auditoria` | routes/auditoria.js |
| `/api/terapeuta` | routes/terapeuta.js |
| `/api/gq` | routes/gq.js |
| `/api/reservas` | routes/reservas.js |
| `/api/admin/salas` | routes/salas.js |
| `/api` | routes/cadastros.js |

### Rotas Especiais
| Rota | Comportamento |
|------|--------------|
| `GET /sso` | Valida JWT Hub (SSO_SECRET), define role, cria cookie, redireciona para /admin |
| `GET /admin` | Serve admin.html (requer cookie spa_admin_sess) |
| `GET /terapeuta` | Serve terapeuta.html (requer cookie spa_terapeuta_sess) |
| `GET /api/health, /health` | Retorna uptime + versão |
| `GET /api/massagistas-ativas` | Query direta db (dropdown público) |
| `GET /api/tipos-massagem-ativos` | Query direta db (dropdown público) |
| `GET /api/survey/:token` | Token-based, sem auth |
| `GET /api/quartos` | Público (SPA profile) |

---

## 6. ROUTERS & ENDPOINTS

### auth.js (`/api/auth`)
| Método | Caminho | Auth | O que faz |
|--------|---------|------|-----------|
| POST | `/login` | público | Valida username/password, cookie spa_admin_sess (JWT 8h) |
| GET | `/usuarios` | requireAuth | Lista admins (tenta Hub, fallback local) |
| POST | `/usuarios` | requireAuth + requireMaster | Cria admin (senha default) |
| PUT | `/usuarios/:id` | requireAuth + requireMaster | Atualiza nome/username/role |
| DELETE | `/usuarios/:id` | requireAuth + requireMaster | Deleta (não pode deletar a si mesmo) |

### feedback.js (`/api/feedback`)
| Método | Caminho | Auth | O que faz |
|--------|---------|------|-----------|
| POST | `/` | rateLimit 5/10min | Insere feedback + marca survey_token + resposta_pesquisa opcional + detecta idioma background |
| GET | `/` | requireAuth | Lista com filtros paginados |
| GET | `/stats` | requireAuth | Médias, distribuição, pct recomenda, metas opcionais |
| GET | `/item/:id` | requireAuth | Detalhe + perguntas extras admin |

### cadastros.js (`/api`)
| Método | Caminho | Auth | O que faz |
|--------|---------|------|-----------|
| GET | `/massagistas` | requireAuth | Lista com stats feedback |
| GET | `/massagistas/padroes` | requireAuth + requireSpa | Padrões semanais todos |
| POST | `/massagistas` | requireAuth + requireSpa + requireWrite | Cria massagista |
| PUT | `/massagistas/:id` | requireAuth + requireSpa + requireWrite | Atualiza nome/ativo/matricula |
| PUT | `/massagistas/:id/padrao` | requireAuth + requireSpa + requireWrite | Padrão semanal (7 dias) |
| GET | `/massagistas/:id/historico` | requireAuth | Histórico feedback |
| GET | `/massagistas/:id/receita` | requireAuth | Receita + comissão por mês |
| DELETE | `/massagistas/:id` | requireAuth + requireSpa + requireWrite | Soft delete |
| GET | `/massagistas/:id/ferias` | requireAuth | Lista férias |
| POST | `/massagistas/:id/ferias` | requireAuth + requireSpa + requireWrite | Cria férias |
| PUT | `/massagistas/:id/ferias/:fId` | requireAuth + requireSpa + requireWrite | Atualiza férias |
| DELETE | `/massagistas/:id/ferias/:fId` | requireAuth + requireSpa + requireWrite | Deleta férias |
| POST | `/massagistas/:id/pin` | requireAuth + requireSpa + requireWrite | Define PIN mobile (bcrypt) |
| GET | `/comissao/regras` | requireAuth | Config comissão (base_rate + tiers) |
| PUT | `/comissao/regras` | requireAuth + requireSpa + requireWrite | Atualiza config |
| GET | `/tipos-massagem` | requireAuth | Lista tipos |
| POST | `/tipos-massagem` | requireAuth + requireSpa + requireWrite | Cria tipo |
| PUT | `/tipos-massagem/:id` | requireAuth + requireSpa + requireWrite | Atualiza tipo |
| DELETE | `/tipos-massagem/:id` | requireAuth + requireSpa + requireWrite | Soft delete |
| GET | `/escala-spa` | requireAuth | Turnos do período (ano/mes) |
| PUT | `/escala-spa/:mId/:data` | requireAuth + requireSpa + requireWrite | Upsert turno |
| DELETE | `/escala-spa/:mId/:data` | requireAuth + requireSpa + requireWrite | Deleta turno |
| GET | `/escala-spa/disponibilidade` | requireAuth | Lookup de disponibilidade por dia |
| GET | `/escala-spa/historico/:mId/:data` | requireAuth | Histórico mudanças 1 dia |
| POST | `/escala-spa/aplicar-padrao` | requireAuth + requireSpa + requireWrite | Aplica padrão ao período |
| POST | `/escala-spa/cf-acumulado` | requireAuth | Saldo CF por massagista (datas específicas) |

### reservas.js (`/api/reservas`)
| Método | Caminho | Auth | O que faz |
|--------|---------|------|-----------|
| GET | `/sem-pesquisa` | requireAuth | Conta sessões sem pesquisa |
| GET | `/` | requireAuth | Semana (from/to obrigatório) |
| GET | `/historico` | requireAuth | Histórico filtrado |
| GET | `/:id/detalhe` | requireAuth | Completo: reserva + tokens + perfis + feedback |
| POST | `/` | requireAuth + requireSpa + requireWrite | Cria reserva (suporta casal) |
| PUT | `/:id` | requireAuth + requireSpa + requireWrite | Atualiza |
| DELETE | `/:id` | requireAuth + requireSpa + requireWrite | Cancela (soft) |
| POST | `/:id/liberar-pesquisa` | requireAuth + requireSpa + requireWrite | Cria + libera survey_token |
| POST | `/:id/pessoa/:pessoa/ativar-pesquisa` | requireAuth + requireSpa + requireWrite | Ativa pesquisa casal individual |
| GET | `/:id/status-pesquisa-casal` | requireAuth | Status tokens pessoa 1 e 2 |
| POST | `/:id/gerar-ficha` | requireAuth + requireSpa + requireWrite | Gera documento_token (+15min UTC-3 janela) |

### spa.js (`/api/spa`)
| Método | Caminho | Auth | O que faz |
|--------|---------|------|-----------|
| GET | `/documento` | público (?token=) | Valida token, retorna idioma + dados reserva |
| GET | `/historico` | público | Histórico anamnese anterior por documento |
| POST | `/perfil` | público | Submit anamnese + HMAC LGPD + lock atômico casal |
| GET | `/anamnese/config` | público | Config UI (perguntas, opções, traduções) |

### clientes.js (`/api/clientes`)
| Método | Caminho | Auth | O que faz |
|--------|---------|------|-----------|
| GET | `/` | requireAuth + requireSpa | Busca clientes (nome/email/tel) |
| GET | `/:id` | requireAuth + requireSpa | Cliente 360° |
| GET | `/anamnese/:perfilId` | requireAuth + requireSpa | 1 anamnese |
| GET | `/anamnese/:perfilId/prova-consentimento` | requireAuth + requireMaster | Valida HMAC LGPD + log auditoria |
| GET | `/pesquisa/:respostaId` | requireAuth + requireSpa | 1 resposta estruturada |
| POST | `/` | requireAuth + requireWrite | Cria cliente |
| PUT | `/:id` | requireAuth + requireWrite | Atualiza |
| POST | `/:id/produtos` | requireAuth + requireWrite | Registra produto |
| PUT | `/produtos/:pid` | requireAuth + requireWrite | Atualiza produto |
| DELETE | `/produtos/:pid` | requireAuth + requireWrite | Remove produto |

### salas.js (`/api/admin/salas`)
| Método | Caminho | Auth | O que faz |
|--------|---------|------|-----------|
| GET | `/` | requireAuth ⚠️ | Lista salas + bloqueios ativos |
| PUT | `/:id` | requireAuth ⚠️ | Atualiza sala |
| GET | `/:id/bloqueios` | requireAuth ⚠️ | Lista bloqueios |
| GET | `/:id/bloqueios/check` | requireAuth ⚠️ | Conta reservas no período |
| POST | `/:id/bloqueios` | requireAuth ⚠️ | Cria bloqueio (check conflito → 409) |
| DELETE | `/bloqueios/:bId` | requireAuth ⚠️ | Remove bloqueio |
| GET | `/disponiveis` | requireAuth ⚠️ | Salas livres por horário |
| POST | `/:id/bloqueios/:bId/transferir` | requireAuth ⚠️ | Transfere reservas para outra sala |
| PUT | `/reservas/:id/sala` | requireAuth ⚠️ | Move reserva de sala |

> ⚠️ salas.js usa só `requireAuth` — falta `requireSpa + requireWrite` nas rotas de escrita

### terapeuta.js (`/api/terapeuta`)
| Método | Caminho | Auth | O que faz |
|--------|---------|------|-----------|
| GET | `/nomes-ativos` | público | Dropdown login (nomes massagistas) |
| POST | `/login` | público | bcrypt PIN → cookie spa_terapeuta_sess isolado |
| POST | `/logout` | requireTerapeuta | Limpa cookie |
| GET | `/me` | requireTerapeuta | Dados massagista logada |
| GET | `/escala` | requireTerapeuta | Escala resolvida (férias→turno→padrão) por range |
| GET | `/agenda` | requireTerapeuta | Reservas do dia (IDOR-safe: só massagista_id do token) |
| GET | `/atendimento/:id` | requireTerapeuta | Detalhe reserva (ownership check) |

### qualidade.js (`/api/survey`, `/api/qualidade`)
| Tipo | Quantidade | Auth |
|------|------------|------|
| Público (/config, /published) | 2 | nenhuma |
| Admin CRUD pesquisas/perguntas/escalas/metas/secoes/opcoes | ~30 | requireAuth + requireWrite |
| Tradução | 1 (POST /admin/traduzir) | requireAuth + requireSatisfacao |

### gq.js (`/api/gq`)
| Método | Caminho | Auth | O que faz |
|--------|---------|------|-----------|
| GET | `/stats` | requireAuth + requireSatisfacao | Stats por pesquisa/filtros |
| GET | `/respostas` | requireAuth + requireSatisfacao | Lista paginada |
| GET | `/resposta/:id` | requireAuth + requireSatisfacao | Detalhe + itens enriquecidos |

### auditoria.js (`/api/auditoria`)
| Método | Caminho | Auth | O que faz |
|--------|---------|------|-----------|
| GET | `/` | requireAuth + requireMaster | Lista com filtros |
| GET | `/recursos` | requireAuth + requireMaster | Valores únicos de 'recurso' |

### relatorios.js (`/api/relatorios`)
| Método | Caminho | Auth | O que faz |
|--------|---------|------|-----------|
| GET | `/mensal` | requireAuth + requireSatisfacao | Stats mês (ym query, timezone Fortaleza) |
| GET | `/cruzamento` | requireAuth + requireSatisfacao | Sessões vs pesquisas respondidas |

---

## 7. MIDDLEWARES DE AUTH

**src/middleware/auth.js (73L)**

| Middleware | Roles aceitos | Notas |
|-----------|--------------|-------|
| `requireAuth` | qualquer | Verifica Bearer ou cookie spa_admin_sess/spa_user_sess; popula req.user {sub, username, role} |
| `requireMaster` | master | 403 para outros |
| `requireWrite` | master, spa, satisfacao | admin (read-only) → 403 |
| `requireSpa` | master, spa, admin | Acesso área Spa |
| `requireSatisfacao` | master, satisfacao, admin | Acesso relatórios |
| `requireTerapeuta` | terapeuta | Cookie isolado spa_terapeuta_sess; popula massagista_id |

### Roles × Permissões
| Role | podeSpa | podeSatisfacao | podeUsuarios | podeEscrever |
|------|---------|---------------|-------------|-------------|
| master | ✅ | ✅ | ✅ | ✅ |
| spa | ✅ | ❌ | ❌ | ✅ |
| satisfacao | ❌ | ✅ | ❌ | ✅ |
| admin | ✅ | ✅ | ❌ | ❌ (read-only) |
| terapeuta | (isolado) | — | — | — |

---

## 8. FRONTEND — PÁGINAS HTML

### admin.html (5108L)
14 views. Navegação via `showView(id)` (sessionStorage persiste view ativa).

| View ID | Propósito |
|---------|-----------|
| `view-main` | Dashboard KPIs: total respostas, média, taxa recomendação, dist. Ótimo/Bom/Regular/Ruim |
| `view-reservas` | Calendário semanal: grid profissionais × slots, modais criação/edição |
| `view-massagistas` | Cards profissionais com stats feedback |
| `view-historico` | Histórico avaliações por massoterapeuta com gráficos |
| `view-tipos` | CRUD tipos de tratamento |
| `view-relatorios` | Tabs: Avaliações / Visão Mensal / Atendimentos + drawer detalhe |
| `view-qualidade` | Gestão da Qualidade: stats por serviço/instalação |
| `view-anamnese-editor` | Editor drag-drop anamnese (publica spa-anamnese-v1) |
| `view-pesquisa-editor` | Editor drag-drop pesquisa (publica spa-locc-v1) |
| `view-clientes` | Clientes 360° (4 abas: Tratamentos/Anamneses/Pesquisas/Produtos) |
| `view-auditoria` | Log auditoria com filtros (master only) |
| `view-usuarios` | Gestão usuários e permissões |
| `view-historico-clientes` | Histórico atendimentos por cliente |
| `view-salas` | Gestão salas 1-5 + bloqueios |

**Modais:** Criar/Editar Reserva, Enviar Ficha Anamnese, Liberar Pesquisa, Padrões de Escala, Gestão Férias, Regras Comissão, Gran Class Info

---

### spa-profile.html (649L)
Anamnese para hóspede. Acesso via `/spa-profile.html?t=TOKEN`.

**Seções:** Dados Pessoais → Rotina Facial (pills) → Rotina Corporal (pills) → Preferência Pressão (radio) → Informações Médicas (textarea) → Consentimento LGPD → Marketing (pills) → Assinatura (canvas)

**States:** normal / `ANAMNESE_JA_RESPONDIDA` 409 / link expirado / sucesso pós-submit

**Language bar:** 7 idiomas sticky no topo. Textos: fetch `/locales/{lang}.json`.

---

### escala-spa.html (1345L)
Grade mensal. Período 21/mês → 20/mês+1 (60 dias).

| Sigla | Significado |
|-------|------------|
| `HH:MM` | Entrada (saída = +8h20min, teto 22:00) |
| `HH:MM\|HH:MM` | Jornada customizada |
| X | Folga | FE/FÉR | Férias |
| AT | Atestado | AA | Afastamento |
| CF | Comp. feriado | CH | Comp. hora |
| LS | Lic. sindical | LC | Lic. casamento |
| F | Falta |

**Features:** Picker popup, modal Padrões Semanais, modal Aplicar Padrão, modal Reservas em Conflito, histórico por célula. JWT em `sessionStorage.granspa_token`.

---

### acesso-hub.html (132L) / index.html (24L)
- `acesso-hub.html` — redirect login → Hub (sem JS próprio)
- `index.html` — React SPA entry, bundle em `/assets/index-*.js`

---

## 9. FRONTEND — JAVASCRIPT

### admin.js (9349L)

**Estado Global**
```javascript
let _token          // JWT (memória + sessionStorage.granspa_token)
let _offset, _total // paginação
let _filters        // {from, to, origem, tipo, massoterapeuta}
let _calWeekOffset  // semana calendário
let _calDiaSel      // Date selecionado
let _modalOpen      // flag modal aberto
let _resDetAtual    // reserva em detalhe
let _langSelected   // idioma (padrão 'pt-BR')
```

**Funções Críticas**
| Função | Linha | Papel |
|--------|-------|-------|
| `token()` | 31 | Retorna JWT |
| `tokenValido()` | 34 | Valida exp |
| `logout()` | 127 | Limpa + redireciona acesso-hub.html |
| `api(url, opts)` | 95 | Fetch wrapper: Authorization, trata 401/403 |
| `rolePermissions(role)` | 132 | `{podeSpa, podeSatisfacao, podeUsuarios, podeEscrever}` |
| `aplicarRoleNaUI(role)` | 140 | Esconde/mostra items conforme role |
| `showView(id)` | 667 | Troca view, persiste sessionStorage._vst |
| `showToast(msg, duration)` | 733 | Toast temporário |
| `confirmarAcao(opts)` | 2813 | Modal de confirmação genérico |
| `escHtml(s)` | 74 | HTML-escape |
| `fmtBRT(utcStr, opts)` | 80 | UTC → BRT (Fortaleza UTC-3) |
| `loadStats()` | 275 | GET /api/feedback/stats → KPIs + análise |
| `loadTable()` | 378 | GET /api/feedback → tabela paginada |
| `openDrawer(id)` | 520 | GET /api/feedback/item/:id → drawer detalhe |
| `loadAll()` | 639 | loadStats + loadTable + selects |
| `iniciarPollingStats()` | 316 | setInterval 60s (tab visível) |
| `loadMassagistas()` | 1312 | Lista + cards profissionais |
| `loadTipos()` | 1560 | Tabela tipos massagem |

**Polling:** stats 60s · casal 3s · now-line 60s · check reservas 60s. Sem SSE. Sem retry.

---

### spa-profile.js (1463L)
| Função | Linha | Papel |
|--------|-------|-------|
| `init()` | 610 | Wiring de listeners |
| `validateAll(showErrors)` | 219 | Valida todo o form |
| `handleSubmit(e)` | 369 | POST /api/spa/perfil |
| `collectData()` | 329 | Coleta todos os inputs |
| `loadLocale(lang)` | 564 | GET /locales/{lang}.json |
| `applyLocale(L)` | 482 | Preenche textos DOM |
| `applyAnamneseConfig(idioma)` | 844 | GET /api/spa/anamnese/config → renderiza extras |
| `_tentarPrePreencherHistorico(...)` | 1140 | GET /api/spa/historico → preenche form |
| `initCanvas()` | 102 | Canvas assinatura |
| `validarCPF(cpf)` | 21 | Mod 11 |
| `validarTelefoneFlex(tel)` | 46 | BR + E.164 |

---

### shared-header.js (251L)
`window.initSharedHeader(opts)` — injeta: logo (link Hub), dropdown SPA, dropdown Admin, hora Fortaleza (update 30s), botão tema (light/dark + localStorage), botão Sair.

---

## 10. FLUXOS PRINCIPAIS

### Fluxo 1: Pesquisa Pública (Hóspede)
```
Admin cria reserva → "Liberar pesquisa"
→ POST /api/reservas/:id/liberar-pesquisa
→ cria survey_token (liberada_em = now)
→ Link /?token=XXX (WhatsApp)
→ Hóspede GET /api/survey/:token → React SPA
→ POST /api/feedback
→ marcarSurveyTokenRespondido(token, feedbackId)
→ Aparece em view-relatorios
```

### Fluxo 2: Anamnese (Hóspede)
```
Admin "Gerar ficha"
→ POST /api/reservas/:id/gerar-ficha
→ documento_token (expiry: horário reserva - 15min UTC-3)
→ Link /spa-profile.html?t=TOKEN
→ GET /api/spa/documento → valida token
→ Preenche + assina → POST /api/spa/perfil
→ inserirSpaPerfilComLock() → lock atômico (409 se já respondida)
→ HMAC-SHA256 prova consentimento LGPD salvo
```

### Fluxo 3: Login SSO Hub → Admin
```
Usuário /admin sem cookie → redireciona /acesso-hub.html
→ "Acessar via Hub" → hub-granmarquise.fly.dev
→ Hub autentica → redireciona /sso?sso_token=JWT&next=/admin
→ server.js valida JWT (SSO_SECRET)
→ define role → emite JWT interno 8h → cookie spa_admin_sess
→ /admin → admin.html → showApp()
```

### Fluxo 4: Login Terapeuta (Mobile)
```
GET /terapeuta → select nome
→ POST /api/terapeuta/login {nome, pin}
→ bcrypt.compare → cookie spa_terapeuta_sess (isolado)
→ GET /terapeuta/agenda (IDOR-safe: só massagista_id do token)
```

### Fluxo 5: Resolução de Escala
```
avaliarEscalaMassagista(massagista, data, horaInicio, horaFim, ctx)
  1. feriasConflito() → se em férias: "sem-escala"
  2. buscarTurno() → se turno_massagista: retorna sigla
  3. padrao_entrada[dow(data)] → se definido: retorna padrão
  4. fallback: "sem-escala"
```

### Fluxo 6: Pesquisa Casal (Salas 3+4)
```
Reserva casal (sala 3+4 share se cliente2 != null)
→ criarSurveyToken(id, 1, false) + criarSurveyToken(id, 2, false)
→ Admin ativa individual via POST /:id/pessoa/:n/ativar-pesquisa
→ Frontend polling 3s: GET /:id/status-pesquisa-casal
→ Hóspedes preenchem pesquisas independentes
```

### Fluxo 7: Auditoria
```
auditMiddleware intercepta POST/PUT/DELETE /api/*
→ logAuditoria({ator, metodo, rota, acao, recurso, status, sucesso})
→ view-auditoria: GET /api/auditoria (master only)
```

---

## 11. SEGURANÇA — ACHADOS

| ID | Sev. | Problema | Local | Ação |
|----|------|---------|-------|------|
| S1 | CRÍTICO | `token_github.txt` com FlyV1 token real commitado | raiz/ | Revogar no Fly + `git filter-repo --prune-empty --force -- token_github.txt` |
| S2 | Alta | `cors()` sem whitelist de origens | server.js:84 | `cors({origin: ['https://pesquisa-satisfacao.fly.dev', 'https://hub-granmarquise.fly.dev'], credentials: true})` |
| S3 | Alta | Dockerfile roda como root | Dockerfile | Adicionar `USER node` antes de CMD |
| S4 | Alta | CSP `'unsafe-inline'` em scriptSrc | server.js:71 | Migrar scripts inline para arquivos externos |
| S5 | Alta | 6 env vars ausentes no .env.example | .env.example | Documentar SSO_SECRET, CONSENT_HMAC_SECRET, HUB_URL, MYMEMORY_EMAIL, ANTHROPIC_API_KEY, CONSENT_HMAC_SECRETS_LEGACY |
| S6 | Alta | Email MyMemory hardcoded | utils/traduzir.js:27 | `process.env.MYMEMORY_EMAIL` obrigatório (fail-fast) |
| S7 | Alta | Rate limit só em /api/feedback (memória local) | feedback.js | Rate limit global + store externo para multi-instância |
| S8 | Média | `/api/admin/salas/*` sem requireSpa + requireWrite | salas.js | Adicionar middlewares em rotas de escrita |
| S9 | Média | Sem SIGTERM graceful shutdown | server.js | `process.on('SIGTERM', () => { server.close(); db.close(); process.exit(0); })` |
| S10 | Média | 2 workflows GitHub quase idênticos | .github/workflows/ | Consolidar em fly-deploy.yml único |
| S11 | Baixa | Detritos na raiz | tempadm.html, tmpcss.txt, tmpjs.txt | Remover |

### CSP Atual
```javascript
scriptSrc: ["'self'", "'unsafe-inline'"]     // ⚠️ XSS risk
styleSrc:  ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']
imgSrc:    ["'self'", 'data:', 'https://letsimage.s3.amazonaws.com']
frameSrc:  ["'none'"]    // ✅
objectSrc: ["'none'"]    // ✅
```

---

## 12. SCRIPTS UTILITÁRIOS

| Script | Quando usar | Flag |
|--------|------------|------|
| `node scripts/seed.js` | Setup local | nenhuma |
| `node scripts/migrar-clientes.js` | Migração 1×: clientes a partir de spa_perfis | `--apply` (default dry-run) |
| `node scripts/reset-completo.js` | Dev: zera 23 tabelas | `--apply` |
| `node scripts/repopular-anamnese.js` | Dev: reseed pesquisas | `--apply` |
| `node scripts/repopular-tratamentos.js` | Dev: reseed tipos_massagem | `--apply` |
| `node scripts/traduzir-pesquisa-satisfacao.js` | UPSERT 6 idiomas via Claude Haiku | `ANTHROPIC_API_KEY` |
| `node scripts/seed-traducoes-locc.js` | UPSERT 160 traduções manuais | `--apply` |
| `node scripts/test-janela-anamnese.js` | 11 cenários janela +15min UTC-3 | nenhuma |
| `node scripts/test-trava-anamnese.js` | 8 cenários race condition casal | nenhuma |
| `node scripts/test-receita-local.js` | Valida comissão 6×5 meses | nenhuma |

**Backup manual:**
```bash
fly ssh sftp get /app/data/feedback.db ./backup.db --app pesquisa-satisfacao
```
> Sem backup automático.

---

## DIAGRAMA DE RELACIONAMENTOS

```
massagistas ──→ reservas (massagista_id)
            ──→ turno_massagista
            ──→ ferias_massagista
            ──→ receita_lancamentos

reservas ───→ survey_tokens (reserva_id)
         ──→ spa_perfis
         ──→ feedback (reserva_id)
         ──→ cliente_produto (reserva_id)

clientes ───→ reservas (cliente_id)
         ──→ spa_perfis
         ──→ feedback
         ──→ cliente_produto

pesquisa ───→ resposta_pesquisa
         ──→ pesquisa_pergunta → pergunta_satisfacao → escala → escala_opcao
         ──→ pesquisa_secao
         ──→ meta_pergunta / meta_questionario

tipos_massagem → reservas · receita_lancamentos
salas ─────────→ sala_bloqueios · reservas (sala 1-5)
```

---

*Gerado 2026-07-10 · 3 agentes · backend (db.js 3140L, server.js 401L, 14 routers, 150+ endpoints) · frontend (admin.html 5108L, admin.js 9349L, spa-profile.js 1463L, escala-spa.html 1345L) · infra (Dockerfile, fly.toml, 2 workflows, 40+ tabelas)*
