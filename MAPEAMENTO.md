# PesquisaSatisfacaoSPA — Mapeamento Arquitetural

> Gerado por 50+ agentes em 2026-07-07. Atualizar sempre que alterar o projeto.

**URL produção:** pesquisa-satisfacao.fly.dev  
**Stack:** Node.js + Express 5 (backend) / Vite + React (frontend buildado → `public/`)  
**Persistência:** SQLite via `better-sqlite3` (WAL mode, `/app/data/feedback.db`)

---

## Estrutura de Arquivos

```
PesquisaSatisfacaoSPA/
├── src/
│   ├── server.js           # Entrada + helmet/cors/middlewares
│   ├── db.js               # ~2600 linhas — 25 tabelas, 73+ funções
│   ├── qualidade.js        # 318 linhas — engine de pesquisas/metas
│   ├── routes/
│   │   ├── reservas.js     # CRUD reservas + geração de ficha
│   │   ├── feedback.js     # Formulário público (rate-limited)
│   │   ├── clientes.js     # Clientes 360, anamnese, LGPD
│   │   ├── admin.js        # Auth admin, stats, massagistas, tipos
│   │   ├── survey.js       # Survey público (SSE, ficha)
│   │   ├── terapeuta.js    # Auth PIN + agenda massoterapeuta
│   │   ├── qualidade.js    # CRUD pesquisas/perguntas/escalas/metas
│   │   ├── receita.js      # Relatório financeiro
│   │   └── dev.js          # Vazio (apenas router exportado)
│   ├── middleware/
│   │   ├── auth.js         # requireAdmin, requireWrite, requireMaster, requireTerapeuta
│   │   └── audit.js        # POST/PUT/DELETE → auditoria (fail-safe)
│   └── utils/
│       ├── detectarIdioma.js  # claude-haiku-4-5-20251001, maxTokens=8
│       └── traduzir.js        # MyMemory API, 400ms delay, 2 retries
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # State machine: welcome→form→confirm
│   │   └── index.css       # --gold: #9C5843 light / #C4916A dark
│   └── vite.config.js      # outDir: ../public, emptyOutDir: false
├── public/
│   ├── index.html          # SPA pública de satisfação
│   ├── admin.html          # Painel administrativo (13 views)
│   ├── spa-profile.html    # Formulário de anamnese/perfil
│   ├── terapeuta.html      # App mobile PIN
│   ├── gestao-qualidade.html
│   ├── acesso-hub.html
│   ├── escala-spa.html     # Escala mensal de turnos (standalone, auth JWT); tooltip posicionado via col-first/col-last/row-first
│   ├── js/admin.js         # ~4900+ linhas — toda lógica admin (header extraído)
│   ├── js/shared-header.js # Cabeçalho compartilhado: logo, dropdowns SPA/Admin, relógio, tema, Sair
│   └── spa-profile.js      # Lógica do formulário de perfil
├── scripts/                # 14 scripts (seção 12)
├── seed-data/
│   └── receita-2026.json   # 380 lançamentos Jan-Mai 2026 (6 massagistas)
├── token_github.txt        # ⚠️ TOKEN FlyV1 REAL — REVOGAR E REMOVER DO HISTÓRICO GIT
├── .env.example            # Falta: SSO_SECRET, ANTHROPIC_API_KEY, MYMEMORY_EMAIL
├── Dockerfile
└── fly.toml
```

---

## src/server.js — Segurança e Middlewares

### helmet CSP
```javascript
scriptSrc: ["'self'", "'unsafe-inline'"]
connectSrc: ["'self'"]
frameSrc: ["'none'"]
objectSrc: ["'none'"]
```

### CORS ⚠️
```javascript
cors()  // sem restrição de origem — aceita qualquer domain
```

### SPA Gate Middleware
Público (sem auth): `/api/*`, `/assets/*`, `/sso`, `/acesso-hub.html`, `/spa-profile.html`, `/terapeuta*`

### Variáveis de ambiente (faltam no .env.example)
- `SSO_SECRET` — verifica tokens do Hub
- `ANTHROPIC_API_KEY` — detectarIdioma.js
- `MYMEMORY_EMAIL` — traduzir.js (aumenta limite 1k→50k words/day)

