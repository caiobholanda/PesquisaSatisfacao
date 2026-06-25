// Script de teste pra criar 1 reserva DUO (Antonia + Germana) hoje,
// pro auditor validar D1 da Parte 2/5. Executar via:
//   flyctl ssh console -a pesquisa-satisfacao -C "node /app/scripts/seed-duo-test.js"
// Após validar, remover via:
//   flyctl ssh console -a pesquisa-satisfacao -C "node -e \"require('better-sqlite3')('/app/data/feedback.db').prepare('DELETE FROM reservas WHERE cliente=?').run('TESTE DUO AUDITORIA')\""

const Database = require('better-sqlite3');
const db = new Database('/app/data/feedback.db');

const ID_ANTONIA = 10;
const ID_GERMANA = 7;
const CLIENTE_TAG = 'TESTE DUO AUDITORIA';

const tipo = db.prepare(`SELECT id, nome, preco FROM tipos_massagem WHERE preco > 0 AND ativo = 1 ORDER BY preco DESC LIMIT 1`).get();
if (!tipo) { console.error('Nenhum tipo de massagem com preço cadastrado.'); process.exit(1); }

const hoje = new Date().toISOString().slice(0, 10);

// Procura slot livre HOJE entre 8h e 22h, em qualquer sala 1-5.
let slot = null;
for (let h = 8; h <= 21 && !slot; h++) {
  for (let sala = 1; sala <= 5 && !slot; sala++) {
    const ini = String(h).padStart(2, '0') + ':00';
    const fim = String(h + 1).padStart(2, '0') + ':00';
    const conflitoSala = db.prepare(`SELECT id FROM reservas WHERE data=? AND sala=? AND NOT (hora_fim <= ? OR hora_inicio >= ?)`).get(hoje, sala, ini, fim);
    const conflitoProf = db.prepare(`SELECT id FROM reservas WHERE data=? AND (massagista_id IN (?,?) OR massagista_id2 IN (?,?)) AND NOT (hora_fim <= ? OR hora_inicio >= ?)`).get(hoje, ID_ANTONIA, ID_GERMANA, ID_ANTONIA, ID_GERMANA, ini, fim);
    if (!conflitoSala && !conflitoProf) {
      slot = { sala, ini, fim };
    }
  }
}
if (!slot) { console.error('Nenhum slot livre hoje.'); process.exit(1); }

const result = db.prepare(`
  INSERT INTO reservas (sala, cliente, tipo_cliente, apto, tratamento, data, hora_inicio, hora_fim,
                        tipo_massagem_id, massagista_id,
                        cliente2, tipo_cliente2, apto2, tratamento2, tipo_massagem_id2, massagista_id2,
                        criado_por)
  VALUES (?, ?, 'hospede', '0000', ?, ?, ?, ?, ?, ?, ?, 'hospede', '0000', ?, ?, ?, 'audit-duo-seed')
`).run(
  slot.sala, CLIENTE_TAG + ' (P1)', tipo.nome, hoje, slot.ini, slot.fim, tipo.id, ID_ANTONIA,
  CLIENTE_TAG + ' (P2)', tipo.nome, tipo.id, ID_GERMANA
);

console.log(JSON.stringify({
  ok: true,
  reserva_id: result.lastInsertRowid,
  sala: slot.sala,
  hora: `${slot.ini}-${slot.fim}`,
  data: hoje,
  tipo: { id: tipo.id, nome: tipo.nome, preco: tipo.preco },
  massagista_id: ID_ANTONIA,
  massagista_id2: ID_GERMANA,
}, null, 2));
