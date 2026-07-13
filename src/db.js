import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'feedback.db');

let _db = null;

export function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

export function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      apto TEXT,
      email TEXT NOT NULL,
      telefone TEXT,
      data_tratamento TEXT,
      tratamento_realizado TEXT,
      nome_massoterapeuta TEXT,
      servicos_expectativa TEXT,
      servicos_explicacao TEXT,
      servicos_atitude TEXT,
      servicos_tecnica TEXT,
      servicos_comentario TEXT,
      instalacoes_conforto TEXT,
      instalacoes_organizacao TEXT,
      instalacoes_conveniencia TEXT,
      instalacoes_comentario TEXT,
      recomenda TEXT,
      recomenda_qual TEXT,
      recomenda_porque TEXT,
      tipo_cliente TEXT,
      origem TEXT NOT NULL DEFAULT 'hospede',
      ip_address TEXT,
      user_agent TEXT,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_submitted ON feedback(submitted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_origem ON feedback(origem);
    CREATE INDEX IF NOT EXISTS idx_feedback_tipo_cliente ON feedback(tipo_cliente);

    CREATE TABLE IF NOT EXISTS massagistas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tipos_massagem (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      descricao TEXT,
      duracao_min INTEGER,
      preco REAL,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reservas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sala INTEGER NOT NULL CHECK(sala IN (1,2,3,4,5)),
      cliente TEXT NOT NULL,
      tipo_cliente TEXT,
      apto TEXT,
      email TEXT,
      telefone TEXT,
      tratamento TEXT,
      data TEXT NOT NULL,
      hora_inicio TEXT NOT NULL,
      hora_fim TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reservas_data         ON reservas(data);
    CREATE INDEX IF NOT EXISTS idx_reservas_sala_data     ON reservas(sala, data);
    CREATE INDEX IF NOT EXISTS idx_reservas_massagista    ON reservas(massagista_id, data);
    CREATE INDEX IF NOT EXISTS idx_feedback_massoterapeuta ON feedback(nome_massoterapeuta);

    CREATE TABLE IF NOT EXISTS survey_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      reserva_id INTEGER NOT NULL,
      liberada_em TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_survey_tokens_token ON survey_tokens(token);

    CREATE TABLE IF NOT EXISTS spa_perfis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      sobrenome TEXT NOT NULL,
      tipo_documento TEXT NOT NULL DEFAULT 'cpf',
      documento TEXT NOT NULL,
      email TEXT NOT NULL,
      telefone TEXT NOT NULL,
      data_nascimento TEXT,
      rotina_facial TEXT,
      rotina_corporal TEXT,
      produto_especifico TEXT,
      pressao_massagem TEXT,
      info_medica TEXT NOT NULL DEFAULT '',
      consentimento_saude INTEGER NOT NULL DEFAULT 0,
      consentimento_marketing INTEGER NOT NULL DEFAULT 0,
      canais_marketing TEXT,
      assinatura_data_url TEXT,
      idioma TEXT DEFAULT 'pt-BR',
      reserva_id INTEGER,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration: add descricao column to tipos_massagem if absent
  try { db.exec(`ALTER TABLE tipos_massagem ADD COLUMN descricao TEXT`); } catch {}
  // Migration: add combo/categoria/linhas columns to tipos_massagem
  for (const col of [
    `tipo TEXT NOT NULL DEFAULT 'individual'`,
    'categoria TEXT',
    'componentes TEXT',
    'linhas TEXT',
  ]) {
    try { db.exec(`ALTER TABLE tipos_massagem ADD COLUMN ${col}`); } catch {}
  }
  // Migration: add nome e role a admin_users
  for (const col of ['nome TEXT', `role TEXT NOT NULL DEFAULT 'admin'`]) {
    try { db.exec(`ALTER TABLE admin_users ADD COLUMN ${col}`); } catch {}
  }
  // Migration: add enriched fields to massagistas
  for (const col of [
    'matricula TEXT',
    'especialidade_original TEXT',
    'funcao TEXT',
    'vinculo TEXT',
    `bilingue INTEGER NOT NULL DEFAULT 0`,
    'disponibilidade TEXT',
    'excecoes TEXT',
  ]) {
    try { db.exec(`ALTER TABLE massagistas ADD COLUMN ${col}`); } catch {}
  }
  // Migration: set default funcao for existing records that have null
  try { db.exec(`UPDATE massagistas SET funcao = 'Massoterapeuta' WHERE funcao IS NULL OR funcao = ''`); } catch {}
  // Migration: add email field to massagistas for Hub SSO login
  try { db.exec(`ALTER TABLE massagistas ADD COLUMN email TEXT`); } catch {}
  // Migration: padrão de entrada por dia da semana (populado via seedPadraoEntrada)
  try { db.exec(`ALTER TABLE massagistas ADD COLUMN padrao_entrada TEXT`); } catch {}
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_massagistas_email ON massagistas(email) WHERE email IS NOT NULL AND email <> ''`); } catch {}
  // Migration: tabela de férias programadas por massoterapeuta
  try { db.exec(`CREATE TABLE IF NOT EXISTS ferias_massagista (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    massagista_id INTEGER NOT NULL,
    data_inicio TEXT NOT NULL,
    data_fim TEXT NOT NULL,
    observacao TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`); } catch {}
  // Migration: turnos diários da escala mensal (09:00/14:00/17:30/X/FE/AT/AA/etc.)
  try { db.exec(`CREATE TABLE IF NOT EXISTS turno_massagista (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    massagista_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    turno TEXT NOT NULL,
    obs TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(massagista_id, data)
  )`); } catch {}
  // Migration: auditoria de alterações de padrao_entrada
  try { db.exec(`CREATE TABLE IF NOT EXISTS padrao_entrada_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    massagista_id INTEGER NOT NULL,
    antes TEXT,
    depois TEXT,
    usuario TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`); } catch {}
  // Migration: histórico antes→depois por célula da escala mensal (mesmo padrão de padrao_entrada_log)
  try { db.exec(`CREATE TABLE IF NOT EXISTS turno_historico (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    massagista_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    antes TEXT,
    depois TEXT,
    usuario TEXT,
    origem TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_turno_hist_cell ON turno_historico (massagista_id, data)'); } catch {}
  // Migration: add enriched fields to reservas if absent
  for (const col of ['tipo_cliente TEXT', 'apto TEXT', 'email TEXT', 'telefone TEXT', 'tratamento TEXT', 'linha TEXT', 'tipo_massagem_id INTEGER', 'massagista_id INTEGER']) {
    try { db.exec(`ALTER TABLE reservas ADD COLUMN ${col}`); } catch {}
  }
  // Migration: campos pessoa 2 (casal)
  for (const col of ['cliente2 TEXT','tipo_cliente2 TEXT','apto2 TEXT','email2 TEXT','telefone2 TEXT','tratamento2 TEXT','tipo_massagem_id2 INTEGER','massagista_id2 INTEGER']) {
    try { db.exec(`ALTER TABLE reservas ADD COLUMN ${col}`); } catch {}
  }
  // Migration: add liberada_em to survey_tokens
  try { db.exec(`ALTER TABLE survey_tokens ADD COLUMN liberada_em TEXT`); } catch {}
  // Migration: add respondida_em to survey_tokens
  try { db.exec(`ALTER TABLE survey_tokens ADD COLUMN respondida_em TEXT`); } catch {}
  // Migration: pessoa do token (1=cliente principal, 2=cliente2 do casal).
  // Default NULL = compat com tokens antigos (tratados como pessoa=1).
  try { db.exec(`ALTER TABLE survey_tokens ADD COLUMN pessoa INTEGER`); } catch {}
  // Migration: feedback_id do token (gravado quando hospede responde, permite
  // mostrar "Pesquisa preenchida" no modal casal e abrir o detalhe respondido).
  try { db.exec(`ALTER TABLE survey_tokens ADD COLUMN feedback_id INTEGER`); } catch {}
  // Migration: idioma detectado por IA no feedback
  try { db.exec(`ALTER TABLE feedback ADD COLUMN idioma_detectado TEXT`); } catch {}

  // Migration: spa pre-treatment document token fields
  for (const col of ['documento_token TEXT', 'documento_token_expiry TEXT', 'idioma_documento TEXT', 'documento_enviado_em TEXT', 'documento_perfil_id INTEGER']) {
    try { db.exec(`ALTER TABLE reservas ADD COLUMN ${col}`); } catch {}
  }
  // Migration: token separado para o 2o hospede em reservas casal
  // (cliente2). Antes o token era unico por reserva e os dois hospedes
  // de uma massagem casal acabavam compartilhando o mesmo link.
  for (const col of ['documento_token2 TEXT', 'documento_token_expiry2 TEXT', 'documento_perfil_id2 INTEGER']) {
    try { db.exec(`ALTER TABLE reservas ADD COLUMN ${col}`); } catch {}
  }
  // Migration: idioma escolhido no cadastro da sessão (pessoa 1 e 2)
  try { db.exec(`ALTER TABLE reservas ADD COLUMN idioma TEXT`); } catch {}
  try { db.exec(`ALTER TABLE reservas ADD COLUMN idioma2 TEXT`); } catch {}
  // Migration: nacionalidade por pessoa na reserva (pré-preenchimento da anamnese)
  try { db.exec(`ALTER TABLE reservas ADD COLUMN nacionalidade TEXT`); } catch {}
  try { db.exec(`ALTER TABLE reservas ADD COLUMN nacionalidade2 TEXT`); } catch {}
  // Migration: suporte a passaporte como alternativa ao CPF
  try { db.exec(`ALTER TABLE clientes ADD COLUMN passaporte TEXT`); } catch {}
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_passaporte ON clientes(passaporte) WHERE passaporte IS NOT NULL AND passaporte <> ''`); } catch {}
  try { db.exec(`ALTER TABLE reservas ADD COLUMN passaporte TEXT`); } catch {}

  // Tabela de auditoria das mudancas no editor de anamnese / pesquisa
  // de satisfacao. Registra criar/editar/remover/excluir/reativar de
  // perguntas, secoes, opcoes e associacoes pesquisa_pergunta.
  db.exec(`
    CREATE TABLE IF NOT EXISTS anamnese_auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      usuario TEXT,
      acao TEXT NOT NULL,
      entidade TEXT NOT NULL,
      entidade_id INTEGER,
      descricao TEXT,
      dados_antes TEXT,
      dados_depois TEXT,
      pesquisa_slug TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_anamnese_auditoria_criado ON anamnese_auditoria(criado_em DESC);
    CREATE INDEX IF NOT EXISTS idx_anamnese_auditoria_pesquisa ON anamnese_auditoria(pesquisa_slug);
  `);
  // Migration: admin que criou a reserva
  try { db.exec(`ALTER TABLE reservas ADD COLUMN criado_por TEXT`); } catch {}
  // Migration: nacionalidade do cliente
  try { db.exec(`ALTER TABLE clientes ADD COLUMN nacionalidade TEXT`); } catch {}
  // Migration: nacionalidade na anamnese (spa_perfis)
  try { db.exec(`ALTER TABLE spa_perfis ADD COLUMN nacionalidade TEXT`); } catch {}

  // ── Modulo Receita & Comissao (planilha SPA 2026) ────────────────────────
  // Tabela de lancamentos manuais de receita por (massagista, terapia, faixa
  // de desconto, mes). Fonte: planilha RECEITA TERAPIAS - SPA 2026.xlsx.
  // Idempotente: a UNIQUE(...) permite reseed com INSERT OR REPLACE sem
  // duplicar. NAO mexe em reservas/feedback.
  db.exec(`
    CREATE TABLE IF NOT EXISTS receita_lancamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ano INTEGER NOT NULL,
      mes INTEGER NOT NULL,
      massagista_id INTEGER NOT NULL REFERENCES massagistas(id) ON DELETE CASCADE,
      tipo_massagem_id INTEGER NOT NULL REFERENCES tipos_massagem(id) ON DELETE CASCADE,
      faixa_desconto TEXT NOT NULL CHECK(faixa_desconto IN ('NORMAL','P10','P20','P30','P50')),
      quantidade INTEGER NOT NULL DEFAULT 0,
      preco_base REAL NOT NULL,
      preco_aplicado REAL NOT NULL,
      receita REAL NOT NULL,
      fonte TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ano, mes, massagista_id, tipo_massagem_id, faixa_desconto)
    );
    CREATE INDEX IF NOT EXISTS idx_receita_lanc_ano_mes ON receita_lancamentos(ano, mes);
    CREATE INDEX IF NOT EXISTS idx_receita_lanc_mass    ON receita_lancamentos(massagista_id, ano, mes);

    CREATE TABLE IF NOT EXISTS comissao_config (
      id INTEGER PRIMARY KEY CHECK(id=1),
      base_rate REAL NOT NULL,
      tiers TEXT NOT NULL,
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO comissao_config (id, base_rate, tiers)
    VALUES (1, 0.10, '[{"min_nota":8.5,"bonus":0.05,"label":"+5% por excelência (≥94%)"},{"min_nota":7.5,"bonus":0.02,"label":"+2% por bom desempenho (≥83%)"}]');
  `);

  // ── Modulo Gestao da Qualidade / Pesquisas configuraveis ─────────────────
  // Additive-only. Nenhuma das tabelas existentes (feedback, reservas, etc.) e'
  // tocada. Todas as migrations sao idempotentes (CREATE IF NOT EXISTS).
  db.exec(`
    CREATE TABLE IF NOT EXISTS escala (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL,
      criada_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS escala_opcao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      escala_id INTEGER NOT NULL REFERENCES escala(id) ON DELETE CASCADE,
      chave TEXT NOT NULL,
      valor_numerico REAL,
      polaridade TEXT NOT NULL DEFAULT 'neutral',
      ordem INTEGER NOT NULL DEFAULT 0,
      UNIQUE(escala_id, chave)
    );
    CREATE TABLE IF NOT EXISTS escala_opcao_traducao (
      escala_opcao_id INTEGER NOT NULL REFERENCES escala_opcao(id) ON DELETE CASCADE,
      idioma TEXT NOT NULL,
      rotulo TEXT NOT NULL,
      PRIMARY KEY (escala_opcao_id, idioma)
    );
    CREATE TABLE IF NOT EXISTS pergunta_satisfacao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL,
      escala_id INTEGER REFERENCES escala(id),
      mapeia_campo_legado TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      criada_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pergunta_traducao (
      pergunta_id INTEGER NOT NULL REFERENCES pergunta_satisfacao(id) ON DELETE CASCADE,
      idioma TEXT NOT NULL,
      rotulo TEXT NOT NULL,
      ajuda TEXT,
      PRIMARY KEY (pergunta_id, idioma)
    );
    CREATE TABLE IF NOT EXISTS pesquisa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      titulo TEXT NOT NULL,
      descricao TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      versao INTEGER NOT NULL DEFAULT 1,
      app_escopo TEXT NOT NULL DEFAULT 'all',
      publicada_em TEXT,
      criada_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizada_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(slug, versao)
    );
    CREATE TABLE IF NOT EXISTS pesquisa_traducao (
      pesquisa_id INTEGER NOT NULL REFERENCES pesquisa(id) ON DELETE CASCADE,
      idioma TEXT NOT NULL,
      titulo TEXT NOT NULL,
      descricao TEXT,
      PRIMARY KEY (pesquisa_id, idioma)
    );
    CREATE TABLE IF NOT EXISTS pesquisa_secao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pesquisa_id INTEGER NOT NULL REFERENCES pesquisa(id) ON DELETE CASCADE,
      chave TEXT NOT NULL,
      ordem INTEGER NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      UNIQUE(pesquisa_id, chave)
    );
    CREATE TABLE IF NOT EXISTS pesquisa_secao_traducao (
      pesquisa_secao_id INTEGER NOT NULL REFERENCES pesquisa_secao(id) ON DELETE CASCADE,
      idioma TEXT NOT NULL,
      titulo TEXT NOT NULL,
      PRIMARY KEY (pesquisa_secao_id, idioma)
    );
    CREATE TABLE IF NOT EXISTS pesquisa_pergunta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pesquisa_id INTEGER NOT NULL REFERENCES pesquisa(id) ON DELETE CASCADE,
      pergunta_id INTEGER NOT NULL REFERENCES pergunta_satisfacao(id),
      secao_id INTEGER REFERENCES pesquisa_secao(id) ON DELETE SET NULL,
      ordem INTEGER NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      obrigatoria INTEGER NOT NULL DEFAULT 0,
      UNIQUE(pesquisa_id, pergunta_id)
    );
    CREATE TABLE IF NOT EXISTS meta_pergunta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pesquisa_id INTEGER NOT NULL REFERENCES pesquisa(id) ON DELETE CASCADE,
      pergunta_id INTEGER NOT NULL REFERENCES pergunta_satisfacao(id),
      tipo_meta TEXT NOT NULL,
      valor_alvo REAL NOT NULL,
      valido_de TEXT,
      valido_ate TEXT,
      criada_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS meta_questionario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pesquisa_id INTEGER NOT NULL REFERENCES pesquisa(id) ON DELETE CASCADE,
      tipo_meta TEXT NOT NULL,
      valor_alvo REAL NOT NULL,
      valido_de TEXT,
      valido_ate TEXT,
      criada_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS resposta_pesquisa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pesquisa_id INTEGER NOT NULL REFERENCES pesquisa(id),
      pesquisa_versao INTEGER NOT NULL,
      app_origem TEXT NOT NULL DEFAULT 'spa',
      cliente_id INTEGER,
      reserva_id INTEGER,
      feedback_id INTEGER,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS resposta_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resposta_pesquisa_id INTEGER NOT NULL REFERENCES resposta_pesquisa(id) ON DELETE CASCADE,
      pergunta_chave TEXT NOT NULL,
      valor_texto TEXT,
      valor_numerico REAL,
      escala_opcao_chave TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_resposta_pesquisa     ON resposta_pesquisa(pesquisa_id, submitted_at);
    CREATE INDEX IF NOT EXISTS idx_resposta_pesquisa_app ON resposta_pesquisa(app_origem, submitted_at);
    CREATE INDEX IF NOT EXISTS idx_resposta_item_resp    ON resposta_item(resposta_pesquisa_id);
    CREATE INDEX IF NOT EXISTS idx_pesquisa_slug_ativo   ON pesquisa(slug) WHERE ativo=1;

    -- Opções de perguntas dos tipos 'unica'/'multipla' que NÃO usam escala
    -- (ex.: rotina_facial, tipo_documento, canais_marketing da anamnese).
    CREATE TABLE IF NOT EXISTS pergunta_opcao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pergunta_id INTEGER NOT NULL REFERENCES pergunta_satisfacao(id) ON DELETE CASCADE,
      chave TEXT NOT NULL,
      valor_numerico REAL,
      ordem INTEGER NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      UNIQUE(pergunta_id, chave)
    );
    CREATE TABLE IF NOT EXISTS pergunta_opcao_traducao (
      pergunta_opcao_id INTEGER NOT NULL REFERENCES pergunta_opcao(id) ON DELETE CASCADE,
      idioma TEXT NOT NULL,
      rotulo TEXT NOT NULL,
      PRIMARY KEY (pergunta_opcao_id, idioma)
    );
    CREATE INDEX IF NOT EXISTS idx_pergunta_opcao_perg ON pergunta_opcao(pergunta_id, ordem);

    -- Cadastro central de clientes (Módulo 1).
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpf TEXT,
      passaporte TEXT,
      nome TEXT NOT NULL,
      email TEXT,
      telefone TEXT,
      data_nascimento TEXT,
      locale_pref TEXT DEFAULT 'pt-BR',
      nacionalidade TEXT,
      observacao TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_cpf ON clientes(cpf) WHERE cpf IS NOT NULL AND cpf <> '';
    CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes(nome);

    -- Produtos adquiridos pelo cliente (conceito novo - Módulo 1).
    CREATE TABLE IF NOT EXISTS cliente_produto (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      produto_nome TEXT NOT NULL,
      categoria TEXT,
      valor REAL,
      data_compra TEXT,
      reserva_id INTEGER REFERENCES reservas(id) ON DELETE SET NULL,
      observacao TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cliente_produto_cli ON cliente_produto(cliente_id, data_compra);

    -- Flags do sistema (controle de seeds e migrações pontuais).
    CREATE TABLE IF NOT EXISTS system_meta (
      chave TEXT PRIMARY KEY,
      valor TEXT,
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Quartos do Hotel Gran Marquise (fonte da verdade).
    -- A categoria 'gran_class' é derivada deste cadastro — nunca digitada
    -- à mão. Andares 14 e 15 são mistos (standard + gran_class no mesmo andar).
    CREATE TABLE IF NOT EXISTS quartos (
      numero TEXT PRIMARY KEY,
      andar INTEGER NOT NULL,
      categoria TEXT NOT NULL CHECK (categoria IN ('standard','gran_class')),
      ativo INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_quartos_andar ON quartos(andar);
    CREATE INDEX IF NOT EXISTS idx_quartos_categoria ON quartos(categoria);

    -- Auditoria: log de TODAS as ações que modificam o sistema. Alimentado
    -- automaticamente por middleware em qualquer POST/PUT/DELETE, mais
    -- eventos explícitos de login/logout.
    CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      ator_username TEXT,
      ator_role TEXT,
      ator_ip TEXT,
      metodo TEXT,
      rota TEXT,
      acao TEXT,
      recurso TEXT,
      recurso_id TEXT,
      status INTEGER,
      detalhes TEXT,
      sucesso INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_auditoria_data    ON auditoria(criado_em DESC);
    CREATE INDEX IF NOT EXISTS idx_auditoria_ator    ON auditoria(ator_username);
    CREATE INDEX IF NOT EXISTS idx_auditoria_recurso ON auditoria(recurso, recurso_id);
    CREATE INDEX IF NOT EXISTS idx_auditoria_acao    ON auditoria(acao);
  `);

  // Migration: atualiza CHECK(sala IN (...)) em DBs antigos. Versoes pre
  // sala 4/5 criaram reservas com CHECK(sala IN (1,2,3)); CREATE TABLE IF
  // NOT EXISTS nao redefine constraint, entao sala 5 (Espaco Beleza) e
  // sala 4 batiam SQLITE_CONSTRAINT_CHECK ao tentar inserir. Idempotente:
  // so executa se o CHECK atual nao for exatamente (1,2,3,4,5).
  try {
    const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='reservas'`).get();
    if (row?.sql) {
      const checkRe = /CHECK\s*\(\s*sala\s+IN\s*\([^)]*\)\s*\)/i;
      const jaAtualizadoRe = /CHECK\s*\(\s*sala\s+IN\s*\(\s*1\s*,\s*2\s*,\s*3\s*,\s*4\s*,\s*5\s*\)\s*\)/i;
      if (checkRe.test(row.sql) && !jaAtualizadoRe.test(row.sql)) {
        const novoSql = row.sql.replace(checkRe, 'CHECK(sala IN (1,2,3,4,5))');
        const sv = db.pragma('schema_version', { simple: true });
        db.unsafeMode(true);
        try {
          db.exec(`PRAGMA writable_schema = 1`);
          db.prepare(`UPDATE sqlite_master SET sql = ? WHERE type = 'table' AND name = 'reservas'`).run(novoSql);
          db.exec(`PRAGMA writable_schema = 0`);
          // Bumpa schema_version pra SQLite reparsear o schema na proxima query.
          db.exec(`PRAGMA schema_version = ${sv + 1}`);
        } finally {
          db.unsafeMode(false);
        }
        const ic = db.prepare(`PRAGMA integrity_check`).get();
        if (ic?.integrity_check !== 'ok') {
          console.error('[migration sala CHECK] integrity_check falhou:', ic);
        } else {
          console.log('[migration sala CHECK] aplicado: sala IN (1,2,3,4,5)');
        }
      }
    }
  } catch (e) { console.error('[migration sala CHECK]', e?.message || e); }

  // Vínculos cliente_id/cpf adicionados de forma idempotente.
  try { db.exec(`ALTER TABLE reservas    ADD COLUMN cliente_id INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE reservas    ADD COLUMN cpf TEXT`); } catch {}
  try { db.exec(`ALTER TABLE reservas    ADD COLUMN quarto TEXT`); } catch {}
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN cliente_id INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN quarto TEXT`); } catch {}
  // Identidade da pessoa dentro da reserva (1 = principal, 2 = casal).
  // Passa a ser a chave de upsert em (reserva_id, pessoa) — sem isso, o
  // hospede 2 de um casal sobrescrevia a anamnese do hospede 1 quando
  // ambos preenchiam no mesmo idioma.
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN pessoa INTEGER NOT NULL DEFAULT 1`); } catch {}
  // Backfill idempotente: registros ja referenciados como pessoa 2 na
  // tabela reservas viram pessoa=2.
  try { db.exec(`UPDATE spa_perfis SET pessoa=2 WHERE id IN (SELECT documento_perfil_id2 FROM reservas WHERE documento_perfil_id2 IS NOT NULL)`); } catch {}
  // Prova de consentimento LGPD (Passo 6 / Item 7): texto exato exibido +
  // hash SHA-256 + versao (16 chars do hash) + timestamp. Sem IP por
  // decisao explicita (timestamp+versao+hash bastam como prova).
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN consentimento_saude_texto TEXT`); } catch {}
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN consentimento_saude_hash TEXT`); } catch {}
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN consentimento_saude_versao TEXT`); } catch {}
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN consentimento_saude_em TEXT`); } catch {}
  // Cross-check de adulteracao: 1 = texto exibido ao hospede divergiu do
  // canonico do servidor (cache stale, deploy mid-sessao, etc). Nao
  // invalida a prova — a prova continua sendo o que ele leu.
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN consentimento_saude_canonico_divergente INTEGER NOT NULL DEFAULT 0`); } catch {}
  // 3o estado do cross-check (resolve ambiguidade do _divergente=0):
  //   NULL = nao havia canonico no momento (sem comparacao)
  //   1    = havia canonico, foi comparado (use o valor de _divergente)
  // Sem essa coluna, _divergente=0 colidia "bate" com "nao comparei".
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN consentimento_saude_canonico_comparado INTEGER`); } catch {}
  // HMAC do texto canonico do servidor no momento da gravacao (quando
  // existia). Permite que o controlador apresente em disputa AMBOS os
  // lados: o texto exibido ao hospede (prova juridica) E a referencia
  // oficial (canonico). Sem isso, controlador so tem o lado do titular.
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN consentimento_saude_hash_canonico TEXT`); } catch {}
  // ID da chave HMAC usada para gerar o hash. Permite rotacao de
  // segredo: hashes antigos continuam validos com a key_id de origem.
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN consentimento_saude_key_id TEXT`); } catch {}
  // Algoritmo da prova. Versionado para permitir migracao futura sem
  // invalidar provas antigas:
  //   'hmac-sha256-v1'           = HMAC apenas do texto (Passo 6 D7-D14)
  //   'hmac-sha256-composto-v1'  = HMAC de {texto,documento,reserva_id,
  //                                 assinatura_hash,consentido_em}
  //                                 (Passo 6 D19 — prova autoria + conteudo)
  // Revalidacao escolhe algoritmo pela coluna; rollback que nao suporta
  // o alg gravado deve falhar abertamente em vez de marcar adulterado.
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN consentimento_saude_alg TEXT`); } catch {}
  // Componentes do selo composto (D19): documento e reserva_id ja sao
  // colunas regulares; assinatura_hash e o SHA-256 da assinatura_data_url
  // no momento da gravacao (sem precisar do PNG bruto pra revalidar).
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN consentimento_saude_assinatura_hash TEXT`); } catch {}
  // Guard D22 (estado orfao): canonico_divergente=1 sem comparado=1 e
  // estado fisicamente possivel mas invalido. SQLite nao permite ALTER
  // ADD CHECK; corrigimos eventuais inconsistencias e prevenimos na app.
  try { db.exec(`UPDATE spa_perfis SET consentimento_saude_canonico_divergente=0 WHERE consentimento_saude_canonico_comparado IS NULL AND consentimento_saude_canonico_divergente=1`); } catch {}
  // Backfill idempotente: linhas existentes com consentimento marcado mas
  // sem hash viram versao='desconhecida' + em=criado_em. Nao falsificar
  // hash com texto atual — assume-se honestamente que nao ha prova
  // robusta dos consentimentos antigos.
  try { db.exec(`UPDATE spa_perfis SET consentimento_saude_versao='desconhecida', consentimento_saude_em=criado_em WHERE consentimento_saude=1 AND consentimento_saude_versao IS NULL`); } catch {}
  try { db.exec(`ALTER TABLE feedback    ADD COLUMN cliente_id INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE feedback    ADD COLUMN reserva_id INTEGER`); } catch {}
  // PIN hash da terapeuta (login mobile). Aditivo + idempotente.
  try { db.exec(`ALTER TABLE massagistas ADD COLUMN pin_hash TEXT`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_reservas_cliente   ON reservas(cliente_id)`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_reservas_cpf       ON reservas(cpf)`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_spa_perfis_cliente ON spa_perfis(cliente_id)`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_spa_perfis_reserva_pessoa ON spa_perfis(reserva_id, pessoa)`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_cliente   ON feedback(cliente_id)`); } catch {}

  seedTratamentosGranSpa();
  seedMassoterapeutasGranSpa();
  seedQuartosGranMarquise();
  seedPadraoEntrada();
  // Modulo Qualidade: seed e' chamado em server.js apos initDb() (ESM).

  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'TrocarEmProducao!';
  const hash = bcrypt.hashSync(adminPass, 10);
  db.prepare(`INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, 'master')
    ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`).run(adminUser, hash);

  // Migration: seed hub users com acesso ao sistema (mesma senha do admin principal)
  const hubUsers = [
    { username: 'estagio.ti@granmarquise.com.br', nome: 'Estágio TI' },
    { username: 'suporte.ti@granmarquise.com.br', nome: 'Suporte TI' },
    { username: 'richard@granmarquise.com.br', nome: 'Richard' },
    { username: 'qualidade@granmarquise.com.br', nome: 'Qualidade' },
    { username: 'spa@granmarquise.com.br', nome: 'Spa' },
  ];
  for (const u of hubUsers) {
    db.prepare(`INSERT INTO admin_users (username, password_hash, nome, role) VALUES (?, ?, ?, 'master')
      ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`).run(u.username, hash, u.nome);
  }
  // Garante que todos os usuários existentes sejam master (exceto recepcionistas com role spa)
  db.prepare(`UPDATE admin_users SET role = 'master' WHERE (role IS NULL OR role != 'master') AND role != 'spa'`).run();

  // Migration: seed recepcionistas Georgia Gomes e Julia Santos na escala
  try {
    const _mIns = db.prepare(`INSERT OR IGNORE INTO massagistas (nome, funcao, vinculo, email, padrao_entrada, ativo)
      VALUES (?, 'Recepcionista', 'Pleno', ?, ?, 1)`);
    const _mGet = db.prepare(`SELECT id FROM massagistas WHERE email = ?`);
    const _tIns = db.prepare(`INSERT OR IGNORE INTO turno_massagista (massagista_id, data, turno) VALUES (?, ?, ?)`);

    _mIns.run('GEORGIA GOMES', 'georgia.gomes@granmarquise.com.br',
      '{"dom":"12:00","seg":"15:00","ter":"FOLGA","qua":"14:00","qui":"15:00","sex":"15:00","sab":"15:00"}');
    const geId = _mGet.get('georgia.gomes@granmarquise.com.br')?.id;
    if (geId) for (const [d,t] of [
      ['2026-06-21','CH'], ['2026-06-22','16:00'], ['2026-06-23','X'],
      ['2026-06-24','14:00'], ['2026-06-25','09:00'], ['2026-06-26','14:00'],
      ['2026-06-27','09:00'], ['2026-06-28','12:00'], ['2026-06-29','16:00'],
      ['2026-06-30','X'], ['2026-07-01','14:00'], ['2026-07-02','15:00'],
      ['2026-07-03','15:00'], ['2026-07-04','15:00'], ['2026-07-06','15:00'],
      ['2026-07-07','X'], ['2026-07-08','14:00'], ['2026-07-09','15:00'],
      ['2026-07-10','15:00'], ['2026-07-11','15:00'], ['2026-07-12','12:00'],
      ['2026-07-13','15:00'], ['2026-07-14','X'], ['2026-07-15','14:00'],
      ['2026-07-16','15:00'], ['2026-07-17','15:00'], ['2026-07-18','15:00'],
      ['2026-07-19','X'], ['2026-07-20','15:00'],
    ]) _tIns.run(geId, d, t);

    _mIns.run('JULIA SANTOS', 'julia.santos@granmarquise.com.br',
      '{"dom":"09:00","seg":"09:00","ter":"14:00","qua":"FOLGA","qui":"09:00","sex":"09:00","sab":"09:00"}');
    const juId = _mGet.get('julia.santos@granmarquise.com.br')?.id;
    if (juId) for (const [d,t] of [
      ['2026-06-21','12:00'], ['2026-06-22','09:00'], ['2026-06-23','12:00'],
      ['2026-06-24','X'], ['2026-06-25','CH'], ['2026-06-26','CH'],
      ['2026-06-27','CH'], ['2026-06-28','09:00'], ['2026-06-29','09:00'],
      ['2026-06-30','14:00'], ['2026-07-01','X'], ['2026-07-02','09:00'],
      ['2026-07-03','09:00'], ['2026-07-04','09:00'], ['2026-07-06','09:00'],
      ['2026-07-07','14:00'], ['2026-07-08','X'], ['2026-07-09','09:00'],
      ['2026-07-10','09:00'], ['2026-07-11','09:00'], ['2026-07-12','X'],
      ['2026-07-13','09:00'], ['2026-07-14','14:00'], ['2026-07-15','X'],
      ['2026-07-16','09:00'], ['2026-07-17','09:00'], ['2026-07-18','09:00'],
      ['2026-07-19','12:00'], ['2026-07-20','09:00'],
    ]) _tIns.run(juId, d, t);

    // Hub users com role spa (acesso leitura+escrita na escala, sem admin master)
    for (const [username, nome] of [
      ['georgia.gomes@granmarquise.com.br', 'Georgia Gomes'],
      ['julia.santos@granmarquise.com.br', 'Julia Santos'],
    ]) {
      db.prepare(`INSERT OR IGNORE INTO admin_users (username, password_hash, nome, role) VALUES (?, ?, ?, 'spa')`)
        .run(username, hash, nome);
    }
  } catch (e) { console.error('[seed recepcionistas]', e.message); }

  // ── Gestão de Salas ─────────────────────────────────────────────────────
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS salas (
        id INTEGER PRIMARY KEY,
        nome TEXT NOT NULL,
        tipo TEXT NOT NULL DEFAULT 'individual',
        ativa INTEGER NOT NULL DEFAULT 1,
        observacao TEXT
      );

      CREATE TABLE IF NOT EXISTS sala_bloqueios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sala INTEGER NOT NULL CHECK(sala IN (1,2,3,4,5)),
        data_inicio TEXT NOT NULL,
        data_fim TEXT NOT NULL,
        motivo TEXT NOT NULL,
        bloqueado_por TEXT,
        criado_em TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_sala_bloqueios_sala ON sala_bloqueios(sala, data_inicio, data_fim);
    `);
    db.exec(`
      INSERT OR IGNORE INTO salas (id, nome, tipo) VALUES (1, 'Sala 1', 'individual');
      INSERT OR IGNORE INTO salas (id, nome, tipo) VALUES (2, 'Sala 2', 'individual');
      INSERT OR IGNORE INTO salas (id, nome, tipo) VALUES (3, 'Sala 3', 'individual');
      INSERT OR IGNORE INTO salas (id, nome, tipo) VALUES (4, 'Sala 4', 'individual');
      INSERT OR IGNORE INTO salas (id, nome, tipo, observacao) VALUES (5, 'Espaço Beleza', 'beleza', 'Área de serviços de beleza');
    `);
  } catch (e) { console.error('[migration salas]', e.message); }
}