---

## src/db.js (~2600 linhas)

### Configuração SQLite
```sql
PRAGMA journal_mode=WAL;    -- linha 16
PRAGMA foreign_keys=ON;     -- linha 17
```

### 24 Tabelas
1. `feedback` — respostas legado do formulário público
2. `reservas` — agendamentos SPA
3. `spa_perfis` — perfis legado (migrado para `clientes`)
4. `clientes` — tabela normalizada (CPF/passaporte/email)
5. `massagistas`
6. `tipos_massagem` — catálogo de tratamentos
7. `admin_users` — email + bcrypt senha
8. `auditoria` — log POST/PUT/DELETE
9. `documento_token` — links únicos para anamnese
10. `pesquisa` — pesquisas configuráveis (slug, versão, app_escopo)
11. `pesquisa_secao`
12. `pesquisa_secao_traducao` — 6 idiomas
13. `pergunta_satisfacao`
14. `pergunta_traducao`
15. `pergunta_opcao`
16. `pergunta_opcao_traducao`
17. `pesquisa_pergunta` — associação pesquisa↔pergunta (ordem, obrigatório)
18. `escala`
19. `escala_opcao` — valor numérico + polaridade
20. `escala_opcao_traducao`
21. `resposta_pesquisa` — header (pesquisa_id, cliente_id, reserva_id)
22. `resposta_item` — itens individuais
23. `meta_pergunta` — metas KPI
24. `system_meta` — flags de migrations/seeds

### Janelas de Tempo — Estado Atual

| Função | Janela | Status |
|---|---|---|
| `buscarSurveyTokenAtivo()` | 15min | **DESATIVADA** (query comentada em db.js) |
| `buscarDocumentoToken()` | `documento_token_expiry` | **ATIVA** — retorna `{ expirado: true }` |

> Para reativar janela 15min: descomentar query em `buscarSurveyTokenAtivo` com `liberada_em >= datetime('now', '-15 minutes')`

### Funções por Categoria

**Reservas**
- `criarReserva(dados)` — INSERT + conflict detection
- `buscarReservaPorId(id)` — joins massagista/tipo/cliente
- `listarReservas({ data, massagista_id, sala })`
- `atualizarReserva(id, dados)`
- `cancelarReserva(id)`
- `detectarConflito({ sala, massagista_id, data, hora_inicio, hora_fim, excluir_id })`

**Feedback (legado)**
- `inserirFeedback(dados)` (linhas 615-635) — INSERT 24 campos; retorna `lastInsertRowid`
- `statsFeedback({ from, to })` (linhas 681-735) — total, origens, tipos, médias, distribuições, textos

**Clientes**
- `buscarOuCriarCliente({ cpf, passaporte, email, telefone, nome })` — upsert por documento
- `buscarClientePorId(id)` — `{ cliente, reservas, anamneses, pesquisas, produtos, gran_class }`
- `listarClientes({ q, page, limit })` — busca em cpf/email/telefone/nome
- `inserirProduto(clienteId, dados)`
- `deletarProduto(id)`

**Documento Token**
- `gerarDocumentoToken(reservaId, pessoa)` — INSERT token UUID + expiry
- `buscarDocumentoToken(token)` — `{ expirado: true }` se passou expiry
- `marcarTokenUsado(token)` — grava `usado_em`

**Survey**
- `buscarSurveyTokenAtivo(reservaId)` — janela 15min DESATIVADA
- `inserirResposta(dados)`

**Stats/Admin**
- `statsGerais()`
- CRUD massagistas: `listarMassagistas`, `criarMassagista`, `atualizarMassagista`, `desativarMassagista`
- CRUD tipos: `listarTiposMassagem`, `criarTipoMassagem`, `atualizarTipoMassagem`

---

## src/qualidade.js (318 linhas)

Engine de pesquisas configuráveis. Módulo separado de db.js.

