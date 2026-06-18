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
    cpf2, quarto2,
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
  // Casal: pessoa 2 é OPCIONAL. Só valida coerencia SE algum campo foi
  // preenchido (cliente2, cpf2, tratamento2 ou massagista_id2 disparam
  // a validacao do bloco inteiro).
  const _p2Presente = +sala === 3 && !!(cliente2?.trim() || cpf2 || tratamento2?.trim() || massagista_id2);
  if (_p2Presente) {
    if (!cliente2?.trim())  return res.status(400).json({ ok: false, error: 'Pessoa 2: informe o nome' });
    if (!massagista_id2)    return res.status(400).json({ ok: false, error: 'Pessoa 2: selecione a massoterapeuta' });
    if (massagista_id2 === massagista_id || +massagista_id2 === +massagista_id)
      return res.status(400).json({ ok: false, error: 'As duas pessoas não podem ter a mesma massoterapeuta' });
    if (cpf2) {
      const c2 = String(cpf2).replace(/\D/g, '');
      if (c2 && !validarCpfMod11(c2)) return res.status(400).json({ ok: false, error: 'Pessoa 2: CPF inválido' });
    }
    if (telefone2 && !telefoneValido(telefone2)) {
      return res.status(400).json({ ok: false, error: 'Pessoa 2: telefone inválido' });
    }
  }
  // Quarto pessoa 2 (opcional, mesmas regras)
  const quarto2Limpo = quarto2 ? String(quarto2).trim().replace(/\D/g, '').padStart(4,'0').slice(-4) : '';
  if (_p2Presente && tipo_cliente2 === 'hospede') {
    if (!quarto2Limpo) return res.status(400).json({ ok: false, error: 'Pessoa 2: quarto obrigatório para hóspedes' });
    if (!quartoValido(quarto2Limpo)) return res.status(400).json({ ok: false, error: 'Pessoa 2: quarto inexistente' });
  } else if (quarto2Limpo && !quartoValido(quarto2Limpo)) {
    return res.status(400).json({ ok: false, error: 'Pessoa 2: quarto inexistente' });
  }

  const iniMin = _hhmmToMin(hora_inicio);
  const fimMin = _hhmmToMin(hora_fim);
  if (isNaN(iniMin) || isNaN(fimMin) || fimMin <= iniMin)
    return res.status(400).json({ ok: false, error: 'Horário inválido' });
  if (iniMin < SPA_OPEN_MIN || iniMin >= SPA_CLOSE_MIN)
    return res.status(400).json({ ok: false, error: 'Hora de início fora do expediente do spa (08:00–22:00)' });
  if (fimMin > SPA_CLOSE_MIN)
    return res.status(400).json({ ok: false, error: 'O tratamento terminaria após o fechamento do spa às 22:00' });

  // Bloqueia agendamento em data/hora passada (referência: America/Fortaleza).
  try {
    const nowFt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
    const hojeFt = nowFt.getFullYear() + '-' +
                   String(nowFt.getMonth()+1).padStart(2,'0') + '-' +
                   String(nowFt.getDate()).padStart(2,'0');
    if (data < hojeFt) {
      return res.status(400).json({ ok: false, error: 'Não é possível agendar em data passada' });
    }
    if (data === hojeFt) {
      const nowMin = nowFt.getHours()*60 + nowFt.getMinutes();
      if (iniMin < nowMin) {
        const hh = String(nowFt.getHours()).padStart(2,'0') + ':' + String(nowFt.getMinutes()).padStart(2,'0');
        return res.status(400).json({ ok: false, error: `Horário no passado. Agora são ${hh} (Fortaleza)` });
      }
    }
  } catch {}

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

    // Pessoa 2: se CPF foi fornecido, upserta o cliente tambem
    // (cadastro central serve para os dois hospedes em reservas casal).
    if (_p2Presente && cpf2) {
      const cpf2Norm = String(cpf2).replace(/\D/g, '');
      if (cpf2Norm && validarCpfMod11(cpf2Norm)) {
        const ex2 = buscarClientePorCpf(cpf2Norm);
        if (!ex2) {
          try {
            inserirCliente({
              cpf: cpf2Norm,
              nome: cliente2.trim(),
              email: email2?.trim() || null,
              telefone: telefone2?.trim() || null,
            });
          } catch {}
        }
      }
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
  const origin = process.env.NODE_ENV === 'production'
    ? `https://${req.get('host')}`
    : `${req.protocol}://${req.get('host')}`;

  // Reserva CASAL: 2 tokens distintos pra que cada hospede responda
  // sua propria pesquisa sem sobrescrever a do outro.
  if (reserva.cliente2 && reserva.cliente2.trim()) {
    const token1 = criarSurveyToken(reserva.id, 1);
    const token2 = criarSurveyToken(reserva.id, 2);
    return res.json({
      ok: true, casal: true,
      hospede1: { nome: reserva.cliente,  telefone: reserva.telefone,  token: token1, url: `${origin}/?token=${token1}` },
      hospede2: { nome: reserva.cliente2, telefone: reserva.telefone2, token: token2, url: `${origin}/?token=${token2}` },
    });
  }

  const token = criarSurveyToken(reserva.id, 1);
  res.json({ ok: true, casal: false, token, url: `${origin}/?token=${token}`, nome: reserva.cliente, telefone: reserva.telefone });
});

router.post('/:id/gerar-ficha', ...podeEscreverSpa, (req, res) => {
  const reserva = buscarReservaById(+req.params.id);
  if (!reserva) return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });
  const origin = process.env.NODE_ENV === 'production'
    ? `https://${req.get('host')}`
    : `${req.protocol}://${req.get('host')}`;
  const baseUrl = `${origin}/spa-profile.html`;

  // Reserva CASAL (cliente2 preenchido): gera 2 tokens distintos, um por
  // hospede. Cada um recebe seu proprio link e nao da bagunca no preenchimento.
  if (reserva.cliente2 && reserva.cliente2.trim()) {
    const token1 = gerarDocumentoToken(reserva.id, 1);
    const token2 = gerarDocumentoToken(reserva.id, 2);
    return res.json({
      ok: true, casal: true,
      hospede1: { nome: reserva.cliente,  telefone: reserva.telefone,  token: token1, url: `${baseUrl}?t=${token1}` },
      hospede2: { nome: reserva.cliente2, telefone: reserva.telefone2, token: token2, url: `${baseUrl}?t=${token2}` },
      baseUrl,
    });
  }

  // Reserva individual: 1 token so (compat com clients que ja consomem esse shape)
  const token = gerarDocumentoToken(reserva.id, 1);
  res.json({ ok: true, casal: false, token, nome: reserva.cliente, telefone: reserva.telefone,
    baseUrl, url: `${baseUrl}?t=${token}` });
});

router.delete('/:id', ...podeEscreverSpa, (req, res) => {
  const changes = cancelarReserva(+req.params.id);
  if (!changes) return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });
  res.json({ ok: true });
});

export default router;
