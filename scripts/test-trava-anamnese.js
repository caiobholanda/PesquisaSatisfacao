// Teste integrado da trava "link de uso unico" da anamnese.
// Roda contra data/feedback.db usando reservas de teste taggeadas (cleanup ao fim).
// Cobre os 8 cenarios da spec em 3 passagens.
//
// Uso: node scripts/test-trava-anamnese.js
import { getDb, initDb, gerarDocumentoToken, buscarDocumentoToken, inserirSpaPerfilComLock, vincularDocumentoToken } from '../src/db.js';

initDb();
const db = getDb();

// Tag unica para limpar depois — qualquer reserva com este prefixo sera removida.
const TAG = `__TEST_TRAVA_${Date.now()}_`;

function cleanup() {
  try {
    // Apaga spa_perfis vinculados as reservas de teste
    db.prepare(`DELETE FROM spa_perfis WHERE reserva_id IN (SELECT id FROM reservas WHERE cliente LIKE ?)`).run(TAG + '%');
    db.prepare(`DELETE FROM reservas WHERE cliente LIKE ?`).run(TAG + '%');
  } catch (e) {
    console.error('Cleanup warn:', e.message);
  }
}

function criarReservaTeste(nome) {
  // Insere reserva minima usando colunas obrigatorias (ver schema reservas).
  // Schema: id, cliente, email, telefone, data, hora_inicio, hora_fim, sala, tratamento, ...
  const cliente = TAG + nome;
  const r = db.prepare(`
    INSERT INTO reservas (cliente, email, telefone, data, hora_inicio, hora_fim, sala, tratamento, tipo_cliente)
    VALUES (?, 'teste@teste.com', '+5585999990000', date('now'), '10:00', '11:00', 1, 'Teste', 'hospede')
  `).run(cliente);
  return r.lastInsertRowid;
}

function payloadBase(reservaId, pessoa, locale = 'pt-BR') {
  return {
    nome: 'Teste',
    sobrenome: 'Trava',
    tipo_documento: 'cpf',
    documento: '12345678901',
    email: 'teste@teste.com',
    telefone: '+5585999990000',
    data_nascimento: '1990-01-01',
    rotina_facial: null,
    rotina_corporal: null,
    produto_especifico: null,
    pressao_massagem: 'media',
    info_medica: 'nenhuma',
    consentimento_saude: 1,
    consentimento_marketing: 0,
    canais_marketing: null,
    assinatura_data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    idioma: locale,
    reserva_id: reservaId,
    pessoa,
  };
}

const resultados = []; // {pass, cenario, ok, detalhe}

function reg(pass, cen, ok, detalhe) {
  resultados.push({ pass, cenario: cen, ok, detalhe });
  const flag = ok ? 'PASS' : 'FAIL';
  console.log(`[P${pass}][C${cen}] ${flag}  ${detalhe}`);
}

