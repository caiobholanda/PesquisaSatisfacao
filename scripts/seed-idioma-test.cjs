// Cria 2 feedbacks de teste em idioma 'en' pra auditor validar regra
// bilíngue/não-bilíngue da Parte 4/5 (D/E).
// Rodar:
//   cat scripts/seed-idioma-test.cjs | flyctl ssh console -a pesquisa-satisfacao -C "node --input-type=commonjs"
// Rollback:
//   flyctl ssh console -a pesquisa-satisfacao -C "node --input-type=commonjs" <<< "require('better-sqlite3')('/app/data/feedback.db').prepare(\"DELETE FROM feedback WHERE nome LIKE 'TESTE AUDITORIA IDIOMA%'\").run()"

const Database = require('better-sqlite3');
const db = new Database('/app/data/feedback.db');

const ANTONIA = 'ANTONIA ANA CRISTINA SAMPAIO DE SOUSA';
const GERMANA = 'GERMANA LIMA DA SILVA';

const submitted_at = new Date().toISOString();

const insert = db.prepare(`
  INSERT INTO feedback (
    nome, email, apto, tratamento_realizado, nome_massoterapeuta,
    servicos_expectativa, servicos_explicacao, servicos_atitude, servicos_tecnica,
    instalacoes_conforto, instalacoes_organizacao, instalacoes_conveniencia,
    recomenda, tipo_cliente, origem,
    submitted_at, idioma_detectado
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const out = [];

// ANTONIA (não-bilíngue): exercita exclusão de servicos_explicacao
const r1 = insert.run(
  'TESTE AUDITORIA IDIOMA (P1)', 'teste-auditoria@noemail.local', '0000', 'Teste auditoria EN', ANTONIA,
  'otimo', 'otimo', 'otimo', 'otimo',
  'otimo', 'otimo', 'otimo',
  'sim', 'hospede', 'auditoria-test',
  submitted_at, 'en'
);
out.push({ massagista: ANTONIA, bilingue: false, idioma: 'en', feedback_id: r1.lastInsertRowid });

// GERMANA (bilíngue): confirma que NADA é excluído
const r2 = insert.run(
  'TESTE AUDITORIA IDIOMA (P2)', 'teste-auditoria@noemail.local', '0000', 'Teste auditoria ES', GERMANA,
  'bom', 'bom', 'bom', 'bom',
  'bom', 'bom', 'bom',
  'sim', 'hospede', 'auditoria-test',
  submitted_at, 'es'
);
out.push({ massagista: GERMANA, bilingue: true, idioma: 'es', feedback_id: r2.lastInsertRowid });

console.log(JSON.stringify({ ok: true, seeded: out }, null, 2));
