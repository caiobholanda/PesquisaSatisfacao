import jwt from 'jsonwebtoken';

// Encaminhamento fire-and-forget de respostas para o GestaoQualidade
// (centralização das pesquisas). Nunca lança: falha aqui não pode
// afetar a submissão pública do hóspede.
// Em dev só encaminha se GQ_URL estiver definida explicitamente.
const GQ_URL = (process.env.GQ_URL
  || (process.env.NODE_ENV === 'production' ? 'https://gestao-qualidade-granmarquise.fly.dev' : ''))
  .replace(/\/$/, '');
const SSO_SECRET = process.env.SSO_SECRET;

export function encaminharParaGQ({ feedbackId, body, submittedAt }) {
  if (!GQ_URL || !SSO_SECRET) return;
  try {
    const token = jwt.sign({ app: 'spa' }, SSO_SECRET, { algorithm: 'HS256', expiresIn: '2m' });
    const payload = { ...body };
    delete payload.survey_token; // token de acesso é interno do SPA
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    fetch(`${GQ_URL}/api/ingest/resposta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        tipo: 'spa',
        fonte_id: String(feedbackId),
        submitted_at: submittedAt,
        inserido_por: body?.inserido_por || null,
        payload,
      }),
      signal: ctrl.signal,
    })
      .then(r => { if (!r.ok) console.warn('[GQ-forward] status', r.status); })
      .catch(err => console.warn('[GQ-forward] falhou:', err?.message))
      .finally(() => clearTimeout(timer));
  } catch (err) {
    console.warn('[GQ-forward] erro:', err?.message);
  }
}
