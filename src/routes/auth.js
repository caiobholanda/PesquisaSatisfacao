import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { buscarAdmin, buscarAdminById, listarAdmins, inserirAdmin, atualizarAdmin, deletarAdmin } from '../db.js';
import { requireAuth, requireMaster } from '../middleware/auth.js';

function setAdminCookie(res, token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `spa_admin_sess=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Path=/${secure}`);
}

const router = Router();
const ROLES_VALIDOS = ['master', 'admin', 'normal'];

function senhaForte(s) {
  if (!s || s.length < 8) return false;
  return /[A-Z]/.test(s) && /[0-9]/.test(s) && /[^a-zA-Z0-9]/.test(s);
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ ok: false, error: 'Usuário e senha obrigatórios' });

  const admin = buscarAdmin(username);
  const valido = admin && bcrypt.compareSync(password, admin.password_hash);

  if (!valido) {
    await new Promise(r => setTimeout(r, 500));
    return res.status(401).json({ ok: false, error: 'Credenciais inválidas' });
  }

  const token = jwt.sign(
    { sub: admin.id, username: admin.username, role: admin.role || 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
  setAdminCookie(res, token, 43200);
  return res.json({ ok: true, token });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const { sub, username } = req.user;
  let displayName = username;
  if (sub > 0) {
    const u = buscarAdminById(sub);
    if (u) displayName = u.nome || u.username;
  } else if (username && username.includes('@')) {
    displayName = username.split('@')[0];
  }
  res.json({ ok: true, nome: displayName, username });
});

// GET /api/auth/usuarios
// Fonte de verdade: Hub (data.site_permissions com papel='admin' para o
// sistema 'pesquisa-satisfacao'). Retorna apenas admins ATIVOS — quem
// ja logou no Hub alguma vez. Fallback para a tabela local admin_users
// se o Hub estiver indisponivel (mantem compat com seed inicial).
const HUB_URL = process.env.HUB_URL || 'https://hub-granmarquise.fly.dev';
router.get('/usuarios', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${HUB_URL}/api/hub/site-admins?sistema_id=pesquisa-satisfacao`, {
      headers: { Authorization: `Bearer ${process.env.SSO_SECRET}` },
    });
    if (!r.ok) throw new Error('hub indisponivel');
    const d = await r.json();
    if (!d.ok) throw new Error('hub erro');
    // Filtra: so admins ATIVOS (que ja logaram pelo Hub).
    const items = (d.items || []).filter(x => x.ativo).map(x => ({
      // mapeia para o formato esperado pelo front
      id: x.email,                  // usa email como id (string)
      username: x.email,
      nome: x.nome || x.email,
      role: x.is_master ? 'master' : 'admin',
      ativo: true,
      ultimo_login: x.ultimo_login,
      created_at: x.ultimo_login,   // melhor proxy disponivel
    }));
    return res.json({ ok: true, items });
  } catch {
    // Fallback: lista local da tabela admin_users (compat).
    return res.json({ ok: true, items: listarAdmins() });
  }
});

// POST /api/auth/usuarios
router.post('/usuarios', requireAuth, requireMaster, (req, res) => {
  const { username, nome, role = 'admin' } = req.body || {};
  if (!username?.trim())
    return res.status(400).json({ ok: false, error: 'Usuário obrigatório' });
  if (!ROLES_VALIDOS.includes(role))
    return res.status(400).json({ ok: false, error: 'Perfil inválido' });
  if (buscarAdmin(username.trim()))
    return res.status(409).json({ ok: false, error: 'Usuário já existe' });
  const defaultPass = process.env.ADMIN_PASS || 'TrocarEmProducao!';
  const hash = bcrypt.hashSync(defaultPass, 10);
  const id = inserirAdmin(username.trim(), hash, nome?.trim() || null, role);
  res.status(201).json({ ok: true, id });
});

// PUT /api/auth/usuarios/:id
router.put('/usuarios/:id', requireAuth, requireMaster, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });
  const existing = buscarAdminById(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Não encontrado' });

  const { username, nome, role = existing.role || 'admin' } = req.body || {};
  if (!username?.trim()) return res.status(400).json({ ok: false, error: 'Usuário obrigatório' });
  if (!ROLES_VALIDOS.includes(role)) return res.status(400).json({ ok: false, error: 'Perfil inválido' });

  const outro = buscarAdmin(username.trim());
  if (outro && outro.id !== id)
    return res.status(409).json({ ok: false, error: 'Nome de usuário já está em uso' });

  atualizarAdmin(id, { nome: nome?.trim() || null, username: username.trim(), passwordHash: null, role });
  res.json({ ok: true });
});

// DELETE /api/auth/usuarios/:id
router.delete('/usuarios/:id', requireAuth, requireMaster, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });
  const meId = req.user?.sub;
  if (id === meId) return res.status(400).json({ ok: false, error: 'Não é possível remover sua própria conta' });
  const total = listarAdmins().length;
  if (total <= 1) return res.status(400).json({ ok: false, error: 'Não é possível remover o único usuário' });
  const changes = deletarAdmin(id);
  if (!changes) return res.status(404).json({ ok: false, error: 'Não encontrado' });
  res.json({ ok: true });
});

export default router;
