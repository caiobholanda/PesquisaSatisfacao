import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { statsFeedback } from '../db.js';
import {
  buscarPesquisaPublicada,
  buscarPesquisaPublicadaPorApp,
  listarPesquisasPublicadasPorApp,
  listarPesquisas,
  buscarPesquisaPorId,
  listarPerguntasBiblioteca,
  listarEscalas,
  listarMetasPorPesquisa,
  aplicarMetasEmStats,
} from '../qualidade.js';

const router = Router();

// ── PUBLICAS ──────────────────────────────────────────────────────────────

// GET /api/survey/config?slug=spa-locc-v1&idioma=pt-BR
// Retorna o questionario ativo publicado. Se nao houver, {ok:false} ->
// o front cai no fallback hardcoded (compat total).
router.get('/config', (req, res) => {
  const slug = (req.query.slug || '').toString().trim();
  const idioma = (req.query.idioma || 'pt-BR').toString();
  if (!slug) {
    // Sem slug: tenta deduzir pelo app (default spa). Compat: mantem fallback.
    const app = (req.query.app || 'spa').toString();
    const pesquisa = buscarPesquisaPublicadaPorApp(app, idioma);
    if (!pesquisa) return res.json({ ok: false });
    return res.json({ ok: true, pesquisa });
  }
  const pesquisa = buscarPesquisaPublicada(slug, idioma);
  if (!pesquisa) return res.json({ ok: false });
  return res.json({ ok: true, pesquisa });
});

// GET /api/survey/published?app=spa — lista questionarios disponiveis para
// um app especifico (apps satelites consomem para selecionar qual pesquisa
// renderizar).
router.get('/published', (req, res) => {
  const app = (req.query.app || 'spa').toString();
  const items = listarPesquisasPublicadasPorApp(app);
  res.json({ ok: true, items });
});

// ── ADMIN ─────────────────────────────────────────────────────────────────
router.get('/admin/pesquisas', requireAuth, (_req, res) => {
  res.json({ ok: true, items: listarPesquisas() });
});

router.get('/admin/pesquisas/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const p = buscarPesquisaPorId(id);
  if (!p) return res.status(404).json({ ok: false, error: 'Nao encontrado' });
  res.json({ ok: true, pesquisa: p, metas: listarMetasPorPesquisa(id) });
});

router.get('/admin/perguntas', requireAuth, (_req, res) => {
  res.json({ ok: true, items: listarPerguntasBiblioteca() });
});

router.get('/admin/escalas', requireAuth, (_req, res) => {
  res.json({ ok: true, items: listarEscalas() });
});

router.get('/admin/metas', requireAuth, (req, res) => {
  const pesquisaId = parseInt(req.query.pesquisa_id);
  if (!pesquisaId) return res.status(400).json({ ok: false, error: 'pesquisa_id obrigatorio' });
  res.json({ ok: true, ...listarMetasPorPesquisa(pesquisaId) });
});

// GET /api/qualidade/admin/visao-geral?slug=spa-locc-v1&from=&to=
router.get('/admin/visao-geral', requireAuth, (req, res) => {
  const slug = (req.query.slug || 'spa-locc-v1').toString();
  const stats = statsFeedback({ from: req.query.from, to: req.query.to });
  const metasAplicadas = aplicarMetasEmStats(slug, stats);
  res.json({ ok: true, stats, metas: metasAplicadas });
});

export default router;
