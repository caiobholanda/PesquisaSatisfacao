#!/usr/bin/env node
/**
 * Zera perguntas e tratamentos para permitir cadastro a partir do zero.
 *
 * Apaga:
 *   - pergunta_opcao_traducao, pergunta_opcao
 *   - pergunta_traducao, pergunta_satisfacao
 *   - pesquisa_pergunta (associações)
 *   - meta_pergunta (metas por pergunta)
 *   - tipos_massagem
 *
 * Preserva: pesquisa, pesquisa_secao + traduções, escala + escala_opcao,
 * reservas, spa_perfis, feedback, clientes, resposta_pesquisa,
 * resposta_item, massagistas. Re-seed automático NÃO ocorre porque os
 * seeds checam existência da `pesquisa` antes de inserir.
 *
 * Uso:
 *   node scripts/reset-perguntas-tratamentos.js              # dry-run
 *   node scripts/reset-perguntas-tratamentos.js --apply      # aplica
 */

import 'dotenv/config';
import { getDb, initDb } from '../src/db.js';

const APPLY = process.argv.includes('--apply');

function count(db, sql) { return db.prepare(sql).get().n; }

async function main() {
  initDb();
  const db = getDb();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' RESET DE PERGUNTAS E TRATAMENTOS — ' + (APPLY ? 'APLICANDO' : 'DRY-RUN'));
  console.log('═══════════════════════════════════════════════════════\n');

  const antes = {
    pergunta_opcao_traducao: count(db, "SELECT COUNT(*) AS n FROM pergunta_opcao_traducao"),
    pergunta_opcao:          count(db, "SELECT COUNT(*) AS n FROM pergunta_opcao"),
    pergunta_traducao:       count(db, "SELECT COUNT(*) AS n FROM pergunta_traducao"),
    pergunta_satisfacao:     count(db, "SELECT COUNT(*) AS n FROM pergunta_satisfacao"),
    pesquisa_pergunta:       count(db, "SELECT COUNT(*) AS n FROM pesquisa_pergunta"),
    meta_pergunta:           count(db, "SELECT COUNT(*) AS n FROM meta_pergunta"),
    tipos_massagem:          count(db, "SELECT COUNT(*) AS n FROM tipos_massagem"),
  };

  console.log('ANTES (linhas a apagar):');
  for (const [k, v] of Object.entries(antes)) console.log(`  ${k.padEnd(28)} ${v}`);

  // Stats preservadas (mostra que NÃO vamos tocar):
  console.log('\nPRESERVADAS (apenas referência, não serão tocadas):');
  for (const t of ['pesquisa', 'pesquisa_secao', 'escala', 'escala_opcao', 'reservas', 'spa_perfis', 'feedback', 'clientes', 'resposta_pesquisa', 'massagistas']) {
    try { console.log(`  ${t.padEnd(28)} ${count(db, `SELECT COUNT(*) AS n FROM ${t}`)}`); } catch {}
  }

  if (!APPLY) {
    console.log('\n▶ Para aplicar: node scripts/reset-perguntas-tratamentos.js --apply\n');
    process.exit(0);
  }

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM pergunta_opcao_traducao").run();
    db.prepare("DELETE FROM pergunta_opcao").run();
    db.prepare("DELETE FROM pesquisa_pergunta").run();
    db.prepare("DELETE FROM meta_pergunta").run();
    db.prepare("DELETE FROM pergunta_traducao").run();
    db.prepare("DELETE FROM pergunta_satisfacao").run();
    db.prepare("DELETE FROM tipos_massagem").run();
    // Marca flag para impedir re-seed automático em restart.
    db.prepare(`INSERT OR REPLACE INTO system_meta (chave, valor)
                VALUES ('tipos_massagem_seeded','1')`).run();
  });
  tx();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' CONCLUÍDO');
  console.log('═══════════════════════════════════════════════════════');
  console.log('Perguntas, opções, associações, metas por pergunta e');
  console.log('tipos de massagem foram apagados. Pesquisas e seções');
  console.log('continuam existindo (vazias) — agora popule pela UI.\n');
}

main().catch(e => { console.error('Erro:', e); process.exit(1); });
