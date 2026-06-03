import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { buscarAdmin, buscarAdminById, listarAdmins, inserirAdmin, atualizarAdmin, deletarAdmin } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

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
  return res.json({ ok: true, token });
});

// GET /api/auth/usuarios
router.get('/usuarios', requireAuth, (req, res) => {
  res.json({ ok: true, items: listarAdmins() });
});

// POST /api/auth/usuarios
router.post('/usuarios', requireAuth, (req, res) => {
  const { username, senha, nome, role = 'admin' } = req.body || {};
  if (!username?.trim() || !senha)
    return res.status(400).json({ ok: false, error: 'Usuário e senha obrigatórios' });
  if (!senhaForte(senha))
    return res.status(400).json({ ok: false, error: 'Senha fraca: mín. 8 chars, maiúscula, número e caractere especial' });
  if (!ROLES_VALIDOS.includes(role))
    return res.status(400).json({ ok: false, error: 'Perfil inválido' });
  if (buscarAdmin(username.trim()))
    return res.status(409).json({ ok: false, error: 'Usuário já existe' });
  const hash = bcrypt.hashSync(senha, 10);
  const id = inserirAdmin(username.trim(), hash, nome?.trim() || null, role);
  res.status(201).json({ ok: true, id });
});

// PUT /api/auth/usuarios/:id
router.put('/usuarios/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });
  const existing = buscarAdminById(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Não encontrado' });

  const { username, senha, nome, role = existing.role || 'admin' } = req.body || {};
  if (!username?.trim()) return res.status(400).json({ ok: false, error: 'Usuário obrigatório' });
  if (!ROLES_VALIDOS.includes(role)) return res.status(400).json({ ok: false, error: 'Perfil inválido' });

  // Verifica unicidade do username (excluindo o próprio)
  const outro = buscarAdmin(username.trim());
  if (outro && outro.id !== id)
    return res.status(409).json({ ok: false, error: 'Nome de usuário já está em uso' });

  let passwordHash = null;
  if (senha) {
    if (!senhaForte(senha))
      return res.status(400).json({ ok: false, error: 'Senha fraca: mín. 8 chars, maiúscula, número e caractere especial' });
    passwordHash = bcrypt.hashSync(senha, 10);
  }

  atualizarAdmin(id, { nome: nome?.trim() || null, username: username.trim(), passwordHash, role });
  res.json({ ok: true });
});

// DELETE /api/auth/usuarios/:id
router.delete('/usuarios/:id', requireAuth, (req, res) => {
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
