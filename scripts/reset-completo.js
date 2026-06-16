#!/usr/bin/env node
/**
 * RESET COMPLETO: zera todos os dados operacionais do sistema, preservando
 * APENAS o que é configuração de infraestrutura (admin_users, system_meta,
 * massagistas reais com matrícula).
 *
 * Apaga:
 *   - feedback, resposta_pesquisa, resposta_item, survey_tokens
 *   - pergunta_opcao_traducao, pergunta_opcao
 *   - pergunta_traducao, pergunta_satisfacao
 *   - pesquisa_pergunta, meta_pergunta, meta_questionario
 *   - pesquisa_secao_traducao, pesquisa_secao
 *   - pesquisa_traducao, pesquisa
 *   - escala_opcao_traducao, escala_opcao, escala
 *   - tipos_massagem
 *   - spa_perfis
 *   - reservas
 *   - cliente_produto, clientes
 *
 * Grava flags em system_meta para impedir re-seed em restart:
 *   - tipos_massagem_seeded
 *   - pesquisas_seeded
 *
 * Preserva: admin_users, massagistas, system_meta.
 *
 * Uso:
 *   node scripts/reset-completo.js              # dry-run
 *   node scripts/reset-completo.js --apply      # aplica
 */

import 'dotenv/config';
import { getDb, initDb } from '../src/db.js';

const APPLY = process.argv.includes('--apply');
const TABS_APAGAR = [
  // ordem importa: filhos antes de pais
  'resposta_item',
  'resposta_pesquisa',
  'feedback',
  'survey_tokens',
  'pergunta_opcao_traducao',
  'pergunta_opcao',
  'pesquisa_pergunta',
  'meta_pergunta',
  'meta_questionario',
  'pergunta_traducao',
  'pergunta_satisfacao',
  'pesquisa_secao_traducao',
  'pesquisa_secao',
  'pesquisa_traducao',
  'pesquisa',
  'escala_opcao_traducao',
  'escala_opcao',
  'escala',
  'tipos_massagem',
  'spa_perfis',
  'reservas',
  'cliente_produto',
  'clientes',
];

function count(db, t) {
  try { return db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; }
  catch { return null; }
}

async function main() {
  initDb();
  const db = getDb();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' RESET COMPLETO — ' + (APPLY ? 'APLICANDO' : 'DRY-RUN'));
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('ANTES — tabelas que serão APAGADAS:');
  let total = 0;
  for (const t of TABS_APAGAR) {
    const n = count(db, t);
    if (n !== null) { console.log(`  ${t.padEnd(28)} ${n}`); total += n; }
  }
  console.log(`  ${'TOTAL'.padEnd(28)} ${total}\n`);

  console.log('PRESERVADAS:');
  for (const t of ['admin_users', 'massagistas', 'system_meta']) {
    const n = count(db, t);
    if (n !== null) console.log(`  ${t.padEnd(28)} ${n}`);
  }

  if (!APPLY) {
    console.log('\n▶ Para aplicar: node scripts/reset-completo.js --apply\n');
    process.exit(0);
  }

  const tx = db.transaction(() => {
    // Desliga FKs para apagar em qualquer ordem com segurança
    db.pragma('foreign_keys = OFF');
    for (const t of TABS_APAGAR) {
      try { db.prepare(`DELETE FROM ${t}`).run(); } catch (e) { console.warn(`(skip ${t}: ${e.message})`); }
    }
    // Flags para bloquear re-seed em restarts futuros
    const upFlag = db.prepare("INSERT OR REPLACE INTO system_meta (chave, valor) VALUES (?, '1')");
    upFlag.run('tipos_massagem_seeded');
    upFlag.run('pesquisas_seeded');
    db.pragma('foreign_keys = ON');
  });
  tx();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' CONCLUÍDO — sistema zerado');
  console.log('═══════════════════════════════════════════════════════');
  console.log('Pesquisas, perguntas, escalas, seções, respostas,');
  console.log('reservas, clientes, anamneses e tratamentos foram');
  console.log('removidos. Massagistas e admins permanecem.\n');
  console.log('Para popular do zero pela UI:');
  console.log('  • /admin → Gestão da Qualidade → Pesquisas → + Nova');
  console.log('  • /admin → Spa → Tipos de Tratamento → +\n');
}

main().catch(e => { console.error('Erro:', e); process.exit(1); });