### Seed
- `seedQualidadeSpa()` — escalas (4pt, sim/não) + 12 perguntas satisfação
- `seedAnamneseSpa()` — anamnese 16 campos + 3 seções
- `seedAnamneseOpcoes()`

### Leitura
- `buscarPesquisaPublicada(slug, idioma)` (linha 249) — `WHERE slug=? AND ativo=1 AND publicada_em IS NOT NULL ORDER BY versao DESC LIMIT 1`
- `buscarPesquisaPublicadaPorApp(app, slug)`
- `listarPesquisasPublicadasPorApp(app)`
- `montarConfigPesquisa(id, idioma)` — seções + perguntas + escalas traduzidas
- `listarPesquisas()` (linha 424) — `ORDER BY criada_em DESC`
- `listarEscalas()` (linha 501) — retorna escalas + opções com traduções pt-BR
- `listarMetasPorPesquisa(pesquisaId)` (linha 387) — `{ por_pergunta, por_questionario }`
- `aplicarMetasEmStats(stats, metas)`

### Submissão
- `inserirRespostaPesquisa({ pesquisa_slug, reserva_id, feedback_id, itens })` (linhas 345-384)
  - Se `reserva_id` sem `feedback_id` → **upsert** (anamnese reutiliza registro)
  - Se `feedback_id` → INSERT novo

### CRUD Admin (24 funções)
Pesquisas, seções, perguntas, escalas, opções, metas, auditoria.
- `publicarPesquisa(id)` (linha 588) — `SET publicada_em=datetime('now')`

---

## src/routes/ — Todas as Rotas

### reservas.js
- `POST /api/reservas` — valida CPF mod11, passaporte `[A-Z0-9]{5,20}`, horários 08:00-22:00; 409 para conflitos
- `GET /api/reservas` — lista com filtros
- `PUT /api/reservas/:id`
- `DELETE /api/reservas/:id`
- `POST /api/reservas/:id/gerar-ficha` — janela **10min após hora_inicio**
- `GET /api/reservas/:id/status-pesquisa-casal` — polling casal (3s)

### feedback.js
- `POST /api/feedback` — **rate-limit 5 req/10min/IP** (Map in-memory + cleanup 30min)
- Double-write: `inserirFeedback()` (legado) + `inserirRespostaPesquisa()` (estruturado, falha silenciosa)

### clientes.js
- `GET /api/clientes?q=` — busca full-text
- `GET /api/clientes/:id` — 360 view
- `GET /api/clientes/anamnese/:perfilId`
- `GET /api/clientes/anamnese/:perfilId/prova-consentimento` — requireMaster + sempre auditado (LGPD)
- `POST /api/clientes/:id/produtos`
- `DELETE /api/clientes/produtos/:id`

### admin.js (rotas)
- `POST /api/admin/login` — bcrypt; emite cookie `spa_admin_sess` + token `granspa_token`
- `GET /api/admin/stats` e `/stats/all`
- CRUD massagistas: `/api/massagistas`
- CRUD tipos: `/api/tipos-massagem`
- `GET /api/admin/auditoria`

### survey.js
- `GET /api/survey/live` — SSE (polling 1s no frontend)
- `GET /api/survey/:token` — janela 15min DESATIVADA
- `POST /api/survey/:token` — registra resposta

### terapeuta.js
- `POST /api/terapeuta/login` — nome + PIN; cookie `spa_terapeuta_sess`
- `GET /api/terapeuta/me`
- `GET /api/terapeuta/nomes-ativos`
- `GET /api/terapeuta/agenda?from=&to=`
- `GET /api/terapeuta/atendimento/:id`
- `POST /api/terapeuta/logout`

### qualidade.js (rotas)
- `GET /api/qualidade/pesquisa/:slug` — pública
- CRUD admin: pesquisas, perguntas, escalas, opções, metas, seções
- `PUT /api/qualidade/admin/pesquisa-pergunta/:assocId` — atualiza ordem (drag-and-drop)
- `POST /api/qualidade/admin/pesquisa/:id/publicar`

### receita.js
- `GET /api/receita` — comissões por massagista/mês
- `POST /api/receita/seed` — importa receita-2026.json

