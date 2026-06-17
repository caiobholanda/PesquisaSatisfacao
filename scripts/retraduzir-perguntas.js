#!/usr/bin/env node
// Re-traduz TODAS as perguntas ativas das pesquisas para os 7 idiomas.
// Usado uma vez após a migração da Anthropic API (sem crédito) para
// MyMemory: as 16 perguntas seed + extras tinham todas as traduções
// iguais ao pt-BR (fallback do utils/traduzir.js).
//
// Uso:
//   node scripts/retraduzir-perguntas.js              # dry-run
//   node scripts/retraduzir-perguntas.js --apply      # aplica

import Database from 'better-sqlite3';
import { traduzirParaTodos } from '../src/utils/traduzir.js';

const APPLY = process.argv.includes('--apply');
const DB_PATH = process.env.DB_PATH || '/app/data/feedback.db';

const db = new Database(DB_PATH);

console.log('═══ Re-traduzir perguntas ═══');
console.log('Modo:', APPLY ? 'APLICANDO' : 'DRY-RUN');
console.log('DB:', DB_PATH);

const ativas = db.prepare(`
  SELECT p.id, p.chave,
    (SELECT rotulo FROM pergunta_traducao WHERE pergunta_id=p.id AND idioma='pt-BR') AS rotulo_pt_br
  FROM pergunta_satisfacao p WHERE p.ativo=1
`).all();

console.log('Perguntas ativas:', ativas.length);

const upsert = db.prepare(`
  INSERT INTO pergunta_traducao (pergunta_id, idioma, rotulo, ajuda) VALUES (?,?,?,?)
  ON CONFLICT(pergunta_id, idioma) DO UPDATE SET rotulo=excluded.rotulo
`);

let okCount = 0, semFonte = 0;
for (const p of ativas) {
  if (!p.rotulo_pt_br) { semFonte++; continue; }
  process.stdout.write(`  #${p.id} "${p.rotulo_pt_br}" → `);
  const trads = await traduzirParaTodos(p.rotulo_pt_br);
  const amostra = Object.entries(trads).map(([k, v]) => `${k}:${v.slice(0,20)}`).join(' | ');
  console.log(amostra);
  if (APPLY) {
    for (const [idioma, rotulo] of Object.entries(trads)) {
      if (rotulo && rotulo !== p.rotulo_pt_br) {
        upsert.run(p.id, idioma, rotulo, null);
      }
    }
  }
  okCount++;
  await new Promise(r => setTimeout(r, 300)); // gentil com o MyMemory
}

console.log('\nResumo:');
console.log('  traduzidas:', okCount);
console.log('  sem fonte pt-BR:', semFonte);
if (!APPLY) console.log('\n▶ Para aplicar: node scripts/retraduzir-perguntas.js --apply');
