'use strict';

import { Router } from 'express';
import { requireAuth, requireSatisfacao } from '../middleware/auth.js';
import { getDb } from '../db.js';

const router = Router();
router.use(requireAuth, requireSatisfacao);

const MAX_SCORE = 9;

function fmtDate(iso) {
  return iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
}

function defaultPeriod() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const to = fmt(now);
  const from = fmt(new Date(now.getTime() - 30 * 24 * 3600 * 1000));
  return { from, to };
}

function buildFilters(req) {
  const extra = [];
  const params = [];
  const tipo = (req.query.tipo || '').toString().trim();
  const origem = (req.query.origem || '').toString().trim();
  const massagista = (req.query.massagista || '').toString().trim();
  if (tipo) { extra.push('f.tipo_cliente = ?'); params.push(tipo); }
  if (origem) { extra.push('f.origem = ?'); params.push(origem); }
  if (massagista) { extra.push('LOWER(f.nome_massoterapeuta) LIKE LOWER(?)'); params.push(`%${massagista}%`); }
  return { extra, params };
}

// GET /api/gq/stats?slug&from&to&tipo&origem&massagista
router.get('/stats', (req, res) => {
  try {
  const db = getDb();
  const slug = (req.query.slug || 'spa-locc-v1').toString();
  const { from: defFrom, to: defTo } = defaultPeriod();
  const from = (req.query.from || defFrom).toString();
  const to = (req.query.to || defTo).toString();

  const pesquisa = db.prepare(
    `SELECT id FROM pesquisa WHERE slug = ? AND ativo = 1 ORDER BY versao DESC LIMIT 1`
  ).get(slug);
  if (!pesquisa) return res.status(404).json({ ok: false, error: 'Pesquisa não encontrada' });
  const pid = pesquisa.id;

  const { extra, params: ep } = buildFilters(req);
  const allWhere = [`rp.pesquisa_id = ?`, `date(rp.submitted_at) BETWEEN ? AND ?`, ...extra].join(' AND ');
  const allParams = [pid, from, to, ...ep];

  const total = db.prepare(`
    SELECT COUNT(DISTINCT rp.id) as t
    FROM resposta_pesquisa rp
    LEFT JOIN feedback f ON f.id = rp.feedback_id
    WHERE ${allWhere}
  `).get(...allParams).t;

  const avgRow = db.prepare(`
    SELECT AVG(ri.valor_numerico) as avg_val
    FROM resposta_pesquisa rp
    LEFT JOIN feedback f ON f.id = rp.feedback_id
    JOIN resposta_item ri ON ri.resposta_pesquisa_id = rp.id
    WHERE ${allWhere} AND ri.escala_opcao_chave IS NOT NULL AND ri.valor_numerico IS NOT NULL
  `).get(...allParams);
  const mediaGeral = avgRow.avg_val != null ? Math.round(avgRow.avg_val / MAX_SCORE * 100) : null;

  const origemRows = db.prepare(`
    SELECT COALESCE(f.origem, 'hospede') as orig, COUNT(DISTINCT rp.id) as cnt
    FROM resposta_pesquisa rp
    LEFT JOIN feedback f ON f.id = rp.feedback_id
    WHERE ${allWhere}
    GROUP BY orig
  `).all(...allParams);
  const origemDistrib = Object.fromEntries(origemRows.map(r => [r.orig, r.cnt]));

  const recomRow = db.prepare(`
    SELECT COUNT(DISTINCT rp.id) as t
    FROM resposta_pesquisa rp
    LEFT JOIN feedback f ON f.id = rp.feedback_id
    JOIN resposta_item ri ON ri.resposta_pesquisa_id = rp.id
    WHERE ${allWhere} AND ri.pergunta_chave LIKE '%recomend%' AND ri.valor_numerico > 0
  `).get(...allParams);
  const pctRecomendacao = total > 0 ? Math.round(recomRow.t / total * 1000) / 10 : null;

  const semAv = db.prepare(`
    SELECT COUNT(*) as t FROM survey_tokens
    WHERE respondida_em IS NULL AND liberada_em IS NOT NULL
      AND date(liberada_em) BETWEEN ? AND ?
  `).get(from, to).t;

  const secoes = db.prepare(`
    SELECT ps.id, ps.ordem, COALESCE(pst.titulo, CAST(ps.id AS TEXT)) as titulo
    FROM pesquisa_secao ps
    LEFT JOIN pesquisa_secao_traducao pst ON pst.pesquisa_secao_id = ps.id AND pst.idioma = 'pt-BR'
    WHERE ps.pesquisa_id = ?
    ORDER BY ps.ordem
  `).all(pid);

  const perguntas = db.prepare(`
    SELECT ps2.chave, COALESCE(pt.rotulo, ps2.chave) as texto, pp.secao_id, pp.ordem, ps2.tipo
    FROM pesquisa_pergunta pp
    JOIN pergunta_satisfacao ps2 ON ps2.id = pp.pergunta_id
    LEFT JOIN pergunta_traducao pt ON pt.pergunta_id = ps2.id AND pt.idioma = 'pt-BR'
    WHERE pp.pesquisa_id = ? AND pp.ativo = 1
    ORDER BY pp.secao_id, pp.ordem
  `).all(pid);

  const distRows = db.prepare(`
    SELECT ri.pergunta_chave, ri.escala_opcao_chave, COUNT(*) as cnt, SUM(ri.valor_numerico) as soma
    FROM resposta_pesquisa rp
    LEFT JOIN feedback f ON f.id = rp.feedback_id
    JOIN resposta_item ri ON ri.resposta_pesquisa_id = rp.id
    WHERE ${allWhere} AND ri.escala_opcao_chave IS NOT NULL
    GROUP BY ri.pergunta_chave, ri.escala_opcao_chave
  `).all(...allParams);

  const distMap = {};
  for (const d of distRows) {
    if (!distMap[d.pergunta_chave]) distMap[d.pergunta_chave] = { soma: 0, total: 0, counts: {} };
    distMap[d.pergunta_chave].counts[d.escala_opcao_chave] = d.cnt;
    distMap[d.pergunta_chave].soma += d.soma;
    distMap[d.pergunta_chave].total += d.cnt;
  }

  const secaoMap = {};
  for (const s of secoes) secaoMap[s.id] = { ...s, perguntas: [] };

  for (const p of perguntas) {
    if (p.tipo === 'texto' || p.tipo === 'texto_longo') continue;
    const dist = distMap[p.chave] || { soma: 0, total: 0, counts: {} };
    const notaPct = dist.total > 0 ? Math.round(dist.soma / (dist.total * MAX_SCORE) * 100) : null;
    if (p.secao_id && secaoMap[p.secao_id]) {
      secaoMap[p.secao_id].perguntas.push({
        chave: p.chave, texto: p.texto,
        nota: notaPct != null ? notaPct + '%' : '—',
        respostas: dist.total,
        distribuicao: {
          otimo: dist.counts['otimo'] || 0,
          bom: dist.counts['bom'] || 0,
          regular: dist.counts['regular'] || 0,
          ruim: dist.counts['ruim'] || dist.counts['melhorar'] || 0
        }
      });
    }
  }

  const txtRows = db.prepare(`
    SELECT ri.pergunta_chave, ri.valor_texto, rp.submitted_at, f.nome
    FROM resposta_pesquisa rp
    LEFT JOIN feedback f ON f.id = rp.feedback_id
    JOIN resposta_item ri ON ri.resposta_pesquisa_id = rp.id
    WHERE ${allWhere} AND ri.valor_texto IS NOT NULL AND trim(ri.valor_texto) != ''
    ORDER BY rp.submitted_at DESC
  `).all(...allParams);

  const txtMap = {};
  for (const r of txtRows) {
    if (!txtMap[r.pergunta_chave]) txtMap[r.pergunta_chave] = [];
    txtMap[r.pergunta_chave].push({
      text: r.valor_texto,
      author: r.nome || 'Hóspede',
      date: fmtDate(r.submitted_at)
    });
  }
  const txtPerguntas = perguntas.filter(p => p.tipo === 'texto' || p.tipo === 'texto_longo');
  const comentarios = Object.keys(txtMap).map(chave => ({
    chave,
    label: txtPerguntas.find(p => p.chave === chave)?.texto || chave,
    itens: txtMap[chave]
  }));

  res.json({
    ok: true,
    mediaGeral, total, semAvaliacao: semAv, pctRecomendacao, origemDistrib,
    secoes: Object.values(secaoMap).filter(s => s.perguntas.length > 0).sort((a, b) => a.ordem - b.ordem),
    comentarios
  });
  } catch (e) {
    console.error('[gq/stats]', e);
    res.status(500).json({ ok: false, error: 'Erro interno' });
  }
});

