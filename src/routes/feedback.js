import { Router } from 'express';
import { inserirFeedback, listarFeedback, getFeedbackById, statsFeedback, marcarSurveyTokenRespondido, atualizarIdiomaFeedback, buscarSurveyToken, getDb } from '../db.js';
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

  // BUG-U fix: usa o token especifico do hospede (vindo do body) ao inves
  // do ultimo liberado nos ultimos 15min — preserva a separacao por pessoa
  // em reservas casal (cada um marca SEU token, nao o do parceiro).
  try { marcarSurveyTokenRespondido(b.survey_token || null); } catch {}

  // BUG-CLI360: resolve cliente_id/reserva_id a partir do survey_token (fonte
  // autoritaria) — frontend publico nao manda esses ids no body. Sem isso,
  // Clientes 360 nao consegue vincular a pesquisa ao cliente.
  let _resolvedClienteId = null, _resolvedReservaId = null;
  if (b.survey_token) {
    try {
      const tokRow = buscarSurveyToken(b.survey_token);
      if (tokRow) {
        _resolvedReservaId = tokRow.reserva_id || null;
        _resolvedClienteId = tokRow.cliente_id || null;
      }
    } catch {}
  }
  // Tambem persiste cliente_id/reserva_id na tabela feedback (colunas ja
  // existem via ALTER em db.js). Se a primary insert nao tem essas colunas,
  // fazemos UPDATE direto.
  if (_resolvedClienteId || _resolvedReservaId) {
    try {
      getDb().prepare('UPDATE feedback SET cliente_id=?, reserva_id=? WHERE id=?')
        .run(_resolvedClienteId, _resolvedReservaId, id);
    } catch {}
  }

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
      // Perguntas EXTRAS adicionadas pelo admin no editor.
      // Formato esperado do frontend: b.extras = { chave_pergunta: { tipo, valor } }
      // Aceita tambem fallbacks (string, array, numero, boolean).
      // Limites de seguranca (endpoint publico):
      const CHAVE_RE   = /^[a-z0-9_]{1,64}$/i;
      const MAX_EXTRAS = 60;          // max perguntas extras por submissao
      const MAX_TEXTO  = 4000;        // max chars por valor_texto
      const MAX_OPCOES = 50;          // max opcoes (multipla) por pergunta
      if (b.extras && typeof b.extras === 'object' && !Array.isArray(b.extras)) {
        let count = 0;
        const pushItem = (chave, item) => {
          if (count >= MAX_EXTRAS) return;
          itens.push({ chave, ...item });
          count++;
        };
        const normChave = (k) => {
          if (typeof k !== 'string') return null;
          return CHAVE_RE.test(k) ? k : null;
        };
        const normTexto = (v) => {
          if (v === null || v === undefined) return null;
          const s = String(v);
          if (!s.length) return null;
          return s.slice(0, MAX_TEXTO);
        };
        const normOpcao = (v) => {
          if (v === null || v === undefined || v === '') return null;
          const s = String(v);
          return CHAVE_RE.test(s) ? s : null;
        };
        for (const [chaveRaw, raw] of Object.entries(b.extras)) {
          const chave = normChave(chaveRaw);
          if (!chave) continue;
          if (raw === null || raw === undefined || raw === '') continue;

          // Forma estruturada: { tipo, valor }
          if (typeof raw === 'object' && !Array.isArray(raw) && 'valor' in raw) {
            const tipo = raw.tipo;
            const v = raw.valor;
            if (v === null || v === undefined || v === '') continue;
            if (tipo === 'texto_livre') {
              const t = normTexto(v);
              if (t) pushItem(chave, { valor_texto: t });
            } else if (tipo === 'multipla' || Array.isArray(v)) {
              if (Array.isArray(v)) {
                let opcao = 0;
                for (const x of v) {
                  if (opcao >= MAX_OPCOES) break;
                  const k = normOpcao(x);
                  if (k) { pushItem(chave, { escala_opcao_chave: k }); opcao++; }
                }
              } else {
                const k = normOpcao(v);
                if (k) pushItem(chave, { escala_opcao_chave: k });
              }
            } else {
              // unica/sim_nao/escala
              const k = normOpcao(v);
              if (k) pushItem(chave, { escala_opcao_chave: k });
            }
          } else if (Array.isArray(raw)) {
            let opcao = 0;
            for (const x of raw) {
              if (opcao >= MAX_OPCOES) break;
              const k = normOpcao(x);
              if (k) { pushItem(chave, { escala_opcao_chave: k }); opcao++; }
            }
          } else if (typeof raw === 'string') {
            const t = normTexto(raw);
            if (t) pushItem(chave, { valor_texto: t });
          } else if (typeof raw === 'number' || typeof raw === 'boolean') {
            const t = normTexto(raw);
            if (t) pushItem(chave, { valor_texto: t });
          }
          if (count >= MAX_EXTRAS) break;
        }
      }
      inserirRespostaPesquisa({
        pesquisa_slug: b.pesquisa_slug,
        pesquisa_versao: b.pesquisa_versao,
        app_origem: b.app_origem || 'spa',
        cliente_id: _resolvedClienteId || b.cliente_id || null,
        reserva_id: _resolvedReservaId || b.reserva_id || null,
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
  const { origem, tipo_cliente, from, to, massoterapeuta, limit = '50', offset = '0' } = req.query;

  const { total, items } = listarFeedback({
    origem, tipo_cliente, from, to,
    massoterapeuta: massoterapeuta || null,
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

  // Anexa perguntas EXTRAS (admin-added) via resposta_pesquisa+resposta_item.
  // Sem isso, painel "Detalhes da avaliacao" mostra so as 4 secoes nativas.
  const extras = [];
  try {
    const db = getDb();
    // Lista CHAVES legacy que NAO sao extras (s0-s3, f0-f2, recomenda* + comentarios).
    const LEGACY = new Set([
      'servicos_expectativa','servicos_explicacao','servicos_atitude','servicos_tecnica',
      'instalacoes_conforto','instalacoes_organizacao','instalacoes_conveniencia',
      'recomenda','recomenda_qual','recomenda_porque',
      'servicos_comentario','instalacoes_comentario',
    ]);
    const resp = db.prepare('SELECT id FROM resposta_pesquisa WHERE feedback_id=? LIMIT 1').get(id);
    if (resp?.id) {
      const itens = db.prepare(
        'SELECT pergunta_chave, valor_texto, valor_numerico, escala_opcao_chave FROM resposta_item WHERE resposta_pesquisa_id=?'
      ).all(resp.id);
      for (const it of itens) {
        if (LEGACY.has(it.pergunta_chave)) continue;
        // Enriquece com rotulo pt-BR da pergunta (se existir)
        const trad = db.prepare(`
          SELECT rotulo FROM pergunta_traducao pt
          JOIN pergunta_satisfacao p ON p.id = pt.pergunta_id
          WHERE p.chave = ? AND pt.idioma='pt-BR'
        `).get(it.pergunta_chave);
        it.rotulo = trad?.rotulo || it.pergunta_chave;
        if (it.escala_opcao_chave) {
          const opt = db.prepare(`
            SELECT eot.rotulo FROM escala_opcao eo
            JOIN escala_opcao_traducao eot ON eot.escala_opcao_id = eo.id AND eot.idioma='pt-BR'
            WHERE eo.chave = ? ORDER BY eo.escala_id LIMIT 1
          `).get(it.escala_opcao_chave);
          it.escala_opcao_rotulo = opt?.rotulo || it.escala_opcao_chave;
        }
        extras.push(it);
      }
    }
  } catch (e) { console.warn('[feedback/item extras]', e?.message); }

  res.json({ ok: true, item, extras });
});

export default router;
