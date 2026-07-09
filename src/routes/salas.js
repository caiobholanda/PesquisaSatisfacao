import { Router } from 'express';
import {
  listarSalas,
  buscarSalaById,
  atualizarSala,
  listarBloqueiosSala,
  buscarBloqueioById,
  criarBloqueioSala,
  removerBloqueioSala,
  listarReservasNoBloqueio,
  listarSalasDisponiveis,
  atualizarSalaReserva,
} from '../db.js';

const router = Router();

// ─── GET /api/admin/salas ─────────────────────────────
// Lista todas as salas com bloqueios ativos
router.get('/', (req, res) => {
  try {
    const salas = listarSalas();
    const hoje = new Date().toISOString().slice(0, 10);
    const result = salas.map(s => {
      const bloqueios = listarBloqueiosSala(s.id, { from: hoje });
      return { ...s, bloqueios };
    });
    res.json({ ok: true, salas: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── PUT /api/admin/salas/:id ─────────────────────────
// Atualiza nome/tipo/observacao de uma sala
router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || id < 1 || id > 5) return res.status(400).json({ ok: false, error: 'Sala inválida' });
    const { nome, tipo, observacao } = req.body || {};
    const TIPOS_VALIDOS = ['individual', 'conjugada', 'beleza', 'evento'];
    if (tipo && !TIPOS_VALIDOS.includes(tipo)) return res.status(400).json({ ok: false, error: 'Tipo inválido' });
    const result = atualizarSala(id, { nome, tipo, observacao });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── GET /api/admin/salas/:id/bloqueios ──────────────
// Lista bloqueios de uma sala (opcionais: ?from=YYYY-MM-DD&to=YYYY-MM-DD)
router.get('/:id/bloqueios', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || id < 1 || id > 5) return res.status(400).json({ ok: false, error: 'Sala inválida' });
    const { from, to } = req.query;
    const bloqueios = listarBloqueiosSala(id, { from, to });
    res.json({ ok: true, bloqueios });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── GET /api/admin/salas/:id/bloqueios/check ────────
// Verifica quantas reservas existem no período ANTES de criar bloqueio
router.get('/:id/bloqueios/check', (req, res) => {
  try {
    const sala = Number(req.params.id);
    if (!sala || sala < 1 || sala > 5) return res.status(400).json({ ok: false, error: 'Sala inválida' });
    const { data_inicio, data_fim } = req.query;
    if (!data_inicio || !data_fim) return res.status(400).json({ ok: false, error: 'data_inicio e data_fim são obrigatórios' });
    if (data_fim < data_inicio) return res.status(400).json({ ok: false, error: 'data_fim deve ser >= data_inicio' });
    const reservas = listarReservasNoBloqueio(sala, data_inicio, data_fim);
    res.json({ ok: true, total: reservas.length, reservas });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── POST /api/admin/salas/:id/bloqueios ─────────────
// Cria bloqueio de sala
// Body: { data_inicio, data_fim, motivo, confirmar?: bool }
// Se houver reservas e confirmar != true → retorna 409 com a lista
router.post('/:id/bloqueios', async (req, res) => {
  try {
    const sala = Number(req.params.id);
    if (!sala || sala < 1 || sala > 5) return res.status(400).json({ ok: false, error: 'Sala inválida' });
    const { data_inicio, data_fim, motivo, confirmar } = req.body || {};
    if (!data_inicio || !data_fim || !motivo?.trim())
      return res.status(400).json({ ok: false, error: 'data_inicio, data_fim e motivo são obrigatórios' });
    if (data_fim < data_inicio)
      return res.status(400).json({ ok: false, error: 'data_fim deve ser >= data_inicio' });

    // Verifica sala
    const salaObj = buscarSalaById(sala);
    if (!salaObj) return res.status(404).json({ ok: false, error: 'Sala não encontrada' });

    // Checar reservas no período
    const reservas = listarReservasNoBloqueio(sala, data_inicio, data_fim);
    if (reservas.length > 0 && !confirmar) {
      return res.status(409).json({
        ok: false,
        tipo: 'reservas_no_periodo',
        total: reservas.length,
        reservas,
        error: `Existem ${reservas.length} reserva(s) ativa(s) nesta sala para o período selecionado`,
      });
    }

    // Criar bloqueio
    let bloqueado_por = null;
    try {
      const cookie = (req.headers.cookie || '').split(';').find(c => c.trim().startsWith('spa_admin_sess='));
      if (cookie) {
        const { default: jwt } = await import('jsonwebtoken');
        const tok = decodeURIComponent(cookie.trim().slice('spa_admin_sess='.length));
        const p = jwt.verify(tok, process.env.JWT_SECRET);
        bloqueado_por = p.email || null;
      }
    } catch (_) {}

    const result = criarBloqueioSala({ sala, data_inicio, data_fim, motivo: motivo.trim(), bloqueado_por });
    res.json({ ok: true, id: result.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── DELETE /api/admin/salas/bloqueios/:bloqueioId ───
// Remove um bloqueio pelo ID
router.delete('/bloqueios/:bloqueioId', (req, res) => {
  try {
    const id = Number(req.params.bloqueioId);
    if (!id) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const b = buscarBloqueioById(id);
    if (!b) return res.status(404).json({ ok: false, error: 'Bloqueio não encontrado' });
    const result = removerBloqueioSala(id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── GET /api/admin/salas/disponiveis ────────────────
// Retorna salas livres para um data+horário
// Query: ?data=YYYY-MM-DD&hora_inicio=HH:MM&hora_fim=HH:MM&excluir=1,2
router.get('/disponiveis', (req, res) => {
  try {
    const { data, hora_inicio, hora_fim, excluir } = req.query;
    if (!data || !hora_inicio || !hora_fim) return res.status(400).json({ ok: false, error: 'data, hora_inicio e hora_fim são obrigatórios' });
    const excluirSalas = excluir ? excluir.split(',').map(Number).filter(Boolean) : [];
    const salas = listarSalasDisponiveis({ data, hora_inicio, hora_fim, excluirSalas });
    res.json({ ok: true, salas });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── POST /api/admin/salas/:id/bloqueios/:bloqueioId/transferir ─
// Transfere automaticamente reservas do bloqueio para outras salas disponíveis
router.post('/:id/bloqueios/:bloqueioId/transferir', async (req, res) => {
  try {
    const sala = Number(req.params.id);
    const bloqueioId = Number(req.params.bloqueioId);
    if (!sala || !bloqueioId) return res.status(400).json({ ok: false, error: 'Parâmetros inválidos' });

    const bloqueio = buscarBloqueioById(bloqueioId);
    if (!bloqueio || bloqueio.sala !== sala) return res.status(404).json({ ok: false, error: 'Bloqueio não encontrado' });

    const reservas = listarReservasNoBloqueio(sala, bloqueio.data_inicio, bloqueio.data_fim);
    const resultados = [];

    for (const r of reservas) {
      const disponivel = listarSalasDisponiveis({
        data: r.data,
        hora_inicio: r.hora_inicio,
        hora_fim: r.hora_fim,
        excluirSalas: [sala],
      });
      if (disponivel.length > 0) {
        atualizarSalaReserva(r.id, disponivel[0].id);
        resultados.push({ reserva_id: r.id, cliente: r.cliente, data: r.data, transferida_para: disponivel[0].id, nova_sala_nome: disponivel[0].nome, ok: true });
      } else {
        resultados.push({ reserva_id: r.id, cliente: r.cliente, data: r.data, ok: false, error: 'Sem sala disponível neste horário' });
      }
    }

    const semDisponibilidade = resultados.filter(r => !r.ok);
    res.json({ ok: true, total: reservas.length, transferidas: resultados.filter(r => r.ok).length, sem_disponibilidade: semDisponibilidade.length, resultados });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── PUT /api/admin/reservas/:id/sala ────────────────
// Muda a sala de uma reserva individual (usado no fluxo manual)
router.put('/reservas/:id/sala', (req, res) => {
  try {
    const reservaId = Number(req.params.id);
    const { sala } = req.body || {};
    if (!reservaId || !sala) return res.status(400).json({ ok: false, error: 'reservaId e sala são obrigatórios' });
    const novaSala = Number(sala);
    if (novaSala < 1 || novaSala > 5) return res.status(400).json({ ok: false, error: 'Sala inválida' });
    const result = atualizarSalaReserva(reservaId, novaSala);
    res.json(result);
  } catch (e) {
    if (e.code === 'CONFLITO_SALA') return res.status(409).json({ ok: false, error: 'Sala já reservada neste horário', conflito: e.conflito });
    if (e.code === 'SALA_BLOQUEADA') return res.status(409).json({ ok: false, error: `Sala bloqueada: ${e.motivo}` });
    if (e.code === 'NOT_FOUND') return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
