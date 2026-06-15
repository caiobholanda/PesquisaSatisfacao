import { Router } from 'express';
import { inserirFeedback, listarFeedback, getFeedbackById, statsFeedback, exportarCsv, marcarSurveyTokenRespondido, atualizarIdiomaFeedback } from '../db.js';
import { detectarIdioma } from '../utils/detectarIdioma.js';
import { requireAuth } from '../middleware/auth.js';
import { inserirRespostaPesquisa, aplicarMetasEmStats } from '../qualidade.js';

const router = Router();

// Rate limit em memória: 5 submissões / 10 min por IP
const ratemap = new Map();
const RATE_WINDOW = 10 * 60 * 1000;
const RATE_MAX = 5;
// Limpa entradas expiradas a cada 30 min para evitar leak de memória
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ratemap) {
    if (now - entry.start > RATE_WINDOW * 2) ratemap.delete(ip);
  }
}, 30 * 60 * 1000);
function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const entry = ratemap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) { entry.count = 0; entry.start = now; }
  entry.count++;
  ratemap.set(ip, entry);
  if (entry.count > RATE_MAX) return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde e tente novamente.' });
  next();
}

const NOTAS_VALIDAS = ['otimo', 'bom', 'regular', 'ruim', null, undefined, ''];
const CAMPOS_NOTA = [
  'servicos_expectativa', 'servicos_explicacao', 'servicos_atitude', 'servicos_tecnica',
  'instalacoes_conforto', 'instalacoes_organizacao', 'instalacoes_conveniencia',
];

function validarEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

// POST /api/feedback — público
router.post('/', rateLimit, (req, res) => {
  const b = req.body || {};

  if (b.email?.trim() && !validarEmail(b.email)) return res.status(400).json({ ok: false, error: 'E-mail inválido' });
  if (!['hospede', 'colaborador'].includes(b.origem))
    return res.status(400).json({ ok: false, error: 'Origem inválida' });

  for (const campo of CAMPOS_NOTA) {
    if (b[campo] && !NOTAS_VALIDAS.includes(b[campo]))
      return res.status(400).json({ ok: false, error: `Nota inválida: ${campo}` });
  }

  const id = inserirFeedback({
    nome: b.nome.trim(),
    apto: b.apto?.trim() || null,
    email: b.email.trim().toLowerCase(),
    telefone: b.telefone?.trim() || null,
    data_tratamento: b.data_tratamento || null,
    tratamento_realizado: b.tratamento_realizado?.trim() || null,
    nome_massoterapeuta: b.nome_massoterapeuta?.trim() || null,
    servicos_expectativa: b.servicos_expectativa || null,
    servicos_explicacao: b.servicos_explicacao || null,
    servicos_atitude: b.servicos_atitude || null,
    servicos_tecnica: b.servicos_tecnica || null,
    servicos_comentario: b.servicos_comentario?.trim() || null,
    instalacoes_conforto: b.instalacoes_conforto || null,
    instalacoes_organizacao: b.instalacoes_organizacao || null,
    instalacoes_conveniencia: b.instalacoes_conveniencia || null,
    instalacoes_comentario: b.instalacoes_comentario?.trim() || null,
    recomenda: b.recomenda || null,
    recomenda_qual: b.recomenda_qual?.trim() || null,
    recomenda_porque: b.recomenda_porque?.trim() || null,
    tipo_cliente: b.tipo_cliente.trim(),
    origem: b.origem,
    ip_address: req.ip,
    user_agent: req.headers['user-agent'] || null,
    submitted_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  });

  try { marcarSurveyTokenRespondido(); } catch {}

  // Gravacao paralela ESTRUTURADA (Gestao da Qualidade): se o body trouxer
  // pesquisa_slug, criar resposta_pesquisa + resposta_item vinculados ao
  // feedback_id. Falhas aqui NAO derrubam a submissao publica — o feedback
  // legado ja foi gravado e a pesquisa nunca pode quebrar para o usuario.
  if (b.pesquisa_slug) {
    try {
      const itens = [];
      for (const campo of CAMPOS_NOTA) {
        if (b[campo]) {
          const mapa = { otimo: 9, bom: 6, regular: 3, ruim: 0 };
          itens.push({ chave: campo, escala_opcao_chave: b[campo], valor_numerico: mapa[b[campo]] ?? null });
        }
      }
      if (b.recomenda) itens.push({ chave: 'recomenda', escala_opcao_chave: b.recomenda === 'sim' ? 'sim' : 'nao', valor_numerico: b.recomenda === 'sim' ? 1 : 0 });
      for (const tx of ['servicos_comentario', 'instalacoes_comentario', 'recomenda_qual', 'recomenda_porque']) {
        if (b[tx]) itens.push({ chave: tx, valor_texto: b[tx] });
      }
      inserirRespostaPesquisa({
        pesquisa_slug: b.pesquisa_slug,
        pesquisa_versao: b.pesquisa_versao,
        app_origem: b.app_origem || 'spa',
        cliente_id: b.cliente_id || null,
        reserva_id: b.reserva_id || null,
        feedback_id: id,
        itens,
      });
    } catch (err) {
      console.error('[Qualidade] gravacao estruturada falhou (legado OK):', err.message);
    }
  }

  // Detecção de idioma em background — não bloqueia a resposta
  const textosLivres = [b.servicos_comentario, b.instalacoes_comentario, b.recomenda_qual, b.recomenda_porque, b.nome];
  detectarIdioma(textosLivres)
    .then(idioma => { if (idioma) atualizarIdiomaFeedback(id, idioma); })
    .catch(() => {});

  return res.status(201).json({ ok: true, id });
});

