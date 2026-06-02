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
  const { sala, tipo_cliente, cliente, apto, email, telefone, tratamento, data, hora_inicio, hora_fim } = req.body || {};
  if (!sala || !tipo_cliente || !cliente?.trim() || !email?.trim() || !data || !hora_inicio || !hora_fim)
    return res.status(400).json({ ok: false, error: 'Campos obrigatórios ausentes' });
  if (!['hospede', 'passante'].includes(tipo_cliente))
    return res.status(400).json({ ok: false, error: 'Tipo de cliente inválido' });
  try {
    const id = inserirReserva(+sala, cliente.trim(), tipo_cliente, apto?.trim() || null, email.trim(), telefone?.trim() || null, tratamento?.trim() || null, data, hora_inicio, hora_fim);
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
