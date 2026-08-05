import express from 'express';
import { requireAuth, requireMaster } from '../middleware/auth.js';

const router = express.Router();
const HUB_URL = 'https://hub-granmarquise.fly.dev';
const SISTEMA_ID = 'pesquisa-satisfacao';

router.get('/', requireAuth, requireMaster, async (_req, res) => {
  try {
    const r = await fetch(`${HUB_URL}/api/hub/site-admins?sistema_id=${SISTEMA_ID}`, {
      headers: { Authorization: `Bearer ${process.env.SSO_SECRET}` },
    });
    const d = await r.json();
    res.status(r.status).json(d);
  } catch {
    res.status(502).json({ ok: false, erro: 'Erro ao comunicar com Hub' });
  }
});

router.post('/', requireAuth, requireMaster, async (req, res) => {
  const { email, papel } = req.body || {};
  if (!email || !papel) return res.status(400).json({ ok: false, erro: 'email e papel obrigatorios' });
  try {
    const r = await fetch(`${HUB_URL}/api/hub/site-permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SSO_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, sistema_id: SISTEMA_ID, papel }),
    });
    const d = await r.json();
    res.status(r.status).json(d);
  } catch {
    res.status(502).json({ ok: false, erro: 'Erro ao comunicar com Hub' });
  }
});

router.delete('/', requireAuth, requireMaster, async (req, res) => {
  const email = (req.body && req.body.email) || req.query.email;
  if (!email) return res.status(400).json({ ok: false, erro: 'email obrigatorio' });
  try {
    const r = await fetch(
      `${HUB_URL}/api/hub/site-permissions?email=${encodeURIComponent(email)}&sistema_id=${SISTEMA_ID}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${process.env.SSO_SECRET}` },
      }
    );
    const d = await r.json();
    res.status(r.status).json(d);
  } catch {
    res.status(502).json({ ok: false, erro: 'Erro ao comunicar com Hub' });
  }
});

export default router;
