import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, requireSpa, requireWrite } from '../middleware/auth.js';
import {
  listarMassagistas, listarMassagistasComStats,
  inserirMassagista, atualizarMassagista, deletarMassagista, buscarMassagistaById,
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
  const { nome, ativo = 1, matricula, funcao, vinculo, bilingue, disponibilidade, excecoes } = req.body || {};
  if (!nome?.trim()) return res.status(400).json({ ok: false, error: 'Nome obrigatório' });
  if (disponibilidade !== undefined) {
    const erroDisp = _validarDisp(disponibilidade);
    if (erroDisp) return res.status(400).json({ ok: false, error: erroDisp });
  }
  if (excecoes !== undefined) {
    const erroExc = _validarExcecoes(excecoes);
    if (erroExc) return res.status(400).json({ ok: false, error: erroExc });
  }
  const existing = buscarMassagistaById(parseInt(req.params.id));
  if (!existing) return res.status(404).json({ ok: false, error: 'Não encontrado' });

  const resolvedFuncao = funcao !== undefined ? (funcao?.trim() || 'Massoterapeuta') : (existing.funcao || 'Massoterapeuta');
  const resolvedVinculo = vinculo !== undefined ? (vinculo?.trim() || null) : existing.vinculo;
  const resolvedBilingue = bilingue !== undefined ? (bilingue ? 1 : 0) : existing.bilingue;

  const opts = {
    funcao: resolvedFuncao,
    vinculo: resolvedVinculo,
    bilingue: resolvedBilingue,
    especialidade_original: _computarEsp(resolvedFuncao, resolvedBilingue, resolvedVinculo),
  };
  if (matricula !== undefined) opts.matricula = matricula?.trim() || null;
  if (disponibilidade !== undefined) opts.disponibilidade = disponibilidade
    ? (typeof disponibilidade === 'string' ? disponibilidade : JSON.stringify(disponibilidade))
    : null;
  if (excecoes !== undefined) opts.excecoes = (Array.isArray(excecoes) && excecoes.length)
    ? JSON.stringify(excecoes)
    : (typeof excecoes === 'string' && excecoes.trim() ? excecoes : null);

  atualizarMassagista(parseInt(req.params.id), nome, ativo ? 1 : 0, opts);
  res.json({ ok: true });
});

router.get('/massagistas/:id/historico', (req, res) => {
  const m = listarMassagistas().find(m => m.id === parseInt(req.params.id));
  if (!m) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  const items = historicoMassagista(m.nome);
  res.json({ ok: true, massagista: m, items });
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

export default router;