async function rodarPassagem(pass) {
  console.log(`\n=== PASSAGEM ${pass} ===`);

  // === Cenario 1: link novo -> envia -> sucesso ===
  {
    const rid = criarReservaTeste('c1_' + pass);
    const token = gerarDocumentoToken(rid, 1);
    const row1 = buscarDocumentoToken(token);
    const ok = row1 && row1.reserva_id === rid && row1.pessoa === 1 && row1.ja_respondida === false;
    reg(pass, 1, ok, `GET pre-submit ja_respondida=${row1?.ja_respondida}`);

    let okSubmit = false;
    try {
      const perfilId = inserirSpaPerfilComLock(payloadBase(rid, 1, 'pt-BR'));
      okSubmit = !!perfilId;
    } catch (e) { okSubmit = false; }
    reg(pass, '1b', okSubmit, 'POST submit primeira vez');
  }

  // === Cenario 2: reabrir link respondido -> ja_respondida ===
  // Replica o fluxo real do handler: locale e gravado via vincularDocumentoToken
  // ANTES do inserirSpaPerfilComLock (spa.js linha "if (locale) vincularDocumentoToken(...)").
  {
    const rid = criarReservaTeste('c2_' + pass);
    const token = gerarDocumentoToken(rid, 1);
    vincularDocumentoToken(rid, 'en');
    inserirSpaPerfilComLock(payloadBase(rid, 1, 'en'));
    const row = buscarDocumentoToken(token);
    const ok = row && row.ja_respondida === true && row.locale === 'en';
    reg(pass, 2, ok, `ja_respondida=${row?.ja_respondida} locale=${row?.locale}`);
  }

  // === Cenario 3: preencher pela metade, fechar, reabrir -> aceita ===
  // (Sem submit = sem trava. GET deve continuar retornando form.)
  {
    const rid = criarReservaTeste('c3_' + pass);
    const token = gerarDocumentoToken(rid, 1);
    // Simula "abrir e fechar sem enviar"
    const row1 = buscarDocumentoToken(token);
    const row2 = buscarDocumentoToken(token); // reabrir
    const ok = row1.ja_respondida === false && row2.ja_respondida === false;
    reg(pass, 3, ok, 'reabrir sem enviar continua aceito');
  }

  // === Cenario 4: toque duplo (2 envios sequenciais rapidos) ===
  {
    const rid = criarReservaTeste('c4_' + pass);
    gerarDocumentoToken(rid, 1);
    let ok1 = false, jaSegundo = false;
    try { inserirSpaPerfilComLock(payloadBase(rid, 1)); ok1 = true; } catch (e) {}
    try { inserirSpaPerfilComLock(payloadBase(rid, 1)); } catch (e) { jaSegundo = (e.message === 'ANAMNESE_JA_RESPONDIDA'); }
    const linhasSpa = db.prepare('SELECT COUNT(*) c FROM spa_perfis WHERE reserva_id=?').get(rid).c;
    const ok = ok1 && jaSegundo && linhasSpa === 1;
    reg(pass, 4, ok, `1o ok=${ok1}, 2o ja_respondida=${jaSegundo}, linhas_spa=${linhasSpa}`);
  }

  // === Cenario 5: envios concorrentes via Promise.all ===
  // better-sqlite3 e sincrono entao a "concorrencia" se reduz a serializar
  // no event loop, mas o teste valida que duas chamadas seguidas (mesmo
  // disparadas como promises) so deixam 1 vencer.
  {
    const rid = criarReservaTeste('c5_' + pass);
    gerarDocumentoToken(rid, 1);
    const results = await Promise.allSettled([
      Promise.resolve().then(() => inserirSpaPerfilComLock(payloadBase(rid, 1))),
      Promise.resolve().then(() => inserirSpaPerfilComLock(payloadBase(rid, 1))),
    ]);
    const ok1 = results.filter(r => r.status === 'fulfilled').length;
    const ok2 = results.filter(r => r.status === 'rejected' && r.reason?.message === 'ANAMNESE_JA_RESPONDIDA').length;
    const linhasSpa = db.prepare('SELECT COUNT(*) c FROM spa_perfis WHERE reserva_id=?').get(rid).c;
    const ok = ok1 === 1 && ok2 === 1 && linhasSpa === 1;
    reg(pass, 5, ok, `fulfilled=${ok1}, rejected_jaresp=${ok2}, linhas_spa=${linhasSpa}`);
  }

  // === Cenario 6: simular POST direto com token usado ===
  // Reproduz exatamente o caminho do handler: buscarDocumentoToken -> if ja_respondida -> 409
  {
    const rid = criarReservaTeste('c6_' + pass);
    const token = gerarDocumentoToken(rid, 1);
    inserirSpaPerfilComLock(payloadBase(rid, 1));
    const rowReuse = buscarDocumentoToken(token);
    const ok = rowReuse && rowReuse.ja_respondida === true;
    reg(pass, 6, ok, `token reusado seria recusado em /perfil (ja_respondida=${rowReuse?.ja_respondida})`);
  }

  // === Cenario 7: expiry 48h - nao regrediu ===
  // Modo temp esta ativo: buscarDocumentoToken NAO valida expiry. Confirmar.
  {
    const rid = criarReservaTeste('c7_' + pass);
    const token = gerarDocumentoToken(rid, 1);
    // Forca expiry no passado
    db.prepare('UPDATE reservas SET documento_token_expiry=? WHERE id=?').run('2020-01-01T00:00:00.000Z', rid);
    const row = buscarDocumentoToken(token);
    const ok = !!row && row.ja_respondida === false; // ainda aceito (modo temp)
    reg(pass, 7, ok, `expiry no passado mas modo-temp aceita (row=${!!row}, ja_resp=${row?.ja_respondida})`);
  }

  // === Cenario 8: locale do link e' preservado em ja_respondida ===
  // Confirma que buscarDocumentoToken retorna locale correto para os 7 idiomas.
  {
    const locales = ['pt-BR', 'pt-PT', 'en', 'fr', 'es', 'it', 'de'];
    let okAll = true;
    const detalhes = [];
    for (const loc of locales) {
      const rid = criarReservaTeste(`c8_${loc}_${pass}`);
      const token = gerarDocumentoToken(rid, 1);
      // Grava locale na reserva
      db.prepare('UPDATE reservas SET idioma_documento=? WHERE id=?').run(loc, rid);
      inserirSpaPerfilComLock(payloadBase(rid, 1, loc));
      const row = buscarDocumentoToken(token);
      const ok = row && row.ja_respondida === true && row.locale === loc;
      detalhes.push(`${loc}=${ok ? 'ok' : 'FAIL(' + row?.locale + ')'}`);
      if (!ok) okAll = false;
    }
    reg(pass, 8, okAll, detalhes.join(' '));
  }

  // === Cenario extra: casal (pessoa 2) — verificar que pessoa 1 e 2 sao independentes ===
  {
    const rid = criarReservaTeste('cas_' + pass);
    // Adiciona cliente2 pra simular casal
    db.prepare('UPDATE reservas SET cliente2=?, email2=? WHERE id=?').run(TAG + 'P2_' + pass, 'p2@teste.com', rid);
    const t1 = gerarDocumentoToken(rid, 1);
    const t2 = gerarDocumentoToken(rid, 2);
    // Pessoa 1 envia
    inserirSpaPerfilComLock(payloadBase(rid, 1));
    const r1 = buscarDocumentoToken(t1);
    const r2 = buscarDocumentoToken(t2);
    const ok = r1.ja_respondida === true && r2.ja_respondida === false;
    reg(pass, 'casal', ok, `pessoa1_resp=${r1.ja_respondida}, pessoa2_resp=${r2.ja_respondida}`);
    // Pessoa 2 envia
    inserirSpaPerfilComLock(payloadBase(rid, 2));
    const r2b = buscarDocumentoToken(t2);
    reg(pass, 'casal_p2', r2b.ja_respondida === true, `apos enviar p2, ja_respondida=${r2b.ja_respondida}`);
  }
}

(async () => {
  try {
    for (let p = 1; p <= 3; p++) await rodarPassagem(p);

    // Tabela final
    console.log('\n\n=== TABELA DE RESULTADOS ===');
    console.log('Passagem | Cenario | Status');
    console.log('---------|---------|--------');
    for (const r of resultados) {
      console.log(`P${r.pass}       | C${r.cenario}     | ${r.ok ? 'PASS' : 'FAIL'}`);
    }
    const total = resultados.length;
    const ok = resultados.filter(r => r.ok).length;
    console.log(`\nTotal: ${ok}/${total} OK`);
    if (ok !== total) {
      console.log('\nFALHAS:');
      resultados.filter(r => !r.ok).forEach(r => console.log(`  P${r.pass} C${r.cenario}: ${r.detalhe}`));
      process.exitCode = 1;
    }
  } finally {
    cleanup();
    console.log('\nCleanup feito.');
  }
})();