---

## src/middleware/

### auth.js
| Middleware | Comportamento |
|---|---|
| `requireAdmin` | JWT em cookie `spa_admin_sess` OU header Bearer |
| `requireWrite` | Igual mas **bloqueia role='admin'** (possível bug legado) |
| `requireMaster` | Exige role='master' |
| `requireTerapeuta` | Cookie `spa_terapeuta_sess` com `massagista_id` |

### audit.js
- Captura POST/PUT/DELETE; sanitiza `password, senha, token, assinatura_data_url`
- `sucesso = status 200-399`
- try-catch silencioso — falha nunca quebra a operação

---

## src/utils/

### detectarIdioma.js
```javascript
model: 'claude-haiku-4-5-20251001'
maxTokens: 8
prompt: "Detect the language. Reply with ONLY the ISO 639-1 code... Text: {text.slice(0,400)}"
```

### traduzir.js
- MyMemory API, sequencial (não paralelo), 2 retries (12s/18s timeout), delay 400ms
- Fallback: texto original pt-BR

---

## Frontend Público (Vite + React)

### frontend/src/App.jsx
- State machine: `welcome → form → confirm`
- Polling `/api/survey/live` a cada **1 segundo**
- `carregarConfig()` — merge i18n + extras + sections

### frontend/src/index.css
```css
--gold: #9C5843  /* light — terracota */
--gold: #C4916A  /* dark */
```

---

## public/admin.html + admin.js (~6100 linhas)

### 13 Views
```
view-main           view-massagistas     view-escala
view-tipos          view-historico       view-reservas
view-historico-clientes  view-usuarios  view-qualidade
view-clientes       view-auditoria       view-anamnese-editor
view-pesquisa-editor
```

**Nav:** SPA dropdown (`btn-open-massagistas`, `btn-open-tipos`) + Administrativo dropdown (`btn-open-relatorios`, `btn-open-qualidade`, `btn-open-anamnese-editor`, `btn-open-pesquisa-editor`, `btn-open-clientes`, `btn-open-usuarios`)

**Relógio inline:** `setInterval(tick, 30*1000)` em America/Fortaleza

### admin.js — Auth e Storage
```javascript
TOKEN_KEY = 'granspa_token'  // sessionStorage (linha 1)
token()        // lê _token || sessionStorage
setToken(t)    // grava nos dois
clearToken()
tokenValido()  // verifica exp do JWT
// Fallback: cookie spa_admin_sess (linha 98)
```

### admin.js — Polling (3 instâncias)
| Instância | Intervalo | Endpoint |
|---|---|---|
| `_statsPoller` (linhas 315-334) | 60.000ms | `loadStats()` + `loadAll()` — só quando view-main visível |
| `pollTimer` casal (linhas 992-1018) | 3.000ms | `/api/reservas/{id}/status-pesquisa-casal` |
| `_nowLineInterval` (linhas 3190-3222) | 60.000ms | `calUpdateNowLine()` — linha "agora" no calendário |

### admin.js — Navegação
```javascript
showView(id)  // linhas 674-711; display:block/none
// Persistência: sessionStorage._vst = JSON { view, histId, calOff, ... }
// Restauração: init linha 178
```

### admin.js — Nova Reserva (linhas 4119-4313)
**Trigger:** click `btn-res-salvar`

**Validações (linhas 4135-4269):**
- Sala, CPF mod11/passaporte, tipo cliente, nome, email
- Quarto (obrigatório para hóspede)
- Telefone: BR (10-11 dígitos) ou intl (+8+)
- Data: não no passado (timezone Fortaleza)
- Horário: 09:00-22:00
- Tratamento + massoterapeuta
- Casal: massoterapeuta obrigatória e diferente de Pessoa 1
- Conflito local via `calDetectarConflito()` antes do POST

**POST fields:** `sala, tipo_cliente, cliente, apto, email, telefone, tratamento, data, hora_inicio, hora_fim, linha, tipo_massagem_id, massagista_id, tipo_doc, doc, quarto, idioma, nacionalidade` + campos `*2` para casal

