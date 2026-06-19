import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { requireTerapeuta } from '../middleware/auth.js';
import { buscarMassagistaPorNome, buscarMassagistaPorId, listarReservasDaTerapeuta, buscarReservaDetalheTerapeuta, listarMassagistas } from '../db.js';

const router = Router();
const JWT_TTL_SECONDS = 60 * 60 * 12; // 12h

function setTerapeutaCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.appendHeader('Set-Cookie', `spa_terapeuta_sess=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Max-Age=${JWT_TTL_SECONDS}; Path=/${secure}`);
}
function clearTerapeutaCookie(res) {
  res.appendHeader('Set-Cookie', 'spa_terapeuta_sess=; Max-Age=0; Path=/; HttpOnly');
}

// Lista nomes ATIVOS para o dropdown do login. Publico (nao revela
// nada sensivel — nomes ja aparecem em outros lugares do produto).
router.get('/nomes-ativos', (_req, res) => {
  const lista = listarMassagistas().filter(m => m.ativo).map(m => m.nome);
  res.json({ ok: true, nomes: lista });
});

// POST /api/terapeuta/login — { nome, pin } → cookie spa_terapeuta_sess
router.post('/login', async (req, res) => {
  const { nome, pin } = req.body || {};
  if (!nome || !pin || typeof pin !== 'string') {
    return res.status(400).json({ ok: false, error: 'Nome e PIN obrigatórios' });
  }
  const m = buscarMassagistaPorNome(nome);
  if (!m || !m.ativo) {
    // Mesmo erro pra nao revelar se o nome existe.
    return res.status(401).json({ ok: false, error: 'Nome ou PIN inválido' });
  }
  if (!m.pin_hash) {
    return res.status(401).json({ ok: false, error: 'PIN não configurado. Procure o admin.' });
  }
  const ok = await bcrypt.compare(String(pin), m.pin_hash);
  if (!ok) return res.status(401).json({ ok: false, error: 'Nome ou PIN inválido' });
  const token = jwt.sign(
    { massagista_id: m.id, nome: m.nome, role: 'terapeuta' },
    process.env.JWT_SECRET,
    { expiresIn: JWT_TTL_SECONDS }
  );
  setTerapeutaCookie(res, token);
  res.json({ ok: true, nome: m.nome });
});

router.post('/logout', (_req, res) => {
  clearTerapeutaCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireTerapeuta, (req, res) => {
  const m = buscarMassagistaPorId(req.user.massagista_id);
  if (!m || !m.ativo) return res.status(401).json({ ok: false, error: 'Sessão inválida' });
  let disponibilidade = null;
  try { disponibilidade = m.disponibilidade ? JSON.parse(m.disponibilidade) : null; } catch {}
  res.json({ ok: true, id: m.id, nome: m.nome, disponibilidade });
});

// Agenda escopada — IGNORA qualquer massagista_id do query;
// SO usa o do token. Defesa contra IDOR.
router.get('/agenda', requireTerapeuta, (req, res) => {
  const { from, to } = req.query;
  const items = listarReservasDaTerapeuta(req.user.massagista_id, {
    from: from || null,
    to: to || null,
  });
  res.json({ ok: true, items });
});

// Detalhe de UM atendimento (read-only) — valida ownership
router.get('/atendimento/:id', requireTerapeuta, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'id inválido' });
  }
  try {
    const detalhe = buscarReservaDetalheTerapeuta(id, req.user.massagista_id);
    if (!detalhe) return res.status(404).json({ ok: false, error: 'Atendimento não encontrado' });
    res.json({ ok: true, ...detalhe });
  } catch (e) {
    console.error('[GET /api/terapeuta/atendimento/:id]', e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || 'erro interno' });
  }
});

export default router;
