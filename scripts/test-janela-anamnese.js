// Teste da janela de envio de anamnese:
// admin so' pode gerar ficha ate' 10min APOS hora_inicio.
// Replica a logica do gate em src/routes/reservas.js (gerar-ficha) usando
// o mesmo calculo de timestamp (UTC-3 Fortaleza fixo).
//
// Uso: node scripts/test-janela-anamnese.js

// Replica _normalizarHHMM do backend pra cobrir os mesmos casos.
function normalizarHHMM(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = String(+m[1]).padStart(2, '0');
  const mi = m[2];
  if (+h > 23 || +mi > 59) return null;
  return `${h}:${mi}`;
}

function estaDentroDaJanela(data, hora_inicio, agora = Date.now()) {
  if (!data || !hora_inicio) return true; // sem data -> sem gate
  const hhmm = normalizarHHMM(hora_inicio);
  if (!hhmm) return true; // fail-open intencional
  const inicio = new Date(`${data}T${hhmm}:00-03:00`).getTime();
  if (!Number.isFinite(inicio)) return true;
  return agora <= inicio + 10 * 60 * 1000;
}

// Helper: gera "agora" relativo a um inicio fixo
function agoraOffset(inicioISO, offsetMin) {
  const base = new Date(inicioISO).getTime();
  return base + offsetMin * 60 * 1000;
}

const cenarios = [
  // [descricao, data, hora_inicio, offset_min_apos_inicio, esperado_dentro]
  ['agendamento daqui 30min (futuro)',     '2026-06-25', '20:00', -30, true],
  ['exatamente no hora_inicio',            '2026-06-25', '13:00',   0, true],
  ['5min apos hora_inicio (dentro 10min)', '2026-06-25', '13:00',   5, true],
  ['10min apos hora_inicio (limite)',      '2026-06-25', '13:00',  10, true],
  ['11min apos hora_inicio (fora)',        '2026-06-25', '13:00',  11, false],
  ['1h apos hora_inicio (fora)',           '2026-06-25', '13:00',  60, false],
  ['data sem hora_inicio',                 '2026-06-25', '',        0, true], // sem gate
  ['hora_inicio invalido',                 '2026-06-25', 'INVALID', 5, true], // graceful
  // Dados sujos no banco — normalizacao
  ['hora_inicio legado "9:30" (sem pad)',  '2026-06-25', '9:30',   -5, true],  // antes do limite
  ['hora_inicio legado "9:30" expirado',   '2026-06-25', '9:30',   15, false], // depois +10min
  ['hora_inicio "13:00:00" (HH:MM:SS)',    '2026-06-25', '13:00:00', 5, true], // normaliza
  ['hora_inicio "13:00:00" expirado',      '2026-06-25', '13:00:00', 15, false],
  ['hora invalido "25:00"',                '2026-06-25', '25:00',   0, true], // null -> fail-open
];

let ok = 0, fail = 0;
const linhas = [];
for (const [desc, data, hora, offset, esperado] of cenarios) {
  // Normaliza pra construir o "agora" — se nao normalizar, o teste com
  // "9:30" ou "13:00:00" tem Invalid Date no helper e a comparacao fica
  // sem sentido. Quando o input e' invalido pra normalizacao (ex: "25:00"
  // ou "INVALID"), usa-se a data sem offset como referencia.
  const hhmm = normalizarHHMM(hora) || '00:00';
  const inicioISO = `${data}T${hhmm}:00-03:00`;
  const agora = agoraOffset(inicioISO, offset);
  const got = estaDentroDaJanela(data, hora, agora);
  const pass = got === esperado;
  if (pass) ok++; else fail++;
  linhas.push(`[${pass ? 'PASS' : 'FAIL'}] ${desc} -> ${got} (esperado ${esperado})`);
}

console.log('=== Janela de envio anamnese (gerar-ficha) ===');
console.log('Regra: aceitar ate hora_inicio + 10min (UTC-3 Fortaleza)\n');
linhas.forEach(l => console.log(l));
console.log(`\nTotal: ${ok}/${cenarios.length} OK`);
if (fail) process.exitCode = 1;

// Sanity check do calculo de TZ: 13:00 BRT (UTC-3) == 16:00 UTC
const t13brt = new Date('2026-06-25T13:00:00-03:00');
const t16utc = new Date('2026-06-25T16:00:00Z');
console.log(`\nSanity TZ: 13:00 BRT (${t13brt.toISOString()}) == 16:00 UTC (${t16utc.toISOString()}) -> ${t13brt.getTime() === t16utc.getTime() ? 'OK' : 'FAIL'}`);
