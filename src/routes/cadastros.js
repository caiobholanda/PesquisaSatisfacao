import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listarMassagistas, inserirMassagista, atualizarMassagista, deletarMassagista,
  listarTiposMassagem, inserirTipoMassagem, atualizarTipoMassagem, deletarTipoMassagem,
  historicoMassagista,
} from '../db.js';

const router = Router();
router.use(requireAuth);

// ── Massagistas ──
router.get('/massagistas', (_req, res) => res.json({ ok: true, items: listarMassagistas() }));

router.post('/massagistas', (req, res) => {
  const { nome } = req.body || {};
  if (!nome?.trim()) return res.status(400).json({ ok: false, error: 'Nome obrigatório' });
  const id = inserirMassagista(nome);
  res.status(201).json({ ok: true, id });
});

router.put('/massagistas/:id', (req, res) => {
  const { nome, ativo = 1 } = req.body || {};
  if (!nome?.trim()) return res.status(400).json({ ok: false, error: 'Nome obrigatório' });
  const changes = atualizarMassagista(parseInt(req.params.id), nome, ativo ? 1 : 0);
  if (!changes) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  res.json({ ok: true });
});

router.get('/massagistas/:id/historico', (req, res) => {
  const m = listarMassagistas().find(m => m.id === parseInt(req.params.id));
  if (!m) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  const items = historicoMassagista(m.nome);
  res.json({ ok: true, massagista: m, items });
});

router.delete('/massagistas/:id', (req, res) => {
  const changes = deletarMassagista(parseInt(req.params.id));
  if (!changes) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  res.json({ ok: true });
});

// ── Tipos de Massagem ──
router.get('/tipos-massagem', (_req, res) => res.json({ ok: true, items: listarTiposMassagem() }));

router.post('/tipos-massagem', (req, res) => {
  const { nome, duracao_min, preco } = req.body || {};
  if (!nome?.trim()) return res.status(400).json({ ok: false, error: 'Nome obrigatório' });
  const id = inserirTipoMassagem(nome, duracao_min, preco);
  res.status(201).json({ ok: true, id });
});

router.put('/tipos-massagem/:id', (req, res) => {
  const { nome, duracao_min, preco, ativo = 1 } = req.body || {};
  if (!nome?.trim()) return res.status(400).json({ ok: false, error: 'Nome obrigatório' });
  const changes = atualizarTipoMassagem(parseInt(req.params.id), nome, duracao_min, preco, ativo ? 1 : 0);
  if (!changes) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  res.json({ ok: true });
});

router.delete('/tipos-massagem/:id', (req, res) => {
  const changes = deletarTipoMassagem(parseInt(req.params.id));
  if (!changes) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  res.json({ ok: true });
});

export default router;
