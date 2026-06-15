import { Router } from 'express';
import { requireAuth, requireSatisfacao } from '../middleware/auth.js';
import { estatisticasMes, cruzamentoSessoesPesquisa } from '../db.js';

const router = Router();
router.use(requireAuth, requireSatisfacao);

// GET /api/relatorios/mensal?ym=YYYY-MM (default: mes atual em Fortaleza)
router.get('/mensal', (req, res) => {
  let ym = (req.query.ym || '').toString().trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
    ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  }
  res.json({ ok: true, ...estatisticasMes(ym) });
});

// GET /api/relatorios/cruzamento?from&to&status=todos|respondidas|pendentes
router.get('/cruzamento', (req, res) => {
  const { from, to } = req.query;
  const status = ['respondidas', 'pendentes'].includes(req.query.status) ? req.query.status : 'todos';
  const items = cruzamentoSessoesPesquisa({ from, to, status });
  res.json({ ok: true, items, total: items.length });
});

export default router;
