import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listarReservasSemana, inserirReserva, cancelarReserva, listarTodasReservas, buscarReservaById, criarSurveyToken } from '../db.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ ok: false, error: 'from e to obrigatórios' });
  res.json({ ok: true, items: listarReservasSemana(from, to) });
});

router.get('/historico', (req, res) => {
  const { from, to, sala, busca, limit, offset } = req.query;
  const result = listarTodasReservas({
    from: from || null,
    to: to || null,
    sala: sala || null,
    busca: busca || null,
    limit: limit ? +limit : 100,
    offset: offset ? +offset : 0,
  });
  res.json({ ok: true, ...result });
});

const SPA_OPEN_MIN = 8 * 60;   // 08:00
const SPA_CLOSE_MIN = 22 * 60; // 22:00
function _hhmmToMin(s) {
  if (typeof s !== 'string') return NaN;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  return (+m[1]) * 60 + (+m[2]);
}

router.post('/', (req, res) => {
  const { sala, tipo_cliente, cliente, apto, email, telefone, tratamento, data, hora_inicio, hora_fim, linha, tipo_massagem_id, massagista_id } = req.body || {};
  if (!sala || !tipo_cliente || !cliente?.trim() || !email?.trim() || !data || !hora_inicio || !hora_fim)
    return res.status(400).json({ ok: false, error: 'Campos obrigatórios ausentes' });
  if (!massagista_id)
    return res.status(400).json({ ok: false, error: 'Selecione uma massoterapeuta para o atendimento' });
  if (!['hospede', 'passante'].includes(tipo_cliente))
    return res.status(400).json({ ok: false, error: 'Tipo de cliente inválido' });

  const iniMin = _hhmmToMin(hora_inicio);
  const fimMin = _hhmmToMin(hora_fim);
  if (isNaN(iniMin) || isNaN(fimMin) || fimMin <= iniMin)
    return res.status(400).json({ ok: false, error: 'Horário inválido' });
  if (iniMin < SPA_OPEN_MIN || iniMin >= SPA_CLOSE_MIN)
    return res.status(400).json({ ok: false, error: 'Hora de início fora do expediente do spa (08:00–22:00)' });
  if (fimMin > SPA_CLOSE_MIN)
    return res.status(400).json({ ok: false, error: 'O tratamento terminaria após o fechamento do spa às 22:00' });

  try {
    const id = inserirReserva(
      +sala, cliente.trim(), tipo_cliente, apto?.trim() || null, email.trim(),
      telefone?.trim() || null, tratamento?.trim() || null, data, hora_inicio, hora_fim,
      {
        linha: linha?.trim() || null,
        tipo_massagem_id: tipo_massagem_id ? +tipo_massagem_id : null,
        massagista_id: +massagista_id,
      }
    );
    res.status(201).json({ ok: true, id });
  } catch (e) {
    if (e.code === 'CONFLITO_SALA') {
      return res.status(409).json({ ok: false, error: 'Sala já reservada neste horário', tipo: 'sala', conflito: e.conflito });
    }
    if (e.code === 'CONFLITO_PROF') {
      return res.status(409).json({ ok: false, error: 'Massoterapeuta já tem atendimento neste horário', tipo: 'massagista', conflito: e.conflito });
    }
    throw e;
  }
});

router.post('/:id/liberar-pesquisa', (req, res) => {
  const reserva = buscarReservaById(+req.params.id);
  if (!reserva) return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });
  const token = criarSurveyToken(reserva.id);
  const origin = process.env.NODE_ENV === 'production'
    ? `https://${req.get('host')}`
    : `${req.protocol}://${req.get('host')}`;
  res.json({ ok: true, token, url: `${origin}/?token=${token}`, nome: reserva.cliente, telefone: reserva.telefone });
});

router.delete('/:id', (req, res) => {
  const changes = cancelarReserva(+req.params.id);
  if (!changes) return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });
  res.json({ ok: true });
});

export default router;