// GET /api/gq/respostas?slug&from&to&q&tipo&origem&page&limit
router.get('/respostas', (req, res) => {
  try {
  const db = getDb();
  const slug = (req.query.slug || 'spa-locc-v1').toString();
  const { from: defFrom, to: defTo } = defaultPeriod();
  const from = (req.query.from || defFrom).toString();
  const to = (req.query.to || defTo).toString();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  const pesquisa = db.prepare(
    `SELECT id FROM pesquisa WHERE slug = ? AND ativo = 1 ORDER BY versao DESC LIMIT 1`
  ).get(slug);
  if (!pesquisa) return res.json({ ok: true, total: 0, items: [] });

  const extra = [];
  const ep = [];
  const q = (req.query.q || '').toString().trim();
  const tipo = (req.query.tipo || '').toString().trim();
  const origem = (req.query.origem || '').toString().trim();
  if (q) { extra.push('(f.nome_hospede LIKE ? OR f.nome_casal LIKE ? OR f.email LIKE ?)'); ep.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (tipo) { extra.push('f.tipo_cliente = ?'); ep.push(tipo); }
  if (origem) { extra.push('f.origem = ?'); ep.push(origem); }

  const where = [`rp.pesquisa_id = ?`, `date(rp.submitted_at) BETWEEN ? AND ?`, ...extra].join(' AND ');
  const params = [pesquisa.id, from, to, ...ep];

  const total = db.prepare(`
    SELECT COUNT(DISTINCT rp.id) as t
    FROM resposta_pesquisa rp
    LEFT JOIN feedback f ON f.id = rp.feedback_id
    WHERE ${where}
  `).get(...params).t;

  const rows = db.prepare(`
    SELECT rp.id, rp.submitted_at, f.nome, f.email, f.tipo_cliente, f.origem,
           AVG(ri.valor_numerico) as avg_val, COUNT(ri.id) as resp_cnt
    FROM resposta_pesquisa rp
    LEFT JOIN feedback f ON f.id = rp.feedback_id
    LEFT JOIN resposta_item ri ON ri.resposta_pesquisa_id = rp.id AND ri.escala_opcao_chave IS NOT NULL
    WHERE ${where}
    GROUP BY rp.id
    ORDER BY rp.submitted_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const items = rows.map(r => ({
    id: r.id,
    date: fmtDate(r.submitted_at),
    nome: r.nome || 'Sem nome',
    email: r.email || '—',
    tipo: r.tipo_cliente || '—',
    origem: r.origem || 'hospede',
    media: r.avg_val != null && r.resp_cnt > 0
      ? Math.round(r.avg_val / MAX_SCORE * 100) + '%' : '—'
  }));

  res.json({ ok: true, total, items });
  } catch (e) {
    console.error('[gq/respostas]', e);
    res.status(500).json({ ok: false, error: 'Erro interno' });
  }
});

// GET /api/gq/resposta/:id — detalhe por resposta_pesquisa.id (usado pelo GestaoQualidade)
router.get('/resposta/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });
  const db = getDb();
  const row = db.prepare(`
    SELECT f.*
    FROM resposta_pesquisa rp
    JOIN feedback f ON f.id = rp.feedback_id
    WHERE rp.id = ?
  `).get(id);
  if (!row) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  delete row.ip_address; delete row.user_agent;
  return res.json({ ok: true, item: row });
});

export default router;
