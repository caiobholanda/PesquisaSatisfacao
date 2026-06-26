import { Router } from 'express';
import { requireAuth, requireSpa, requireWrite } from '../middleware/auth.js';
import { listarReservasSemana, inserirReserva, cancelarReserva, listarTodasReservas, buscarReservaById, buscarReservaDetalhe, criarSurveyToken, gerarDocumentoToken, countSessoesSemPesquisa, buscarAdminById, buscarClientePorCpf, buscarClientePorPassaporte, inserirCliente, validarCpfMod11, getDb, quartoValido, isGranClass, telefoneValido, statusPesquisaPessoa } from '../db.js';

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
  const { from, to, busca, limit, offset } = req.query;
  // sala aceita: ?sala=1, ?sala=1&sala=2, ?sala=1,2 (retrocompat)
  const salaRaw = req.query.sala;
  const salaList = []
    .concat(salaRaw == null ? [] : salaRaw)
    .flatMap(v => String(v).split(','))
    .map(v => parseInt(v, 10))
    .filter(n => Number.isInteger(n) && n >= 1 && n <= 5);
  const salas = [...new Set(salaList)];
  const result = listarTodasReservas({
    from: from || null,
    to: to || null,
    salas,
    busca: busca || null,
    limit: limit ? +limit : 100,
    offset: offset ? +offset : 0,
  });
  res.json({ ok: true, ...result });
});

// Detalhe completo da sessao para o modal do Historico de Clientes.
// Reaproveita buscarReservaDetalhe (db.js) que combina reserva + survey_tokens
// + spa_perfis + feedback sem mudar contrato de /historico nem outras telas.
router.get('/:id/detalhe', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'id invalido' });
  }
  try {
    const detalhe = buscarReservaDetalhe(id);
    if (!detalhe) return res.status(404).json({ ok: false, error: 'reserva nao encontrada' });
    res.json({ ok: true, ...detalhe });
  } catch (e) {
    console.error('[GET /api/reservas/:id/detalhe]', e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || 'erro interno' });
  }
});

const SPA_OPEN_MIN = 8 * 60;   // 08:00
const SPA_CLOSE_MIN = 22 * 60; // 22:00
function _hhmmToMin(s) {
  if (typeof s !== 'string') return NaN;
  // Hora deve ter 2 digitos (\d{2}) — evita aceitar "9:30" que e' valido
  // semanticamente mas quebra `new Date('YYYY-MM-DDTH:MM:00-03:00')` (ISO
  // exige HH com 2 digitos), o que causaria bypass acidental do gate de
  // janela de envio em src/routes/reservas.js POST /:id/gerar-ficha.
  const m = s.match(/^(\d{2}):(\d{2})$/);
  if (!m) return NaN;
  return (+m[1]) * 60 + (+m[2]);
}

// Normaliza hora_inicio para "HH:MM" estrito antes de usar em new Date().
// Cobre dados legados que possam ter "9:30" (H:MM) ou "13:00:00" (HH:MM:SS).
// Retorna null se nao conseguir normalizar (gate deixa passar — fail-open
// e' intencional pra nao quebrar geracao em registros antigos).
function _normalizarHHMM(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = String(+m[1]).padStart(2, '0');
  const mi = m[2];
  if (+h > 23 || +mi > 59) return null;
  return `${h}:${mi}`;
}

