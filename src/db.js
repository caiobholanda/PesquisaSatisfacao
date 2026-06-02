import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
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
      data TEXT NOT NULL,
      hora_inicio TEXT NOT NULL,
      hora_fim TEXT NOT NULL,
      observacao TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reservas_data ON reservas(data);
  `);

  // Migration: add descricao column to tipos_massagem if absent
  try { db.exec(`ALTER TABLE tipos_massagem ADD COLUMN descricao TEXT`); } catch {}

  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'TrocarEmProducao!';
  const hash = bcrypt.hashSync(adminPass, 10);
  db.prepare('DELETE FROM admin_users WHERE username != ?').run(adminUser);
  db.prepare(`INSERT INTO admin_users (username, password_hash) VALUES (?, ?)
    ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`).run(adminUser, hash);
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

export function listarFeedback({ origem, tipo_cliente, from, to, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const conds = [];
  const params = [];

  if (origem) { conds.push('origem = ?'); params.push(origem); }
  if (tipo_cliente) { conds.push('tipo_cliente = ?'); params.push(tipo_cliente); }
  if (from) { conds.push("submitted_at >= ?"); params.push(from + ' 00:00:00'); }
  if (to) { conds.push("submitted_at <= ?"); params.push(to + ' 23:59:59'); }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as t FROM feedback ${where}`).get(...params).t;
  const items = db.prepare(`SELECT * FROM feedback ${where} ORDER BY submitted_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, items };
}

const NOTA_MAP = { otimo: 4, bom: 3, regular: 2, ruim: 1 };
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

// ── Massagistas ──
export function listarMassagistas() {
  return getDb().prepare('SELECT * FROM massagistas ORDER BY nome ASC').all();
}

export function listarMassagistasComStats() {
  return getDb().prepare(`
    SELECT
      m.id, m.nome, m.ativo, m.created_at,
      COUNT(f.id) AS total_avaliacoes,
      SUM(CASE WHEN f.recomenda = 'sim' THEN 1 ELSE 0 END) AS rec_sim
    FROM massagistas m
    LEFT JOIN feedback f ON LOWER(f.nome_massoterapeuta) = LOWER(m.nome)
    GROUP BY m.id
    ORDER BY m.nome ASC
  `).all();
}
export function inserirMassagista(nome) {
  return getDb().prepare('INSERT INTO massagistas (nome) VALUES (?)').run(nome.trim()).lastInsertRowid;
}
export function atualizarMassagista(id, nome, ativo) {
  return getDb().prepare('UPDATE massagistas SET nome=?, ativo=? WHERE id=?').run(nome.trim(), ativo, id).changes;
}
export function deletarMassagista(id) {
  return getDb().prepare('DELETE FROM massagistas WHERE id=?').run(id).changes;
}

// ── Tipos de Massagem ──
export function listarTiposMassagem() {
  return getDb().prepare('SELECT * FROM tipos_massagem ORDER BY nome ASC').all();
}
export function inserirTipoMassagem(nome, duracao_min, preco, descricao) {
  return getDb().prepare('INSERT INTO tipos_massagem (nome, descricao, duracao_min, preco) VALUES (?, ?, ?, ?)').run(nome.trim(), descricao || null, duracao_min || null, preco || null).lastInsertRowid;
}
export function atualizarTipoMassagem(id, nome, duracao_min, preco, ativo, descricao) {
  return getDb().prepare('UPDATE tipos_massagem SET nome=?, descricao=?, duracao_min=?, preco=?, ativo=? WHERE id=?').run(nome.trim(), descricao || null, duracao_min || null, preco || null, ativo, id).changes;
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
    `SELECT * FROM reservas WHERE data >= ? AND data <= ? ORDER BY data, hora_inicio`
  ).all(from, to);
}

export function inserirReserva(sala, cliente, data, horaInicio, horaFim, observacao) {
  const conflito = getDb().prepare(`
    SELECT id FROM reservas
    WHERE sala = ? AND data = ?
    AND NOT (hora_fim <= ? OR hora_inicio >= ?)
  `).get(sala, data, horaInicio, horaFim);
  if (conflito) { const e = new Error('CONFLITO'); e.code = 'CONFLITO'; throw e; }
  return getDb().prepare(
    `INSERT INTO reservas (sala, cliente, data, hora_inicio, hora_fim, observacao) VALUES (?,?,?,?,?,?)`
  ).run(sala, cliente, data, horaInicio, horaFim, observacao || null).lastInsertRowid;
}

export function cancelarReserva(id) {
  return getDb().prepare(`DELETE FROM reservas WHERE id = ?`).run(id).changes;
}

export function buscarAdmin(username) {
  return getDb().prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
}

export function exportarCsv({ origem, tipo_cliente, from, to } = {}) {
  const { items } = listarFeedback({ origem, tipo_cliente, from, to, limit: 9999, offset: 0 });
  return items;
}