// Retorna saldo CF: feriados trabalhados (ganhos) − dias com turno='CF' (usados)
export function calcularSaldoCf(datas) {
  const db = getDb();
  const saldo = {};
  if (Array.isArray(datas) && datas.length) {
    const ph = datas.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT massagista_id, COUNT(*) as n FROM turno_massagista WHERE data IN (${ph}) AND turno LIKE '%:%' GROUP BY massagista_id`).all(...datas))
      saldo[r.massagista_id] = (saldo[r.massagista_id] || 0) + r.n;
  }
  for (const r of db.prepare(`SELECT massagista_id, COUNT(*) as n FROM turno_massagista WHERE turno = 'CF' GROUP BY massagista_id`).all())
    saldo[r.massagista_id] = (saldo[r.massagista_id] || 0) - r.n;
  return saldo;
}

export function inserirFeedback(dados) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO feedback (
      nome, apto, email, telefone, data_tratamento, tratamento_realizado,
      nome_massoterapeuta, servicos_expectativa, servicos_explicacao,
      servicos_atitude, servicos_tecnica, servicos_comentario,
      instalacoes_conforto, instalacoes_organizacao, instalacoes_conveniencia,
      instalacoes_comentario, recomenda, recomenda_qual, recomenda_porque,
      tipo_cliente, origem, ip_address, user_agent, submitted_at
    ) VALUES (
      @nome, @apto, @email, @telefone, @data_tratamento, @tratamento_realizado,
      @nome_massoterapeuta, @servicos_expectativa, @servicos_explicacao,
      @servicos_atitude, @servicos_tecnica, @servicos_comentario,
      @instalacoes_conforto, @instalacoes_organizacao, @instalacoes_conveniencia,
      @instalacoes_comentario, @recomenda, @recomenda_qual, @recomenda_porque,
      @tipo_cliente, @origem, @ip_address, @user_agent, @submitted_at
    )
  `);
  return stmt.run(dados).lastInsertRowid;
}

export function getFeedbackById(id) {
  return getDb().prepare('SELECT * FROM feedback WHERE id = ?').get(id) || null;
}

export function listarFeedback({ origem, tipo_cliente, from, to, massoterapeuta, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const conds = [];
  const params = [];

  if (origem) { conds.push('origem = ?'); params.push(origem); }
  if (tipo_cliente) { conds.push('tipo_cliente = ?'); params.push(tipo_cliente); }
  if (from) { conds.push("submitted_at >= ?"); params.push(from + ' 00:00:00'); }
  if (to) { conds.push("submitted_at <= ?"); params.push(to + ' 23:59:59'); }
  // Match case-insensitive — segue padrao ja usado em estatisticasMassagistaPorNome
  // (db.js linha ~624 e ~743). Caveat conhecido: nome divergente entre
  // massagistas e feedback.nome_massoterapeuta nao aparece sob aquele filtro;
  // por isso 'Geral' eh o default seguro no frontend.
  if (massoterapeuta) {
    conds.push('LOWER(nome_massoterapeuta) = LOWER(?)');
    params.push(massoterapeuta);
  }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as t FROM feedback ${where}`).get(...params).t;
  const items = db.prepare(`SELECT * FROM feedback ${where} ORDER BY submitted_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, items };
}

const NOTA_MAP = { otimo: 9, bom: 6, regular: 3, ruim: 0 };
const NOTA_MAX = 9;
function notaNum(v) { return NOTA_MAP[v] ?? null; }
function avgNotas(items, campo) {
  const vals = items.map(r => notaNum(r[campo])).filter(v => v !== null);
  if (!vals.length) return null;
  return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
}
function distNotas(items, campo) {
  const d = { otimo: 0, bom: 0, regular: 0, ruim: 0, total: 0 };
  for (const r of items) {
    if (r[campo]) { d[r[campo]] = (d[r[campo]] || 0) + 1; d.total++; }
  }
  return d;
}