router.post('/', ...podeEscreverSpa, (req, res) => {
  // Diagnostico: captura QUALQUER erro do handler com stack completo,
  // preservando os returns/throws ja existentes (CONFLITO_SALA, CONFLITO_PROF).
  // Logging server-side detalhado; resposta ao cliente continua generica.
  try {
  const {
    sala, tipo_cliente, cliente, apto, email, telefone, tratamento, data, hora_inicio, hora_fim, linha, tipo_massagem_id, massagista_id,
    cliente2, tipo_cliente2, apto2, email2, telefone2, tratamento2, tipo_massagem_id2, massagista_id2,
    tipo_doc, doc, quarto,
    tipo_doc2, doc2, quarto2,
    // compat: clientes antigos podem ainda enviar cpf/cpf2
    cpf: _cpfLegacy, cpf2: _cpf2Legacy,
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
  // Espaço Beleza (sala 5): nao exige massoterapeuta nem tratamento.
  if (+sala !== 5 && !massagista_id)
    return res.status(400).json({ ok: false, error: 'Selecione uma massoterapeuta para o atendimento' });
  if (!['hospede', 'passante'].includes(tipo_cliente))
    return res.status(400).json({ ok: false, error: 'Tipo de cliente inválido' });
  // Casal: pessoa 2 é OPCIONAL. Só valida coerencia SE algum campo foi
  // preenchido (cliente2, cpf2, tratamento2 ou massagista_id2 disparam
  // a validacao do bloco inteiro).
  const _p2Presente = (+sala === 3 || +sala === 4) && !!(cliente2?.trim() || doc2 || _cpf2Legacy || tratamento2?.trim() || massagista_id2);
  // Normaliza documento pessoa 1 (suporte CPF ou Passaporte)
  const tipoDoc1 = tipo_doc === 'passaporte' ? 'passaporte' : 'cpf';
  const docNorm1 = tipoDoc1 === 'cpf'
    ? (doc || _cpfLegacy || '').toString().replace(/\D/g, '')
    : (doc || '').toString().trim().toUpperCase();

  // Normaliza documento pessoa 2 (se presente)
  const tipoDoc2 = tipo_doc2 === 'passaporte' ? 'passaporte' : 'cpf';
  const docNorm2 = tipoDoc2 === 'cpf'
    ? (doc2 || _cpf2Legacy || '').toString().replace(/\D/g, '')
    : (doc2 || '').toString().trim().toUpperCase();

  if (_p2Presente) {
    if (!cliente2?.trim())  return res.status(400).json({ ok: false, error: 'Pessoa 2: informe o nome' });
    if (!massagista_id2)    return res.status(400).json({ ok: false, error: 'Pessoa 2: selecione a massoterapeuta' });
    if (massagista_id2 === massagista_id || +massagista_id2 === +massagista_id)
      return res.status(400).json({ ok: false, error: 'As duas pessoas não podem ter a mesma massoterapeuta' });
    if (docNorm2) {
      if (tipoDoc2 === 'cpf' && !validarCpfMod11(docNorm2))
        return res.status(400).json({ ok: false, error: 'Pessoa 2: CPF inválido' });
      if (tipoDoc2 === 'passaporte' && docNorm2.length < 5)
        return res.status(400).json({ ok: false, error: 'Pessoa 2: passaporte inválido (mínimo 5 caracteres)' });
      if (docNorm1 && docNorm1 === docNorm2)
        return res.status(400).json({ ok: false, error: 'Pessoa 1 e Pessoa 2 não podem ter o mesmo documento' });
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

    // Documento é OBRIGATÓRIO: toda reserva precisa estar vinculada ao cadastro
    // central de clientes (CPF ou Passaporte). Cria o cliente se não existir.
    if (!docNorm1) {
      return res.status(400).json({ ok: false, error: 'Documento do cliente é obrigatório (CPF ou Passaporte)' });
    }
    if (tipoDoc1 === 'cpf' && !validarCpfMod11(docNorm1)) {
      return res.status(400).json({ ok: false, error: 'CPF inválido' });
    }
    if (tipoDoc1 === 'passaporte' && docNorm1.length < 5) {
      return res.status(400).json({ ok: false, error: 'Passaporte inválido (mínimo 5 caracteres)' });
    }

    let clienteIdReserva = null;
    if (tipoDoc1 === 'cpf') {
      const existing = buscarClientePorCpf(docNorm1);
      clienteIdReserva = existing
        ? existing.id
        : inserirCliente({ cpf: docNorm1, nome: cliente.trim(), email: email.trim() || null, telefone: telefone?.trim() || null });
    } else {
      const existing = buscarClientePorPassaporte(docNorm1);
      clienteIdReserva = existing
        ? existing.id
        : inserirCliente({ passaporte: docNorm1, nome: cliente.trim(), email: email.trim() || null, telefone: telefone?.trim() || null });
    }

    // Pessoa 2: upserta cliente também (cadastro central).
    if (_p2Presente && docNorm2) {
      try {
        if (tipoDoc2 === 'cpf' && validarCpfMod11(docNorm2)) {
          if (!buscarClientePorCpf(docNorm2))
            inserirCliente({ cpf: docNorm2, nome: cliente2.trim(), email: email2?.trim() || null, telefone: telefone2?.trim() || null });
        } else if (tipoDoc2 === 'passaporte' && docNorm2.length >= 5) {
          if (!buscarClientePorPassaporte(docNorm2))
            inserirCliente({ passaporte: docNorm2, nome: cliente2.trim(), email: email2?.trim() || null, telefone: telefone2?.trim() || null });
        }
      } catch {}
    }

    const id = inserirReserva(
      +sala, cliente.trim(), tipo_cliente, apto?.trim() || null, email.trim(),
      telefone?.trim() || null, tratamento?.trim() || null, data, hora_inicio, hora_fim,
      {
        linha: linha?.trim() || null,
        tipo_massagem_id: tipo_massagem_id ? +tipo_massagem_id : null,
        // sala 5 (Espaco Beleza) nao tem massoterapeuta: grava NULL, nao 0.
        massagista_id: massagista_id ? +massagista_id : null,
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

    // Vincula cliente_id / cpf ou passaporte / quarto na reserva recém-criada.
    // Falha silenciosa se as colunas ainda não existirem (migrações pendentes).
    try {
      getDb().prepare('UPDATE reservas SET cliente_id=?, cpf=?, passaporte=?, quarto=? WHERE id=?')
        .run(
          clienteIdReserva || null,
          tipoDoc1 === 'cpf' ? docNorm1 : null,
          tipoDoc1 === 'passaporte' ? docNorm1 : null,
          quartoLimpo || null,
          id
        );
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
  } catch (e) {
    // Sanitiza payload: remove documentos antes de logar (LGPD).
    const safeBody = { ...(req.body || {}) };
    for (const k of ['doc','doc2','cpf','cpf2','tipo_doc','tipo_doc2']) delete safeBody[k];
    console.error('[POST /api/reservas] FALHA', {
      sala: req.body?.sala,
      tipo_cliente: req.body?.tipo_cliente,
      data: req.body?.data,
      hora_inicio: req.body?.hora_inicio,
      hora_fim: req.body?.hora_fim,
      massagista_id: req.body?.massagista_id,
      tipo_massagem_id: req.body?.tipo_massagem_id,
      linha: req.body?.linha,
      quarto: req.body?.quarto,
      msg: e?.message,
      code: e?.code,
      stack: e?.stack,
    });
    if (res.headersSent) return;
    return res.status(500).json({ ok: false, error: 'Erro interno' });
  }
});

router.post('/:id/liberar-pesquisa', ...podeEscreverSpa, (req, res) => {
  const reserva = buscarReservaById(+req.params.id);
  if (!reserva) return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });
  const origin = process.env.NODE_ENV === 'production'
    ? `https://${req.get('host')}`
    : `${req.protocol}://${req.get('host')}`;

  // Reserva CASAL: 2 tokens distintos pra que cada hospede responda
  // sua propria pesquisa sem sobrescrever a do outro. Tokens nascem
  // INATIVOS (liberada_em=NULL) — admin precisa clicar o botao
  // "Liberar pesquisa" do hospede que vai responder agora no modal
  // que sera aberto pelo frontend. Isso evita o bug onde ambos os tokens
  // nascem ativados no mesmo segundo e o tablet pega o errado.
  if (reserva.cliente2 && reserva.cliente2.trim()) {
    const token1 = criarSurveyToken(reserva.id, 1, false);
    const token2 = criarSurveyToken(reserva.id, 2, false);
    const s1 = statusPesquisaPessoa(reserva.id, 1);
    const s2 = statusPesquisaPessoa(reserva.id, 2);
    return res.json({
      ok: true, casal: true,
      hospede1: { nome: reserva.cliente,  telefone: reserva.telefone,  token: token1, url: `${origin}/?token=${token1}`, respondida: s1.respondida, feedback_id: s1.feedback_id },
      hospede2: { nome: reserva.cliente2, telefone: reserva.telefone2, token: token2, url: `${origin}/?token=${token2}`, respondida: s2.respondida, feedback_id: s2.feedback_id },
    });
  }

  const token = criarSurveyToken(reserva.id, 1);
  res.json({ ok: true, casal: false, token, url: `${origin}/?token=${token}`, nome: reserva.cliente, telefone: reserva.telefone });
});

// Ativa a pesquisa de UM hospede especifico (pessoa 1 ou 2) numa reserva
// de casal. Faz UPDATE em survey_tokens.liberada_em = now() — assim o
// tablet em / pega esse hospede no proximo polling (~1s).
// Reusa criarSurveyToken que ja' e' idempotente (cria se nao existir).
router.post('/:id/pessoa/:pessoa/ativar-pesquisa', ...podeEscreverSpa, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pessoa = parseInt(req.params.pessoa, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'id invalido' });
  if (![1, 2].includes(pessoa))        return res.status(400).json({ ok: false, error: 'pessoa deve ser 1 ou 2' });
  const reserva = buscarReservaById(id);
  if (!reserva) return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });
  if (pessoa === 2 && !(reserva.cliente2 && reserva.cliente2.trim())) {
    return res.status(400).json({ ok: false, error: 'Reserva não é casal' });
  }
  const token = criarSurveyToken(id, pessoa);
  res.json({ ok: true, token });
});

