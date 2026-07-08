import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, requireSpa, requireWrite } from '../middleware/auth.js';
import {
  listarMassagistas, listarMassagistasComStats, listarMassagistasParaPadroes,
  inserirMassagista, atualizarMassagista, deletarMassagista, buscarMassagistaById,
  listarFeriasMassagista, criarFeriasMassagista, atualizarFeriasMassagista, excluirFeriasMassagista, feriasConflito,
  listarTurnosPeriodo, upsertTurno, deletarTurno, setPadraoEntrada, registrarLogPadrao, calcularSaldoCf,
  buscarTurno, registrarTurnoHistorico, listarTurnoHistorico,
  listarTiposMassagem, inserirTipoMassagem, atualizarTipoMassagem, deletarTipoMassagem,
  historicoMassagista, setMassagistaPinHash,
  calcularComissaoPorMes,
  getComissaoConfig, setComissaoConfig,
} from '../db.js';

const router = Router();
router.use(requireAuth);
// Cadastros pertencem ao escopo Spa. GET livre p/ qualquer autenticado (master,
// admin, spa, satisfacao podem listar). Escrita exige requireSpa + requireWrite:
// master e spa OK; admin (read-only) e satisfacao (escopo relatorios) caem em 403.
const podeEscreverSpa = [requireSpa, requireWrite];

function _computarEsp(funcao, bilingue, vinculo) {
  if (!funcao?.trim()) return null;
  let esp = funcao.trim().toUpperCase();
  if (bilingue) esp += ' BILINGUE';
  if (vinculo === 'Pleno') esp += ' PL';
  else if (vinculo?.trim()) esp += ' ' + vinculo.trim().toUpperCase();
  return esp;
}

// ── Massagistas ──
router.get('/massagistas', (_req, res) => res.json({ ok: true, items: listarMassagistasComStats() }));

// Padrões semanais — leitura (qualquer autenticado do SPA)
router.get('/massagistas/padroes', requireSpa, (req, res) => {
  res.json({ ok: true, items: listarMassagistasParaPadroes() });
});

router.post('/massagistas', ...podeEscreverSpa, (req, res) => {
  const { nome, matricula, funcao, vinculo, bilingue, disponibilidade, excecoes } = req.body || {};
  if (!nome?.trim()) return res.status(400).json({ ok: false, error: 'Nome obrigatório' });
  if (excecoes !== undefined) {
    const erroExc = _validarExcecoes(excecoes);
    if (erroExc) return res.status(400).json({ ok: false, error: erroExc });
  }
  const resolvedFuncao = funcao?.trim() || 'Massoterapeuta';
  const resolvedVinculo = vinculo?.trim() || null;
  const resolvedBilingue = bilingue ? 1 : 0;
  const id = inserirMassagista(nome, {
    matricula: matricula?.trim() || null,
    especialidade_original: _computarEsp(resolvedFuncao, resolvedBilingue, resolvedVinculo),
    funcao: resolvedFuncao,
    vinculo: resolvedVinculo,
    bilingue: resolvedBilingue,
    disponibilidade: disponibilidade ? (typeof disponibilidade === 'string' ? disponibilidade : JSON.stringify(disponibilidade)) : null,
    excecoes: (Array.isArray(excecoes) && excecoes.length)
      ? JSON.stringify(excecoes)
      : (typeof excecoes === 'string' && excecoes.trim() ? excecoes : null),
  });
  res.status(201).json({ ok: true, id });
});

function _validarExcecoes(excecoes) {
  if (!excecoes) return null;
  let arr;
  try { arr = typeof excecoes === 'string' ? JSON.parse(excecoes) : excecoes; }
  catch { return 'Exceções: JSON inválido'; }
  if (!Array.isArray(arr)) return 'Exceções devem ser uma lista';
  if (arr.length > 365) return 'Máximo de 365 exceções por massoterapeuta';
  const SPA_INI = 8 * 60, SPA_FIM = 22 * 60;
  const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const timeRe = /^\d{2}:\d{2}$/;
  for (const e of arr) {
    if (!e || typeof e !== 'object') return 'Exceção inválida';
    if (!dateRe.test(e.data || '')) return `Exceção: data inválida (${e.data})`;
    if (!['disponivel', 'indisponivel'].includes(e.tipo)) return `Exceção ${e.data}: tipo deve ser disponivel ou indisponivel`;
    if (!timeRe.test(e.inicio || '') || !timeRe.test(e.fim || '')) return `Exceção ${e.data}: horário inválido`;
    const ini = toMin(e.inicio), fim = toMin(e.fim);
    if (Number.isNaN(ini) || Number.isNaN(fim)) return `Exceção ${e.data}: horário inválido`;
    if (ini < SPA_INI) return `Exceção ${e.data}: início não pode ser antes das 08:00`;
    if (fim > SPA_FIM) return `Exceção ${e.data}: fim não pode ser após 22:00`;
    if (fim <= ini) return `Exceção ${e.data}: fim deve ser após o início`;
  }
  return null;
}

