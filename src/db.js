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
    CREATE INDEX IF NOT EXISTS idx_reservas_data ON reservas(data);
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
  // Migration: add enriched fields to reservas if absent
  for (const col of ['tipo_cliente TEXT', 'apto TEXT', 'email TEXT', 'telefone TEXT', 'tratamento TEXT', 'linha TEXT', 'tipo_massagem_id INTEGER', 'massagista_id INTEGER']) {
    try { db.exec(`ALTER TABLE reservas ADD COLUMN ${col}`); } catch {}
  }

  seedTratamentosGranSpa();
  seedMassoterapeutasGranSpa();

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

const NOTA_MAP = { otimo: 9, bom: 3, regular: 1, ruim: 0 };
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
  const jaSeed = db.prepare('SELECT COUNT(*) AS c FROM massagistas WHERE matricula IS NOT NULL AND matricula != ""').get().c;
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
function seedTratamentosGranSpa() {
  const db = getDb();
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

export function inserirReserva(sala, cliente, tipo_cliente, apto, email, telefone, tratamento, data, horaInicio, horaFim, opts = {}) {
  const { linha = null, tipo_massagem_id = null } = opts;
  const conflito = getDb().prepare(`
    SELECT id FROM reservas
    WHERE sala = ? AND data = ?
    AND NOT (hora_fim <= ? OR hora_inicio >= ?)
  `).get(sala, data, horaInicio, horaFim);
  if (conflito) { const e = new Error('CONFLITO'); e.code = 'CONFLITO'; throw e; }
  return getDb().prepare(
    `INSERT INTO reservas (sala, cliente, tipo_cliente, apto, email, telefone, tratamento, data, hora_inicio, hora_fim, linha, tipo_massagem_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(sala, cliente, tipo_cliente, apto, email, telefone, tratamento, data, horaInicio, horaFim, linha, tipo_massagem_id).lastInsertRowid;
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
