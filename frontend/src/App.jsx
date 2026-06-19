import { useState, useEffect, useRef, useCallback } from 'react';
import WelcomeScreen      from './components/WelcomeScreen.jsx';
import FormScreen         from './components/FormScreen.jsx';
import ConfirmationScreen from './components/ConfirmationScreen.jsx';

// Mapa chave da pergunta no banco → id local hardcoded usado em
// shared.jsx/FormScreen.jsx. Permite sobrescrever rótulos dinamicamente.
const _MAP_CHAVE_ID = {
  servicos_expectativa:    's0',
  servicos_explicacao:     's1',
  servicos_atitude:        's2',
  servicos_tecnica:        's3',
  instalacoes_conforto:    'f0',
  instalacoes_organizacao: 'f1',
  instalacoes_conveniencia:'f2',
};

export default function App() {
  const [screen,       setScreen]       = useState('welcome');
  const [visible,      setVisible]      = useState(true);
  const [tokenData,    setTokenData]    = useState(null);
  const [tokenChecked, setTokenChecked] = useState(false);
  const [formStart,    setFormStart]    = useState(null);
  const [i18n,         setI18n]         = useState(null);
  const pollRef = useRef(null);

  const [extrasPorSecao, setExtrasPorSecao] = useState([]);
  const [secoesOrdenadas, setSecoesOrdenadas] = useState([]);
  const [pesquisaVersao, setPesquisaVersao] = useState(null);

  const configCacheRef = useRef(new Set());
  // Busca config da pesquisa e monta:
  // - mapa de rotulos i18n (sobrescreve hardcoded quando idioma != pt-BR)
  // - extras por secao (perguntas adicionadas pelo admin no editor)
  // Sempre carrega, mesmo em pt-BR, para coletar os extras. Faz cache por
  // idioma para nao re-fetch enquanto o usuario continua na welcome.
  const carregarConfig = useCallback(async (idioma) => {
    const lang = idioma || 'pt-BR';
    if (configCacheRef.current.has(lang)) return;
    configCacheRef.current.add(lang);
    try {
      // Cache-bust + cache:'no-store' — admin pode ter editado a estrutura
      // (reordenar, criar pergunta/secao) e o hospede precisa ver as mudanças.
      const r = await fetch('/api/survey/config?slug=spa-locc-v1&idioma=' + encodeURIComponent(lang) + '&_=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      if (!d?.ok || !d.pesquisa) return;
      const labels = {};
      const ratings = {};
      const sectionTitles = {};
      const legacyOrder = {};
      const extras = [];
      // Lista completa de perguntas por secao em ordem (legacy + extras +
      // comentarios). Cada item carrega tipo, ordem, legacy_id (se for s0-s3
      // ou f0-f2), permitindo o FormScreen renderizar tudo na ordem definida
      // pelo admin via drag-and-drop.
      const secoesOrd = [];
      const COMENTARIO_LEGADO = new Set(['servicos_comentario', 'instalacoes_comentario']);
      const SKIP_LEGADO = new Set(['recomenda', 'recomenda_qual', 'recomenda_porque']);
      for (const sec of d.pesquisa.secoes || []) {
        if (sec.chave) sectionTitles[sec.chave] = sec.titulo;
        const extrasDaSecao = [];
        const perguntasOrd = [];
        for (const q of sec.perguntas || []) {
          const id = _MAP_CHAVE_ID[q.mapeia_campo_legado] || _MAP_CHAVE_ID[q.chave];
          if (id) {
            labels[id] = q.rotulo;
            legacyOrder[id] = (typeof q.ordem === 'number') ? q.ordem : 99;
          }
          if (Array.isArray(q.opcoes)) {
            for (const o of q.opcoes) if (o.chave && o.rotulo) ratings[o.chave] = o.rotulo;
          }
          const refChave = q.mapeia_campo_legado || q.chave;
          // Pula recomenda* (renderizado em secao separada hardcoded fora do loop).
          if (SKIP_LEGADO.has(refChave)) continue;
          const ehLegacyRating = !!id;
          const ehComentario = COMENTARIO_LEGADO.has(refChave);
          const ehExtra = !ehLegacyRating && !ehComentario;
          perguntasOrd.push({
            chave: q.chave,
            mapeia_campo_legado: q.mapeia_campo_legado || null,
            ordem: (typeof q.ordem === 'number') ? q.ordem : 99,
            tipo: q.tipo,
            rotulo: q.rotulo,
            obrigatoria: !!q.obrigatoria,
            opcoes: Array.isArray(q.opcoes) ? q.opcoes : null,
            legacy_id: id || null,
            kind: ehLegacyRating ? 'rating-legacy'
                : ehComentario   ? 'comentario'
                                 : 'extra',
          });
          if (ehExtra) extrasDaSecao.push({
            chave: q.chave,
            rotulo: q.rotulo,
            tipo: q.tipo,
            obrigatoria: !!q.obrigatoria,
            opcoes: Array.isArray(q.opcoes) ? q.opcoes : null,
          });
        }
        perguntasOrd.sort((a, b) => a.ordem - b.ordem);
        secoesOrd.push({ chave: sec.chave, titulo: sec.titulo, perguntas: perguntasOrd });
        if (extrasDaSecao.length) extras.push({
          chave: sec.chave,
          titulo: sec.titulo,
          perguntas: extrasDaSecao,
        });
      }
      setExtrasPorSecao(extras);
      setSecoesOrdenadas(secoesOrd);
      setPesquisaVersao(d.pesquisa.versao || null);
      setI18n({ lang, labels, ratings, sectionTitles, legacyOrder, suppressEn: !!(lang && lang !== 'pt-BR') });
    } catch {
      // libera o cache pra permitir retry quando o usuario interagir
      configCacheRef.current.delete(lang);
    }
  }, []);

  const carregarI18n = carregarConfig;

  const startPolling = useCallback(() => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      fetch('/api/survey/live')
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d?.ok) {
            setTokenData(d.dados);
            carregarI18n(d.dados?.idioma);
            clearInterval(pollRef.current);
          }
        })
        .catch(() => {});
    }, 4000);
  }, [carregarI18n]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');

    if (token) {
      fetch(`/api/survey/${encodeURIComponent(token)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.ok) { setTokenData(d.dados); carregarI18n(d.dados?.idioma); } })
        .catch(() => {})
        .finally(() => setTokenChecked(true));
      return;
    }

    setTokenChecked(true);
    startPolling();
    return () => clearInterval(pollRef.current);
  }, [startPolling, carregarI18n]);

  useEffect(() => {
    if (screen !== 'welcome') clearInterval(pollRef.current);
  }, [screen]);

  const go = (next, opts = {}) => {
    setVisible(false);
    setTimeout(() => {
      setScreen(next);
      window.scrollTo(0, 0);
      setVisible(true);
      if (next === 'form') {
        const lib = tokenData?.liberada_em;
        setFormStart(lib ? new Date(lib.replace(' ', 'T') + 'Z').getTime() : Date.now());
      }
      if (opts.afterSubmit || opts.clearToken) {
        setTokenData(null);
        startPolling();
      }
    }, 600);
  };

  if (!tokenChecked) return null;

  return (
    <div className="app-root">
      {screen === 'welcome' && <WelcomeScreen      visible={visible} onStart={() => go('form')}    tokenData={tokenData} i18n={i18n} />}
      {screen === 'form'    && <FormScreen         visible={visible} onSubmit={() => go('confirm')} onBack={() => go('welcome')} prefill={tokenData} formStart={formStart} onTimeout={() => go('welcome', { clearToken: true })} i18n={i18n} extrasPorSecao={extrasPorSecao} secoesOrdenadas={secoesOrdenadas} pesquisaVersao={pesquisaVersao} />}
      {screen === 'confirm' && <ConfirmationScreen visible={visible} onRestart={() => go('welcome', { afterSubmit: true })} i18n={i18n} />}
    </div>
  );
}