// Status atual da pesquisa de casal (p1 e p2). Consumido pelo polling
// do modal admin para detectar quando um hospede respondeu — sem precisar
// fechar/reabrir o modal. Read-only, GET. Sem side effects.
router.get('/:id/status-pesquisa-casal', (req, res) => {
  // no-store: polling 3s precisa de resposta fresca a cada tick.
  // Mesmo Cache-Control aplicado em /api/survey/live por consistencia.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'id invalido' });
  const reserva = buscarReservaById(id);
  if (!reserva) return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });
  const s1 = statusPesquisaPessoa(id, 1);
  const s2 = statusPesquisaPessoa(id, 2);
  res.json({ ok: true, h1: s1, h2: s2 });
});

router.post('/:id/gerar-ficha', ...podeEscreverSpa, (req, res) => {
  const reserva = buscarReservaById(+req.params.id);
  if (!reserva) return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });

  // Janela de envio: anamnese so' pode ser enviada ate' 10min APOS o
  // hora_inicio da sessao. Apos isso, botao no admin fica desabilitado
  // ("Tempo para enviar anamnese expirado"). Backend e' a fonte da verdade
  // — bater na API direto apos a janela tambem e' recusado.
  //
  // Timezone: Fortaleza/CE = UTC-3 fixo (Ceara nao adota horario de verao).
  // Hardcoded -03:00 evita depender do TZ do container Fly.io.
  // slice(0,5) defende contra hora_inicio sujo no banco (ex: 'HH:MM:SS' que
  // quebraria o parse ISO -> NaN -> bypass acidental).
  if (reserva.data && reserva.hora_inicio) {
    const hhmm = _normalizarHHMM(reserva.hora_inicio);
    if (hhmm) {
      const inicioMs = new Date(`${reserva.data}T${hhmm}:00-03:00`).getTime();
      if (Number.isFinite(inicioMs)) {
        const limiteMs = inicioMs + 10 * 60 * 1000;
        if (Date.now() > limiteMs) {
          return res.status(409).json({ ok: false, error: 'tempo_expirado',
            message: 'Tempo para enviar anamnese expirado' });
        }
      }
    }
  }

  const origin = process.env.NODE_ENV === 'production'
    ? `https://${req.get('host')}`
    : `${req.protocol}://${req.get('host')}`;
  const baseUrl = `${origin}/spa-profile.html`;
  const ehCasal = !!(reserva.cliente2 && reserva.cliente2.trim());

  // Suporte opcional a { pessoa: 1|2 } no body: gera o token APENAS dessa pessoa
  // em reserva casal, sem sobrescrever o token da outra. Sem `pessoa`: mantem
  // comportamento legado (casal gera ambos; individual gera 1).
  const pessoaRaw = req.body?.pessoa;
  const pessoaEspec = (pessoaRaw === 1 || pessoaRaw === 2) ? pessoaRaw : null;

  if (ehCasal && pessoaEspec === null) {
    const token1 = gerarDocumentoToken(reserva.id, 1);
    const token2 = gerarDocumentoToken(reserva.id, 2);
    return res.json({
      ok: true, casal: true,
      hospede1: { nome: reserva.cliente,  telefone: reserva.telefone,  token: token1, url: `${baseUrl}?t=${token1}` },
      hospede2: { nome: reserva.cliente2, telefone: reserva.telefone2, token: token2, url: `${baseUrl}?t=${token2}` },
      baseUrl,
    });
  }

  // Pessoa especifica (casal com pessoa=N) OU reserva individual.
  const p = pessoaEspec || 1;
  const token = gerarDocumentoToken(reserva.id, p);
  const nome = p === 2 ? reserva.cliente2 : reserva.cliente;
  const telefone = p === 2 ? reserva.telefone2 : reserva.telefone;
  res.json({ ok: true, casal: false, pessoa: p, token, nome, telefone,
    baseUrl, url: `${baseUrl}?t=${token}` });
});

router.delete('/:id', ...podeEscreverSpa, (req, res) => {
  const changes = cancelarReserva(+req.params.id);
  if (!changes) return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });
  res.json({ ok: true });
});

export default router;
