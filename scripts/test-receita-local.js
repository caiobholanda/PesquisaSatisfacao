// Sanity test local da feature de receita. Imprime totais por mes para
// cada massagista e compara com totais conhecidos da planilha.
import { initDb, seedReceitaTerapias, listarMassagistas, calcularComissaoPorMes } from '../src/db.js';

initDb();
seedReceitaTerapias();

const ESPERADO = {
  // Da analise da planilha: { mes: { nome: [qty, receita_aprox] } }
  1: { GERMANA:[31,15135], CRISTINA:[32,15104], MAYARA:[34,14326], VAL:[28,12607], KAROL:[23,14624], ISADORA:[32,14556] },
  2: { GERMANA:[27,11640], CRISTINA:[30,12776], MAYARA:[16,6785], VAL:[25,10787], KAROL:[24,12141], ISADORA:[25,11937] },
  3: { GERMANA:[0,0],      CRISTINA:[39,21297], MAYARA:[28,14400], VAL:[39,20481], KAROL:[27,13725], ISADORA:[30,14200] },
  4: { GERMANA:[31,13075], CRISTINA:[30,13327], MAYARA:[47,21334], VAL:[0,0],      KAROL:[10,5189], ISADORA:[30,13152] },
  5: { GERMANA:[28,13306], CRISTINA:[39,19029], MAYARA:[47,22171], VAL:[15,6556],  KAROL:[35,16962], ISADORA:[38,15882] },
};

const NOME_CURTO = {
  'GERMANA LIMA DA SILVA': 'GERMANA',
  'ANTONIA ANA CRISTINA SAMPAIO DE SOUSA': 'CRISTINA',
  'MAYARA DOS SANTOS DIAS': 'MAYARA',
  'VALDERLANIA ALEXANDRE BEZERRA': 'VAL',
  'KAROLINE COSTA DE FREITAS': 'KAROL',
  'ISADORA MARIA SOUSA BEZERRA DE MENEZES': 'ISADORA',
};

let pass = 0, fail = 0;
for (const m of listarMassagistas()) {
  const curto = NOME_CURTO[m.nome]; if (!curto) continue;
  const d = calcularComissaoPorMes(m.id, m.nome, 2026);
  console.log(`\n${curto.padEnd(9)} | nome=${m.nome}`);
  console.log(`  YTD: ${d.total.atendimentos} atend.  R$ ${d.total.receita.toFixed(2)}  comissao R$ ${d.total.comissao.toFixed(2)}`);
  for (let mes = 1; mes <= 5; mes++) {
    const row = d.meses.find(x => x.mes === mes);
    const got = row ? [row.atendimentos, Math.round(row.receita)] : [0, 0];
    const exp = ESPERADO[mes][curto];
    const ok = got[0] === exp[0] && Math.abs(got[1] - exp[1]) <= 1;
    if (ok) pass++; else fail++;
    const tag = ok ? 'OK' : `FAIL (esperado ${exp[0]}/${exp[1]})`;
    console.log(`  mes ${mes}: ${got[0]}/${got[1]}  ${tag}`);
  }
}
console.log(`\n=== Resultado: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