**409 com objeto:** `calMostrarConflito()` + recarrega agenda

### admin.js — Clientes 360 (linhas 5316-5597)
- Busca: debounce 250ms → POST `/api/clientes?q=`
- `selectCliente(id)` → GET `/api/clientes/{id}` → `renderClienteDetail()`
- 4 abas: Tratamentos / Anamneses / Pesquisas / Produtos
- Modal anamnese: GET `/api/clientes/anamnese/{perfilId}` → 6 seções renderizadas
- Guard anti-duplo-clique: `_anamReadonlyAbrindo` (linha 1148)

### admin.js — Drag-and-Drop Anamnese (linhas 7924-8154)
- API: **Pointer Events** (não Drag API clássica)
- `_wireDragReorder(prefix)` — `pointerdown` em `.drag-handle`
- Visual: placeholder borda tracejada dourada + row flutuante (scale 1.03, rotate -0.6°)
- FLIP animation via `requestAnimationFrame`
- Out-of-bounds: classe `drag-out-bounds` (outline vermelho)
- Persistência: `PUT /api/qualidade/admin/pesquisa-pergunta/{assocId}` com `{ ordem: (i+1)*10 }`

---

## public/spa-profile.js

### Funções Principais
| Linha | Função |
|---|---|
| 21 | `validarCPF()` — mod11 completo |
| 36 | `validarPassaporte()` — `[A-Z0-9]{5,20}` |
| 46 | `validarTelefoneFlex()` — BR (DDD+10/11) ou E.164 |
| 78 | `renderPills()` — checkboxes Facial/Corpo |
| 102 | `initCanvas()` — assinatura HTML5, DPR-aware |
| 219 | `validateAll()` |
| 329 | `collectData()` |
| 369 | `handleSubmit()` — POST /api/spa/perfil |
| 482 | `applyLocale()` — 7 idiomas |
| 564 | `loadLocale()` — GET /locales/{lang}.json |
| 844 | `applyAnamneseConfig()` — config dinâmica |
| 1140 | `_tentarPrePreencherHistorico()` |
| 1166 | `_aplicarPerfilNoForm()` — campos VAZIOS apenas; nunca sobrescreve `info_medica` |

### Canvas Assinatura
```javascript
ctx.strokeStyle = '#241508'  // marrom
ctx.lineWidth = 2.2
ctx.lineCap = ctx.lineJoin = 'round'
// mouse + touch via eventos nativos
// retorno: canvas.toDataURL('image/png')
```

### Fluxo Token/Histórico
- `?t=TOKEN` → GET `/api/spa/documento?t=TOKEN` → pré-preenche campos
- 410 → expirado; 409 → já respondida
- CPF 11 dígitos → GET `/api/spa/historico?documento=&tipo_documento=cpf` → pré-fill campos vazios

### POST /api/spa/perfil
```json
{
  "nome","sobrenome","tipo_documento","documento","email","telefone",
  "data_nascimento","rotina_facial":[],"rotina_corporal":[],
  "produto_especifico","pressao_massagem","info_medica",
  "consentimento_saude":bool,"consentimento_marketing":bool,
  "canais_marketing":[],"assinatura_data_url","idioma",
  "documento_token","quarto","respostas_extras":{chave:valor}
}
```

---

## public/terapeuta.html (652 linhas)

