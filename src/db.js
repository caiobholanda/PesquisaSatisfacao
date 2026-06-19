import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
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
      sala INTEGER NOT NULL CHECK(sala IN (1,2,3)),
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
  ]) {
    try { db.exec(`ALTER TABLE massagistas ADD COLUMN ${col}`); } catch {}
  }
  // Migration: set default funcao for existing records that have null
  try { db.exec(`UPDATE massagistas SET funcao = 'Massoterapeuta' WHERE funcao IS NULL OR funcao = ''`); } catch {}
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
      nome TEXT NOT NULL,
      email TEXT,
      telefone TEXT,
      data_nascimento TEXT,
      locale_pref TEXT DEFAULT 'pt-BR',
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

  // Vínculos cliente_id/cpf adicionados de forma idempotente.
  try { db.exec(`ALTER TABLE reservas    ADD COLUMN cliente_id INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE reservas    ADD COLUMN cpf TEXT`); } catch {}
  try { db.exec(`ALTER TABLE reservas    ADD COLUMN quarto TEXT`); } catch {}
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN cliente_id INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE spa_perfis  ADD COLUMN quarto TEXT`); } catch {}
  try { db.exec(`ALTER TABLE feedback    ADD COLUMN cliente_id INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE feedback    ADD COLUMN reserva_id INTEGER`); } catch {}
  // PIN hash da terapeuta (login mobile). Aditivo + idempotente.
  try { db.exec(`ALTER TABLE massagistas ADD COLUMN pin_hash TEXT`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_reservas_cliente   ON reservas(cliente_id)`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_reservas_cpf       ON reservas(cpf)`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_spa_perfis_cliente ON spa_perfis(cliente_id)`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_cliente   ON feedback(cliente_id)`); } catch {}

  seedTratamentosGranSpa();
  seedMassoterapeutasGranSpa();
  seedQuartosGranMarquise();
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
  // Garante que todos os usuários existentes sejam master
  db.prepare(`UPDATE admin_users SET role = 'master' WHERE role IS NULL OR role != 'master'`).run();
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
  const pctRecomenda = total > 0 ? +(recSim / total * 100).toFixed(1) : 0;

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

  const DISP_DEFAULT = JSON.stringify({ seg: '08:00-22:00', ter: '08:00-22:00', qua: '08:00-22:00', qui: '08:00-22:00', sex: '08:00-22:00', sab: '08:00-22:00', dom: '08:00-22:00' });
  const profs = [
    { mat: '0010001573', nome: 'GERMANA LIMA DA SILVA',                     esp: 'MASSOTERAPEUTA BILINGUE PL',   vinc: 'Pleno',     bil: 1 },
    { mat: '0010002052', nome: 'ISADORA MARIA SOUSA BEZERRA DE MENEZES',    esp: 'MASSOTERAPEUTA PART TIME',     vinc: 'Part Time', bil: 0 },
    { mat: '0010001711', nome: 'KAROLINE COSTA DE FREITAS',                 esp: 'MASSOTERAPEUTA PART TIME',     vinc: 'Part Time', bil: 0 },
    { mat: '0010001614', nome: 'ANTONIA ANA CRISTINA SAMPAIO DE SOUSA',     esp: 'MASSOTERAPEUTA PL',            vinc: 'Pleno',     bil: 0 },
    { mat: '0010001981', nome: 'VALDERLANIA ALEXANDRE BEZERRA',             esp: 'MASSOTERAPEUTA PL',            vinc: 'Pleno',     bil: 0 },
    { mat: '0010001881', nome: 'MAYARA DOS SANTOS DIAS',                    esp: 'MASSOTERAPEUTA PL',            vinc: 'Pleno',     bil: 0 },
  ];
  const stmt = db.prepare(
    `INSERT INTO massagistas (nome, matricula, especialidade_original, funcao, vinculo, bilingue, disponibilidade, ativo)
     VALUES (?, ?, ?, 'Massoterapeuta', ?, ?, ?, 1)`
  );
  for (const p of profs) stmt.run(p.nome, p.mat, p.esp, p.vinc, p.bil, DISP_DEFAULT);
}

// ── Massagistas ──
export function listarMassagistas() {
  return getDb().prepare('SELECT * FROM massagistas ORDER BY nome ASC').all();
}
export function buscarMassagistaById(id) {
  return getDb().prepare('SELECT * FROM massagistas WHERE id=?').get(id) || null;
}

export function listarMassagistasComStats() {
  return getDb().prepare(`
    SELECT
      m.id, m.nome, m.ativo, m.created_at,
      m.matricula, m.especialidade_original, m.funcao, m.vinculo, m.bilingue, m.disponibilidade,
      COUNT(f.id) AS total_avaliacoes,
      SUM(CASE WHEN f.recomenda = 'sim' THEN 1 ELSE 0 END) AS rec_sim
    FROM massagistas m
    LEFT JOIN feedback f ON LOWER(f.nome_massoterapeuta) = LOWER(m.nome)
    GROUP BY m.id
    ORDER BY m.nome ASC
  `).all();
}
export function inserirMassagista(nome, opts = {}) {
  const { matricula = null, especialidade_original = null, funcao = 'Massoterapeuta', vinculo = null, bilingue = 0, disponibilidade = null } = opts;
  return getDb().prepare(
    `INSERT INTO massagistas (nome, matricula, especialidade_original, funcao, vinculo, bilingue, disponibilidade)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(nome.trim(), matricula, especialidade_original, funcao, vinculo, bilingue ? 1 : 0, disponibilidade).lastInsertRowid;
}
export function atualizarMassagista(id, nome, ativo, opts = {}) {
  const sets = ['nome=?', 'ativo=?'];
  const vals = [nome.trim(), ativo];
  for (const k of ['matricula', 'especialidade_original', 'funcao', 'vinculo', 'disponibilidade']) {
    if (opts[k] !== undefined) { sets.push(`${k}=?`); vals.push(opts[k]); }
  }
  if (opts.bilingue !== undefined) { sets.push('bilingue=?'); vals.push(opts.bilingue ? 1 : 0); }
  vals.push(id);
  return getDb().prepare(`UPDATE massagistas SET ${sets.join(', ')} WHERE id=?`).run(...vals).changes;
}
export function deletarMassagista(id) {
  return getDb().prepare('DELETE FROM massagistas WHERE id=?').run(id).changes;
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
export function deletarTipoMassagem(id) {
  return getDb().prepare('DELETE FROM tipos_massagem WHERE id=?').run(id).changes;
}

export function historicoMassagista(nome) {
  return getDb()
    .prepare(`SELECT * FROM feedback WHERE LOWER(nome_massoterapeuta) = LOWER(?) ORDER BY submitted_at DESC`)
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

export function listarTodasReservas({ from, to, sala, busca, limit = 100, offset = 0 } = {}) {
  const db = getDb();
  const conds = [];
  const params = [];
  if (from)   { conds.push('r.data >= ?');   params.push(from); }
  if (to)     { conds.push('r.data <= ?');   params.push(to); }
  if (sala)   { conds.push('r.sala = ?');    params.push(+sala); }
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
  } = opts;
  const db = getDb();

  // Conflito de sala
  const conflitoSala = db.prepare(`
    SELECT id, cliente, hora_inicio, hora_fim FROM reservas
    WHERE sala = ? AND data = ?
    AND NOT (hora_fim <= ? OR hora_inicio >= ?)
  `).get(sala, data, horaInicio, horaFim);
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
       cliente2, tipo_cliente2, apto2, email2, telefone2, tratamento2, tipo_massagem_id2, massagista_id2)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    sala, cliente, tipo_cliente, apto, email, telefone, tratamento, data, horaInicio, horaFim,
    linha, tipo_massagem_id, massagista_id, criado_por,
    cliente2, tipo_cliente2, apto2, email2, telefone2, tratamento2, tipo_massagem_id2, massagista_id2
  ).lastInsertRowid;
}

