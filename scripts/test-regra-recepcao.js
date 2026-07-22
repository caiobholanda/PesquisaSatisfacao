// Teste integrado da regra da recepção: sempre deve sobrar ≥1 massoterapeuta
// livre no intervalo. Roda contra data/feedback.db usando massagistas e
// reservas de teste taggeadas em data futura isolada (cleanup ao fim).
// Cobre os cenários da spec em 3 passagens.
//
// Uso: node scripts/test-regra-recepcao.js
import { getDb, initDb, inserirReserva, cancelarReserva, contarLivresIntervalo, avaliarRegraRecepcao, upsertTurno } from '../src/db.js';

initDb();
const db = getDb();

const TAG = `__TEST_RECEP_${Date.now()}_`;
const DATA = '2099-01-15'; // data isolada: turnos lançados só p/ as terapeutas de teste
                           // (escala "lancada" ⇒ demais massagistas = "não escalada no dia")

function criarMassagista(nome, funcao) {
  return db.prepare(`INSERT INTO massagistas (nome, ativo, funcao) VALUES (?, 1, ?)`)
    .run(TAG + nome, funcao).lastInsertRowid;
}

function reservar(sala, massagista_id, hi, hf, opts = {}) {
  return inserirReserva(sala, TAG + 'Cliente', 'passante', null, 'teste@teste.com',
    null, 'Teste', DATA, hi, hf, { massagista_id, ...opts });
}

let ids = {};
function setup() {
  ids.A = criarMassagista('Ana', 'Massoterapeuta');
  ids.B = criarMassagista('Bia', 'Massoterapeuta');
  ids.C = criarMassagista('Cris', 'Massoterapeuta');
  ids.R = criarMassagista('Rec', 'Recepcionista');
  for (const id of [ids.A, ids.B, ids.C]) upsertTurno(id, DATA, '09:00|22:00');
  // Recepcionista de FOLGA por padrão → recepção descoberta → regra ativa.
  // Cenários 3b/3c ligam o turno dela para testar a cobertura.
  upsertTurno(ids.R, DATA, 'X');
}

function cleanup() {
  try {
    db.prepare(`DELETE FROM reservas WHERE cliente LIKE ?`).run(TAG.slice(0, 13) + '%');
    db.prepare(`DELETE FROM reservas WHERE cliente LIKE '__TEST_RECEP_%'`).run();
    db.prepare(`DELETE FROM turno_massagista WHERE massagista_id IN (SELECT id FROM massagistas WHERE nome LIKE '__TEST_RECEP_%')`).run();
    db.prepare(`DELETE FROM massagistas WHERE nome LIKE '__TEST_RECEP_%'`).run();
  } catch (e) { console.error('Cleanup warn:', e.message); }
}

const resultados = [];
function check(pass, cenario, cond, detalhe = '') {
  resultados.push({ pass, cenario, ok: !!cond, detalhe });
  if (!cond) console.error(`  ✗ [p${pass}] ${cenario} ${detalhe}`);
}