// GET /api/feedback — protegido
router.get('/', requireAuth, (req, res) => {
  const { origem, tipo_cliente, from, to, limit = '50', offset = '0', format } = req.query;

  if (format === 'csv') {
    const items = exportarCsv({ origem, tipo_cliente, from, to });
    const cols = [
      'id','nome','apto','email','telefone','data_tratamento','tratamento_realizado',
      'nome_massoterapeuta','servicos_expectativa','servicos_explicacao','servicos_atitude',
      'servicos_tecnica','servicos_comentario','instalacoes_conforto','instalacoes_organizacao',
      'instalacoes_conveniencia','instalacoes_comentario','recomenda','recomenda_qual',
      'recomenda_porque','tipo_cliente','origem','submitted_at',
    ];
    const csv = '﻿' + [
      cols.join(';'),
      ...items.map(r => cols.map(c => `"${(r[c] ?? '').toString().replace(/"/g, '""')}"`).join(';')),
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="feedback_${from || 'all'}_${to || 'all'}.csv"`);
    return res.send(csv);
  }

  const { total, items } = listarFeedback({
    origem, tipo_cliente, from, to,
    limit: Math.min(parseInt(limit) || 50, 200),
    offset: parseInt(offset) || 0,
  });
  return res.json({ ok: true, total, items });
});

// GET /api/feedback/stats — protegido. Mantem 100% do retorno antigo
// (total, periodo, porOrigem, porTipo, recomenda, medias, mediaGeral,
// pctRecomenda, distribuicoes, textos). Adiciona campo OPCIONAL 'metas'
// quando ?pesquisa_slug=X, calculado sobre o mesmo periodo.
router.get('/stats', requireAuth, (req, res) => {
  const { from, to, pesquisa_slug } = req.query;
  const stats = statsFeedback({ from, to });
  const out = { ok: true, ...stats };
  if (pesquisa_slug) {
    try { out.metas = aplicarMetasEmStats(pesquisa_slug, stats); } catch {}
  }
  return res.json(out);
});

// GET /api/feedback/item/:id — protegido (após /stats para não conflitar)
router.get('/item/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });
  const item = getFeedbackById(id);
  if (!item) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  res.json({ ok: true, item });
});

export default router;
