import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { initDb, listarMassagistas } from './db.js';
import feedbackRouter from './routes/feedback.js';
import authRouter from './routes/auth.js';
import cadastrosRouter from './routes/cadastros.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/massagistas-ativas', (_req, res) => {
  res.json({ nomes: listarMassagistas().filter(m => m.ativo).map(m => m.nome) });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), version: pkg.version });
});

app.use('/api/feedback', feedbackRouter);
app.use('/api/auth', authRouter);
app.use('/api', cadastrosRouter);

// Fallback SPA: admin.html para /admin
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    ok: false,
    error: process.env.NODE_ENV === 'production' ? 'Erro interno' : err.message,
  });
});

initDb();
app.listen(PORT, () => console.log(`[Gran SPA] Servidor rodando na porta ${PORT}`));