function _validarDisp(disponibilidade) {
  if (!disponibilidade) return null;
  const disp = typeof disponibilidade === 'string' ? JSON.parse(disponibilidade) : disponibilidade;
  const SPA_INI = 8 * 60, SPA_FIM = 22 * 60;
  const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  for (const [day, faixa] of Object.entries(disp)) {
    if (!faixa) continue;
    const parts = faixa.split('-');
    if (parts.length !== 2) return `Formato inválido para ${day}`;
    const ini = toMin(parts[0].trim()), fim = toMin(parts[1].trim());
    if (ini < SPA_INI) return `Horário de ${day} não pode começar antes das 08:00`;
    if (fim > SPA_FIM) return `Horário de ${day} não pode terminar após as 22:00`;
    if (fim <= ini) return `Horário de fim de ${day} deve ser após o início`;
  }
  return null;
}

router.put('/massagistas/:id', ...podeEscreverSpa, (req, res) => {
  // nome/funcao/vinculo/bilingue são gerenciados pelo Hub — ignorados se enviados pelo frontend
  const { nome, ativo = 1, matricula, disponibilidade, excecoes } = req.body || {};
  const existing = buscarMassagistaById(parseInt(req.params.id));
  if (!existing) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  if (disponibilidade !== undefined) {
    const erroDisp = _validarDisp(disponibilidade);
    if (erroDisp) return res.status(400).json({ ok: false, error: erroDisp });
  }
  if (excecoes !== undefined) {
    const erroExc = _validarExcecoes(excecoes);
    if (erroExc) return res.status(400).json({ ok: false, error: erroExc });
  }
  const opts = {};
  if (matricula !== undefined) opts.matricula = matricula?.trim() || null;
  if (disponibilidade !== undefined) opts.disponibilidade = disponibilidade
    ? (typeof disponibilidade === 'string' ? disponibilidade : JSON.stringify(disponibilidade))
    : null;
  if (excecoes !== undefined) opts.excecoes = (Array.isArray(excecoes) && excecoes.length)
    ? JSON.stringify(excecoes)
    : (typeof excecoes === 'string' && excecoes.trim() ? excecoes : null);

  atualizarMassagista(parseInt(req.params.id), nome || existing.nome, ativo ? 1 : 0, opts);
  res.json({ ok: true });
});

// Alterar padrão semanal de um massagista (escrita)
const PM_DIAS_VALIDOS = ['seg','ter','qua','qui','sex','sab','dom'];
const PM_HORAS_VALIDAS = new Set(['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','17:30']);

router.put('/massagistas/:id/padrao', ...podeEscreverSpa, (req, res) => {
  const mId = parseInt(req.params.id);
  if (isNaN(mId)) return res.status(400).json({ ok: false, error: 'id inválido' });
  const { padrao } = req.body || {};
  if (!padrao || typeof padrao !== 'object' || Array.isArray(padrao))
    return res.status(400).json({ ok: false, error: 'padrao inválido' });
  for (const dia of PM_DIAS_VALIDOS) {
    if (!(dia in padrao)) return res.status(400).json({ ok: false, error: `Dia "${dia}" ausente` });
    const val = padrao[dia];
    if (val !== null && val !== 'FOLGA' && !PM_HORAS_VALIDAS.has(val))
      return res.status(400).json({ ok: false, error: `Horário inválido para ${dia}: ${val}` });
  }
  const existing = buscarMassagistaById(mId);
  if (!existing) return res.status(404).json({ ok: false, error: 'Massagista não encontrado' });
  if (!existing.ativo) return res.status(400).json({ ok: false, error: 'Massagista inativo' });
  registrarLogPadrao(mId, existing.padrao_entrada, JSON.stringify(padrao), req.user?.username || null);
  setPadraoEntrada(mId, padrao);
  res.json({ ok: true });
});