- Mobile-first, tema verde escuro (#202C28) com acentos dourados
- Auth: nome + PIN → cookie `spa_terapeuta_sess`
- Funções: `carregarNomes()`, `checarSessao()`, `carregarAgenda()`, `abrirDetalhe(id)`, `logout`
- Helpers: `toLocalISO()`, `getWeekDates()`, `labelDiaSemana()`, `escalaDia()`
- Toggle: Hoje / Semana

## public/gestao-qualidade.html (577 linhas)

- Dashboard desktop, JetBrains Mono; tema dark/light
- Cores: verde (#15705A), ouro (#9C5843), vermelho (#B85450)
- `fetchStats()` → GET `/api/gq/stats?slug=spa-locc-v1&from&to&filtros`
- `fetchRespostas()` → paginação 20/página
- KPIs: grid 5 colunas; gráficos de barras
- Filtros: tipo, origem, período, nome/email
- Timestamp: `setInterval(render, 60000)`
- `verResposta(id)` → `window.open('/admin.html#resposta-'+id)`

---

## scripts/ (14 scripts)

| Script | Propósito | Idempotente | Flag |
|---|---|---|---|
| `seed.js` | 20 feedbacks aleatórios | Não | — |
| `migrar-clientes.js` | spa_perfis → clientes | Não | `--apply` |
| `reset-perguntas-tratamentos.js` | Zera perguntas/tratamentos | Sim | `--apply` |
| `reset-completo.js` | Reset total (preserva admin_users, massagistas, system_meta) | Sim | `--apply` |
| `repopular-tratamentos.js` | Reconstrói catálogo Gran SPA L'Occitane | Sim | `--apply` |
| `repopular-anamnese.js` | Recria spa-locc-v1 e spa-anamnese-v1 | Sim | `--apply` |
| `traduzir-pesquisa-satisfacao.js` | Traduz 6 idiomas via Claude Haiku | Sim (UPSERT) | — |
| `seed-traducoes-locc.js` | Traduções estáticas revisadas (produção) | Sim (UPSERT) | `--apply` |
| `retraduzir-perguntas.js` | Re-traduz perguntas ativas | Sim | `--apply` |
| `test-trava-anamnese.js` | Testa lock link único (8 cenários, cleanup auto) | Sim | — |
| `test-janela-anamnese.js` | Testa regra 10min após hora_inicio | Sim | — |
| `test-receita-local.js` | Valida comissões vs planilha | Sim | — |
| `seed-duo-test.cjs` | 1 reserva DUO para auditoria | Não | — |
| `seed-idioma-test.cjs` | 2 feedbacks em 'en' para auditoria | Não | — |

**Regra:** todos destrutivos são **dry-run por padrão** → precisam `--apply`

---

## Infra

### Dockerfile
- Base: `node:20-alpine`
- Instala `python3 make g++` (necessário para `better-sqlite3`)
- Build Vite → `/app/public/`
- `CMD: node src/server.js` (NODE_ENV=production)

### fly.toml
- App: `pesquisa-satisfacao` | Região: GRU
- `min_machines_running=1` (sempre ligado)
- Volume: `feedback_data` → `/app/data`
- Health: GET `/api/health` a cada 30s
- RAM: 256MB, deploy timeout 180s

### CI/CD
**fly-deploy.yml:** `node --check` em 6 arquivos + concurrency mutex + `flyctl --remote-only`  
**deploy.yml:** curl polling 30 tentativas × 5s em `/api/health`

---

## Segurança

| Problema | Detalhe |
|---|---|
| ⚠️ `token_github.txt` | **TOKEN FlyV1 REAL** — revogar em fly.io + remover histórico git (BFG/filter-repo) |
| `cors()` sem restrições | Aceita qualquer origem |
| Rate limit só no feedback | Rotas admin/reservas sem proteção |
| `requireWrite` bloqueia admin | Lógica invertida — possível bug legado |
| Fallback tradução silencioso | Retorna pt-BR sem avisar se MyMemory falhar |
| ANTHROPIC_API_KEY ausente | Não está no .env.example |

---

## Ecossistema

| Sistema | URL | Relação |
|---|---|---|
| Hub | hub-granmarquise.fly.dev | SSO provider, proxy caller |
| PesquisaSPA | pesquisa-satisfacao.fly.dev | Satélite SSO, origin dos dados |
| GestaoQualidade | gestao-qualidade-granmarquise.fly.dev | Proxy para `/api/gq/*` |

```
gestao-qualidade → pesquisa-satisfacao.fly.dev/api/gq/*
GestaoQualidade não tem backend próprio
```

### seed-data/receita-2026.json
- 380 lançamentos, Janeiro–Maio 2026
- 6 massagistas (por matrícula)
- Exportado de planilha em 25/06/2026

## Escala ↔ Reservas (integração, 2026-07-09)

### Paridade escala mensal (escala-spa.html + cadastros.js + db.js)
- `PUT/DELETE /api/escala-spa/:mId/:data` valida data REAL (`dataRealValida`, rejeita 2026-13-45) e massagista existente/ativa (404/400)
- **Histórico por célula**: tabela `turno_historico` (massagista_id, data, antes, depois, usuario, origem 'manual'|'aplicar-padrao', criado_em) — capturado no PUT/DELETE/aplicar-padrao; `GET /api/escala-spa/historico/:mId/:data`; UI: botão "📜 Histórico da célula" no picker → popover `#hist-pop`
- Auditoria: rótulos 'Escala mensal' + ações (audit.js ROTULOS + admin.js _AUD_*); `POST /cf-acumulado` em ROTAS_IGNORAR (era ruído); `aplicar-padrao` → ação `aplicar_padrao_escala`
- Rollback do save otimista: `saveTurno(mId, data, turno, anterior)` restaura célula em 403/!ok/catch
- aplicar-padrao pula no-ops (total = células efetivamente alteradas) e grava histórico por célula

### Disponibilidade por escala (fonte da verdade: mensal → semanal → sem-escala)
- `avaliarEscalaMassagista(m, data, horaIni, horaFim, ctx)` em db.js + `contextoEscalaDia(data)`:
  - turno status (X/FE/AT/AA/CF/CH/LS/LC/F) → indisponível com motivo
  - turno "HH:MM" → janela [entrada, min(entrada+9h, 22:00)]; composite "e|s" usa saída real
  - sem turno mas data lançada (outras têm) → 'não escalada no dia'
  - data 100% sem turnos → fallback semanal (espelho de `_massagistaTrabalhaNoHorario`)
  - sem disponibilidade nem exceções → disponível fonte 'sem-escala' + aviso (operação nunca trava)
- `GET /api/escala-spa/disponibilidade?data&hora_inicio&hora_fim` → `{ok, lancada, items:[{massagista_id, disponivel, fonte, motivo, faixa, aviso}]}`

### Seletor de massoterapeuta (admin.js modal reserva)
- `_fetchEscalaAval` (cache por data|horas, descarte de resposta antiga, retry em falha) + `_escalaFiltra` (fail-open p/ filtro semanal local) + aviso "⚠ Escala mensal não lançada" como 1º item da lista
- POST `/api/reservas` revalida escala (P1 e P2, TODAS as violações num único erro) → **409 `tipo:'escala'`** `{motivo, fonte, faixa, massagista, override_permitido}`; body `override_escala:true` pula (auditado); handler no btn-res-salvar oferece confirm() de override
- Editar célula com reservas na data → salva e response traz `reservas_conflitantes:[{id, cliente, sala, hora_inicio, hora_fim}]` → modal `#conf-esc-overlay` no escala-spa.html (nada é cancelado)

### Sincronização em tempo real (auditoria 2026-07-09)
- `calOpenModal` invalida `_escalaAvalKey` e re-renderiza os 2 comboboxes a cada abertura (escala editada em outra aba reflete no reopen)
- escala-spa.html recarrega a grade em visibilitychange/focus (debounce 5s)
- **Férias** (`ferias_massagista`) entram em `contextoEscalaDia.feriasDia` → `avaliarEscalaMassagista` veta com fonte 'ferias'; **turno manual explícito vence férias** (volta antecipada); aplicar-padrao pula dias de férias
- **App da terapeuta**: `GET /api/terapeuta/escala?from&to` (escopado ao token) devolve escala resolvida por dia; banner de terapeuta.html prioriza mensal→férias→semanal (fallback local antigo se fetch falhar)
- view-escala do admin rotulada "Padrão semanal (template)" com link para a Escala Mensal

### Invariantes
- Escala semanal padrão (disponibilidade/excecoes/padrao_entrada) INTACTA — segue como template do aplicar-padrao e fallback
- Contratos de endpoints existentes inalterados (só extensões aditivas)
- E2E: 4 passagens (41+41+41+52 asserts, 2026-07-09) — servidor local, DB restaurado após
