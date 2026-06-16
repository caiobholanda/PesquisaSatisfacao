import { Router } from 'express';
import { requireAuth, requireSpa, requireWrite } from '../middleware/auth.js';
import {
  listarClientes, buscarClientePorId, buscarClientePorCpf,
  inserirCliente, atualizarCliente, buscarCliente360,
  inserirProdutoCliente, atualizarProdutoCliente, removerProdutoCliente,
  validarCpfMod11,
} from '../db.js';

const router = Router();

// Tudo aqui exige sessão admin (master/spa/admin lê; admin não escreve).
router.use(requireAuth, requireSpa);

// GET /api/clientes?q=...
router.get('/', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  res.json({ ok: true, ...listarClientes({ q, limit, offset }) });
});

// GET /api/clientes/buscar?cpf=... (autofill na reserva)
router.get('/buscar', (req, res) => {
  const cpf = (req.query.cpf || '').toString();
  if (!cpf) return res.status(400).json({ ok: false, error: 'cpf obrigatorio' });
  if (!validarCpfMod11(cpf)) return res.status(400).json({ ok: false, error: 'CPF invalido' });
  const cli = buscarClientePorCpf(cpf);
  if (!cli) return res.json({ ok: true, cliente: null });
  res.json({ ok: true, cliente: cli });
});

// GET /api/clientes/:id (cliente 360)
router.get('/:id', (req, res) => {
  const data = buscarCliente360(parseInt(req.params.id));
  if (!data) return res.status(404).json({ ok: false, error: 'Cliente nao encontrado' });
  res.json({ ok: true, ...data });
});

// POST /api/clientes
router.post('/', requireWrite, (req, res) => {
  try {
    const id = inserirCliente(req.body || {});
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// PUT /api/clientes/:id
router.put('/:id', requireWrite, (req, res) => {
  try {
    atualizarCliente(parseInt(req.params.id), req.body || {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Produtos
router.post('/:id/produtos', requireWrite, (req, res) => {
  try {
    const pid = inserirProdutoCliente(parseInt(req.params.id), req.body || {});
    res.json({ ok: true, id: pid });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.put('/produtos/:pid', requireWrite, (req, res) => {
  try {
    atualizarProdutoCliente(parseInt(req.params.pid), req.body || {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.delete('/produtos/:pid', requireWrite, (req, res) => {
  removerProdutoCliente(parseInt(req.params.pid));
  res.json({ ok: true });
});

export default router;