export function cancelarReserva(id) {
  return getDb().prepare(`DELETE FROM reservas WHERE id = ?`).run(id).changes;
}

export function buscarReservaById(id) {
  return getDb().prepare(`
    SELECT r.*, m.nome AS massagista_nome, m2.nome AS massagista_nome2
    FROM reservas r
    LEFT JOIN massagistas m  ON m.id  = r.massagista_id
    LEFT JOIN massagistas m2 ON m2.id = r.massagista_id2
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

export function criarSurveyToken(reservaId, pessoa = 1) {
  const db = getDb();
  const p = pessoa === 2 ? 2 : 1;
  // Reusa token existente DESTA pessoa nesta reserva (idempotente).
  const existente = db.prepare(
    `SELECT token FROM survey_tokens WHERE reserva_id = ? AND COALESCE(pessoa,1) = ? AND respondida_em IS NULL ORDER BY criado_em DESC LIMIT 1`
  ).get(reservaId, p);
  if (existente) {
    db.prepare(`UPDATE survey_tokens SET liberada_em = datetime('now') WHERE token = ?`).run(existente.token);
    return existente.token;
  }
  const token = randomBytes(24).toString('hex');
  db.prepare(
    `INSERT INTO survey_tokens (token, reserva_id, pessoa, liberada_em) VALUES (?, ?, ?, datetime('now'))`
  ).run(token, reservaId, p);
  return token;
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
export function marcarSurveyTokenRespondido(token) {
  const db = getDb();
  if (token) {
    db.prepare(`UPDATE survey_tokens SET respondida_em = datetime('now') WHERE token = ?`).run(token);
    return;
  }
  // ⚠️ MODO TEMPORARIO: janela de 15min desativada.
  db.prepare(`
    UPDATE survey_tokens SET respondida_em = datetime('now')
    WHERE token = (
      SELECT token FROM survey_tokens
      WHERE respondida_em IS NULL
        AND liberada_em IS NOT NULL
      ORDER BY liberada_em DESC LIMIT 1
    )
  `).run();
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
  const expiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
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
  // ⚠️ MODO TEMPORARIO: validacao de expiracao da anamnese desativada.
  // Para restaurar, troque pelo bloco comentado abaixo.
  const row = getDb().prepare(`
    SELECT r.id AS reserva_id, r.cliente, r.email, r.telefone, r.tratamento AS servico,
           r.idioma_documento AS locale, r.cpf, r.quarto, r.cliente_id,
           r.cliente2, r.email2, r.telefone2, r.apto2 AS quarto2,
           c.data_nascimento AS cli_nascimento,
           r.documento_token, r.documento_token2,
           r.documento_token_expiry, r.documento_token_expiry2
    FROM reservas r
    LEFT JOIN clientes c ON c.id = r.cliente_id
    WHERE r.documento_token = ? OR r.documento_token2 = ?
  `).get(token, token);
  /* VERSAO ORIGINAL (com validacao de expiracao):
  const row = getDb().prepare(`
    SELECT r.id AS reserva_id, r.cliente, r.email, r.tratamento AS servico,
           r.idioma_documento AS locale,
           r.cliente2, r.email2,
           r.documento_token, r.documento_token2,
           r.documento_token_expiry, r.documento_token_expiry2
    FROM reservas r
    WHERE (
      r.documento_token  = ? AND (r.documento_token_expiry  IS NULL OR r.documento_token_expiry  > datetime('now'))
    ) OR (
      r.documento_token2 = ? AND (r.documento_token_expiry2 IS NULL OR r.documento_token_expiry2 > datetime('now'))
    )
  `).get(token, token);
  */
  if (!row) return null;
  const pessoa = (row.documento_token2 === token) ? 2 : 1;
  return {
    reserva_id:    row.reserva_id,
    hospede_nome:  pessoa === 2 ? (row.cliente2  || '') : (row.cliente  || ''),
    hospede_email: pessoa === 2 ? (row.email2    || '') : (row.email    || ''),
    hospede_telefone: pessoa === 2 ? (row.telefone2 || '') : (row.telefone || ''),
    hospede_cpf:      pessoa === 2 ? '' : (row.cpf || ''),
    hospede_quarto:   pessoa === 2 ? (row.quarto2 || '') : (row.quarto || ''),
    hospede_data_nascimento: pessoa === 2 ? '' : (row.cli_nascimento || ''),
    servico:       row.servico,
    locale:        row.locale,
    pessoa,
  };
}

export function inserirSpaPerfil(dados) {
  const { nome, sobrenome, tipo_documento, documento, email, telefone, data_nascimento,
          rotina_facial, rotina_corporal, produto_especifico, pressao_massagem, info_medica,
          consentimento_saude, consentimento_marketing, canais_marketing, assinatura_data_url,
          idioma, reserva_id } = dados;
  const r = getDb().prepare(`
    INSERT INTO spa_perfis (nome, sobrenome, tipo_documento, documento, email, telefone, data_nascimento,
      rotina_facial, rotina_corporal, produto_especifico, pressao_massagem, info_medica,
      consentimento_saude, consentimento_marketing, canais_marketing, assinatura_data_url, idioma, reserva_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(nome, sobrenome, tipo_documento || 'cpf', documento || '', email, telefone,
         data_nascimento || null, rotina_facial || null, rotina_corporal || null,
         produto_especifico || null, pressao_massagem || null, info_medica || '',
         consentimento_saude ? 1 : 0, consentimento_marketing ? 1 : 0,
         canais_marketing || null, assinatura_data_url || null, idioma || 'pt-BR', reserva_id || null);
  if (reserva_id) {
    getDb().prepare('UPDATE reservas SET documento_perfil_id=? WHERE id=?').run(r.lastInsertRowid, reserva_id);
  }
  return r.lastInsertRowid;
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

export function listarClientes({ q, limit = 100, offset = 0 } = {}) {
  const db = getDb();
  let where = '1=1', args = [];
  if (q) {
    const needle = '%' + q.toLowerCase().replace(/\s+/g, '%') + '%';
    where = '(LOWER(nome) LIKE ? OR cpf LIKE ? OR LOWER(email) LIKE ? OR telefone LIKE ?)';
    const cpfN = '%' + _normCpf(q) + '%';
    args = [needle, cpfN, needle, needle];
  }
  const items = db.prepare(`
    SELECT id, cpf, nome, email, telefone, data_nascimento, locale_pref, criado_em, atualizado_em
    FROM clientes WHERE ${where}
    ORDER BY nome
    LIMIT ? OFFSET ?
  `).all(...args, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM clientes WHERE ${where}`).get(...args).n;
  return { items, total };
}

export function buscarClientePorId(id) {
  return getDb().prepare(`
    SELECT id, cpf, nome, email, telefone, data_nascimento, locale_pref, observacao, criado_em, atualizado_em
    FROM clientes WHERE id=?
  `).get(id) || null;
}

export function buscarClientePorCpf(cpf) {
  const n = _normCpf(cpf);
  if (!n) return null;
  return getDb().prepare(`
    SELECT id, cpf, nome, email, telefone, data_nascimento, locale_pref, observacao, criado_em, atualizado_em
    FROM clientes WHERE cpf=? LIMIT 1
  `).get(n) || null;
}

export function inserirCliente({ cpf, nome, email, telefone, data_nascimento, locale_pref, observacao }) {
  if (!nome) throw new Error('nome obrigatorio');
  const cpfN = _normCpf(cpf) || null;
  if (cpfN && !validarCpfMod11(cpfN)) throw new Error('CPF invalido');
  // upsert por CPF (se cpf existir, retorna o existente; se nome novo, atualiza)
  if (cpfN) {
    const existing = buscarClientePorCpf(cpfN);
    if (existing) return existing.id;
  }
  const r = getDb().prepare(`
    INSERT INTO clientes (cpf, nome, email, telefone, data_nascimento, locale_pref, observacao)
    VALUES (?,?,?,?,?,?,?)
  `).run(cpfN, nome, email || null, telefone || null, data_nascimento || null, locale_pref || 'pt-BR', observacao || null);
  return r.lastInsertRowid;
}

export function atualizarCliente(id, { cpf, nome, email, telefone, data_nascimento, locale_pref, observacao }) {
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
  const anamPerfis = db.prepare(`
    SELECT id, nome, sobrenome, tipo_documento, documento, email, telefone,
           idioma, reserva_id, criado_em, 'spa_perfil' AS fonte
    FROM spa_perfis
    WHERE cliente_id=? OR (documento IS NOT NULL AND documento=?)
    ORDER BY criado_em DESC
  `).all(id, cliente.cpf || '');
  // Reservas onde JA existe spa_perfil (pra nao duplicar a entrada da
  // resposta_pesquisa quando a anamnese tradicional foi gravada normal).
  const _reservasComPerfil = new Set(anamPerfis.map(a => a.reserva_id).filter(Boolean));
  const anamRespostas = db.prepare(`
    SELECT rp.id, rp.submitted_at AS criado_em, rp.reserva_id,
           p.slug AS pesquisa_slug, 'resposta_pesquisa' AS fonte
    FROM resposta_pesquisa rp
    JOIN pesquisa p ON p.id = rp.pesquisa_id
    WHERE p.slug LIKE 'spa-anamnese%'
      AND (rp.cliente_id=? OR rp.reserva_id IN (SELECT id FROM reservas WHERE cliente_id=? OR (cpf IS NOT NULL AND cpf=?)))
    ORDER BY rp.submitted_at DESC
  `).all(id, id, cliente.cpf || '');
  const anamRespostasFiltrado = anamRespostas.filter(a => !a.reserva_id || !_reservasComPerfil.has(a.reserva_id));
  const anamneses = [...anamPerfis, ...anamRespostasFiltrado]
    .sort((a, b) => (b.criado_em || '').localeCompare(a.criado_em || ''));
  // Pesquisas de SATISFAÇÃO respondidas — exclui slugs de anamnese
  // (anamnese tem sua propria aba via spa_perfis). Tambem inclui titulo
  // amigavel pra nao expor slug tecnico no front.
  const pesquisas = db.prepare(`
    SELECT rp.id, rp.pesquisa_id, p.slug, p.titulo AS pesquisa_titulo,
           rp.app_origem, rp.submitted_at, rp.reserva_id, rp.feedback_id
    FROM resposta_pesquisa rp
    LEFT JOIN pesquisa p ON p.id = rp.pesquisa_id
    WHERE (rp.cliente_id=?
       OR rp.reserva_id IN (SELECT id FROM reservas WHERE cliente_id=?))
      AND (p.slug IS NULL OR p.slug NOT LIKE 'spa-anamnese%')
    ORDER BY rp.submitted_at DESC
  `).all(id, id);
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
  return getDb().prepare("SELECT id, nome, ativo, disponibilidade FROM massagistas WHERE id = ?").get(id) || null;
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