router.get('/massagistas/:id/historico', (req, res) => {
  const m = listarMassagistas().find(m => m.id === parseInt(req.params.id));
  if (!m) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  // Nunca expor pin_hash ao front (auditoria 2026-06-25).
  const { pin_hash, ...massagistaSafe } = m;
  const items = historicoMassagista(m.nome);
  res.json({ ok: true, massagista: massagistaSafe, items });
});

// Receita & comissao por mes. Fonte: reservas do sistema (data <= hoje) +
// nota media do feedback + regras configuráveis em comissao_config.
// Default: ano atual. ?ano=2026 para forcar.
router.get('/massagistas/:id/receita', (req, res) => {
  const m = listarMassagistas().find(m => m.id === parseInt(req.params.id));
  if (!m) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  const ano = parseInt(req.query.ano) || new Date().getFullYear();
  const data = calcularComissaoPorMes(m.id, m.nome, ano);
  res.json({ ok: true, massagista: { id: m.id, nome: m.nome }, ...data });
});

router.delete('/massagistas/:id', ...podeEscreverSpa, (req, res) => {
  const changes = deletarMassagista(parseInt(req.params.id));
  if (!changes) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  res.json({ ok: true });
});

// ── Férias massagista ──
router.get('/massagistas/:id/ferias', (req, res) => {
  const m = buscarMassagistaById(parseInt(req.params.id));
  if (!m) return res.status(404).json({ ok: false, error: 'Não encontrada' });
  res.json({ ok: true, ferias: listarFeriasMassagista(m.id) });
});

router.post('/massagistas/:id/ferias', ...podeEscreverSpa, (req, res) => {
  const m = buscarMassagistaById(parseInt(req.params.id));
  if (!m) return res.status(404).json({ ok: false, error: 'Não encontrada' });
  const { data_inicio, data_fim, observacao } = req.body || {};
  if (!data_inicio || !data_fim) return res.status(400).json({ ok: false, error: 'data_inicio e data_fim são obrigatórios' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data_inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(data_fim))
    return res.status(400).json({ ok: false, error: 'Datas inválidas (YYYY-MM-DD)' });
  if (data_inicio > data_fim) return res.status(400).json({ ok: false, error: 'Início deve ser anterior ao fim' });
  if (feriasConflito(m.id, data_inicio, data_fim, null))
    return res.status(409).json({ ok: false, error: 'Período se sobrepõe a férias já programadas' });
  const id = criarFeriasMassagista(m.id, data_inicio, data_fim, observacao?.trim() || null);
  res.json({ ok: true, id });
});

router.put('/massagistas/:id/ferias/:fId', ...podeEscreverSpa, (req, res) => {
  const m = buscarMassagistaById(parseInt(req.params.id));
  if (!m) return res.status(404).json({ ok: false, error: 'Não encontrada' });
  const { data_inicio, data_fim, observacao } = req.body || {};
  if (!data_inicio || !data_fim) return res.status(400).json({ ok: false, error: 'data_inicio e data_fim são obrigatórios' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data_inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(data_fim))
    return res.status(400).json({ ok: false, error: 'Datas inválidas (YYYY-MM-DD)' });
  if (data_inicio > data_fim) return res.status(400).json({ ok: false, error: 'Início deve ser anterior ao fim' });
  const fId = parseInt(req.params.fId);
  if (feriasConflito(m.id, data_inicio, data_fim, fId))
    return res.status(409).json({ ok: false, error: 'Período se sobrepõe a férias já programadas' });
  const changes = atualizarFeriasMassagista(fId, data_inicio, data_fim, observacao?.trim() || null);
  if (!changes) return res.status(404).json({ ok: false, error: 'Período não encontrado' });
  res.json({ ok: true });
});

router.delete('/massagistas/:id/ferias/:fId', ...podeEscreverSpa, (req, res) => {
  const changes = excluirFeriasMassagista(parseInt(req.params.fId));
  if (!changes) return res.status(404).json({ ok: false, error: 'Período não encontrado' });
  res.json({ ok: true });
});

// Define/reseta PIN da massoterapeuta (login mobile). Hash bcrypt.
// Admin nunca ve o PIN — apenas redefine.
router.post('/massagistas/:id/pin', ...podeEscreverSpa, async (req, res) => {
  const { pin } = req.body || {};
  if (!pin || typeof pin !== 'string' || pin.length < 4 || pin.length > 12) {
    return res.status(400).json({ ok: false, error: 'PIN deve ter 4 a 12 caracteres' });
  }
  const m = buscarMassagistaById(parseInt(req.params.id));
  if (!m) return res.status(404).json({ ok: false, error: 'Massoterapeuta nao encontrada' });
  const hash = await bcrypt.hash(String(pin), 10);
  setMassagistaPinHash(m.id, hash);
  res.json({ ok: true });
});

// ── Comissão: regras (% base + tiers de bônus por nota) ──
// GET livre p/ autenticado (tela do histórico exibe regras junto).
// PUT exige podeEscreverSpa (master/spa) — não permite admin nem satisfacao.
router.get('/comissao/regras', (_req, res) => {
  res.json({ ok: true, ...getComissaoConfig() });
});
router.put('/comissao/regras', ...podeEscreverSpa, (req, res) => {
  try {
    const { base_rate, tiers } = req.body || {};
    const out = setComissaoConfig({ base_rate: Number(base_rate), tiers });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e?.message || 'Erro ao salvar regras' });
  }
});

