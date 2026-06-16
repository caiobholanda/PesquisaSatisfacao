import { Router } from 'express';
import { requireAuth, requireMaster } from '../middleware/auth.js';
import { listarAuditoria, listarRecursosAuditoria } from '../db.js';

const router = Router();

router.use(requireAuth, requireMaster);

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  const filtros = {
    from: req.query.from || null,
    to: req.query.to || null,
    ator: req.query.ator || null,
    acao: req.query.acao || null,
    recurso: req.query.recurso || null,
    sucesso: req.query.sucesso != null && req.query.sucesso !== '' ? req.query.sucesso : null,
    limit, offset,
  };
  res.json({ ok: true, ...listarAuditoria(filtros) });
});

router.get('/recursos', (_req, res) => {
  res.json({ ok: true, items: listarRecursosAuditoria() });
});

export default router;
