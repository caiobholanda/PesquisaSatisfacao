import { Router } from 'express';
import { requireAuth, requireSatisfacao, requireWrite } from '../middleware/auth.js';
import { statsFeedback } from '../db.js';
import { traduzirParaTodos } from '../utils/traduzir.js';
import {
  buscarPesquisaPublicada,
  buscarPesquisaPublicadaPorApp,
  listarPesquisasPublicadasPorApp,
  listarPesquisas,
  buscarPesquisaPorId,
  montarEstruturaPesquisaAdmin,
  listarPerguntasBiblioteca,
  listarEscalas,
  listarMetasPorPesquisa,
  aplicarMetasEmStats,
  criarPesquisa, editarPesquisa, publicarPesquisa, despublicarPesquisa, clonarPesquisa,
  criarSecao, editarSecao, removerSecao,
  associarPergunta, editarAssociacaoPergunta, desassociarPergunta,
  criarPergunta, editarPergunta, excluirPerguntaDefinitivo,
  registrarHistoricoAnamnese, listarHistoricoAnamnese, resolverSlugPesquisa,
  criarEscala,
  salvarMetaPergunta, salvarMetaQuestionario, removerMeta,
  listarOpcoesPergunta, salvarOpcaoPergunta, removerOpcaoPergunta,
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

// Estrutura completa para o editor admin (sem filtro publicada_em,
// com associacao_id pra DELETE correto). Cache-Control desligado pra
// evitar staleness pós-edição.
router.get('/admin/pesquisas/slug/:slug/estrutura', requireAuth, (req, res) => {
  const slug = (req.params.slug || '').toString();
  const idioma = (req.query.idioma || 'pt-BR').toString();
  const estrutura = montarEstruturaPesquisaAdmin(slug, idioma);
  if (!estrutura) return res.status(404).json({ ok: false, error: 'Pesquisa nao encontrada' });
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, estrutura });
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

// ── ADMIN: ESCRITAS (Módulo 4) ────────────────────────────────────────────
// Cadeia: requireAuth → requireSatisfacao (master|satisfacao|admin) →
// requireWrite (bloqueia admin read-only). master e satisfacao podem escrever.
const writeChain = [requireAuth, requireSatisfacao, requireWrite];

// Historico — somente leitura
router.get('/admin/anamnese/historico', requireAuth, (req, res) => {
  const items = listarHistoricoAnamnese({
    pesquisa_slug: req.query.slug || null,
    limite: req.query.limite,
    offset: req.query.offset,
  });
  res.json({ ok: true, items });
});

// Pesquisa
router.post('/admin/pesquisas', writeChain, (req, res) => {
  try { res.json({ ok: true, id: criarPesquisa(req.body || {}) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.put('/admin/pesquisas/:id', writeChain, (req, res) => {
  try { editarPesquisa(parseInt(req.params.id), req.body || {}); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.post('/admin/pesquisas/:id/publicar', writeChain, (req, res) => {
  publicarPesquisa(parseInt(req.params.id)); res.json({ ok: true });
});
router.post('/admin/pesquisas/:id/despublicar', writeChain, (req, res) => {
  despublicarPesquisa(parseInt(req.params.id)); res.json({ ok: true });
});
router.post('/admin/pesquisas/:id/clonar', writeChain, (req, res) => {
  try {
    const id = clonarPesquisa(parseInt(req.params.id), req.body || {});
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Seções
router.post('/admin/pesquisas/:id/secoes', writeChain, (req, res) => {
  try {
    const pesquisaId = parseInt(req.params.id);
    const id = criarSecao(pesquisaId, req.body || {});
    registrarHistoricoAnamnese({
      usuario: req.user, acao: 'criar', entidade: 'secao', entidade_id: id,
      descricao: `Seção criada: "${(req.body?.traducoes?.['pt-BR']?.titulo || req.body?.traducoes?.['pt-BR'] || req.body?.chave || '')}"`,
      dados_depois: req.body, pesquisa_slug: resolverSlugPesquisa({ pesquisaId }),
    });
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.put('/admin/secoes/:id', writeChain, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const slug = resolverSlugPesquisa({ secaoId: id });
    editarSecao(id, req.body || {});
    registrarHistoricoAnamnese({
      usuario: req.user, acao: 'editar', entidade: 'secao', entidade_id: id,
      descricao: `Seção renomeada/editada: "${(req.body?.traducoes?.['pt-BR']?.titulo || req.body?.traducoes?.['pt-BR'] || '')}"`,
      dados_depois: req.body, pesquisa_slug: slug,
    });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.delete('/admin/secoes/:id', writeChain, (req, res) => {
  const id = parseInt(req.params.id);
  const slug = resolverSlugPesquisa({ secaoId: id });
  removerSecao(id);
  registrarHistoricoAnamnese({
    usuario: req.user, acao: 'remover', entidade: 'secao', entidade_id: id,
    descricao: 'Seção removida (com suas perguntas)', pesquisa_slug: slug,
  });
  res.json({ ok: true });
});

// Associação pesquisa_pergunta
router.post('/admin/pesquisas/:id/perguntas', writeChain, (req, res) => {
  try {
    const pesquisaId = parseInt(req.params.id);
    const id = associarPergunta(pesquisaId, req.body || {});
    registrarHistoricoAnamnese({
      usuario: req.user, acao: 'associar', entidade: 'pesquisa_pergunta', entidade_id: id,
      descricao: `Pergunta #${req.body?.pergunta_id} associada à pesquisa`,
      dados_depois: req.body, pesquisa_slug: resolverSlugPesquisa({ pesquisaId }),
    });
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.put('/admin/pesquisa-pergunta/:id', writeChain, (req, res) => {
  const id = parseInt(req.params.id);
  const slug = resolverSlugPesquisa({ assocId: id });
  editarAssociacaoPergunta(id, req.body || {});
  registrarHistoricoAnamnese({
    usuario: req.user, acao: 'editar', entidade: 'pesquisa_pergunta', entidade_id: id,
    descricao: 'Associação pergunta-pesquisa editada (ordem/obrigatoria/ativo)',
    dados_depois: req.body, pesquisa_slug: slug,
  });
  res.json({ ok: true });
});
router.delete('/admin/pesquisa-pergunta/:id', writeChain, (req, res) => {
  const id = parseInt(req.params.id);
  const slug = resolverSlugPesquisa({ assocId: id });
  desassociarPergunta(id);
  registrarHistoricoAnamnese({
    usuario: req.user, acao: 'desassociar', entidade: 'pesquisa_pergunta', entidade_id: id,
    descricao: 'Pergunta removida da pesquisa', pesquisa_slug: slug,
  });
  res.json({ ok: true });
});

// Biblioteca de perguntas
router.post('/admin/perguntas', writeChain, (req, res) => {
  try {
    const id = criarPergunta(req.body || {});
    // Front pode informar `pesquisa_slug` no body pra que a criacao
    // ja apareca na timeline da pesquisa certa (antes de existir
    // associacao no DB). Fallback: lookup posterior na 1a associacao.
    registrarHistoricoAnamnese({
      usuario: req.user, acao: 'criar', entidade: 'pergunta', entidade_id: id,
      descricao: `Pergunta criada: "${(req.body?.traducoes?.['pt-BR']?.rotulo || req.body?.traducoes?.['pt-BR'] || req.body?.chave || '')}" — tipo ${req.body?.tipo || '?'}`,
      dados_depois: req.body,
      pesquisa_slug: req.body?.pesquisa_slug || null,
    });
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.put('/admin/perguntas/:id', writeChain, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    editarPergunta(id, req.body || {});
    const novo = (req.body?.traducoes?.['pt-BR']?.rotulo || req.body?.traducoes?.['pt-BR'] || null);
    let descricao = 'Pergunta editada';
    if (req.body?.ativo === 0) descricao = 'Pergunta DESATIVADA (oculta da anamnese)';
    else if (req.body?.ativo === 1) descricao = 'Pergunta REATIVADA';
    else if (novo) descricao = `Pergunta editada: novo texto "${novo}"` + (req.body?.tipo ? ` — tipo ${req.body.tipo}` : '');
    else if (req.body?.tipo) descricao = `Pergunta editada: novo tipo ${req.body.tipo}`;
    registrarHistoricoAnamnese({
      usuario: req.user, acao: 'editar', entidade: 'pergunta', entidade_id: id,
      descricao, dados_depois: req.body,
      pesquisa_slug: req.body?.pesquisa_slug || resolverSlugPesquisa({ perguntaId: id }),
    });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
// Exclusao DEFINITIVA — apaga a pergunta + traducoes + opcoes + associacoes.
// Bloqueia se houver respostas, pra nao quebrar historico.
router.delete('/admin/perguntas/:id', writeChain, (req, res) => {
  const id = parseInt(req.params.id);
  // Captura slug ANTES de excluir (apos delete nao tem mais associacao).
  const slug = resolverSlugPesquisa({ perguntaId: id });
  const r = excluirPerguntaDefinitivo(id);
  if (!r.ok) return res.status(400).json(r);
  registrarHistoricoAnamnese({
    usuario: req.user, acao: 'excluir_definitivo', entidade: 'pergunta', entidade_id: id,
    descricao: 'Pergunta excluída permanentemente do banco',
    pesquisa_slug: slug,
  });
  res.json(r);
});

// Escalas
router.post('/admin/escalas', writeChain, (req, res) => {
  try { res.json({ ok: true, id: criarEscala(req.body || {}) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Metas
router.post('/admin/metas/pergunta', writeChain, (req, res) => {
  try { res.json({ ok: true, id: salvarMetaPergunta(req.body || {}) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.post('/admin/metas/questionario', writeChain, (req, res) => {
  try { res.json({ ok: true, id: salvarMetaQuestionario(req.body || {}) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.delete('/admin/metas/:tipo/:id', writeChain, (req, res) => {
  removerMeta(req.params.tipo, parseInt(req.params.id)); res.json({ ok: true });
});

// Tradução automática pt-BR → demais idiomas (anamnese)
router.post('/admin/traduzir', requireAuth, requireSatisfacao, async (req, res) => {
  const texto = (req.body?.texto || '').toString();
  const idiomas = Array.isArray(req.body?.idiomas) ? req.body.idiomas : null;
  if (!texto.trim()) return res.json({ ok: true, traducoes: {} });
  try {
    const traducoes = await traduzirParaTodos(texto, idiomas);
    res.json({ ok: true, traducoes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Opções de pergunta (tipos 'unica'/'multipla' sem escala)
router.get('/admin/perguntas/:id/opcoes', requireAuth, (req, res) => {
  res.json({ ok: true, items: listarOpcoesPergunta(parseInt(req.params.id)) });
});
router.post('/admin/perguntas/:id/opcoes', writeChain, (req, res) => {
  try {
    const perguntaId = parseInt(req.params.id);
    const id = salvarOpcaoPergunta(perguntaId, req.body || {});
    registrarHistoricoAnamnese({
      usuario: req.user, acao: 'criar', entidade: 'opcao', entidade_id: id,
      descricao: `Opção adicionada na pergunta #${perguntaId}: "${(req.body?.traducoes?.['pt-BR'] || req.body?.chave || '')}"`,
      dados_depois: req.body,
      pesquisa_slug: resolverSlugPesquisa({ perguntaId }),
    });
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.delete('/admin/opcoes/:id', writeChain, (req, res) => {
  const id = parseInt(req.params.id);
  const slug = resolverSlugPesquisa({ opcaoId: id });
  removerOpcaoPergunta(id);
  registrarHistoricoAnamnese({
    usuario: req.user, acao: 'remover', entidade: 'opcao', entidade_id: id,
    descricao: 'Opção removida', pesquisa_slug: slug,
  });
  res.json({ ok: true });
});

export default router;