// ── Tipos de Massagem ──
router.get('/tipos-massagem', (_req, res) => res.json({ ok: true, items: listarTiposMassagem() }));

router.post('/tipos-massagem', ...podeEscreverSpa, (req, res) => {
  const { nome, duracao_min, preco, descricao } = req.body || {};
  if (!nome?.trim()) return res.status(400).json({ ok: false, error: 'Nome obrigatório' });
  const id = inserirTipoMassagem(nome, duracao_min, preco, descricao);
  res.status(201).json({ ok: true, id });
});

router.put('/tipos-massagem/:id', ...podeEscreverSpa, (req, res) => {
  const { nome, duracao_min, preco, ativo = 1, descricao } = req.body || {};
  if (!nome?.trim()) return res.status(400).json({ ok: false, error: 'Nome obrigatório' });
  const changes = atualizarTipoMassagem(parseInt(req.params.id), nome, duracao_min, preco, ativo ? 1 : 0, descricao);
  if (!changes) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  res.json({ ok: true });
});

router.delete('/tipos-massagem/:id', ...podeEscreverSpa, (req, res) => {
  const changes = deletarTipoMassagem(parseInt(req.params.id));
  if (!changes) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  res.json({ ok: true });
});

// ── Escala mensal (turnos) ──
const VALID_TIMES  = new Set(['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','17:30','18:00','19:00','20:00','20:20','21:00','22:00','22:20']);
const VALID_STATUS = new Set(['X','FE','AT','AA','CF','CH','LS','LC','F']);
function turnoValido(t) {
  if (!t) return false;
  if (VALID_STATUS.has(t)) return true;
  if (VALID_TIMES.has(t)) return true;
  const p = t.split('|');
  return p.length === 2 && VALID_TIMES.has(p[0]) && VALID_TIMES.has(p[1]);
}

