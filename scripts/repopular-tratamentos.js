#!/usr/bin/env node
/**
 * Repopula a tabela tipos_massagem com o catálogo default Gran SPA L'Occitane,
 * removendo a flag 'tipos_massagem_seeded' antes (gravada pelo reset-completo).
 *
 * Uso:
 *   node scripts/repopular-tratamentos.js              # dry-run
 *   node scripts/repopular-tratamentos.js --apply      # aplica
 */

import 'dotenv/config';
import { getDb, initDb, seedTratamentosGranSpa } from '../src/db.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  initDb();
  const db = getDb();

  const antes = db.prepare("SELECT COUNT(*) AS n FROM tipos_massagem").get().n;
  const flag = db.prepare("SELECT valor FROM system_meta WHERE chave='tipos_massagem_seeded'").get();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' REPOPULAR TRATAMENTOS — ' + (APPLY ? 'APLICANDO' : 'DRY-RUN'));
  console.log('═══════════════════════════════════════════════════════');
  console.log('  tipos_massagem antes...........: ' + antes);
  console.log('  flag tipos_massagem_seeded.....: ' + (flag ? flag.valor : '(ausente)'));

  if (!APPLY) {
    console.log('\n▶ Para aplicar: node scripts/repopular-tratamentos.js --apply\n');
    process.exit(0);
  }

  // Apaga a flag e roda o seed que está exportado em db.js
  db.prepare("DELETE FROM system_meta WHERE chave='tipos_massagem_seeded'").run();
  seedTratamentosGranSpa();

  const depois = db.prepare("SELECT COUNT(*) AS n FROM tipos_massagem").get().n;
  const flagFinal = db.prepare("SELECT valor FROM system_meta WHERE chave='tipos_massagem_seeded'").get();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' CONCLUÍDO');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  tipos_massagem depois..........: ' + depois);
  console.log('  flag re-marcada................: ' + (flagFinal ? 'sim' : 'NÃO'));
  console.log('\n  Os tratamentos já aparecem no autocomplete de "Nova Reserva"');
  console.log('  via /api/tipos-massagem-ativos.\n');
}

main().catch(e => { console.error('Erro:', e); process.exit(1); });