function rodarPassagem(pass) {
  setup();
  try {
    const total = (hi, hf, ex) => contarLivresIntervalo(DATA, hi, hf, { excluirReservaId: ex || null }).total;
    const rr = (sel, hi, hf, ex) => avaliarRegraRecepcao(DATA, hi, hf, { selecionadas: sel, excluirReservaId: ex || null });

    // 1. 3 livres → agendar 1 OK (e recepcionista NUNCA conta como livre)
    check(pass, '1a. recepcionista fora da contagem', total('14:00', '15:00') === 3, `total=${total('14:00','15:00')}`);
    check(pass, '1b. 3 livres → agenda OK', rr([ids.A], '14:00', '15:00').viola === false);
    const resA = reservar(1, ids.A, '14:00', '15:00');

    // 2. 2 livres → agenda OK (sobra 1 pra recepção)
    check(pass, '2a. contagem caiu p/ 2', total('14:00', '15:00') === 2);
    check(pass, '2b. 2 livres → agenda OK', rr([ids.B], '14:00', '15:00').viola === false);
    const resB = reservar(2, ids.B, '14:00', '15:00');

    // 3. 1 livre → recusa (equivale ao 409 tipo:recepcao do POST)
    const v3 = rr([ids.C], '14:00', '15:00');
    check(pass, '3. última livre → viola', v3.viola === true && v3.total === 1, JSON.stringify(v3));

    // 4. override: com a flag o POST pula a regra e o INSERT persiste normalmente
    const resC = reservar(4, ids.C, '14:00', '15:00');
    check(pass, '4. override persiste', !!resC);
    cancelarReserva(resC);

    // 5. conta POR INTERVALO: mesma terapeuta bloqueada às 14h, livre às 16h
    check(pass, '5. intervalo independente (16h)', total('16:00', '17:00') === 3 && rr([ids.A], '16:00', '17:00').viola === false);

    // 6. casal consome 2: com 2 livres recusa; com 3 livres OK
    const resA18 = reservar(1, ids.A, '18:00', '19:00');
    const v6a = rr([ids.B, ids.C], '18:00', '19:00');
    check(pass, '6a. casal com 2 livres → viola', v6a.viola === true && v6a.total === 2, JSON.stringify(v6a));
    cancelarReserva(resA18);
    check(pass, '6b. casal com 3 livres → OK', rr([ids.B, ids.C], '18:00', '19:00').viola === false);
    const resCasal = reservar(3, ids.B, '18:00', '19:00', { massagista_id2: ids.C, cliente2: TAG + 'C2' });
    check(pass, '6c. casal consumiu 2 → sobrou 1', total('18:00', '19:00') === 1 && rr([ids.A], '18:00', '19:00').viola === true);

    // 7. corrida serializada: duas reservas disputando a penúltima livre — só a 1ª vence
    const res20 = reservar(1, ids.A, '20:00', '21:00'); // sobra B,C (2 livres)
    const req1 = rr([ids.B], '20:00', '21:00');
    check(pass, '7a. req1 vê 2 livres → OK', req1.viola === false);
    const resReq1 = reservar(2, ids.B, '20:00', '21:00');
    const req2 = rr([ids.C], '20:00', '21:00'); // reconta já vendo a reserva da req1
    check(pass, '7b. req2 reconta 1 livre → 409', req2.viola === true && req2.total === 1);

    // 8. edição não se auto-conflita: excluindo a própria reserva, A conta como livre
    const v8 = rr([ids.A], '14:00', '15:00', resA);
    check(pass, '8a. edição exclui a própria reserva', v8.viola === false && v8.total === 2, JSON.stringify(v8));
    const v8b = rr([ids.A], '14:00', '15:00'); // sem excluir: A ocupada → não é violação DESTA regra (CONFLITO_PROF aponta)
    check(pass, '8b. selecionada ocupada → deixa CONFLITO_PROF apontar', v8b.viola === false);

    // 9. cancelamento libera na hora
    cancelarReserva(resB);
    check(pass, '9. cancelou → voltou a contar', total('14:00', '15:00') === 2);

    // 10. fronteira: reserva 14–15 não conflita com intervalo 15–16
    check(pass, '10. fronteira de horário', total('15:00', '16:00') === 3);

    // 11. zero livres (fora do turno): selecionada não-livre → sem falso 409 de recepção
    const v11 = rr([ids.A], '08:00', '08:30');
    check(pass, '11. 0 livres → escala/conflito aponta, não a recepção', v11.total === 0 && v11.viola === false);

    cancelarReserva(resA); cancelarReserva(resCasal); cancelarReserva(res20); cancelarReserva(resReq1);
  } finally {
    cleanup();
  }
}

for (let p = 1; p <= 3; p++) rodarPassagem(p);

const falhas = resultados.filter(r => !r.ok);
console.log('\npassagem | cenário | resultado');
for (const r of resultados) console.log(`p${r.pass} | ${r.cenario} | ${r.ok ? 'OK' : 'FALHOU ' + r.detalhe}`);
console.log(`\n${resultados.length - falhas.length}/${resultados.length} OK`);
process.exit(falhas.length ? 1 : 0);
