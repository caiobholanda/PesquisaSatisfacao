import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listarReservasSemana, inserirReserva, cancelarReserva } from '../db.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ ok: false, error: 'from e to obrigatórios' });
  res.json({ ok: true, items: listarReservasSemana(from, to) });
});

router.post('/', (req, res) => {
  const { sala, cliente, data, hora_inicio, hora_fim, observacao } = req.body || {};
  if (!sala || !cliente?.trim() || !data || !hora_inicio || !hora_fim)
    return res.status(400).json({ ok: false, error: 'Campos obrigatórios ausentes' });
  try {
    const id = inserirReserva(+sala, cliente.trim(), data, hora_inicio, hora_fim, observacao);
    res.status(201).json({ ok: true, id });
  } catch (e) {
    if (e.code === 'CONFLITO') return res.status(409).json({ ok: false, error: 'Horário já reservado para esta sala' });
    throw e;
  }
});

router.delete('/:id', (req, res) => {
  const changes = cancelarReserva(+req.params.id);
  if (!changes) return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });
  res.json({ ok: true });
});

export default router;
