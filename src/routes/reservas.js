import { Router } from 'express';
import { requireAuth, requireSpa, requireWrite } from '../middleware/auth.js';
import { listarReservasSemana, inserirReserva, cancelarReserva, listarTodasReservas, buscarReservaById, criarSurveyToken, gerarDocumentoToken, countSessoesSemPesquisa, buscarAdminById, buscarClientePorCpf, inserirCliente, validarCpfMod11, getDb, quartoValido, isGranClass, telefoneValido } from '../db.js';

const router = Router();
router.use(requireAuth);
// Reservas sao escopo Spa. GETs livres p/ autenticados. Escrita (criar reserva,
// liberar pesquisa, gerar ficha, cancelar) exige requireSpa + requireWrite.
const podeEscreverSpa = [requireSpa, requireWrite];

router.get('/sem-pesquisa', (req, res) => {
  res.json({ ok: true, total: countSessoesSemPesquisa() });
});

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

router.post('/', ...podeEscreverSpa, (req, res) => {
  const {
    sala, tipo_cliente, cliente, apto, email, telefone, tratamento, data, hora_inicio, hora_fim, linha, tipo_massagem_id, massagista_id,
    cliente2, tipo_cliente2, apto2, email2, telefone2, tratamento2, tipo_massagem_id2, massagista_id2,
    cpf, quarto,
  } = req.body || {};

  // Quarto: obrigatório e VÁLIDO para hóspedes; opcional para passantes/externos.
  const quartoLimpo = quarto ? String(quarto).trim().replace(/\D/g, '').padStart(4,'0').slice(-4) : '';
  if (tipo_cliente === 'hospede') {
    if (!quartoLimpo) return res.status(400).json({ ok: false, error: 'Quarto obrigatório para hóspedes' });
    if (!quartoValido(quartoLimpo)) return res.status(400).json({ ok: false, error: 'Quarto inexistente. Confira o número (ex: 0501, 1401).' });
  } else if (quartoLimpo && !quartoValido(quartoLimpo)) {
    return res.status(400).json({ ok: false, error: 'Quarto inexistente. Deixe em branco para clientes externos.' });
  }

  // Telefone: aceita BR ou internacional; rejeita lixo.
  if (telefone && !telefoneValido(telefone)) {
    return res.status(400).json({ ok: false, error: 'Telefone inválido. Use formato BR (85 99999-9999) ou internacional (+33 6 12 34 56 78).' });
  }
  if (!sala || !tipo_cliente || !cliente?.trim() || !email?.trim() || !data || !hora_inicio || !hora_fim)
    return res.status(400).json({ ok: false, error: 'Campos obrigatórios ausentes' });
  if (!massagista_id)
    return res.status(400).json({ ok: false, error: 'Selecione uma massoterapeuta para o atendimento' });
  if (!['hospede', 'passante'].includes(tipo_cliente))
    return res.status(400).json({ ok: false, error: 'Tipo de cliente inválido' });
  // Casal: validar pessoa 2
  if (+sala === 3) {
    if (!cliente2?.trim()) return res.status(400).json({ ok: false, error: 'Informe o nome da Pessoa 2 (Casal)' });
    if (!massagista_id2)   return res.status(400).json({ ok: false, error: 'Selecione a massoterapeuta da Pessoa 2' });
    if (massagista_id2 === massagista_id || +massagista_id2 === +massagista_id)
      return res.status(400).json({ ok: false, error: 'As duas pessoas não podem ter a mesma massoterapeuta' });
  }

  const iniMin = _hhmmToMin(hora_inicio);
  const fimMin = _hhmmToMin(hora_fim);
  if (isNaN(iniMin) || isNaN(fimMin) || fimMin <= iniMin)
    return res.status(400).json({ ok: false, error: 'Horário inválido' });
  if (iniMin < SPA_OPEN_MIN || iniMin >= SPA_CLOSE_MIN)
    return res.status(400).json({ ok: false, error: 'Hora de início fora do expediente do spa (08:00–22:00)' });
  if (fimMin > SPA_CLOSE_MIN)
    return res.status(400).json({ ok: false, error: 'O tratamento terminaria após o fechamento do spa às 22:00' });

  try {
    const criado_por = (() => { const a = req.user?.sub ? buscarAdminById(req.user.sub) : null; return a?.nome || a?.username || req.user?.username || null; })();

    // CPF é OBRIGATÓRIO: toda reserva precisa estar vinculada ao cadastro
    // central de clientes. Se o CPF não existir ainda, criamos o cliente.
    let clienteIdReserva = null;
    const cpfNorm = (cpf || '').toString().replace(/\D/g, '');
    if (!cpfNorm) {
      return res.status(400).json({ ok: false, error: 'CPF do cliente é obrigatório' });
    }
    if (!validarCpfMod11(cpfNorm)) {
      return res.status(400).json({ ok: false, error: 'CPF inválido' });
    }
    const existing = buscarClientePorCpf(cpfNorm);
    if (existing) {
      clienteIdReserva = existing.id;
    } else {
      clienteIdReserva = inserirCliente({
        cpf: cpfNorm,
        nome: cliente.trim(),
        email: email.trim() || null,
        telefone: telefone?.trim() || null,
      });
    }

    const id = inserirReserva(
      +sala, cliente.trim(), tipo_cliente, apto?.trim() || null, email.trim(),
      telefone?.trim() || null, tratamento?.trim() || null, data, hora_inicio, hora_fim,
      {
        linha: linha?.trim() || null,
        tipo_massagem_id: tipo_massagem_id ? +tipo_massagem_id : null,
        massagista_id: +massagista_id,
        criado_por,
        cliente2: cliente2?.trim() || null,
        tipo_cliente2: tipo_cliente2 || null,
        apto2: apto2?.trim() || null,
        email2: email2?.trim() || null,
        telefone2: telefone2?.trim() || null,
        tratamento2: tratamento2?.trim() || null,
        tipo_massagem_id2: tipo_massagem_id2 ? +tipo_massagem_id2 : null,
        massagista_id2: massagista_id2 ? +massagista_id2 : null,
      }
    );

    // Vincula cliente_id / cpf / quarto na reserva recém-criada (a inserirReserva
    // não conhece esses campos — gravamos via UPDATE para não mexer na
    // assinatura existente). Falha silenciosa se as colunas não existirem.
    try {
      getDb().prepare('UPDATE reservas SET cliente_id=?, cpf=?, quarto=? WHERE id=?')
        .run(clienteIdReserva || null, cpfNorm || null, quartoLimpo || null, id);
    } catch {}

    res.status(201).json({
      ok: true, id, cliente_id: clienteIdReserva,
      quarto: quartoLimpo || null,
      gran_class: quartoLimpo ? isGranClass(quartoLimpo) : false,
    });
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

router.post('/:id/liberar-pesquisa', ...podeEscreverSpa, (req, res) => {
  const reserva = buscarReservaById(+req.params.id);
  if (!reserva) return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });
  const token = criarSurveyToken(reserva.id);
  const origin = process.env.NODE_ENV === 'production'
    ? `https://${req.get('host')}`
    : `${req.protocol}://${req.get('host')}`;
  res.json({ ok: true, token, url: `${origin}/?token=${token}`, nome: reserva.cliente, telefone: reserva.telefone });
});

router.post('/:id/gerar-ficha', ...podeEscreverSpa, (req, res) => {
  const reserva = buscarReservaById(+req.params.id);
  if (!reserva) return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });
  const token = gerarDocumentoToken(reserva.id);
  const origin = process.env.NODE_ENV === 'production'
    ? `https://${req.get('host')}`
    : `${req.protocol}://${req.get('host')}`;
  res.json({ ok: true, token, nome: reserva.cliente, telefone: reserva.telefone,
    baseUrl: `${origin}/spa-profile.html` });
});

router.delete('/:id', ...podeEscreverSpa, (req, res) => {
  const changes = cancelarReserva(+req.params.id);
  if (!changes) return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });
  res.json({ ok: true });
});

export default router;
