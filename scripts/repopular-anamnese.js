#!/usr/bin/env node
/**
 * Apaga a flag 'pesquisas_seeded' (gravada pelo reset-completo) e re-roda
 * o seed das pesquisas configuráveis (spa-locc-v1 + spa-anamnese-v1).
 * Não toca em respostas, reservas ou clientes — apenas recria o esqueleto
 * das pesquisas/perguntas/opções.
 *
 * Uso:
 *   node scripts/repopular-anamnese.js              # dry-run
 *   node scripts/repopular-anamnese.js --apply
 */

import 'dotenv/config';
import { getDb, initDb } from '../src/db.js';
import { seedQualidadeSpa, seedAnamneseSpa, seedAnamneseOpcoes } from '../src/qualidade.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  initDb();
  const db = getDb();

  const antes = {
    pesquisas:           db.prepare('SELECT COUNT(*) AS n FROM pesquisa').get().n,
    perguntas:           db.prepare('SELECT COUNT(*) AS n FROM pergunta_satisfacao').get().n,
    pesquisa_pergunta:   db.prepare('SELECT COUNT(*) AS n FROM pesquisa_pergunta').get().n,
    pergunta_opcao:      db.prepare('SELECT COUNT(*) AS n FROM pergunta_opcao').get().n,
  };
  const flag = db.prepare("SELECT valor FROM system_meta WHERE chave='pesquisas_seeded'").get();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' REPOPULAR ANAMNESE — ' + (APPLY ? 'APLICANDO' : 'DRY-RUN'));
  console.log('═══════════════════════════════════════════════════════');
  console.log('  flag pesquisas_seeded....: ' + (flag ? flag.valor : '(ausente)'));
  for (const [k, v] of Object.entries(antes)) console.log('  ' + k.padEnd(22) + ': ' + v);

  if (!APPLY) {
    console.log('\n▶ Para aplicar: node scripts/repopular-anamnese.js --apply\n');
    process.exit(0);
  }

  db.prepare("DELETE FROM system_meta WHERE chave='pesquisas_seeded'").run();
  const a = seedQualidadeSpa();
  const b = seedAnamneseSpa();
  const c = seedAnamneseOpcoes();

  const depois = {
    pesquisas:           db.prepare('SELECT COUNT(*) AS n FROM pesquisa').get().n,
    perguntas:           db.prepare('SELECT COUNT(*) AS n FROM pergunta_satisfacao').get().n,
    pesquisa_pergunta:   db.prepare('SELECT COUNT(*) AS n FROM pesquisa_pergunta').get().n,
    pergunta_opcao:      db.prepare('SELECT COUNT(*) AS n FROM pergunta_opcao').get().n,
  };
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' CONCLUÍDO');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  seedQualidadeSpa()...: ' + (a ? 'executado' : 'pulado (já existia)'));
  console.log('  seedAnamneseSpa()....: ' + (b ? 'executado' : 'pulado (já existia)'));
  console.log('  seedAnamneseOpcoes().: ' + (c ? 'executado' : 'pulado'));
  for (const [k, v] of Object.entries(depois)) console.log('  ' + k.padEnd(22) + ': ' + v);
  console.log('');
}

main().catch(e => { console.error('Erro:', e); process.exit(1); });