export function statsFeedback({ from, to } = {}) {
  const db = getDb();
  const conds = [];
  const params = [];

  const dfrom = from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dto = to || new Date().toISOString().slice(0, 10);
  conds.push("submitted_at >= ?"); params.push(dfrom + ' 00:00:00');
  conds.push("submitted_at <= ?"); params.push(dto + ' 23:59:59');
  const where = 'WHERE ' + conds.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) as t FROM feedback ${where}`).get(...params).t;
  const porOrigem = db.prepare(`SELECT origem, COUNT(*) as t FROM feedback ${where} GROUP BY origem`).all(...params);
  const porTipo = db.prepare(`SELECT tipo_cliente, COUNT(*) as t FROM feedback ${where} GROUP BY tipo_cliente`).all(...params);
  const recomenda = db.prepare(`SELECT recomenda, COUNT(*) as t FROM feedback ${where} GROUP BY recomenda`).all(...params);
  const items = db.prepare(`SELECT * FROM feedback ${where}`).all(...params);

  const medias = {
    servicos_expectativa: avgNotas(items, 'servicos_expectativa'),
    servicos_explicacao: avgNotas(items, 'servicos_explicacao'),
    servicos_atitude: avgNotas(items, 'servicos_atitude'),
    servicos_tecnica: avgNotas(items, 'servicos_tecnica'),
    instalacoes_conforto: avgNotas(items, 'instalacoes_conforto'),
    instalacoes_organizacao: avgNotas(items, 'instalacoes_organizacao'),
    instalacoes_conveniencia: avgNotas(items, 'instalacoes_conveniencia'),
  };

  const todasNotas = Object.values(medias).filter(v => v !== null);
  const mediaGeral = todasNotas.length ? +(todasNotas.reduce((a, b) => a + b, 0) / todasNotas.length).toFixed(2) : null;

  const recSim = recomenda.find(r => r.recomenda === 'sim')?.t || 0;
  const recNao = recomenda.find(r => r.recomenda === 'nao')?.t || 0;
  const respondentesRec = recSim + recNao;
  const pctRecomenda = respondentesRec > 0 ? +(recSim / respondentesRec * 100).toFixed(1) : 0;

  const distribuicoes = {
    servicos_expectativa: distNotas(items, 'servicos_expectativa'),
    servicos_explicacao: distNotas(items, 'servicos_explicacao'),
    servicos_atitude: distNotas(items, 'servicos_atitude'),
    servicos_tecnica: distNotas(items, 'servicos_tecnica'),
    instalacoes_conforto: distNotas(items, 'instalacoes_conforto'),
    instalacoes_organizacao: distNotas(items, 'instalacoes_organizacao'),
    instalacoes_conveniencia: distNotas(items, 'instalacoes_conveniencia'),
  };

  const mkTextos = (campo) => items.filter(r => r[campo]).map(r => ({ nome: r.nome, texto: r[campo], data: r.submitted_at }));
  const textos = {
    servicos: mkTextos('servicos_comentario'),
    instalacoes: mkTextos('instalacoes_comentario'),
    recomenda_qual: mkTextos('recomenda_qual'),
    recomenda_porque: mkTextos('recomenda_porque'),
  };

  return { total, periodo: { from: dfrom, to: dto }, porOrigem, porTipo, recomenda, medias, mediaGeral, pctRecomenda, distribuicoes, textos };
}

// ── Seed: 6 massoterapeutas do Gran Spa ──
function seedMassoterapeutasGranSpa() {
  const db = getDb();
  // Idempotente: só roda se ainda não há massagistas com matrícula
  const jaSeed = db.prepare("SELECT COUNT(*) AS c FROM massagistas WHERE matricula IS NOT NULL AND matricula != ''").get().c;
  if (jaSeed > 0) return;

  // Apaga as antigas (sem matrícula) — apagamento permanente conforme decisão do admin
  db.prepare('DELETE FROM massagistas').run();

  const profs = [
    { mat: '0010001573', nome: 'GERMANA LIMA DA SILVA',                     esp: 'MASSOTERAPEUTA BILINGUE PL',   vinc: 'Pleno',     bil: 1 },
    { mat: '0010002052', nome: 'ISADORA MARIA SOUSA BEZERRA DE MENEZES',    esp: 'MASSOTERAPEUTA PART TIME',     vinc: 'Part Time', bil: 0 },
    { mat: '0010001711', nome: 'KAROLINE COSTA DE FREITAS',                 esp: 'MASSOTERAPEUTA PART TIME',     vinc: 'Part Time', bil: 0 },
    { mat: '0010001614', nome: 'ANTONIA ANA CRISTINA SAMPAIO DE SOUSA',     esp: 'MASSOTERAPEUTA PL',            vinc: 'Pleno',     bil: 0 },
    { mat: '0010001981', nome: 'VALDERLANIA ALEXANDRE BEZERRA',             esp: 'MASSOTERAPEUTA PL',            vinc: 'Pleno',     bil: 0 },
    { mat: '0010001881', nome: 'MAYARA DOS SANTOS DIAS',                    esp: 'MASSOTERAPEUTA PL',            vinc: 'Pleno',     bil: 0 },
  ];
  const stmt = db.prepare(
    `INSERT INTO massagistas (nome, matricula, especialidade_original, funcao, vinculo, bilingue, ativo)
     VALUES (?, ?, ?, 'Massoterapeuta', ?, ?, 1)`
  );
  for (const p of profs) stmt.run(p.nome, p.mat, p.esp, p.vinc, p.bil);
}

// ── Massagistas ──
// Whitelist explícita: pin_hash NUNCA volta dessa função (auditoria 2026-06-25).
// Quem precisa do hash pra autenticar (login da terapeuta) usa buscarMassagistaPorNome.
export function listarMassagistas() {
  return getDb().prepare(`
    SELECT id, nome, ativo, created_at, matricula, especialidade_original,
           funcao, vinculo, bilingue, padrao_entrada
    FROM massagistas
    ORDER BY nome ASC
  `).all();
}
export function setPadraoEntrada(id, padrao) {
  getDb().prepare('UPDATE massagistas SET padrao_entrada=? WHERE id=?')
    .run(typeof padrao === 'string' ? padrao : JSON.stringify(padrao), id);
}

export function registrarLogPadrao(mId, antes, depois, usuario) {
  getDb().prepare(
    'INSERT INTO padrao_entrada_log (massagista_id, antes, depois, usuario) VALUES (?,?,?,?)'
  ).run(mId, antes || null, typeof depois === 'object' ? JSON.stringify(depois) : depois || null, usuario || null);
}

export function listarMassagistasParaPadroes() {
  return getDb().prepare(`
    SELECT id, nome, ativo, funcao, vinculo, email, padrao_entrada
    FROM massagistas
    WHERE ativo = 1
    ORDER BY nome ASC
  `).all();
}

export function seedPadraoEntrada() {
  const db = getDb();
  try {
    if (db.prepare("SELECT valor FROM system_meta WHERE chave='padrao_entrada_seeded_v2'").get()) return;
  } catch { return; }
  // Matched by matricula (stable unique ID) — not by nome que varia entre ambientes
  const PADROES = {
    '0010001614': { seg:'10:00', ter:'10:00', qua:'10:00', qui:'10:00', sex:'10:00', sab:'10:00', dom:'10:00' }, // Ana Cristina
    '0010001711': { seg:null,    ter:null,    qua:null,    qui:null,    sex:'09:00', sab:'09:00', dom:'09:00' }, // Karoline
    '0010001573': { seg:'12:00', ter:'12:00', qua:'12:00', qui:'12:00', sex:'12:00', sab:'12:00', dom:'FOLGA' }, // Germana
    '0010001881': { seg:'14:00', ter:'14:00', qua:'14:00', qui:'14:00', sex:'14:00', sab:'14:00', dom:'12:00' }, // Mayara
    '0010001981': { seg:'14:00', ter:'14:00', qua:'14:00', qui:'14:00', sex:'14:00', sab:'14:00', dom:'12:00' }, // Val
    '0010002052': { seg:'17:30', ter:'17:30', qua:'17:30', qui:'17:30', sex:'17:30', sab:'17:30', dom:'FOLGA' }, // Isadora
  };
  try {
    const massas = db.prepare('SELECT id, matricula FROM massagistas WHERE matricula IS NOT NULL').all();
    for (const m of massas) {
      const p = PADROES[m.matricula];
      if (p) db.prepare('UPDATE massagistas SET padrao_entrada=? WHERE id=?').run(JSON.stringify(p), m.id);
    }
    db.prepare("INSERT OR REPLACE INTO system_meta (chave,valor) VALUES ('padrao_entrada_seeded_v2','1')").run();
  } catch {}
}

export function buscarMassagistaById(id) {
  return getDb().prepare('SELECT * FROM massagistas WHERE id=?').get(id) || null;
}

export function listarMassagistasComStats() {
  return getDb().prepare(`
    SELECT
      m.id, m.nome, m.ativo, m.created_at,
      m.matricula, m.especialidade_original, m.funcao, m.vinculo, m.bilingue,
      COUNT(f.id) AS total_avaliacoes,
      SUM(CASE WHEN f.recomenda = 'sim' THEN 1 ELSE 0 END) AS rec_sim,
      SUM(CASE WHEN f.recomenda = 'nao' THEN 1 ELSE 0 END) AS rec_nao
    FROM massagistas m
    LEFT JOIN feedback f ON LOWER(f.nome_massoterapeuta) = LOWER(m.nome)
    GROUP BY m.id
    ORDER BY m.nome ASC
  `).all();
}
export function inserirMassagista(nome, opts = {}) {
  const { matricula = null, especialidade_original = null, funcao = 'Massoterapeuta', vinculo = null, bilingue = 0 } = opts;
  return getDb().prepare(
    `INSERT INTO massagistas (nome, matricula, especialidade_original, funcao, vinculo, bilingue)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(nome.trim(), matricula, especialidade_original, funcao, vinculo, bilingue ? 1 : 0).lastInsertRowid;
}
export function atualizarMassagista(id, nome, ativo, opts = {}) {
  const sets = ['nome=?', 'ativo=?'];
  const vals = [nome.trim(), ativo];
  for (const k of ['matricula', 'especialidade_original', 'funcao', 'vinculo']) {
    if (opts[k] !== undefined) { sets.push(`${k}=?`); vals.push(opts[k]); }
  }
  if (opts.bilingue !== undefined) { sets.push('bilingue=?'); vals.push(opts.bilingue ? 1 : 0); }
  vals.push(id);
  return getDb().prepare(`UPDATE massagistas SET ${sets.join(', ')} WHERE id=?`).run(...vals).changes;
}
export function deletarMassagista(id) {
  return getDb().prepare('DELETE FROM massagistas WHERE id=?').run(id).changes;
}

// ── Férias massagista ──
export function listarFeriasMassagista(massagista_id) {
  return getDb().prepare('SELECT * FROM ferias_massagista WHERE massagista_id=? ORDER BY data_inicio ASC').all(massagista_id);
}
export function criarFeriasMassagista(massagista_id, data_inicio, data_fim, observacao) {
  return getDb().prepare(
    'INSERT INTO ferias_massagista (massagista_id, data_inicio, data_fim, observacao) VALUES (?,?,?,?)'
  ).run(massagista_id, data_inicio, data_fim, observacao || null).lastInsertRowid;
}
export function atualizarFeriasMassagista(id, data_inicio, data_fim, observacao) {
  return getDb().prepare(
    'UPDATE ferias_massagista SET data_inicio=?, data_fim=?, observacao=? WHERE id=?'
  ).run(data_inicio, data_fim, observacao || null, id).changes;
}
export function excluirFeriasMassagista(id) {
  return getDb().prepare('DELETE FROM ferias_massagista WHERE id=?').run(id).changes;
}
export function feriasConflito(massagista_id, data_inicio, data_fim, excludeId) {
  if (excludeId) {
    return !!getDb().prepare(
      'SELECT 1 FROM ferias_massagista WHERE massagista_id=? AND id<>? AND data_inicio<=? AND data_fim>=?'
    ).get(massagista_id, excludeId, data_fim, data_inicio);
  }
  return !!getDb().prepare(
    'SELECT 1 FROM ferias_massagista WHERE massagista_id=? AND data_inicio<=? AND data_fim>=?'
  ).get(massagista_id, data_fim, data_inicio);
}

// ── Turnos (escala mensal) ──
export function listarTurnosPeriodo(ano, mes) {
  const p2 = n => String(n).padStart(2, '0');
  const a2 = mes === 11 ? ano + 1 : ano;
  const m2 = mes === 11 ? 0 : mes + 1;
  const dataIni = `${ano}-${p2(mes + 1)}-21`;
  const dataFim = `${a2}-${p2(m2 + 1)}-20`;
  return getDb().prepare(
    'SELECT massagista_id, data, turno FROM turno_massagista WHERE data >= ? AND data <= ? ORDER BY data ASC'
  ).all(dataIni, dataFim);
}
export function upsertTurno(massagista_id, data, turno) {
  return getDb().prepare(
    'INSERT INTO turno_massagista (massagista_id, data, turno) VALUES (?,?,?) ON CONFLICT(massagista_id, data) DO UPDATE SET turno=excluded.turno'
  ).run(massagista_id, data, turno);
}
export function deletarTurno(massagista_id, data) {
  return getDb().prepare(
    'DELETE FROM turno_massagista WHERE massagista_id=? AND data=?'
  ).run(massagista_id, data).changes;
}
export function buscarTurno(massagista_id, data) {
  const r = getDb().prepare('SELECT turno FROM turno_massagista WHERE massagista_id=? AND data=?').get(massagista_id, data);
  return r ? r.turno : null;
}
export function registrarTurnoHistorico(massagista_id, data, antes, depois, usuario, origem) {
  getDb().prepare(
    'INSERT INTO turno_historico (massagista_id, data, antes, depois, usuario, origem) VALUES (?,?,?,?,?,?)'
  ).run(massagista_id, data, antes || null, depois || null, usuario || null, origem || null);
}
export function listarTurnoHistorico(massagista_id, data, limit = 50) {
  return getDb().prepare(
    'SELECT antes, depois, usuario, origem, criado_em FROM turno_historico WHERE massagista_id=? AND data=? ORDER BY id DESC LIMIT ?'
  ).all(massagista_id, data, Math.min(Math.max(1, limit), 200));
}

// ── Avaliação de disponibilidade por escala (mensal → semanal → sem escala) ──
const JORNADA_MIN = 8 * 60 + 20; // fim derivado = entrada + 8h20min
const SPA_FIM_MIN = 22 * 60;  // teto 22:00