// Data em formato ISO E com valores reais (rejeita 2026-13-45, 2026-02-30 etc.)
function dataRealValida(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

router.get('/escala-spa', (req, res) => {
  const ano = parseInt(req.query.ano);
  const mes = parseInt(req.query.mes);
  if (isNaN(ano) || isNaN(mes) || mes < 0 || mes > 11) {
    return res.status(400).json({ ok: false, error: 'ano e mes (0-11) obrigatórios' });
  }
  const profs = listarMassagistas().filter(m => m.ativo).map(({ pin_hash, disponibilidade, excecoes, ...rest }) => rest);
  const turnos = listarTurnosPeriodo(ano, mes);
  res.json({ ok: true, profs, turnos });
});

router.put('/escala-spa/:mId/:data', ...podeEscreverSpa, (req, res) => {
  const mId = parseInt(req.params.mId);
  const { data } = req.params;
  const { turno } = req.body || {};
  if (!turnoValido(turno)) return res.status(400).json({ ok: false, error: 'turno inválido' });
  if (!dataRealValida(data)) return res.status(400).json({ ok: false, error: 'data inválida' });
  const m = buscarMassagistaById(mId);
  if (!m) return res.status(404).json({ ok: false, error: 'Massagista não encontrada' });
  if (!m.ativo) return res.status(400).json({ ok: false, error: 'Massagista inativa' });
  const antes = buscarTurno(mId, data);
  if (antes !== turno) {
    upsertTurno(mId, data, turno);
    // Histórico nunca pode derrubar a operação real
    try { registrarTurnoHistorico(mId, data, antes, turno, req.user?.username || null, 'manual'); } catch {}
  }
  res.json({ ok: true });
});

router.delete('/escala-spa/:mId/:data', ...podeEscreverSpa, (req, res) => {
  const mId = parseInt(req.params.mId);
  const { data } = req.params;
  if (isNaN(mId) || !dataRealValida(data)) return res.status(400).json({ ok: false, error: 'parâmetros inválidos' });
  const antes = buscarTurno(mId, data);
  const changes = deletarTurno(mId, data);
  if (changes) {
    try { registrarTurnoHistorico(mId, data, antes, null, req.user?.username || null, 'manual'); } catch {}
  }
  res.json({ ok: true });
});

// Histórico antes→depois de uma célula da escala mensal
router.get('/escala-spa/historico/:mId/:data', (req, res) => {
  const mId = parseInt(req.params.mId);
  const { data } = req.params;
  if (isNaN(mId) || !dataRealValida(data)) return res.status(400).json({ ok: false, error: 'parâmetros inválidos' });
  res.json({ ok: true, items: listarTurnoHistorico(mId, data) });
});

// Aplica padrão semanal a um período 21→20. body: { ano, mes, sobrescrever?, preview? }
router.post('/escala-spa/aplicar-padrao', ...podeEscreverSpa, (req, res) => {
  const ano = parseInt(req.body?.ano);
  const mes = parseInt(req.body?.mes);
  const sobrescrever = !!req.body?.sobrescrever;
  const preview = !!req.body?.preview;
  if (isNaN(ano) || isNaN(mes) || mes < 0 || mes > 11)
    return res.status(400).json({ ok: false, error: 'ano e mes (0-11) obrigatórios' });

  const p = n => String(n).padStart(2, '0');
  const ano2 = mes === 11 ? ano + 1 : ano;
  const mes2 = mes === 11 ? 0 : mes + 1;
  const dataIni = `${ano}-${p(mes + 1)}-21`;
  const dataFim  = `${ano2}-${p(mes2 + 1)}-20`;

  const dias = [];
  for (let d = new Date(dataIni + 'T12:00:00Z'), fim = new Date(dataFim + 'T12:00:00Z'); d <= fim; d.setUTCDate(d.getUTCDate() + 1))
    dias.push(new Date(d).toISOString().slice(0, 10));

  const DOW_KEYS = ['dom','seg','ter','qua','qui','sex','sab'];
  const profs = listarMassagistas().filter(m => m.ativo && m.padrao_entrada);
  const existentes = new Map(listarTurnosPeriodo(ano, mes).map(t => [`${t.massagista_id}-${t.data}`, t.turno]));

  const alteracoes = [];
  for (const prof of profs) {
    let padrao;
    try { padrao = JSON.parse(prof.padrao_entrada); } catch { continue; }
    for (const dataIso of dias) {
      const val = padrao[DOW_KEYS[new Date(dataIso + 'T12:00:00Z').getUTCDay()]];
      if (!val) continue;
      const key = `${prof.id}-${dataIso}`;
      const atual = existentes.has(key) ? existentes.get(key) : null;
      if (existentes.has(key) && !sobrescrever) continue;
      const turnoNovo = val === 'FOLGA' ? 'X' : val;
      if (atual === turnoNovo) continue;
      alteracoes.push({ massagista_id: prof.id, data: dataIso, turno: turnoNovo, antes: atual });
    }
  }

  if (preview) return res.json({ ok: true, preview: true, total: alteracoes.length });
  const usuario = req.user?.username || null;
  for (const { massagista_id, data, turno, antes } of alteracoes) {
    upsertTurno(massagista_id, data, turno);
    try { registrarTurnoHistorico(massagista_id, data, antes, turno, usuario, 'aplicar-padrao'); } catch {}
  }
  res.json({ ok: true, total: alteracoes.length });
});

// Saldo CF: ganhos (feriados trabalhados) − usados (turno='CF')
router.post('/escala-spa/cf-acumulado', (req, res) => {
  const { datas } = req.body || {};
  const cf = calcularSaldoCf(Array.isArray(datas) ? datas : []);
  res.json({ ok: true, cf });
});

export default router;
