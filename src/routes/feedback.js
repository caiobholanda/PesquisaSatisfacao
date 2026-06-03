import { Router } from 'express';
import { inserirFeedback, listarFeedback, getFeedbackById, statsFeedback, exportarCsv } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Rate limit em memória: 5 submissões / 10 min por IP
const ratemap = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const window = 10 * 60 * 1000;
  const max = 5;
  const entry = ratemap.get(ip) || { count: 0, start: now };
  if (now - entry.start > window) { entry.count = 0; entry.start = now; }
  entry.count++;
  ratemap.set(ip, entry);
  if (entry.count > max) return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde e tente novamente.' });
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

  if (!b.nome?.trim()) return res.status(400).json({ ok: false, error: 'Nome é obrigatório' });
  if (!b.email?.trim()) return res.status(400).json({ ok: false, error: 'E-mail é obrigatório' });
  if (!validarEmail(b.email)) return res.status(400).json({ ok: false, error: 'E-mail inválido' });
  if (!b.tipo_cliente?.trim()) return res.status(400).json({ ok: false, error: 'Tipo de cliente é obrigatório' });
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

// GET /api/feedback/stats — protegido
router.get('/stats', requireAuth, (req, res) => {
  const { from, to } = req.query;
  return res.json({ ok: true, ...statsFeedback({ from, to }) });
});

export default router;