function _hmEsc(s) {
  if (!s || !/^\d{2}:\d{2}$/.test(String(s).trim())) return NaN;
  const [h, m] = String(s).trim().split(':').map(Number);
  return h * 60 + m;
}
function _minToHm(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function listarTurnosDia(data) {
  return getDb().prepare('SELECT massagista_id, turno FROM turno_massagista WHERE data=?').all(data);
}

export function contextoEscalaDia(data) {
  const rows = listarTurnosDia(data);
  let feriasDia = new Set();
  try {
    feriasDia = new Set(getDb().prepare(
      'SELECT massagista_id FROM ferias_massagista WHERE data_inicio <= ? AND data_fim >= ?'
    ).all(data, data).map(r => r.massagista_id));
  } catch {}
  return { turnosDia: new Map(rows.map(r => [r.massagista_id, r.turno])), lancada: rows.length > 0, feriasDia };
}

const TURNO_STATUS_MOTIVO = {
  X: 'folga', FE: 'férias', AT: 'atestado', AA: 'afastamento',
  CF: 'compensação de feriado', CH: 'compensação de hora',
  LS: 'licença sindical', LC: 'licença casamento', F: 'falta',
};

// Fonte da verdade do dia real: escala mensal (turno_massagista). Fallback:
// padrão semanal (padrao_entrada — a engrenagem "Padrões semanais" da escala
// mensal) quando a data não tem NENHUM turno lançado. Sem padrão cadastrado →
// liberada com aviso, para a operação nunca ficar travada por falta de escala.
export function avaliarEscalaMassagista(m, data, horaInicio, horaFim, ctx) {
  const c = ctx || contextoEscalaDia(data);
  const resIni = _hmEsc(horaInicio);
  const resFim = _hmEsc(horaFim);
  const rFim = Number.isNaN(resFim) ? resIni : resFim;
  const turno = c.turnosDia.get(m.id);

  if (turno) {
    if (TURNO_STATUS_MOTIVO[turno]) {
      return { disponivel: false, fonte: 'mensal', motivo: TURNO_STATUS_MOTIVO[turno], turno };
    }
    let ini, fim;
    if (turno.includes('|')) {
      const [e, s] = turno.split('|');
      ini = _hmEsc(e); fim = _hmEsc(s);
    } else {
      ini = _hmEsc(turno);
      fim = Number.isNaN(ini) ? NaN : Math.min(ini + JORNADA_MIN, SPA_FIM_MIN);
    }
    // Turno ilegível: nunca travar a operação
    if (Number.isNaN(ini) || Number.isNaN(fim)) return { disponivel: true, fonte: 'mensal', turno };
    const faixa = `${_minToHm(ini)}-${_minToHm(fim)}`;
    if (Number.isNaN(resIni)) return { disponivel: true, fonte: 'mensal', faixa, turno };
    const ok = resIni >= ini && rFim <= fim;
    return { disponivel: ok, fonte: 'mensal', motivo: ok ? null : 'fora do turno', faixa, turno };
  }

  // Férias programadas (ferias_massagista) vetam quando NÃO há turno manual
  // explícito no dia — turno digitado conscientemente vence (volta antecipada).
  if (c.feriasDia?.has(m.id)) {
    return { disponivel: false, fonte: 'ferias', motivo: 'férias programadas' };
  }

  if (c.lancada) {
    return { disponivel: false, fonte: 'mensal', motivo: 'não escalada no dia' };
  }

  // Fallback: padrão semanal (padrao_entrada da engrenagem "Padrões semanais").
  // Entrada "HH:MM" → janela [entrada, min(entrada+9h, 22:00)]; "FOLGA" →
  // indisponível; sem padrão/dia nulo → liberada com aviso (nunca travar).
  const semEscala = { disponivel: true, fonte: 'sem-escala', aviso: 'escala não lançada para esta data' };
  let padrao = null;
  try {
    padrao = typeof m.padrao_entrada === 'string' ? JSON.parse(m.padrao_entrada) : m.padrao_entrada;
  } catch { padrao = null; }
  if (!padrao || typeof padrao !== 'object' || Array.isArray(padrao)) return semEscala;
  const dowKey = ['dom','seg','ter','qua','qui','sex','sab'][new Date(data + 'T12:00:00Z').getUTCDay()];
  const val = padrao[dowKey];
  if (val === 'FOLGA') return { disponivel: false, fonte: 'padrao', motivo: 'folga (padrão semanal)' };
  const pIni = _hmEsc(val);
  if (Number.isNaN(pIni)) return semEscala;
  const pFim = Math.min(pIni + JORNADA_MIN, SPA_FIM_MIN);
  const faixa = `${_minToHm(pIni)}-${_minToHm(pFim)}`;
  if (Number.isNaN(resIni)) return { disponivel: true, fonte: 'padrao', faixa };
  const ok = resIni >= pIni && rFim <= pFim;
  return { disponivel: ok, fonte: 'padrao', motivo: ok ? null : 'fora do padrão semanal', faixa };
}

export function listarReservasMassagistaData(massagista_id, data) {
  return getDb().prepare(
    `SELECT id, cliente, cliente2, sala, hora_inicio, hora_fim, massagista_id, massagista_id2
     FROM reservas WHERE data=? AND (massagista_id=? OR massagista_id2=?) ORDER BY hora_inicio ASC`
  ).all(data, massagista_id, massagista_id);
}

// ── Tipos de Massagem ──
export function listarTiposMassagem() {
  return getDb().prepare('SELECT * FROM tipos_massagem ORDER BY categoria, nome ASC').all();
}
export function inserirTipoMassagem(nome, duracao_min, preco, descricao, opts = {}) {
  const { tipo = 'individual', categoria = null, componentes = null, linhas = null } = opts;
  return getDb().prepare(
    'INSERT INTO tipos_massagem (nome, descricao, duracao_min, preco, tipo, categoria, componentes, linhas) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(nome.trim(), descricao || null, duracao_min || null, preco || null, tipo, categoria, componentes, linhas).lastInsertRowid;
}
export function atualizarTipoMassagem(id, nome, duracao_min, preco, ativo, descricao, opts = {}) {
  const { tipo, categoria, componentes, linhas } = opts;
  const sets = ['nome=?', 'descricao=?', 'duracao_min=?', 'preco=?', 'ativo=?'];
  const vals = [nome.trim(), descricao || null, duracao_min || null, preco || null, ativo];
  if (tipo !== undefined) { sets.push('tipo=?'); vals.push(tipo); }
  if (categoria !== undefined) { sets.push('categoria=?'); vals.push(categoria); }
  if (componentes !== undefined) { sets.push('componentes=?'); vals.push(componentes); }
  if (linhas !== undefined) { sets.push('linhas=?'); vals.push(linhas); }
  vals.push(id);
  return getDb().prepare(`UPDATE tipos_massagem SET ${sets.join(', ')} WHERE id=?`).run(...vals).changes;
}

// ── Seed: tratamentos do Gran Spa by L'Occitane ──
export function seedTratamentosGranSpa() {
  const db = getDb();
  // Se a tabela system_meta marca este seed como concluído, NÃO re-popular.
  // Caso o admin tenha zerado a base intencionalmente, a flag impede o
  // restart de recriar os tratamentos default.
  try {
    const flag = db.prepare("SELECT valor FROM system_meta WHERE chave='tipos_massagem_seeded'").get();
    if (flag) return;
  } catch {}
  const exists = nome => db.prepare('SELECT id FROM tipos_massagem WHERE nome = ?').get(nome);
  const insert = (nome, duracao_min, preco, descricao, opts = {}) => {
    if (exists(nome)) return exists(nome).id;
    const { tipo = 'individual', categoria = null, componentes = null, linhas = null } = opts;
    return db.prepare(
      `INSERT INTO tipos_massagem (nome, descricao, duracao_min, preco, tipo, categoria, componentes, linhas, ativo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(nome, descricao, duracao_min, preco, tipo, categoria, componentes, linhas).lastInsertRowid;
  };

  // Individuais
  const M = 'Massagem', T = 'Tratamento', C = 'Complementar', F = 'Facial';
  insert('Relaxante aromacologia', 50, 445, 'Massagem suave com óleos essenciais aromáticos para aliviar o estresse e relaxar corpo e mente.', { categoria: M });
  insert('Deep tissue',           50, 445, 'Massagem de pressão firme nas camadas profundas da musculatura, indicada para desfazer tensões e nós musculares.', { categoria: M });
  insert('Signature lavanda',     50, 445, 'Massagem assinatura com óleo de lavanda, de efeito calmante, que promove relaxamento profundo.', { categoria: M });
  insert('Bem estar da futura mamãe', 50, 445, 'Massagem desenvolvida para gestantes, com técnicas seguras que aliviam os desconfortos da gravidez.', { categoria: M });
  insert('Reenergizante pedras do sol', 50, 445, 'Massagem com pedras aquecidas que combina calor e toque para relaxar os músculos e renovar a energia.', { categoria: M });
  insert('Fabulosa com karité',   50, 445, 'Massagem nutritiva com manteiga de karité, que hidrata a pele enquanto relaxa o corpo.', { categoria: M });
  insert('Nutrição intensa karité', 80, 560, 'Versão prolongada com karité, focada em hidratação intensa e relaxamento completo.', { categoria: M });
  insert('Terapia do sono restaurador', 80, 560, 'Ritual relaxante com aromas e técnicas que preparam o corpo para um descanso reparador.', { categoria: M });

  insert('Desintoxicante de amêndoa', 50, 445, 'Tratamento corporal com óleo de amêndoa que ajuda a eliminar toxinas e revitalizar a pele.', { categoria: T });
  insert('Modelador amêndoa',         50, 445, 'Tratamento à base de amêndoa com foco em modelar o corpo e firmar a pele.', { categoria: T });

  insert('Massagem pés com óleos essenciais', 30, 272, 'Massagem relaxante nos pés com óleos essenciais para aliviar o cansaço.', { categoria: C });
  insert('Máscara corporal ultra hidratante Karité', 30, 359, 'Máscara corporal com karité para hidratação intensa da pele.', { categoria: C });
  insert('Esfoliação corporal nutritiva Karité',     30, 272, 'Esfoliação que remove células mortas e nutre a pele com karité, deixando-a macia.', { categoria: C });
  insert('Power nap',                                 30, 218, 'Sessão curta de descanso e relaxamento para recuperar as energias rapidamente.', { categoria: C });

  const linhasFacial = JSON.stringify(['Immortelle', 'Source Réotier']);
  insert('Lifting',             50, 445, 'Tratamento facial com efeito tensor que firma e revitaliza a pele do rosto.', { categoria: F, linhas: linhasFacial });
  insert('Muscular Profunda',   50, 445, 'Tratamento facial que trabalha a musculatura do rosto, relaxando e tonificando.', { categoria: F, linhas: linhasFacial });
  insert('Drenagem Linfática',  50, 445, 'Tratamento facial de drenagem que reduz o inchaço e ativa a circulação.', { categoria: F, linhas: linhasFacial });

  // Combos — resolve IDs dos componentes pelo nome
  const id = n => exists(n)?.id;
  const combos = [
    { nome: 'Gran sublime',      duracao: 80, preco: 663, desc: 'Combo Gran Sublime — Esfoliação Karité + Relaxante aromacologia. 80 minutos de hidratação e relaxamento profundo.', a: 'Esfoliação corporal nutritiva Karité', b: 'Relaxante aromacologia' },
    { nome: 'Gran relaxamento',  duracao: 80, preco: 613, desc: 'Combo Gran Relaxamento — Relaxante aromacologia + Power nap. 80 minutos de relaxamento total.',                       a: 'Relaxante aromacologia',                b: 'Power nap' },
    { nome: 'Ritual detox',      duracao: 80, preco: 663, desc: 'Combo Ritual Detox — Esfoliação Karité + Desintoxicante de amêndoa. 80 minutos de purificação e renovação.',          a: 'Esfoliação corporal nutritiva Karité', b: 'Desintoxicante de amêndoa' },
  ];
  for (const c of combos) {
    if (exists(c.nome)) continue;
    const ida = id(c.a), idb = id(c.b);
    if (!ida || !idb) { console.warn(`[seed] Combo ${c.nome}: componente faltando (${c.a}, ${c.b})`); continue; }
    db.prepare(
      `INSERT INTO tipos_massagem (nome, descricao, duracao_min, preco, tipo, categoria, componentes, ativo)
       VALUES (?, ?, ?, ?, 'combo', 'Combo', ?, 1)`
    ).run(c.nome, c.desc, c.duracao, c.preco, JSON.stringify([ida, idb]));
  }
  // Marca o seed como concluído para não re-rodar em restarts futuros.
  try {
    db.prepare("INSERT OR REPLACE INTO system_meta (chave, valor) VALUES ('tipos_massagem_seeded','1')").run();
  } catch {}
}

// ───────────────────────────────────────────────────────────────────────────
// Modulo Receita & Comissao
// Fonte: planilha RECEITA TERAPIAS - SPA 2026.xlsx (data/receita-2026.json)
//
// AJUSTE DE COMISSAO (alteravel sem deploy de codigo: editar e redeploy):
//   COMMISSION_BASE_RATE = % base sobre receita liquida do mes
//   COMMISSION_BONUS_TIERS = bonus aplicado quando nota media do mes >= min
//
// Calculo:
//   bonus  = primeiro tier cuja nota_media >= min (encontrado nessa ordem)
//   liquid = comissao_base * (1 + bonus)
//
// Escala interna: 0-9 (alinhada com NOTA_MAP existente; otimo=9, bom=6, ...).
// min_nota e' em pontos 0-9: 8.5 ~= 94%, 7.5 ~= 83%.
export const COMMISSION_BASE_RATE = 0.10;            // 10%
export const COMMISSION_BONUS_TIERS = [
  { min_nota: 8.5, bonus: 0.05, label: '+5% por excelencia (≥94%)' },
  { min_nota: 7.5, bonus: 0.02, label: '+2% por bom desempenho (≥83%)' },
];

// Mapeamento nome-planilha -> nome-no-sistema (seed atual tipos_massagem).
// As terapias com valor `null` ainda nao existem no seed: serao criadas
// pelo seedReceitaTerapias com o nome exato da planilha.
const PLANILHA_TO_SEED_NOME = {
  'RELAXANTE':                          'Relaxante aromacologia',
  'REVITALIZANTE':                       null,
  'DEEP TISSUE':                        'Deep tissue',
  'SIGNATURE LAVANDA':                  'Signature lavanda',
  'BEM ESTAR DA FUTURA MAMÃE':          'Bem estar da futura mamãe',
  'TRAT. DESINTOXICANTE DE AMENDOA':    'Desintoxicante de amêndoa',
  'MODELADORA AMENDOA':                 'Modelador amêndoa',
  'IMMORTELLE (ROSTO)':                  null,
  'MASCULINA CADE':                      null,
  'POWER NAP':                          'Power nap',
  'REFLEXOLOGIA':                       'Massagem pés com óleos essenciais',
  'ESFOLIAÇÃO CORPORAL':                'Esfoliação corporal nutritiva Karité',
  'MASCARA CORPORAL':                   'Máscara corporal ultra hidratante Karité',
  'FABULOSA KARITE':                    'Fabulosa com karité',
  'NUTRIÇÃO INTENSA':                   'Nutrição intensa karité',
  'TERAPIA DO SONO':                    'Terapia do sono restaurador',
  'RE ENERGIZANTE PEDRAS DO SOL':       'Reenergizante pedras do sol',
  'GRAN SUBLIME':                       'Gran sublime',
  'GRAN RELAXAMENTO':                   'Gran relaxamento',
  'RITUAL DETOX':                       'Ritual detox',
  'PACOTE DAY SPA':                      null,
  'DIA DA NOIVA OPC. 1':                 null,
  'DIA DA NOIVA OPC. 2':                 null,
  'DIA DO NOIVO OPC.2':                  null,
  'PACOTE CASAL':                        null,
  'PACOTE GRUPO':                        null,
  'PACOTE 5 MASSAGEM ( 60 MIN )':        null,
  'PACOTE 10 MASSAGEM ( 60 MIN )':       null,
};

const FAIXAS_FATOR = { NORMAL: 1.0, P10: 0.9, P20: 0.8, P30: 0.7, P50: 0.5 };

// Seed: garante os tipos_massagem que existem na planilha mas nao no seed
// original. Marca com categoria 'Pacote' (vendas agregadas) ou 'Receita'
// (terapias avulsas nao listadas no seed). Idempotente (procura por nome).
export function seedReceitaTerapias({ jsonPath } = {}) {
  const db = getDb();
  // IMPORTANTE: o JSON vive em seed-data/, NAO em data/. Em prod o Fly.io
  // monta um volume persistente em /app/data, o que sobrescreve qualquer
  // arquivo da imagem nessa pasta. seed-data/ fica na imagem read-only.
  const candidatos = [
    jsonPath,
    path.join(__dirname, '..', 'seed-data', 'receita-2026.json'),
    path.join(__dirname, '..', 'data', 'receita-2026.json'), // fallback historico
  ].filter(Boolean);
  const file = candidatos.find(p => fs.existsSync(p));
  if (!file) {
    console.warn(`[receita] JSON nao encontrado em: ${candidatos.join(' | ')} - seed ignorado`);
    return;
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  // 1) Garantir tipos_massagem extras (nome exato da planilha)
  // Categorias: terapias avulsas faltantes -> 'Receita'; combos/pacotes -> 'Pacote'
  const EXTRAS = [
    { nome: 'REVITALIZANTE',                 preco: 445,     categoria: 'Receita', duracao: 50, ativo: 1 },
    { nome: 'IMMORTELLE (ROSTO)',            preco: 445,     categoria: 'Facial',  duracao: 50, ativo: 1 },
    { nome: 'MASCULINA CADE',                preco: 445,     categoria: 'Receita', duracao: 50, ativo: 1 },
    { nome: 'PACOTE DAY SPA',                preco: 1309,    categoria: 'Pacote',  duracao: null, ativo: 1 },
    { nome: 'DIA DA NOIVA OPC. 1',           preco: 2898,    categoria: 'Pacote',  duracao: null, ativo: 1 },
    { nome: 'DIA DA NOIVA OPC. 2',           preco: 2035.5,  categoria: 'Pacote',  duracao: null, ativo: 1 },
    { nome: 'DIA DO NOIVO OPC.2',            preco: 1046,    categoria: 'Pacote',  duracao: null, ativo: 1 },
    { nome: 'PACOTE CASAL',                  preco: 422.5,   categoria: 'Pacote',  duracao: null, ativo: 1 },
    { nome: 'PACOTE GRUPO',                  preco: 263,     categoria: 'Pacote',  duracao: null, ativo: 1 },
    { nome: 'PACOTE 5 MASSAGEM ( 60 MIN )',  preco: 422.75,  categoria: 'Pacote',  duracao: null, ativo: 1 },
    { nome: 'PACOTE 10 MASSAGEM ( 60 MIN )', preco: 378.25,  categoria: 'Pacote',  duracao: null, ativo: 1 },
  ];
  const findByNome = db.prepare('SELECT id FROM tipos_massagem WHERE LOWER(nome)=LOWER(?)');
  const insTipo    = db.prepare(`INSERT INTO tipos_massagem (nome, descricao, duracao_min, preco, tipo, categoria, ativo) VALUES (?, ?, ?, ?, 'individual', ?, ?)`);
  for (const t of EXTRAS) {
    if (findByNome.get(t.nome)) continue;
    insTipo.run(t.nome, null, t.duracao, t.preco, t.categoria, t.ativo);
  }

  // 2) Resolver IDs: massagistas por matricula, tipos por nome (mapa).
  const massByMatricula = new Map();
  for (const row of db.prepare('SELECT id, nome, matricula FROM massagistas').all()) {
    if (row.matricula) massByMatricula.set(row.matricula, row.id);
  }
  const tipoIdByPlanilha = new Map();
  for (const [planilhaNome, seedNome] of Object.entries(PLANILHA_TO_SEED_NOME)) {
    const procurar = seedNome || planilhaNome;
    const row = findByNome.get(procurar);
    if (row) tipoIdByPlanilha.set(planilhaNome, row.id);
    else console.warn(`[receita] tipo_massagem nao resolvido: "${planilhaNome}" -> "${procurar}"`);
  }
  const precosBase = data.precos_base || {};

  // 3) Upsert lancamentos. Idempotente via UNIQUE(ano,mes,mass,tipo,faixa).
  const upsert = db.prepare(`
    INSERT INTO receita_lancamentos (ano, mes, massagista_id, tipo_massagem_id, faixa_desconto, quantidade, preco_base, preco_aplicado, receita, fonte, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(ano, mes, massagista_id, tipo_massagem_id, faixa_desconto)
    DO UPDATE SET quantidade=excluded.quantidade, preco_base=excluded.preco_base,
                  preco_aplicado=excluded.preco_aplicado, receita=excluded.receita,
                  fonte=excluded.fonte, atualizado_em=datetime('now')
  `);

  let inserted = 0, skipped = 0;
  const tx = db.transaction(() => {
    for (const l of data.lancamentos) {
      const massId = massByMatricula.get(l.matricula);
      const tipoId = tipoIdByPlanilha.get(l.terapia);
      const precoBase = precosBase[l.terapia];
      if (!massId || !tipoId || !precoBase) { skipped++; continue; }
      const fator = FAIXAS_FATOR[l.faixa];
      const precoAplicado = precoBase * fator;
      const receita = precoAplicado * l.quantidade;
      upsert.run(l.ano, l.mes, massId, tipoId, l.faixa, l.quantidade,
                 precoBase, precoAplicado, receita, data.fonte || 'planilha-2026');
      inserted++;
    }
  });
  tx();
  console.log(`[receita] seed concluido: ${inserted} lancamentos${skipped ? `, ${skipped} ignorados` : ''}.`);
}

// Agrega receita por mes para uma massagista, no ano informado.
// Retorna { meses: [...], total: {...} }.
export function agregarReceitaPorMes(massagistaId, ano) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT mes,
           SUM(quantidade) AS atendimentos,
           SUM(receita)    AS receita,
           SUM(CASE WHEN faixa_desconto='NORMAL' THEN quantidade ELSE 0 END) AS qty_normal,
           SUM(CASE WHEN faixa_desconto='P10'    THEN quantidade ELSE 0 END) AS qty_p10,
           SUM(CASE WHEN faixa_desconto='P20'    THEN quantidade ELSE 0 END) AS qty_p20,
           SUM(CASE WHEN faixa_desconto='P30'    THEN quantidade ELSE 0 END) AS qty_p30,
           SUM(CASE WHEN faixa_desconto='P50'    THEN quantidade ELSE 0 END) AS qty_p50
    FROM receita_lancamentos
    WHERE massagista_id = ? AND ano = ?
    GROUP BY mes
    ORDER BY mes
  `).all(massagistaId, ano);

  const porTerapia = db.prepare(`
    SELECT mes, t.id AS tipo_id, t.nome AS terapia,
           SUM(quantidade) AS atendimentos, SUM(receita) AS receita
    FROM receita_lancamentos r
    JOIN tipos_massagem t ON t.id = r.tipo_massagem_id
    WHERE massagista_id = ? AND ano = ?
    GROUP BY mes, t.id, t.nome
    ORDER BY mes, receita DESC
  `).all(massagistaId, ano);

  const porTerapiaByMes = new Map();
  for (const p of porTerapia) {
    if (!porTerapiaByMes.has(p.mes)) porTerapiaByMes.set(p.mes, []);
    porTerapiaByMes.get(p.mes).push({ tipo_id: p.tipo_id, terapia: p.terapia, atendimentos: p.atendimentos, receita: p.receita });
  }

  const meses = rows.map(r => ({
    mes: r.mes,
    atendimentos: r.atendimentos || 0,
    receita: r.receita || 0,
    distribuicao: { NORMAL: r.qty_normal||0, P10: r.qty_p10||0, P20: r.qty_p20||0, P30: r.qty_p30||0, P50: r.qty_p50||0 },
    por_terapia: porTerapiaByMes.get(r.mes) || [],
  }));
  const total = {
    atendimentos: meses.reduce((s,m)=>s+m.atendimentos, 0),
    receita:      meses.reduce((s,m)=>s+m.receita, 0),
  };
  return { ano, meses, total };
}

// Nota media de uma massagista em (ano, mes), considerando o feedback.
// Reusa a escala 0-9 do sistema (NOTA_MAP / NOTA_MAX definidos acima).
const CAMPOS_NOTA_RECEITA = ['servicos_expectativa','servicos_explicacao','servicos_atitude','servicos_tecnica'];

export function notaMediaPorMes(massagistaNome, ano) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM feedback
    WHERE LOWER(nome_massoterapeuta) = LOWER(?)
      AND substr(submitted_at, 1, 4) = ?
  `).all(massagistaNome, String(ano));
  const acc = new Map(); // mes -> { soma, n }
  for (const r of rows) {
    const mes = parseInt((r.submitted_at || '').slice(5,7), 10);
    if (!mes) continue;
    const notas = CAMPOS_NOTA_RECEITA.map(c => notaNum(r[c])).filter(v => v != null);
    if (!notas.length) continue;
    const media = notas.reduce((a,b)=>a+b, 0) / notas.length;
    if (!acc.has(mes)) acc.set(mes, { soma: 0, n: 0 });
    const slot = acc.get(mes); slot.soma += media; slot.n += 1;
  }
  const out = {};
  for (const [mes, { soma, n }] of acc) out[mes] = soma / n;
  return out; // ex: { 1: 8.2, 2: 7.6, ... } na escala 0-9
}

// Config de comissão (1 linha em comissao_config). Defaults seedados em initDb.
export function getComissaoConfig() {
  const row = getDb().prepare(`SELECT base_rate, tiers FROM comissao_config WHERE id=1`).get();
  if (!row) return { base_rate: COMMISSION_BASE_RATE, tiers: COMMISSION_BONUS_TIERS };
  let tiers = [];
  try { tiers = JSON.parse(row.tiers); } catch { tiers = COMMISSION_BONUS_TIERS; }
  return { base_rate: row.base_rate, tiers };
}
export function setComissaoConfig({ base_rate, tiers }) {
  if (typeof base_rate !== 'number' || base_rate < 0 || base_rate > 1) {
    throw new Error('base_rate deve ser número entre 0 e 1');
  }
  if (!Array.isArray(tiers)) throw new Error('tiers deve ser array');
  const norm = tiers.map(t => {
    const min_nota = Number(t.min_nota), bonus = Number(t.bonus);
    if (!Number.isFinite(min_nota) || min_nota < 0 || min_nota > 9) throw new Error('min_nota fora do range 0-9');
    if (!Number.isFinite(bonus) || bonus < 0 || bonus > 1) throw new Error('bonus fora do range 0-1');
    return { min_nota, bonus, label: String(t.label || '').slice(0, 80) };
  }).sort((a,b) => b.min_nota - a.min_nota);
  getDb().prepare(`UPDATE comissao_config SET base_rate=?, tiers=?, atualizado_em=datetime('now') WHERE id=1`)
    .run(base_rate, JSON.stringify(norm));
  return { base_rate, tiers: norm };
}

// Receita derivada das RESERVAS do sistema (substitui leitura da planilha).
// Regras (definidas pelo usuário):
//   - Só reservas com data <= hoje
//   - massagista_id E massagista_id2 contam cada uma 1 atendimento + preço cheio
//   - Preço = tipos_massagem.preco (tabela base; sem faixas de desconto)
export function agregarReceitaPorMesDoSistema(massagistaId, ano) {
  const db = getDb();
  const hoje = new Date().toISOString().slice(0, 10);
  // UNION: linha por reserva onde a massagista atua como id OU id2.
  // Cada lado conta 1 atendimento + preço cheio (decisão do usuário).
  const sql = `
    WITH atend AS (
      SELECT r.data, r.tipo_massagem_id, t.nome AS terapia, COALESCE(t.preco, 0) AS preco
      FROM reservas r
      LEFT JOIN tipos_massagem t ON t.id = r.tipo_massagem_id
      WHERE r.massagista_id = ?
        AND r.data <= ?
        AND substr(r.data, 1, 4) = ?
      UNION ALL
      SELECT r.data, r.tipo_massagem_id2 AS tipo_massagem_id, t.nome AS terapia, COALESCE(t.preco, 0) AS preco
      FROM reservas r
      LEFT JOIN tipos_massagem t ON t.id = r.tipo_massagem_id2
      WHERE r.massagista_id2 = ?
        AND r.data <= ?
        AND substr(r.data, 1, 4) = ?
    )
    SELECT CAST(substr(data, 6, 2) AS INTEGER) AS mes,
           COUNT(*) AS atendimentos,
           SUM(preco) AS receita
    FROM atend
    GROUP BY mes
    ORDER BY mes
  `;
  let rows;
  try {
    rows = db.prepare(sql).all(massagistaId, hoje, String(ano), massagistaId, hoje, String(ano));
  } catch (e) {
    // Fallback: schema pode não ter tipo_massagem_id2/massagista_id2 em deploys antigos.
    // Conta só o lado primário.
    const fb = db.prepare(`
      SELECT CAST(substr(r.data, 6, 2) AS INTEGER) AS mes,
             COUNT(*) AS atendimentos,
             SUM(COALESCE(t.preco, 0)) AS receita
      FROM reservas r
      LEFT JOIN tipos_massagem t ON t.id = r.tipo_massagem_id
      WHERE r.massagista_id = ? AND r.data <= ? AND substr(r.data, 1, 4) = ?
      GROUP BY mes ORDER BY mes
    `).all(massagistaId, hoje, String(ano));
    rows = fb;
  }

  // Detalhe por terapia (mesmo UNION).
  const sqlPor = `
    WITH atend AS (
      SELECT r.data, r.tipo_massagem_id, t.id AS tipo_id, t.nome AS terapia, COALESCE(t.preco,0) AS preco
      FROM reservas r
      LEFT JOIN tipos_massagem t ON t.id = r.tipo_massagem_id
      WHERE r.massagista_id = ? AND r.data <= ? AND substr(r.data,1,4) = ?
      UNION ALL
      SELECT r.data, r.tipo_massagem_id2, t.id AS tipo_id, t.nome AS terapia, COALESCE(t.preco,0) AS preco
      FROM reservas r
      LEFT JOIN tipos_massagem t ON t.id = r.tipo_massagem_id2
      WHERE r.massagista_id2 = ? AND r.data <= ? AND substr(r.data,1,4) = ?
    )
    SELECT CAST(substr(data,6,2) AS INTEGER) AS mes, tipo_id, terapia,
           COUNT(*) AS atendimentos, SUM(preco) AS receita
    FROM atend
    WHERE tipo_id IS NOT NULL
    GROUP BY mes, tipo_id, terapia
    ORDER BY mes, receita DESC
  `;
  let porTerapia = [];
  try {
    porTerapia = db.prepare(sqlPor).all(massagistaId, hoje, String(ano), massagistaId, hoje, String(ano));
  } catch {}

  const porTerapiaByMes = new Map();
  for (const p of porTerapia) {
    if (!porTerapiaByMes.has(p.mes)) porTerapiaByMes.set(p.mes, []);
    porTerapiaByMes.get(p.mes).push({ tipo_id: p.tipo_id, terapia: p.terapia || '—', atendimentos: p.atendimentos, receita: p.receita });
  }

  const meses = rows.map(r => ({
    mes: r.mes,
    atendimentos: r.atendimentos || 0,
    receita: r.receita || 0,
    por_terapia: porTerapiaByMes.get(r.mes) || [],
  }));
  const total = {
    atendimentos: meses.reduce((s,m)=>s+m.atendimentos, 0),
    receita:      meses.reduce((s,m)=>s+m.receita, 0),
  };
  return { ano, meses, total };
}

// Calcula comissao por mes a partir das reservas (sistema) + nota media (feedback).
// Config (base + tiers) lida de comissao_config — editável via UI sem deploy.
export function calcularComissaoPorMes(massagistaId, massagistaNome, ano) {
  const receita = agregarReceitaPorMesDoSistema(massagistaId, ano);
  const notas   = notaMediaPorMes(massagistaNome, ano);
  const cfg     = getComissaoConfig();

  const meses = receita.meses.map(m => {
    const nota = notas[m.mes] ?? null;
    const base = m.receita * cfg.base_rate;
    let bonusPct = 0, bonusLabel = null;
    if (nota != null) {
      for (const tier of cfg.tiers) {
        if (nota >= tier.min_nota) { bonusPct = tier.bonus; bonusLabel = tier.label; break; }
      }
    }
    const comissao = base * (1 + bonusPct);
    return { ...m, nota_media: nota, comissao_base: base, bonus_pct: bonusPct, bonus_label: bonusLabel, comissao };
  });

  const total = {
    atendimentos: meses.reduce((s,m)=>s+m.atendimentos, 0),
    receita:      meses.reduce((s,m)=>s+m.receita, 0),
    comissao:     meses.reduce((s,m)=>s+m.comissao, 0),
  };
  return {
    ano, meses, total,
    regras: { base_rate: cfg.base_rate, tiers: cfg.tiers },
    fonte: 'sistema',
  };
}

export function deletarTipoMassagem(id) {
  return getDb().prepare('DELETE FROM tipos_massagem WHERE id=?').run(id).changes;
}

// Whitelist explícita — evita expor PII (email, telefone, ip, user_agent)
// ao front. Drawer de detalhe usa endpoint separado (GET /api/feedback/item/:id)
// que faz seu próprio controle. Auditoria 2026-06-25.
export function historicoMassagista(nome) {
  return getDb()
    .prepare(`
      SELECT id, nome, recomenda, submitted_at, tratamento_realizado, idioma_detectado,
             servicos_expectativa, servicos_explicacao, servicos_atitude, servicos_tecnica, servicos_comentario,
             instalacoes_conforto, instalacoes_organizacao, instalacoes_conveniencia, instalacoes_comentario
      FROM feedback
      WHERE LOWER(nome_massoterapeuta) = LOWER(?)
      ORDER BY submitted_at DESC
    `)
    .all(nome);
}

// ── Reservas ──
export function listarReservasSemana(from, to) {
  return getDb().prepare(
    `SELECT r.*, m.nome AS massagista_nome, m2.nome AS massagista_nome2,
            q.categoria AS quarto_categoria
     FROM reservas r
     LEFT JOIN massagistas m  ON m.id  = r.massagista_id
     LEFT JOIN massagistas m2 ON m2.id = r.massagista_id2
     LEFT JOIN quartos q ON q.numero = r.quarto
     WHERE r.data >= ? AND r.data <= ?
     ORDER BY r.data, r.hora_inicio`
  ).all(from, to);
}

export function listarTodasReservas({ from, to, sala, salas, busca, massagista_id, limit = 100, offset = 0 } = {}) {
  const db = getDb();
  const conds = [];
  const params = [];
  // Normaliza: aceita 'salas' (array) novo ou 'sala' (escalar) legado.
  const salasNorm = (Array.isArray(salas) ? salas : (sala != null && sala !== '' ? [sala] : []))
    .map(n => parseInt(n, 10))
    .filter(n => Number.isInteger(n) && n >= 1 && n <= 5);
  const salasUniq = [...new Set(salasNorm)];
  if (from)   { conds.push('r.data >= ?');   params.push(from); }
  if (to)     { conds.push('r.data <= ?');   params.push(to); }
  if (salasUniq.length) {
    conds.push(`r.sala IN (${salasUniq.map(() => '?').join(',')})`);
    params.push(...salasUniq);
  }
  if (massagista_id) { conds.push('(r.massagista_id = ? OR r.massagista_id2 = ?)'); params.push(massagista_id, massagista_id); }
  if (busca)  { conds.push('(LOWER(r.cliente) LIKE ? OR LOWER(r.email) LIKE ?)'); params.push(`%${busca.toLowerCase()}%`, `%${busca.toLowerCase()}%`); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS t FROM reservas r ${where}`).get(...params).t;
  // Aditivo: novo campo respondeu_pesquisa (1 se ao menos uma pesquisa
  // foi respondida pra essa reserva). Subquery via survey_tokens. Contrato
  // do endpoint /historico preservado — campos antigos intactos.
  const items = db.prepare(`
    SELECT r.*,
      m.nome AS massoterapeuta_nome,
      t.nome AS tipo_massagem_nome,
      CASE WHEN EXISTS (
        SELECT 1 FROM survey_tokens st
        WHERE st.reserva_id = r.id AND st.respondida_em IS NOT NULL
      ) THEN 1 ELSE 0 END AS respondeu_pesquisa
    FROM reservas r
    LEFT JOIN massagistas m ON m.id = r.massagista_id
    LEFT JOIN tipos_massagem t ON t.id = r.tipo_massagem_id
    ${where}
    ORDER BY r.data DESC, r.hora_inicio DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  return { total, items };
}

export function inserirReserva(sala, cliente, tipo_cliente, apto, email, telefone, tratamento, data, horaInicio, horaFim, opts = {}) {
  const {
    linha = null, tipo_massagem_id = null, massagista_id = null, criado_por = null,
    cliente2 = null, tipo_cliente2 = null, apto2 = null, email2 = null, telefone2 = null,
    tratamento2 = null, tipo_massagem_id2 = null, massagista_id2 = null,
    idioma = null, idioma2 = null, nacionalidade = null, nacionalidade2 = null,
  } = opts;
  const db = getDb();

  // Verificar bloqueio de sala
  const _bloqueioAtivo = db.prepare(
    `SELECT id, motivo FROM sala_bloqueios WHERE sala = ? AND data_inicio <= ? AND data_fim >= ? LIMIT 1`
  ).get(sala, data, data);
  if (_bloqueioAtivo) {
    const e = new Error('SALA_BLOQUEADA');
    e.code = 'SALA_BLOQUEADA';
    e.motivo = _bloqueioAtivo.motivo;
    throw e;
  }

  // Conflito de sala. Salas 3 e 4 compartilham espaco fisico SOMENTE quando
  // a reserva (nova ou existente) eh CASAL — sinalizado por cliente2 != null.
  // Se ambas forem individuais, 3 e 4 sao independentes.
  const novaCasal = !!(cliente2 && String(cliente2).trim());
  const isSala34 = (sala === 3 || sala === 4);
  const conflitoSala = db.prepare(`
    SELECT id, cliente, hora_inicio, hora_fim, sala FROM reservas
    WHERE data = ?
      AND NOT (hora_fim <= ? OR hora_inicio >= ?)
      AND (
        sala = ?
        OR (
          ? = 1 AND sala IN (3, 4)
          AND (? = 1 OR (cliente2 IS NOT NULL AND TRIM(cliente2) != ''))
        )
      )
    LIMIT 1
  `).get(data, horaInicio, horaFim, sala, isSala34 ? 1 : 0, novaCasal ? 1 : 0);
  if (conflitoSala) {
    const e = new Error('CONFLITO_SALA');
    e.code = 'CONFLITO_SALA';
    e.conflito = conflitoSala;
    throw e;
  }

  // Conflito de massoterapeuta 1
  if (massagista_id) {
    const conflitoProf = db.prepare(`
      SELECT id, cliente, hora_inicio, hora_fim, sala FROM reservas
      WHERE (massagista_id = ? OR massagista_id2 = ?) AND data = ?
      AND NOT (hora_fim <= ? OR hora_inicio >= ?)
    `).get(massagista_id, massagista_id, data, horaInicio, horaFim);
    if (conflitoProf) {
      const e = new Error('CONFLITO_PROF');
      e.code = 'CONFLITO_PROF';
      e.conflito = conflitoProf;
      throw e;
    }
  }

  // Conflito de massoterapeuta 2 (casal)
  if (massagista_id2) {
    const conflitoProf2 = db.prepare(`
      SELECT id, cliente, hora_inicio, hora_fim, sala FROM reservas
      WHERE (massagista_id = ? OR massagista_id2 = ?) AND data = ?
      AND NOT (hora_fim <= ? OR hora_inicio >= ?)
    `).get(massagista_id2, massagista_id2, data, horaInicio, horaFim);
    if (conflitoProf2) {
      const e = new Error('CONFLITO_PROF');
      e.code = 'CONFLITO_PROF';
      e.conflito = conflitoProf2;
      throw e;
    }
  }

  return db.prepare(
    `INSERT INTO reservas (sala, cliente, tipo_cliente, apto, email, telefone, tratamento, data, hora_inicio, hora_fim, linha, tipo_massagem_id, massagista_id, criado_por,
       cliente2, tipo_cliente2, apto2, email2, telefone2, tratamento2, tipo_massagem_id2, massagista_id2, idioma, idioma2, nacionalidade, nacionalidade2)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    sala, cliente, tipo_cliente, apto, email, telefone, tratamento, data, horaInicio, horaFim,
    linha, tipo_massagem_id, massagista_id, criado_por,
    cliente2, tipo_cliente2, apto2, email2, telefone2, tratamento2, tipo_massagem_id2, massagista_id2,
    idioma, idioma2, nacionalidade, nacionalidade2
  ).lastInsertRowid;
}

export function cancelarReserva(id) {
  return getDb().prepare(`DELETE FROM reservas WHERE id = ?`).run(id).changes;
}

export function atualizarReserva(id, sala, cliente, tipo_cliente, apto, email, telefone, tratamento, data, horaInicio, horaFim, opts = {}) {
  const {
    linha = null, tipo_massagem_id = null, massagista_id = null,
    cliente2 = null, tipo_cliente2 = null, apto2 = null, email2 = null, telefone2 = null,
    tratamento2 = null, tipo_massagem_id2 = null, massagista_id2 = null,
    idioma = null, idioma2 = null,
  } = opts;
  const db = getDb();

  const existing = db.prepare('SELECT id FROM reservas WHERE id = ?').get(id);
  if (!existing) throw Object.assign(new Error('Reserva não encontrada'), { code: 'NOT_FOUND' });

  const _bloqueioAtivo = db.prepare(
    `SELECT id, motivo FROM sala_bloqueios WHERE sala = ? AND data_inicio <= ? AND data_fim >= ? LIMIT 1`
  ).get(sala, data, data);
  if (_bloqueioAtivo) throw Object.assign(new Error('SALA_BLOQUEADA'), { code: 'SALA_BLOQUEADA', motivo: _bloqueioAtivo.motivo });

  const novaCasal = !!(cliente2 && String(cliente2).trim());
  const isSala34 = (sala === 3 || sala === 4);
  const conflitoSala = db.prepare(`
    SELECT id, cliente, hora_inicio, hora_fim, sala FROM reservas
    WHERE data = ? AND id != ?
      AND NOT (hora_fim <= ? OR hora_inicio >= ?)
      AND (
        sala = ?
        OR (? = 1 AND sala IN (3, 4) AND (? = 1 OR (cliente2 IS NOT NULL AND TRIM(cliente2) != '')))
      )
    LIMIT 1
  `).get(data, id, horaInicio, horaFim, sala, isSala34 ? 1 : 0, novaCasal ? 1 : 0);
  if (conflitoSala) throw Object.assign(new Error('CONFLITO_SALA'), { code: 'CONFLITO_SALA', conflito: conflitoSala });

  if (massagista_id) {
    const conflitoProf = db.prepare(`
      SELECT id, cliente, hora_inicio, hora_fim, sala FROM reservas
      WHERE (massagista_id = ? OR massagista_id2 = ?) AND data = ? AND id != ?
        AND NOT (hora_fim <= ? OR hora_inicio >= ?)
    `).get(massagista_id, massagista_id, data, id, horaInicio, horaFim);
    if (conflitoProf) throw Object.assign(new Error('CONFLITO_PROF'), { code: 'CONFLITO_PROF', conflito: conflitoProf });
  }

  if (massagista_id2) {
    const conflitoProf2 = db.prepare(`
      SELECT id, cliente, hora_inicio, hora_fim, sala FROM reservas
      WHERE (massagista_id = ? OR massagista_id2 = ?) AND data = ? AND id != ?
        AND NOT (hora_fim <= ? OR hora_inicio >= ?)
    `).get(massagista_id2, massagista_id2, data, id, horaInicio, horaFim);
    if (conflitoProf2) throw Object.assign(new Error('CONFLITO_PROF'), { code: 'CONFLITO_PROF', conflito: conflitoProf2 });
  }

  db.prepare(`
    UPDATE reservas SET
      sala=?, cliente=?, tipo_cliente=?, apto=?, email=?, telefone=?, tratamento=?,
      data=?, hora_inicio=?, hora_fim=?, linha=?, tipo_massagem_id=?, massagista_id=?,
      cliente2=?, tipo_cliente2=?, apto2=?, email2=?, telefone2=?, tratamento2=?,
      tipo_massagem_id2=?, massagista_id2=?, idioma=?, idioma2=?
    WHERE id=?
  `).run(
    sala, cliente, tipo_cliente, apto, email, telefone, tratamento,
    data, horaInicio, horaFim, linha, tipo_massagem_id, massagista_id,
    cliente2, tipo_cliente2, apto2, email2, telefone2, tratamento2,
    tipo_massagem_id2, massagista_id2, idioma, idioma2,
    id
  );
  return { ok: true };
}

export function buscarReservaById(id) {
  return getDb().prepare(`
    SELECT r.*, m.nome AS massagista_nome, m2.nome AS massagista_nome2,
           c.nacionalidade AS nacionalidade
    FROM reservas r
    LEFT JOIN massagistas m  ON m.id  = r.massagista_id
    LEFT JOIN massagistas m2 ON m2.id = r.massagista_id2
    LEFT JOIN clientes c ON c.id = r.cliente_id
    WHERE r.id = ?
  `).get(id) || null;
}

// Retorna detalhe completo da sessao: reserva + survey_tokens (status da
// pesquisa por pessoa) + spa_perfis (anamnese readonly por pessoa) +
// feedback (notas dadas, busca por reserva_id). Reaproveita schemas
// existentes; nao introduz tabelas/migrations nem mexe em /historico.
//
// Casos de borda tratados: token nao gerado, pesquisa nao respondida,
// anamnese nao vinculada (documento_perfil_id null), zero feedbacks.
export function buscarReservaDetalhe(id) {
  const db = getDb();
  const reserva = buscarReservaById(id);
  if (!reserva) return null;

  // Survey tokens por pessoa (1 e 2 — casal)
  const tokens = db.prepare(`
    SELECT token, pessoa, liberada_em, respondida_em
    FROM survey_tokens
    WHERE reserva_id = ?
    ORDER BY criado_em ASC
  `).all(id);
  const tokenP1 = tokens.find(t => (t.pessoa || 1) === 1) || null;
  const tokenP2 = tokens.find(t => t.pessoa === 2) || null;

  // Anamneses por pessoa via documento_perfil_id / documento_perfil_id2
  const carregarPerfil = (perfilId) => {
    if (!perfilId) return null;
    return db.prepare(`SELECT * FROM spa_perfis WHERE id = ?`).get(perfilId) || null;
  };
  const perfilP1 = carregarPerfil(reserva.documento_perfil_id);
  const perfilP2 = carregarPerfil(reserva.documento_perfil_id2);

  // Feedback(s) ligados a essa reserva — pode haver 2 (casal). Filtra
  // tambem por email do hospede como fallback caso reserva_id nao
  // tenha sido gravado (compat retroativa antes da migracao do feedback.reserva_id).
  // Colunas reais da tabela feedback (schema em db.js:25-52). NAO inclui
  // massoterapeuta_avaliacao, tratamento, sala (nao existem). Quando
  // feedback.reserva_id ainda nao foi populado (registros antigos), o
  // fallback abaixo busca por nome+email.
  const _selectFb = `
    SELECT id, submitted_at, nome, email, tipo_cliente, origem,
           recomenda, recomenda_qual, recomenda_porque,
           servicos_expectativa, servicos_explicacao, servicos_atitude, servicos_tecnica,
           servicos_comentario,
           instalacoes_conforto, instalacoes_organizacao, instalacoes_conveniencia,
           instalacoes_comentario,
           nome_massoterapeuta, tratamento_realizado, data_tratamento, apto
    FROM feedback
  `;
  let feedbacks = [];
  try {
    feedbacks = db.prepare(`${_selectFb} WHERE reserva_id = ? ORDER BY submitted_at ASC`).all(id);
  } catch {
    // reserva_id pode nao existir em DB antigo (caso ALTER tenha falhado)
    feedbacks = [];
  }
  // Fallback adicional por nome/email da reserva caso reserva_id nao tenha
  // sido populado para registros antigos.
  if (!feedbacks.length && reserva.email) {
    try {
      const porEmail = db.prepare(`${_selectFb} WHERE LOWER(email) = LOWER(?) ORDER BY submitted_at ASC`).all(reserva.email);
      feedbacks = porEmail.filter(fb => {
        if (!fb.submitted_at || !reserva.data) return true;
        // Mesmo dia ou ate 7 dias depois da reserva
        const fbDay = fb.submitted_at.slice(0, 10);
        return fbDay >= reserva.data;
      });
    } catch {}
  }

  return {
    reserva,
    pessoa1: {
      token: tokenP1?.token || null,
      pesquisa_liberada_em: tokenP1?.liberada_em || null,
      pesquisa_respondida_em: tokenP1?.respondida_em || null,
      anamnese: perfilP1,
      // Filtra feedback por nome (P1 = reserva.cliente)
      feedback: feedbacks.find(f =>
        f.nome && reserva.cliente &&
        f.nome.trim().toLowerCase() === reserva.cliente.trim().toLowerCase()
      ) || null,
    },
    pessoa2: reserva.cliente2 ? {
      token: tokenP2?.token || null,
      pesquisa_liberada_em: tokenP2?.liberada_em || null,
      pesquisa_respondida_em: tokenP2?.respondida_em || null,
      anamnese: perfilP2,
      feedback: feedbacks.find(f =>
        f.nome && reserva.cliente2 &&
        f.nome.trim().toLowerCase() === reserva.cliente2.trim().toLowerCase()
      ) || null,
    } : null,
    // Lista completa pra debug / fallback (caso match por nome falhe)
    feedbacks_todos: feedbacks,
  };
}

// ativar=true (default) seta liberada_em=now() — tablet em / pega esse
// token no proximo polling. ativar=false cria/reusa o token mas mantem
// liberada_em=NULL — usado para reserva casal, onde os 2 tokens nascem
// inativos e cada um e' ativado individualmente pelo botao no modal.
// Sem isso, ambos os tokens nasciam com mesmo liberada_em (segundo) e o
// ORDER BY DESC LIMIT 1 podia retornar o errado (P1 quando admin clicou P2).
export function criarSurveyToken(reservaId, pessoa = 1, ativar = true) {
  const db = getDb();
  const p = pessoa === 2 ? 2 : 1;
  // Reusa token existente DESTA pessoa nesta reserva (idempotente).
  const existente = db.prepare(
    `SELECT token FROM survey_tokens WHERE reserva_id = ? AND COALESCE(pessoa,1) = ? AND respondida_em IS NULL ORDER BY criado_em DESC LIMIT 1`
  ).get(reservaId, p);
  if (existente) {
    if (ativar) {
      db.prepare(`UPDATE survey_tokens SET liberada_em = datetime('now') WHERE token = ?`).run(existente.token);
    }
    return existente.token;
  }
  const token = randomBytes(24).toString('hex');
  const sql = ativar
    ? `INSERT INTO survey_tokens (token, reserva_id, pessoa, liberada_em) VALUES (?, ?, ?, datetime('now'))`
    : `INSERT INTO survey_tokens (token, reserva_id, pessoa, liberada_em) VALUES (?, ?, ?, NULL)`;
  db.prepare(sql).run(token, reservaId, p);
  return token;
}

// Status da pesquisa do hospede (pessoa 1 ou 2) numa reserva. Usado pelo
// modal casal para decidir se mostra "Liberar pesquisa" ou "Pesquisa
// preenchida". Retorna { respondida: bool, feedback_id: number|null }.
export function statusPesquisaPessoa(reservaId, pessoa = 1) {
  const db = getDb();
  const p = pessoa === 2 ? 2 : 1;
  const row = db.prepare(
    `SELECT respondida_em, feedback_id FROM survey_tokens
     WHERE reserva_id = ? AND COALESCE(pessoa,1) = ?
     ORDER BY criado_em DESC LIMIT 1`
  ).get(reservaId, p);
  if (!row) return { respondida: false, feedback_id: null };
  return {
    respondida: !!row.respondida_em,
    feedback_id: row.feedback_id || null,
  };
}

export function buscarSurveyTokenAtivo() {
  // ⚠️ MODO TEMPORARIO: janela de 15min desativada a pedido do usuario.
  // Para restaurar a rigorosidade de tempo, troque pelo bloco comentado abaixo.
  return getDb().prepare(`
    SELECT st.token, st.liberada_em, r.cliente, r.apto, r.email, r.telefone, r.data, r.tratamento,
           r.tipo_cliente, r.quarto, r.idioma_documento AS idioma, m.nome AS massagista_nome
    FROM survey_tokens st
    JOIN reservas r ON r.id = st.reserva_id
    LEFT JOIN massagistas m ON m.id = r.massagista_id
    WHERE st.liberada_em IS NOT NULL
      AND st.respondida_em IS NULL
    ORDER BY st.liberada_em DESC LIMIT 1
  `).get() || null;
  /* VERSAO ORIGINAL (com janela de 15min):
  return getDb().prepare(`
    SELECT st.token, st.liberada_em, r.cliente, r.apto, r.email, r.telefone, r.data, r.tratamento,
           r.tipo_cliente, r.quarto, r.idioma_documento AS idioma, m.nome AS massagista_nome
    FROM survey_tokens st
    JOIN reservas r ON r.id = st.reserva_id
    LEFT JOIN massagistas m ON m.id = r.massagista_id
    WHERE st.liberada_em IS NOT NULL
      AND st.respondida_em IS NULL
      AND st.liberada_em >= datetime('now', '-15 minutes')
    ORDER BY st.liberada_em DESC LIMIT 1
  `).get() || null;
  */
}

// Marca o token de pesquisa como respondido. Se 'token' for passado,
// marca DESSE token especifico — preserva a pesquisa do casal (cada
// pessoa tem token proprio). Sem token, marca o ultimo liberado (compat).
// feedbackId opcional: se passado, grava o vinculo token→feedback (usado
// pelo modal casal pra abrir a pesquisa respondida no "Pesquisa preenchida").
export function marcarSurveyTokenRespondido(token, feedbackId = null) {
  const db = getDb();
  const setFeedback = (tok) => {
    if (feedbackId != null) {
      db.prepare(`UPDATE survey_tokens SET feedback_id = ? WHERE token = ?`).run(feedbackId, tok);
    }
  };
  if (token) {
    db.prepare(`UPDATE survey_tokens SET respondida_em = datetime('now') WHERE token = ?`).run(token);
    setFeedback(token);
    const row = db.prepare(`SELECT reserva_id FROM survey_tokens WHERE token = ?`).get(token);
    return row?.reserva_id || null;
  }
  // ⚠️ MODO TEMPORARIO: janela de 15min desativada.
  // Retorna reserva_id para que feedback.js possa linkar mesmo sem token no body.
  const target = db.prepare(`
    SELECT token, reserva_id FROM survey_tokens
    WHERE respondida_em IS NULL AND liberada_em IS NOT NULL
    ORDER BY liberada_em DESC LIMIT 1
  `).get();
  if (target) {
    db.prepare(`UPDATE survey_tokens SET respondida_em = datetime('now') WHERE token = ?`).run(target.token);
    setFeedback(target.token);
    return target.reserva_id || null;
  }
  return null;
  /* VERSAO ORIGINAL (com janela de 15min):
  db.prepare(`
    UPDATE survey_tokens SET respondida_em = datetime('now')
    WHERE token = (
      SELECT token FROM survey_tokens
      WHERE respondida_em IS NULL
        AND liberada_em IS NOT NULL
        AND liberada_em >= datetime('now', '-15 minutes')
      ORDER BY liberada_em DESC LIMIT 1
    )
  `).run();
  */
}

export function atualizarIdiomaFeedback(id, idioma) {
  getDb().prepare(`UPDATE feedback SET idioma_detectado = ? WHERE id = ?`).run(idioma, id);
}

// === Relatorios (Fase 2) ====================================================
// "Respondeu a pesquisa" = existe survey_token vinculado a reserva com
// respondida_em != NULL. Esta e' a unica fonte de verdade — o fluxo publico
// (cliente digitando direto na pesquisa) tambem marca o token via
// marcarSurveyTokenRespondido() em feedback.js.

// Resumo do mes: total de sessoes (1 reserva = 1 sessao, mesmo casal),
// total respondido e taxa. ym no formato 'YYYY-MM'.
export function estatisticasMes(ym) {
  const db = getDb();
  const sessoes = db.prepare(
    `SELECT COUNT(*) AS t FROM reservas WHERE substr(data,1,7) = ?`
  ).get(ym).t;
  const respondidas = db.prepare(`
    SELECT COUNT(DISTINCT st.reserva_id) AS t
    FROM survey_tokens st
    JOIN reservas r ON r.id = st.reserva_id
    WHERE substr(r.data,1,7) = ? AND st.respondida_em IS NOT NULL
  `).get(ym).t;
  const taxa = sessoes ? Math.round((respondidas / sessoes) * 1000) / 10 : 0;
  return { ym, sessoes, respondidas, pendentes: sessoes - respondidas, taxa };
}

// Cruzamento sessao x pesquisa. status: 'todos' | 'respondidas' | 'pendentes'.
// Retorna cada reserva (passada) com flag respondeu_pesquisa.
export function cruzamentoSessoesPesquisa({ from, to, status = 'todos' } = {}) {
  const db = getDb();
  const conds = ['(r.data < date(\'now\',\'localtime\') OR (r.data = date(\'now\',\'localtime\') AND r.hora_fim <= time(\'now\',\'localtime\')))'];
  const params = [];
  if (from) { conds.push('r.data >= ?'); params.push(from); }
  if (to)   { conds.push('r.data <= ?'); params.push(to); }
  const where = 'WHERE ' + conds.join(' AND ');
  const respondidaExpr = `EXISTS (SELECT 1 FROM survey_tokens st WHERE st.reserva_id = r.id AND st.respondida_em IS NOT NULL)`;
  let extra = '';
  if (status === 'respondidas') extra = ` AND ${respondidaExpr}`;
  else if (status === 'pendentes') extra = ` AND NOT ${respondidaExpr}`;
  const rows = db.prepare(`
    SELECT r.id, r.cliente, r.email, r.data, r.hora_inicio, r.hora_fim, r.sala, r.tratamento,
           m.nome AS massagista_nome,
           (${respondidaExpr}) AS respondeu_pesquisa,
           (SELECT MAX(st.respondida_em) FROM survey_tokens st WHERE st.reserva_id = r.id) AS respondida_em
    FROM reservas r
    LEFT JOIN massagistas m ON m.id = r.massagista_id
    ${where}${extra}
    ORDER BY r.data DESC, r.hora_inicio DESC
  `).all(...params);
  return rows.map(r => ({ ...r, respondeu_pesquisa: !!r.respondeu_pesquisa }));
}

export function countSessoesSemPesquisa() {
  return getDb().prepare(`
    SELECT COUNT(*) AS total FROM reservas r
    WHERE (
      r.data < date('now','localtime')
      OR (r.data = date('now','localtime') AND r.hora_fim <= time('now','localtime'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM survey_tokens st
      WHERE st.reserva_id = r.id AND st.respondida_em IS NOT NULL
    )
  `).get()?.total ?? 0;
}

export function buscarSurveyToken(token) {
  const row = getDb().prepare(`
    SELECT st.liberada_em, st.pessoa, st.reserva_id AS reserva_id,
           r.cliente_id AS cliente_id,
           r.cliente, r.apto, r.email, r.telefone, r.data, r.tratamento, r.tipo_cliente,
           r.quarto, r.idioma_documento AS idioma, m.nome AS massagista_nome,
           r.cliente2, r.apto2, r.email2, r.telefone2, r.tratamento2, r.tipo_cliente2,
           m2.nome AS massagista_nome2
    FROM survey_tokens st
    JOIN reservas r ON r.id = st.reserva_id
    LEFT JOIN massagistas m  ON m.id  = r.massagista_id
    LEFT JOIN massagistas m2 ON m2.id = r.massagista_id2
    WHERE st.token = ?
  `).get(token);
  if (!row) return null;
  // BUG-U fix: para tokens da pessoa 2 (cliente2 em reservas casal),
  // devolve os campos do cliente2 mascarando os campos principais —
  // pra que o link da pessoa 2 carregue os dados DELA, nao da pessoa 1.
  if (row.pessoa === 2) {
    return {
      liberada_em: row.liberada_em,
      pessoa: 2,
      reserva_id: row.reserva_id,
      cliente_id: row.cliente_id,
      cliente:        row.cliente2 || row.cliente,
      apto:           row.apto2     || row.apto,
      email:          row.email2    || row.email,
      telefone:       row.telefone2 || row.telefone,
      data:           row.data,
      tratamento:    row.tratamento2 || row.tratamento,
      tipo_cliente:  row.tipo_cliente2 || row.tipo_cliente,
      quarto:        row.quarto,
      idioma:        row.idioma,
      massagista_nome: row.massagista_nome2 || row.massagista_nome,
    };
  }
  return row;
}

export function buscarAdmin(username) {
  return getDb().prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
}

export function listarAdmins() {
  return getDb().prepare('SELECT id, nome, username, role, created_at FROM admin_users ORDER BY created_at ASC').all();
}

export function buscarAdminById(id) {
  return getDb().prepare('SELECT * FROM admin_users WHERE id = ?').get(id) || null;
}

export function inserirAdmin(username, passwordHash, nome = null, role = 'admin') {
  return getDb().prepare(
    'INSERT INTO admin_users (username, password_hash, nome, role) VALUES (?, ?, ?, ?)'
  ).run(username, passwordHash, nome, role).lastInsertRowid;
}

export function atualizarAdmin(id, { nome, username, passwordHash, role }) {
  const db = getDb();
  if (passwordHash) {
    db.prepare('UPDATE admin_users SET nome=?, username=?, password_hash=?, role=? WHERE id=?')
      .run(nome ?? null, username, passwordHash, role, id);
  } else {
    db.prepare('UPDATE admin_users SET nome=?, username=?, role=? WHERE id=?')
      .run(nome ?? null, username, role, id);
  }
}

export function deletarAdmin(id) {
  return getDb().prepare('DELETE FROM admin_users WHERE id = ?').run(id).changes;
}

// ── SPA Pre-treatment form ──
// pessoa: 1 (cliente principal) | 2 (cliente2 — segunda pessoa da reserva casal)
// Para reservas individuais, sempre usar pessoa=1.
export function gerarDocumentoToken(reservaId, pessoa = 1) {
  const token = randomBytes(24).toString('hex');
  // Expiry = horário de FIM da reserva (UTC-3/Fortaleza). Link inválido após o procedimento.
  // Fallback para +48h caso a reserva não seja encontrada ou hora_fim esteja ausente.
  let expiry;
  try {
    const r = getDb().prepare('SELECT data, hora_fim FROM reservas WHERE id=?').get(reservaId);
    if (r?.data && r?.hora_fim) {
      const hm = r.hora_fim.match(/^(\d{1,2}):(\d{2})/);
      if (hm) {
        const h = String(+hm[1]).padStart(2, '0');
        expiry = new Date(`${r.data}T${h}:${hm[2]}:00-03:00`).toISOString();
      }
    }
  } catch {}
  if (!expiry) expiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const p = pessoa === 2 ? 2 : 1;
  if (p === 2) {
    getDb().prepare(
      `UPDATE reservas SET documento_token2=?, documento_token_expiry2=?, documento_enviado_em=datetime('now') WHERE id=?`
    ).run(token, expiry, reservaId);
  } else {
    getDb().prepare(
      `UPDATE reservas SET documento_token=?, documento_token_expiry=?, documento_enviado_em=datetime('now') WHERE id=?`
    ).run(token, expiry, reservaId);
  }
  return token;
}

// Busca por QUALQUER um dos dois tokens da reserva (cliente principal
// ou cliente2). Retorna o nome/email do hospede CERTO conforme o token
// usado, e o campo 'pessoa' (1 ou 2) pra rastreabilidade.
export function buscarDocumentoToken(token) {
  const row = getDb().prepare(`
    SELECT r.id AS reserva_id, r.cliente, r.email, r.telefone, r.tratamento AS servico,
           r.idioma_documento AS locale, r.cpf, r.quarto, r.cliente_id,
           r.cliente2, r.email2, r.telefone2, r.apto2 AS quarto2,
           r.nacionalidade, r.nacionalidade2,
           c.data_nascimento AS cli_nascimento,
           r.documento_token, r.documento_token2,
           r.documento_token_expiry, r.documento_token_expiry2,
           r.documento_perfil_id, r.documento_perfil_id2
    FROM reservas r
    LEFT JOIN clientes c ON c.id = r.cliente_id
    WHERE r.documento_token = ? OR r.documento_token2 = ?
  `).get(token, token);
  if (!row) return null;
  const pessoa = (row.documento_token2 === token) ? 2 : 1;
  // Verifica expiração: se a hora_fim da reserva passou, link é inválido.
  const expiry = pessoa === 2 ? row.documento_token_expiry2 : row.documento_token_expiry;
  if (expiry && new Date(expiry) < new Date()) {
    return { expirado: true, locale: row.locale || 'pt-BR' };
  }
  // ja_respondida: o slot da pessoa em reservas ja aponta para um spa_perfis.
  // Gate de uso único — checado tanto no GET /documento quanto na transação do POST /perfil.
  const _perfilIdSlot = pessoa === 2 ? row.documento_perfil_id2 : row.documento_perfil_id;
  const ja_respondida = _perfilIdSlot != null;
  return {
    reserva_id:    row.reserva_id,
    hospede_nome:  pessoa === 2 ? (row.cliente2  || '') : (row.cliente  || ''),
    hospede_email: pessoa === 2 ? (row.email2    || '') : (row.email    || ''),
    hospede_telefone: pessoa === 2 ? (row.telefone2 || '') : (row.telefone || ''),
    hospede_cpf:           pessoa === 2 ? '' : (row.cpf || ''),
    hospede_quarto:        pessoa === 2 ? (row.quarto2 || '') : (row.quarto || ''),
    hospede_nacionalidade: pessoa === 2 ? (row.nacionalidade2 || '') : (row.nacionalidade || ''),
    hospede_data_nascimento: pessoa === 2 ? '' : (row.cli_nascimento || ''),
    servico:       row.servico,
    locale:        row.locale,
    pessoa,
    ja_respondida,
  };
}

export function inserirSpaPerfil(dados) {
  const { nome, sobrenome, tipo_documento, documento, email, telefone, data_nascimento,
          rotina_facial, rotina_corporal, produto_especifico, pressao_massagem, info_medica,
          consentimento_saude, consentimento_marketing, canais_marketing, assinatura_data_url,
          idioma, reserva_id, pessoa, nacionalidade,
          consentimento_saude_texto, consentimento_saude_hash,
          consentimento_saude_versao, consentimento_saude_em,
          consentimento_saude_canonico_divergente, consentimento_saude_canonico_comparado,
          consentimento_saude_hash_canonico, consentimento_saude_key_id,
          consentimento_saude_alg, consentimento_saude_assinatura_hash } = dados;
  // Guard D22: estado orfao do canonico nao pode ser persistido.
  // Se nao ha comparacao, nao pode ter divergencia gravada como 1.
  const _safeDivergente = (consentimento_saude_canonico_comparado === 1)
    ? (consentimento_saude_canonico_divergente ? 1 : 0)
    : 0;
  const db = getDb();
  const resolvedIdioma = idioma || 'pt-BR';
  const resolvedPessoa = pessoa === 2 ? 2 : 1;

  // Upsert por (reserva_id, pessoa): garante que o hospede 2 nao sobrescreva
  // a anamnese do hospede 1 em reservas casal, mesmo quando ambos preenchem
  // no mesmo idioma. O idioma vira coluna comum (sobrescrita no reenvio).
  // ORDER BY criado_em DESC: protege contra orfas legadas (linhas duplicadas
  // criadas antes do Passo 2 quando a chave era (reserva_id, idioma) — ao
  // reenviar, escolhemos deterministicamente a mais recente para atualizar.
  const existente = reserva_id
    ? db.prepare('SELECT id FROM spa_perfis WHERE reserva_id=? AND pessoa=? ORDER BY criado_em DESC, id DESC LIMIT 1').get(reserva_id, resolvedPessoa)
    : null;

  let perfil_id;
  if (existente) {
    // consentimento_saude_em: preserva o timestamp da PRIMEIRA aceitacao
    // quando o hash nao muda (mesma versao do texto). Sobrescreve so se
    // o hash mudou ou se ainda nao existia hash. Mantem a "data jurídica"
    // do primeiro consentimento daquela versao do texto.
    db.prepare(`UPDATE spa_perfis SET nome=?, sobrenome=?, tipo_documento=?, documento=?, email=?, telefone=?,
      data_nascimento=?, rotina_facial=?, rotina_corporal=?, produto_especifico=?, pressao_massagem=?,
      info_medica=?, consentimento_saude=?, consentimento_marketing=?, canais_marketing=?,
      assinatura_data_url=?, idioma=?, pessoa=?, nacionalidade=?,
      consentimento_saude_texto=?, consentimento_saude_hash=?,
      consentimento_saude_versao=?,
      consentimento_saude_canonico_divergente=?, consentimento_saude_canonico_comparado=?,
      consentimento_saude_hash_canonico=?, consentimento_saude_key_id=?,
      consentimento_saude_alg=?, consentimento_saude_assinatura_hash=?,
      consentimento_saude_em = CASE
        WHEN consentimento_saude_hash IS NOT NULL AND consentimento_saude_hash = ? THEN consentimento_saude_em
        ELSE ?
      END
      WHERE id=?`
    ).run(nome, sobrenome, tipo_documento || 'cpf', documento || '', email, telefone,
          data_nascimento || null, rotina_facial || null, rotina_corporal || null,
          produto_especifico || null, pressao_massagem || null, info_medica || '',
          consentimento_saude ? 1 : 0, consentimento_marketing ? 1 : 0,
          canais_marketing || null, assinatura_data_url || null, resolvedIdioma, resolvedPessoa,
          nacionalidade || null,
          consentimento_saude_texto || null, consentimento_saude_hash || null,
          consentimento_saude_versao || null,
          _safeDivergente,
          (consentimento_saude_canonico_comparado === 1 ? 1 : null),
          consentimento_saude_hash_canonico || null, consentimento_saude_key_id || null,
          consentimento_saude_alg || null, consentimento_saude_assinatura_hash || null,
          consentimento_saude_hash || null, consentimento_saude_em || null, existente.id);
    perfil_id = existente.id;
  } else {
    const r = db.prepare(`
      INSERT INTO spa_perfis (nome, sobrenome, tipo_documento, documento, email, telefone, data_nascimento,
        rotina_facial, rotina_corporal, produto_especifico, pressao_massagem, info_medica,
        consentimento_saude, consentimento_marketing, canais_marketing, assinatura_data_url, idioma, reserva_id, pessoa,
        nacionalidade,
        consentimento_saude_texto, consentimento_saude_hash, consentimento_saude_versao, consentimento_saude_em,
        consentimento_saude_canonico_divergente, consentimento_saude_canonico_comparado,
        consentimento_saude_hash_canonico, consentimento_saude_key_id,
        consentimento_saude_alg, consentimento_saude_assinatura_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(nome, sobrenome, tipo_documento || 'cpf', documento || '', email, telefone,
           data_nascimento || null, rotina_facial || null, rotina_corporal || null,
           produto_especifico || null, pressao_massagem || null, info_medica || '',
           consentimento_saude ? 1 : 0, consentimento_marketing ? 1 : 0,
           canais_marketing || null, assinatura_data_url || null, resolvedIdioma, reserva_id || null, resolvedPessoa,
           nacionalidade || null,
           consentimento_saude_texto || null, consentimento_saude_hash || null,
           consentimento_saude_versao || null, consentimento_saude_em || null,
           _safeDivergente,
           (consentimento_saude_canonico_comparado === 1 ? 1 : null),
           consentimento_saude_hash_canonico || null, consentimento_saude_key_id || null,
           consentimento_saude_alg || null, consentimento_saude_assinatura_hash || null);
    perfil_id = r.lastInsertRowid;
  }

  // Amarra ao slot certo da reserva: documento_perfil_id (pessoa 1) ou
  // documento_perfil_id2 (pessoa 2). Sem isso, ambas as colunas poderiam
  // apontar para o mesmo registro em reservas casal.
  // DEFESA EM PROFUNDIDADE: o `AND ${col} IS NULL` replica o gate de uso unico
  // tambem na funcao legada. Se algum codigo futuro chamar inserirSpaPerfil
  // (sem lock), nao consegue bypassar a trava silenciosamente.
  if (reserva_id) {
    const col = resolvedPessoa === 2 ? 'documento_perfil_id2' : 'documento_perfil_id';
    db.prepare(`UPDATE reservas SET ${col}=? WHERE id=? AND ${col} IS NULL`).run(perfil_id, reserva_id);
  }
  return perfil_id;
}

// Trava atomica de "link de uso unico" para anamnese.
// Envolve a gravacao do perfil + a marcacao em reservas (documento_perfil_id ou _id2)
// numa transacao com BEGIN IMMEDIATE. O passo-chave e' o UPDATE condicional
// com `AND documento_perfil_id IS NULL` — se changes===0, outro envio ja venceu
// a corrida e nos abortamos com Error('ANAMNESE_JA_RESPONDIDA').
// Reqer reserva_id valido — chamadores sem token nao devem usar essa funcao.
export function inserirSpaPerfilComLock(dados) {
  const { reserva_id, pessoa } = dados;
  if (!reserva_id) {
    throw new Error('RESERVA_ID_OBRIGATORIO');
  }
  const resolvedPessoa = pessoa === 2 ? 2 : 1;
  const col = resolvedPessoa === 2 ? 'documento_perfil_id2' : 'documento_perfil_id';

  const db = getDb();
  // Pre-check fora da transacao da' uma resposta amigavel ja no comeco
  // (evita rodar todo o INSERT/UPDATE pra descobrir no fim que tava travado).
  // A trava REAL e' o UPDATE condicional dentro da transacao — esta linha
  // e' apenas otimizacao + erro mais cedo.
  const pre = db.prepare(`SELECT ${col} AS slot FROM reservas WHERE id=?`).get(reserva_id);
  if (pre && pre.slot != null) {
    throw new Error('ANAMNESE_JA_RESPONDIDA');
  }

  // Transacao IMMEDIATE: pega write-lock no inicio, serializando concorrentes.
  // better-sqlite3 e' sincrono — no mesmo processo, transacoes ja serializam.
  // A IMMEDIATE protege contra outro processo (improvável aqui, mas defensivo).
  const tx = db.transaction((d) => {
    // 1) Insere/atualiza spa_perfis (replica logica de inserirSpaPerfil)
    const perfil_id = _inserirSpaPerfilCore(d);
    // 2) Gate atomico: UPDATE so' grava se o slot estiver NULL.
    const r = db.prepare(
      `UPDATE reservas SET ${col}=? WHERE id=? AND ${col} IS NULL`
    ).run(perfil_id, reserva_id);
    if (r.changes === 0) {
      // Outro envio venceu a corrida — aborta a transacao.
      throw new Error('ANAMNESE_JA_RESPONDIDA');
    }
    return perfil_id;
  }).immediate;
  return tx(dados);
}

// Logica do inserirSpaPerfil SEM o UPDATE de reservas no final.
// Extraida pra ser reutilizada por inserirSpaPerfilComLock dentro da transacao.
// Mantem inserirSpaPerfil exportada inalterada para compatibilidade.
function _inserirSpaPerfilCore(dados) {
  const { nome, sobrenome, tipo_documento, documento, email, telefone, data_nascimento,
          rotina_facial, rotina_corporal, produto_especifico, pressao_massagem, info_medica,
          consentimento_saude, consentimento_marketing, canais_marketing, assinatura_data_url,
          idioma, reserva_id, pessoa, nacionalidade,
          consentimento_saude_texto, consentimento_saude_hash,
          consentimento_saude_versao, consentimento_saude_em,
          consentimento_saude_canonico_divergente, consentimento_saude_canonico_comparado,
          consentimento_saude_hash_canonico, consentimento_saude_key_id,
          consentimento_saude_alg, consentimento_saude_assinatura_hash } = dados;
  const _safeDivergente = (consentimento_saude_canonico_comparado === 1)
    ? (consentimento_saude_canonico_divergente ? 1 : 0)
    : 0;
  const db = getDb();
  const resolvedIdioma = idioma || 'pt-BR';
  const resolvedPessoa = pessoa === 2 ? 2 : 1;
  const existente = reserva_id
    ? db.prepare('SELECT id FROM spa_perfis WHERE reserva_id=? AND pessoa=? ORDER BY criado_em DESC, id DESC LIMIT 1').get(reserva_id, resolvedPessoa)
    : null;
  let perfil_id;
  if (existente) {
    db.prepare(`UPDATE spa_perfis SET nome=?, sobrenome=?, tipo_documento=?, documento=?, email=?, telefone=?,
      data_nascimento=?, rotina_facial=?, rotina_corporal=?, produto_especifico=?, pressao_massagem=?,
      info_medica=?, consentimento_saude=?, consentimento_marketing=?, canais_marketing=?,
      assinatura_data_url=?, idioma=?, pessoa=?, nacionalidade=?,
      consentimento_saude_texto=?, consentimento_saude_hash=?,
      consentimento_saude_versao=?,
      consentimento_saude_canonico_divergente=?, consentimento_saude_canonico_comparado=?,
      consentimento_saude_hash_canonico=?, consentimento_saude_key_id=?,
      consentimento_saude_alg=?, consentimento_saude_assinatura_hash=?,
      consentimento_saude_em = CASE
        WHEN consentimento_saude_hash IS NOT NULL AND consentimento_saude_hash = ? THEN consentimento_saude_em
        ELSE ?
      END
      WHERE id=?`
    ).run(nome, sobrenome, tipo_documento || 'cpf', documento || '', email, telefone,
          data_nascimento || null, rotina_facial || null, rotina_corporal || null,
          produto_especifico || null, pressao_massagem || null, info_medica || '',
          consentimento_saude ? 1 : 0, consentimento_marketing ? 1 : 0,
          canais_marketing || null, assinatura_data_url || null, resolvedIdioma, resolvedPessoa,
          nacionalidade || null,
          consentimento_saude_texto || null, consentimento_saude_hash || null,
          consentimento_saude_versao || null,
          _safeDivergente,
          (consentimento_saude_canonico_comparado === 1 ? 1 : null),
          consentimento_saude_hash_canonico || null, consentimento_saude_key_id || null,
          consentimento_saude_alg || null, consentimento_saude_assinatura_hash || null,
          consentimento_saude_hash || null, consentimento_saude_em || null, existente.id);
    perfil_id = existente.id;
  } else {
    const r = db.prepare(`
      INSERT INTO spa_perfis (nome, sobrenome, tipo_documento, documento, email, telefone, data_nascimento,
        rotina_facial, rotina_corporal, produto_especifico, pressao_massagem, info_medica,
        consentimento_saude, consentimento_marketing, canais_marketing, assinatura_data_url, idioma, reserva_id, pessoa,
        nacionalidade,
        consentimento_saude_texto, consentimento_saude_hash, consentimento_saude_versao, consentimento_saude_em,
        consentimento_saude_canonico_divergente, consentimento_saude_canonico_comparado,
        consentimento_saude_hash_canonico, consentimento_saude_key_id,
        consentimento_saude_alg, consentimento_saude_assinatura_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(nome, sobrenome, tipo_documento || 'cpf', documento || '', email, telefone,
           data_nascimento || null, rotina_facial || null, rotina_corporal || null,
           produto_especifico || null, pressao_massagem || null, info_medica || '',
           consentimento_saude ? 1 : 0, consentimento_marketing ? 1 : 0,
           canais_marketing || null, assinatura_data_url || null, resolvedIdioma, reserva_id || null, resolvedPessoa,
           nacionalidade || null,
           consentimento_saude_texto || null, consentimento_saude_hash || null,
           consentimento_saude_versao || null, consentimento_saude_em || null,
           _safeDivergente,
           (consentimento_saude_canonico_comparado === 1 ? 1 : null),
           consentimento_saude_hash_canonico || null, consentimento_saude_key_id || null,
           consentimento_saude_alg || null, consentimento_saude_assinatura_hash || null);
    perfil_id = r.lastInsertRowid;
  }
  return perfil_id;
}

export function vincularDocumentoToken(reservaId, locale) {
  try { getDb().prepare('UPDATE reservas SET idioma_documento=? WHERE id=?').run(locale, reservaId); } catch {}
}

// ── Quartos do Hotel Gran Marquise ───────────────────────────────────────
// Fonte da verdade dos 230 quartos. Categoria 'gran_class' é derivada
// deste cadastro — nunca digitada à mão.
export function seedQuartosGranMarquise() {
  const db = getDb();
  const ins = db.prepare("INSERT OR IGNORE INTO quartos (numero, andar, categoria, ativo) VALUES (?,?,?,1)");
  const tx = db.transaction(() => {
    // Andares 05 a 13: XX01 a XX17 (17 quartos por andar, standard).
    for (let a = 5; a <= 13; a++) {
      for (let n = 1; n <= 17; n++) {
        const num = String(a).padStart(2, '0') + String(n).padStart(2, '0');
        ins.run(num, a, 'standard');
      }
    }
    // Andar 14 — misto.
    for (const n of ['1401','1402','1404','1405']) ins.run(n, 14, 'gran_class');
    for (let n = 6; n <= 17; n++) ins.run('14' + String(n).padStart(2, '0'), 14, 'standard');
    // Andar 15 — misto.
    for (const n of ['1501','1502','1504','1505']) ins.run(n, 15, 'gran_class');
    for (let n = 6; n <= 17; n++) ins.run('15' + String(n).padStart(2, '0'), 15, 'standard');
    // Andar 16 — Gran Class, sem 1603.
    for (let n = 1; n <= 17; n++) {
      if (n === 3) continue;
      ins.run('16' + String(n).padStart(2, '0'), 16, 'gran_class');
    }
    // Andar 17 — Gran Class, sem 1704 e 1705.
    for (let n = 1; n <= 17; n++) {
      if (n === 4 || n === 5) continue;
      ins.run('17' + String(n).padStart(2, '0'), 17, 'gran_class');
    }
    // Andar 18 — Gran Class, sem 1802, 1804 e 1805.
    for (let n = 1; n <= 17; n++) {
      if (n === 2 || n === 4 || n === 5) continue;
      ins.run('18' + String(n).padStart(2, '0'), 18, 'gran_class');
    }
  });
  tx();
  return true;
}

function _normQuarto(v) {
  if (v == null) return '';
  return String(v).trim().replace(/\D/g, '').padStart(4, '0').slice(-4);
}

export function buscarQuarto(numero) {
  const n = _normQuarto(numero);
  if (!n) return null;
  return getDb().prepare("SELECT numero, andar, categoria, ativo FROM quartos WHERE numero=?").get(n) || null;
}

export function quartoValido(numero) {
  const q = buscarQuarto(numero);
  return !!(q && q.ativo);
}

export function isGranClass(numero) {
  const q = buscarQuarto(numero);
  return !!(q && q.ativo && q.categoria === 'gran_class');
}

export function categoriaQuarto(numero) {
  const q = buscarQuarto(numero);
  return q?.categoria || null;
}

export function listarQuartos({ categoria, andar, ativo } = {}) {
  const where = [], args = [];
  if (categoria) { where.push('categoria=?'); args.push(categoria); }
  if (andar)     { where.push('andar=?');     args.push(andar); }
  if (ativo != null) { where.push('ativo=?'); args.push(ativo ? 1 : 0); }
  const sql = `SELECT numero, andar, categoria, ativo FROM quartos
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY numero`;
  return getDb().prepare(sql).all(...args);
}

// ── Validação de telefone (BR e internacional E.164) ─────────────────────
// CRÍTICO: hóspedes estrangeiros usam números com "+" e código de país.
// NÃO bloquear esses telefones. Validação estrita só para números BR.
const _DDDS_BR = new Set([
  '11','12','13','14','15','16','17','18','19',
  '21','22','24','27','28',
  '31','32','33','34','35','37','38',
  '41','42','43','44','45','46','47','48','49',
  '51','53','54','55',
  '61','62','63','64','65','66','67','68','69',
  '71','73','74','75','77','79',
  '81','82','83','84','85','86','87','88','89',
  '91','92','93','94','95','96','97','98','99',
]);

export function telefoneValido(tel) {
  if (!tel) return false;
  const raw = String(tel).trim();
  if (!raw) return false;
  // Internacional (E.164): começa com + e tem 8 a 15 dígitos após.
  if (raw.startsWith('+')) {
    const digits = raw.slice(1).replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15;
  }
  // Brasileiro: aceita 10 ou 11 dígitos, primeiro par é DDD válido, e se
  // for 11 dígitos o primeiro do número precisa ser 9 (celular).
  const d = raw.replace(/\D/g, '');
  if (d.length !== 10 && d.length !== 11) return false;
  const ddd = d.slice(0, 2);
  if (!_DDDS_BR.has(ddd)) return false;
  if (d.length === 11 && d[2] !== '9') return false;
  return true;
}

// ── Módulo 1: Cadastro de Clientes ────────────────────────────────────────
function _normCpf(v) {
  return (v || '').toString().replace(/\D/g, '');
}

export function validarCpfMod11(cpf) {
  cpf = _normCpf(cpf);
  if (cpf.length !== 11 || /^(.)\1+$/.test(cpf)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += +cpf[i] * (10 - i);
  let r = (s * 10) % 11;
  if (r >= 10) r = 0;
  if (r !== +cpf[9]) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += +cpf[i] * (11 - i);
  r = (s * 10) % 11;
  if (r >= 10) r = 0;
  return r === +cpf[10];
}

export function validarPassaporte(p) {
  return typeof p === 'string' && /^[A-Z0-9]{5,20}$/.test(p.trim().toUpperCase());
}

export function listarClientes({ q, limit = 100, offset = 0 } = {}) {
  const db = getDb();
  let where = '1=1', args = [];
  if (q) {
    const needle = '%' + q.toLowerCase().replace(/\s+/g, '%') + '%';
    where = '(LOWER(nome) LIKE ? OR cpf LIKE ? OR LOWER(passaporte) LIKE ? OR LOWER(email) LIKE ? OR telefone LIKE ?)';
    const cpfN = '%' + _normCpf(q) + '%';
    const passN = '%' + q.toUpperCase() + '%';
    args = [needle, cpfN, passN, needle, needle];
  }
  const items = db.prepare(`
    SELECT id, cpf, passaporte, nome, email, telefone, data_nascimento, locale_pref, nacionalidade, criado_em, atualizado_em
    FROM clientes WHERE ${where}
    ORDER BY nome
    LIMIT ? OFFSET ?
  `).all(...args, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM clientes WHERE ${where}`).get(...args).n;
  return { items, total };
}

export function buscarClientePorId(id) {
  return getDb().prepare(`
    SELECT id, cpf, passaporte, nome, email, telefone, data_nascimento, locale_pref, nacionalidade, observacao, criado_em, atualizado_em
    FROM clientes WHERE id=?
  `).get(id) || null;
}

export function buscarClientePorCpf(cpf) {
  const n = _normCpf(cpf);
  if (!n) return null;
  return getDb().prepare(`
    SELECT id, cpf, passaporte, nome, email, telefone, data_nascimento, locale_pref, nacionalidade, observacao, criado_em, atualizado_em
    FROM clientes WHERE cpf=? LIMIT 1
  `).get(n) || null;
}

export function buscarClientePorPassaporte(passaporte) {
  const p = (passaporte || '').toString().trim().toUpperCase();
  if (!p) return null;
  return getDb().prepare(`
    SELECT id, cpf, passaporte, nome, email, telefone, data_nascimento, locale_pref, nacionalidade, observacao, criado_em, atualizado_em
    FROM clientes WHERE passaporte=? LIMIT 1
  `).get(p) || null;
}

export function inserirCliente({ cpf, passaporte, nome, email, telefone, data_nascimento, locale_pref, nacionalidade, observacao }) {
  if (!nome) throw new Error('nome obrigatorio');
  const cpfN = _normCpf(cpf) || null;
  const passN = passaporte ? passaporte.toString().trim().toUpperCase() : null;
  if (cpfN && !validarCpfMod11(cpfN)) throw new Error('CPF invalido');
  // upsert por CPF ou passaporte (retorna id existente se já cadastrado)
  if (cpfN) {
    const existing = buscarClientePorCpf(cpfN);
    if (existing) return existing.id;
  } else if (passN) {
    const existing = buscarClientePorPassaporte(passN);
    if (existing) return existing.id;
  }
  const r = getDb().prepare(`
    INSERT INTO clientes (cpf, passaporte, nome, email, telefone, data_nascimento, locale_pref, nacionalidade, observacao)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(cpfN, passN, nome, email || null, telefone || null, data_nascimento || null, locale_pref || 'pt-BR', nacionalidade || null, observacao || null);
  return r.lastInsertRowid;
}

export function atualizarCliente(id, { cpf, nome, email, telefone, data_nascimento, locale_pref, nacionalidade, observacao }) {
  const db = getDb();
  const sets = [], args = [];
  if (cpf !== undefined) {
    const cpfN = _normCpf(cpf) || null;
    if (cpfN && !validarCpfMod11(cpfN)) throw new Error('CPF invalido');
    sets.push('cpf=?'); args.push(cpfN);
  }
  if (nome !== undefined)            { sets.push('nome=?');            args.push(nome); }
  if (email !== undefined)           { sets.push('email=?');           args.push(email); }
  if (telefone !== undefined)        { sets.push('telefone=?');        args.push(telefone); }
  if (data_nascimento !== undefined) { sets.push('data_nascimento=?'); args.push(data_nascimento); }
  if (locale_pref !== undefined)     { sets.push('locale_pref=?');     args.push(locale_pref); }
  if (nacionalidade !== undefined)   { sets.push('nacionalidade=?');   args.push(nacionalidade); }
  if (observacao !== undefined)      { sets.push('observacao=?');      args.push(observacao); }
  if (!sets.length) return false;
  sets.push("atualizado_em=datetime('now')");
  args.push(id);
  db.prepare(`UPDATE clientes SET ${sets.join(', ')} WHERE id=?`).run(...args);
  return true;
}

export function buscarCliente360(id) {
  const db = getDb();
  const cliente = buscarClientePorId(id);
  if (!cliente) return null;
  // Tratamentos (reservas), via cliente_id direto OU CPF de match
  const reservas = db.prepare(`
    SELECT r.id, r.data, r.hora_inicio, r.hora_fim, r.sala, r.cliente, r.cliente2, r.tratamento, r.tipo_cliente,
           r.massagista_id, r.massagista_id2, r.tipo_massagem_id, r.quarto, r.criado_em,
           q.categoria AS quarto_categoria
    FROM reservas r
    LEFT JOIN quartos q ON q.numero = r.quarto
    WHERE r.cliente_id=? OR (r.cpf IS NOT NULL AND r.cpf=?)
    ORDER BY r.data DESC, r.hora_inicio DESC
  `).all(id, cliente.cpf || '');
  // Flag agregado: cliente é Gran Class se TIVER ALGUMA reserva em quarto GC.
  const _gcReservas = reservas.some(r => r.quarto_categoria === 'gran_class');
  // Anamneses (formato unificado): vem de duas fontes:
  // 1) spa_perfis (anamnese tradicional com assinatura + info_medica)
  // 2) resposta_pesquisa com slug spa-anamnese* (anamnese estruturada)
  // Faz UNION e deduplica por reserva_id quando existir spa_perfil.
  // COALESCE: usa dado do formulário (spa_perfis) quando preenchido, caso contrário
  // cai no cadastro do cliente — evita exibir "—" para info que o sistema já conhece.
  const anamPerfis = db.prepare(`
    SELECT sp.id, sp.nome, sp.sobrenome, sp.tipo_documento, sp.documento,
           COALESCE(sp.email,    c.email)    AS email,
           COALESCE(sp.telefone, c.telefone) AS telefone,
           sp.idioma, sp.pessoa,
           sp.reserva_id, sp.criado_em, 'spa_perfil' AS fonte
    FROM spa_perfis sp
    LEFT JOIN clientes c ON c.id = sp.cliente_id
    WHERE sp.cliente_id=?
      OR (sp.documento IS NOT NULL AND sp.documento=?)
      OR sp.reserva_id IN (SELECT id FROM reservas WHERE cliente_id=? OR (cpf IS NOT NULL AND cpf=?))
    ORDER BY sp.criado_em DESC
  `).all(id, cliente.cpf || '', id, cliente.cpf || '');
  // Reservas onde JA existe spa_perfil por (reserva_id, pessoa) — dedup
  // preserva anamnese do hospede 2 que so existe em resposta_pesquisa
  // (caso em casal onde apenas um dos hospedes preencheu o formulario
  // novo e o outro tem apenas o registro estruturado).
  const _perfisExistentes = new Set(
    anamPerfis
      .map(a => a.reserva_id ? `${a.reserva_id}|${a.pessoa || 1}` : null)
      .filter(Boolean)
  );
  const anamRespostas = db.prepare(`
    SELECT rp.id, rp.submitted_at AS criado_em, rp.reserva_id,
           p.slug AS pesquisa_slug, rp.app_origem, 'resposta_pesquisa' AS fonte,
           CASE WHEN rp.app_origem = 'spa-anamnese-p2' THEN COALESCE(rv.email2, c.email)
                ELSE COALESCE(c.email, rv.email) END AS email,
           CASE WHEN rp.app_origem = 'spa-anamnese-p2' THEN COALESCE(rv.telefone2, c.telefone)
                ELSE COALESCE(c.telefone, rv.telefone) END AS telefone,
           NULL AS idioma,
           CASE WHEN rp.app_origem = 'spa-anamnese-p2' THEN 2 ELSE 1 END AS pessoa,
           CASE WHEN rv.cliente2 IS NOT NULL AND TRIM(rv.cliente2)!='' THEN 1 ELSE 0 END AS reserva_eh_casal
    FROM resposta_pesquisa rp
    JOIN pesquisa p ON p.id = rp.pesquisa_id
    LEFT JOIN reservas rv ON rv.id = rp.reserva_id
    LEFT JOIN clientes c ON c.id = COALESCE(rp.cliente_id, rv.cliente_id)
    WHERE p.slug LIKE 'spa-anamnese%'
      AND (rp.cliente_id=? OR rp.reserva_id IN (SELECT id FROM reservas WHERE cliente_id=? OR (cpf IS NOT NULL AND cpf=?)))
    ORDER BY rp.submitted_at DESC
  `).all(id, id, cliente.cpf || '');
  // Detecta reservas casal LEGADAS (anteriores a app_origem='spa-anamnese-p2'):
  // 2+ resposta_pesquisa todas com app_origem='spa-anamnese' E reserva eh casal
  // E nao existe rp diferenciada (-p2). Nesse caso a pessoa derivada do CASE
  // pode estar errada — preservamos todas as rp sem dedup para nao sumir com
  // a anamnese do hospede 2.
  const _rpsPorReserva = new Map();
  for (const a of anamRespostas) {
    if (!a.reserva_id) continue;
    if (!_rpsPorReserva.has(a.reserva_id)) _rpsPorReserva.set(a.reserva_id, []);
    _rpsPorReserva.get(a.reserva_id).push(a);
  }
  const _reservasLegacyCasal = new Set();
  for (const [resId, rps] of _rpsPorReserva) {
    if (!rps[0]?.reserva_eh_casal) continue;
    const semDiff = rps.filter(r => r.app_origem === 'spa-anamnese').length;
    const comDiff = rps.filter(r => r.app_origem === 'spa-anamnese-p2').length;
    if (comDiff > 0) continue;
    // Dispara guard quando faltam perfis para garantir dedup correto:
    // - 2+ rp undiff sem perfis suficientes (cenario classico legacy)
    // - 1 rp undiff em casal onde so um dos slots tem spa_perfil (cenario
    //   parcial onde a rp poderia ser do p2 mas o dedup a colide com p1)
    const perfilP1Existe = _perfisExistentes.has(`${resId}|1`);
    const perfilP2Existe = _perfisExistentes.has(`${resId}|2`);
    if (semDiff >= 1 && (!perfilP1Existe || !perfilP2Existe)) {
      _reservasLegacyCasal.add(resId);
    }
  }
  const anamRespostasFiltrado = anamRespostas.filter(a => {
    if (!a.reserva_id) return true;
    // Casal legado sem diferenciacao: nao confiamos na pessoa derivada,
    // preservamos todas as rp para garantir visibilidade do hospede 2.
    if (_reservasLegacyCasal.has(a.reserva_id)) return true;
    return !_perfisExistentes.has(`${a.reserva_id}|${a.pessoa || 1}`);
  });
  const anamneses = [...anamPerfis, ...anamRespostasFiltrado]
    .sort((a, b) => (b.criado_em || '').localeCompare(a.criado_em || ''));
  // Pesquisas de SATISFAÇÃO respondidas.
  // Causa raiz: surveys submetidas sem token no body → marcarSurveyTokenRespondido(null)
  // marca o token correto, mas buscarSurveyToken nunca é chamado → resposta_pesquisa.reserva_id=null.
  // Solução: terceira condição via timestamp (submitted_at = survey_tokens.respondida_em).
  const _cpf360 = cliente.cpf || '';
  const pesquisasRp = db.prepare(`
    SELECT rp.id, rp.pesquisa_id, p.slug, p.titulo AS pesquisa_titulo,
           rp.app_origem, rp.submitted_at, rp.reserva_id, rp.feedback_id, 'rp' AS fonte
    FROM resposta_pesquisa rp
    LEFT JOIN pesquisa p ON p.id = rp.pesquisa_id
    WHERE (
      rp.cliente_id=?
      OR rp.reserva_id IN (SELECT id FROM reservas WHERE cliente_id=? OR (cpf IS NOT NULL AND cpf=?))
      OR rp.submitted_at IN (
        SELECT st.respondida_em FROM survey_tokens st
        WHERE st.reserva_id IN (SELECT id FROM reservas WHERE cliente_id=? OR (cpf IS NOT NULL AND cpf=?))
          AND st.respondida_em IS NOT NULL
      )
    )
    AND (p.slug IS NULL OR p.slug NOT LIKE 'spa-anamnese%')
    ORDER BY rp.submitted_at DESC
  `).all(id, id, _cpf360, id, _cpf360);
  // Fonte 2: feedback direto (dedup por feedback_id para não duplicar).
  const _rpFbIds = new Set(pesquisasRp.map(r => r.feedback_id).filter(Boolean));
  const feedbackExtra = db.prepare(`
    SELECT NULL AS id, NULL AS pesquisa_id, NULL AS slug, 'Pesquisa de Satisfação' AS pesquisa_titulo,
           'spa' AS app_origem, f.submitted_at, f.reserva_id, f.id AS feedback_id, 'fb' AS fonte
    FROM feedback f
    WHERE (
      f.cliente_id=?
      OR f.reserva_id IN (SELECT id FROM reservas WHERE cliente_id=? OR (cpf IS NOT NULL AND cpf=?))
      OR f.submitted_at IN (
        SELECT st.respondida_em FROM survey_tokens st
        WHERE st.reserva_id IN (SELECT id FROM reservas WHERE cliente_id=? OR (cpf IS NOT NULL AND cpf=?))
          AND st.respondida_em IS NOT NULL
      )
    )
  `).all(id, id, _cpf360, id, _cpf360).filter(f => !_rpFbIds.has(f.feedback_id));
  const pesquisas = [...pesquisasRp, ...feedbackExtra]
    .sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''));
  // Produtos
  const produtos = db.prepare(`
    SELECT id, produto_nome, categoria, valor, data_compra, reserva_id, observacao, criado_em
    FROM cliente_produto WHERE cliente_id=?
    ORDER BY data_compra DESC, criado_em DESC
  `).all(id);
  // Flag agregado: também considera anamneses com quarto GC.
  const _gcAnamneses = anamneses.some(a => {
    const q = a.quarto && db.prepare("SELECT categoria FROM quartos WHERE numero=?").get(a.quarto);
    return q?.categoria === 'gran_class';
  });
  return { cliente, reservas, anamneses, pesquisas, produtos, gran_class: _gcReservas || _gcAnamneses };
}

export function inserirProdutoCliente(clienteId, { produto_nome, categoria, valor, data_compra, reserva_id, observacao }) {
  if (!produto_nome) throw new Error('produto_nome obrigatorio');
  const r = getDb().prepare(`
    INSERT INTO cliente_produto (cliente_id, produto_nome, categoria, valor, data_compra, reserva_id, observacao)
    VALUES (?,?,?,?,?,?,?)
  `).run(clienteId, produto_nome, categoria || null, valor ?? null, data_compra || null, reserva_id || null, observacao || null);
  return r.lastInsertRowid;
}

export function atualizarProdutoCliente(id, { produto_nome, categoria, valor, data_compra, reserva_id, observacao }) {
  const sets = [], args = [];
  if (produto_nome !== undefined) { sets.push('produto_nome=?'); args.push(produto_nome); }
  if (categoria !== undefined)    { sets.push('categoria=?');    args.push(categoria); }
  if (valor !== undefined)        { sets.push('valor=?');        args.push(valor); }
  if (data_compra !== undefined)  { sets.push('data_compra=?'); args.push(data_compra); }
  if (reserva_id !== undefined)   { sets.push('reserva_id=?');   args.push(reserva_id); }
  if (observacao !== undefined)   { sets.push('observacao=?');   args.push(observacao); }
  if (!sets.length) return false;
  args.push(id);
  getDb().prepare(`UPDATE cliente_produto SET ${sets.join(', ')} WHERE id=?`).run(...args);
  return true;
}

export function removerProdutoCliente(id) {
  getDb().prepare('DELETE FROM cliente_produto WHERE id=?').run(id);
  return true;
}

// ── Auditoria ─────────────────────────────────────────────────────────────
export function logAuditoria(evt) {
  try {
    getDb().prepare(`
      INSERT INTO auditoria
        (ator_username, ator_role, ator_ip, metodo, rota, acao, recurso, recurso_id, status, detalhes, sucesso)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      evt.ator_username || null,
      evt.ator_role || null,
      evt.ator_ip || null,
      evt.metodo || null,
      evt.rota || null,
      evt.acao || null,
      evt.recurso || null,
      evt.recurso_id != null ? String(evt.recurso_id) : null,
      evt.status ?? null,
      evt.detalhes || null,
      evt.sucesso ? 1 : 0,
    );
  } catch (e) {
    // Auditoria nunca pode derrubar uma operação real.
    console.error('[auditoria] falha ao gravar:', e.message);
  }
}

export function listarAuditoria({ from, to, ator, acao, recurso, sucesso, limit = 100, offset = 0 } = {}) {
  const db = getDb();
  const where = [], args = [];
  if (from)    { where.push("criado_em >= ?"); args.push(from + ' 00:00:00'); }
  if (to)      { where.push("criado_em <= ?"); args.push(to + ' 23:59:59'); }
  if (ator)    { where.push("ator_username LIKE ?"); args.push('%' + ator.toLowerCase() + '%'); }
  if (acao)    { where.push("acao LIKE ?");     args.push('%' + acao + '%'); }
  if (recurso) { where.push("recurso = ?");     args.push(recurso); }
  if (sucesso === '1' || sucesso === 1 || sucesso === true)  { where.push("sucesso = 1"); }
  if (sucesso === '0' || sucesso === 0 || sucesso === false) { where.push("sucesso = 0"); }
  const sqlWhere = where.length ? ('WHERE ' + where.join(' AND ')) : '';
  const items = db.prepare(`
    SELECT id, criado_em, ator_username, ator_role, ator_ip, metodo, rota, acao,
           recurso, recurso_id, status, detalhes, sucesso
    FROM auditoria ${sqlWhere}
    ORDER BY criado_em DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...args, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM auditoria ${sqlWhere}`).get(...args).n;
  return { items, total };
}

export function listarRecursosAuditoria() {
  return getDb().prepare("SELECT DISTINCT recurso FROM auditoria WHERE recurso IS NOT NULL ORDER BY recurso").all().map(r => r.recurso);
}

// ───── Terapeuta (mobile) — helpers de DB ─────
export function buscarMassagistaPorNome(nome) {
  if (!nome) return null;
  return getDb().prepare("SELECT id, nome, pin_hash, ativo FROM massagistas WHERE LOWER(nome) = LOWER(?) LIMIT 1").get(nome) || null;
}
export function buscarMassagistaPorId(id) {
  return getDb().prepare("SELECT id, nome, ativo FROM massagistas WHERE id = ?").get(id) || null;
}
export function buscarMassagistaPorEmail(email) {
  if (!email) return null;
  return getDb().prepare("SELECT id, nome, ativo FROM massagistas WHERE LOWER(email) = LOWER(?) LIMIT 1").get(email) || null;
}
export function setMassagistaPinHash(id, pinHash) {
  getDb().prepare("UPDATE massagistas SET pin_hash = ? WHERE id = ?").run(pinHash, id);
}
// Agenda da terapeuta: reservas SOMENTE com massagista_id correspondente
// (pessoa 1 OU pessoa 2 — em sessoes de casal a terapeuta pode estar na sala 2).
export function listarReservasDaTerapeuta(massagistaId, { from, to } = {}) {
  const db = getDb();
  const conds = ['(r.massagista_id = ? OR r.massagista_id2 = ?)'];
  const params = [massagistaId, massagistaId];
  if (from) { conds.push('r.data >= ?'); params.push(from); }
  if (to)   { conds.push('r.data <= ?'); params.push(to); }
  return db.prepare(`
    SELECT r.id, r.data, r.hora_inicio, r.hora_fim, r.sala, r.cliente, r.cliente2,
           r.tipo_cliente, r.tipo_cliente2, r.quarto, r.apto2 AS quarto2, r.apto, r.apto2,
           r.tratamento, r.tratamento2, r.massagista_id, r.massagista_id2,
           t.nome AS tipo_massagem_nome, t2.nome AS tipo_massagem_nome2,
           m.nome AS massagista_nome, m2.nome AS massagista_nome2,
           CASE WHEN EXISTS (
             SELECT 1 FROM survey_tokens st
             WHERE st.reserva_id = r.id AND st.respondida_em IS NOT NULL
           ) THEN 1 ELSE 0 END AS respondeu_pesquisa
    FROM reservas r
    LEFT JOIN tipos_massagem t  ON t.id = r.tipo_massagem_id
    LEFT JOIN tipos_massagem t2 ON t2.id = r.tipo_massagem_id2
    LEFT JOIN massagistas m  ON m.id = r.massagista_id
    LEFT JOIN massagistas m2 ON m2.id = r.massagista_id2
    WHERE ${conds.join(' AND ')}
    ORDER BY r.data ASC, r.hora_inicio ASC
  `).all(...params);
}
// Detalhe de uma reserva — valida que pertence a essa terapeuta.
// Retorna null se nao pertence (frontend tratara como 404).
export function buscarReservaDetalheTerapeuta(reservaId, massagistaId) {
  const r = getDb().prepare(`
    SELECT id, massagista_id, massagista_id2
    FROM reservas WHERE id = ?
  `).get(reservaId);
  if (!r) return null;
  if (r.massagista_id !== massagistaId && r.massagista_id2 !== massagistaId) return null;
  return buscarReservaDetalhe(reservaId);
}

// ═══════════════════════════════════════════════════════
// Gestão de Salas
// ═══════════════════════════════════════════════════════

export function listarSalas() {
  return getDb().prepare('SELECT id, nome, tipo, ativa, observacao FROM salas ORDER BY id').all();
}

export function buscarSalaById(id) {
  return getDb().prepare('SELECT id, nome, tipo, ativa, observacao FROM salas WHERE id = ?').get(id);
}

export function atualizarSala(id, { nome, tipo, observacao }) {
  const campos = [];
  const vals = [];
  if (nome !== undefined) { campos.push('nome = ?'); vals.push(nome); }
  if (tipo !== undefined) { campos.push('tipo = ?'); vals.push(tipo); }
  if (observacao !== undefined) { campos.push('observacao = ?'); vals.push(observacao); }
  if (!campos.length) return { ok: true, mudou: false };
  vals.push(id);
  const r = getDb().prepare(`UPDATE salas SET ${campos.join(', ')} WHERE id = ?`).run(...vals);
  return { ok: true, mudou: r.changes > 0 };
}

// ─── Bloqueios ───────────────────────────────────────

export function listarBloqueiosSala(sala, opts = {}) {
  const { from, to } = opts;
  let q = 'SELECT * FROM sala_bloqueios WHERE sala = ?';
  const params = [sala];
  if (from) { q += ' AND data_fim >= ?'; params.push(from); }
  if (to)   { q += ' AND data_inicio <= ?'; params.push(to); }
  q += ' ORDER BY data_inicio';
  return getDb().prepare(q).all(...params);
}

export function listarTodosBloqueios(opts = {}) {
  const { from, to } = opts;
  let q = 'SELECT sb.*, s.nome as sala_nome FROM sala_bloqueios sb JOIN salas s ON sb.sala = s.id WHERE 1=1';
  const params = [];
  if (from) { q += ' AND sb.data_fim >= ?'; params.push(from); }
  if (to)   { q += ' AND sb.data_inicio <= ?'; params.push(to); }
  q += ' ORDER BY sb.sala, sb.data_inicio';
  return getDb().prepare(q).all(...params);
}

export function buscarBloqueioById(id) {
  return getDb().prepare('SELECT * FROM sala_bloqueios WHERE id = ?').get(id);
}

export function criarBloqueioSala({ sala, data_inicio, data_fim, motivo, bloqueado_por = null }) {
  const r = getDb().prepare(
    `INSERT INTO sala_bloqueios (sala, data_inicio, data_fim, motivo, bloqueado_por) VALUES (?,?,?,?,?)`
  ).run(sala, data_inicio, data_fim, motivo, bloqueado_por);
  return { id: r.lastInsertRowid };
}

export function removerBloqueioSala(id) {
  const r = getDb().prepare('DELETE FROM sala_bloqueios WHERE id = ?').run(id);
  return { ok: true, mudou: r.changes > 0 };
}

// ─── Reservas dentro de um período de bloqueio ───────

export function listarReservasNoBloqueio(sala, data_inicio, data_fim) {
  return getDb().prepare(`
    SELECT r.id, r.sala, r.cliente, r.cliente2, r.data, r.hora_inicio, r.hora_fim,
           r.massagista_id, r.massagista_id2, r.tipo_massagem_id, r.tipo_massagem_id2,
           m.nome as massagista_nome, m2.nome as massagista_nome2
    FROM reservas r
    LEFT JOIN massagistas m  ON m.id  = r.massagista_id
    LEFT JOIN massagistas m2 ON m2.id = r.massagista_id2
    WHERE r.sala = ? AND r.data >= ? AND r.data <= ?
    ORDER BY r.data, r.hora_inicio
  `).all(sala, data_inicio, data_fim);
}

// ─── Salas disponíveis para um horário ───────────────

export function listarSalasDisponiveis({ data, hora_inicio, hora_fim, excluirSalas = [] }) {
  const db = getDb();
  const todas = db.prepare('SELECT id, nome, tipo FROM salas WHERE ativa = 1 ORDER BY id').all();
  const disponiveis = [];
  for (const s of todas) {
    if (excluirSalas.includes(s.id)) continue;
    const conflitoRes = db.prepare(`
      SELECT id FROM reservas
      WHERE sala = ? AND data = ? AND NOT (hora_fim <= ? OR hora_inicio >= ?)
      LIMIT 1
    `).get(s.id, data, hora_inicio, hora_fim);
    if (conflitoRes) continue;
    const conflitoBloq = db.prepare(`
      SELECT id FROM sala_bloqueios
      WHERE sala = ? AND data_inicio <= ? AND data_fim >= ?
      LIMIT 1
    `).get(s.id, data, data);
    if (conflitoBloq) continue;
    disponiveis.push(s);
  }
  return disponiveis;
}

// ─── Alterar sala de uma reserva ─────────────────────

export function atualizarSalaReserva(reservaId, novaSala) {
  const db = getDb();
  const reserva = db.prepare('SELECT * FROM reservas WHERE id = ?').get(reservaId);
  if (!reserva) throw Object.assign(new Error('Reserva não encontrada'), { code: 'NOT_FOUND' });

  const bloqueio = db.prepare(
    `SELECT id, motivo FROM sala_bloqueios WHERE sala = ? AND data_inicio <= ? AND data_fim >= ? LIMIT 1`
  ).get(novaSala, reserva.data, reserva.data);
  if (bloqueio) throw Object.assign(new Error('SALA_BLOQUEADA'), { code: 'SALA_BLOQUEADA', motivo: bloqueio.motivo });

  const conflito = db.prepare(`
    SELECT id, cliente, hora_inicio, hora_fim FROM reservas
    WHERE sala = ? AND data = ? AND id != ? AND NOT (hora_fim <= ? OR hora_inicio >= ?)
    LIMIT 1
  `).get(novaSala, reserva.data, reservaId, reserva.hora_inicio, reserva.hora_fim);
  if (conflito) throw Object.assign(new Error('CONFLITO_SALA'), { code: 'CONFLITO_SALA', conflito });

  const r = db.prepare('UPDATE reservas SET sala = ? WHERE id = ?').run(novaSala, reservaId);
  return { ok: true, mudou: r.changes > 0 };
}
