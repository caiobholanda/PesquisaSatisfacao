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

  // Busca config da pesquisa no idioma da reserva e monta o mapa de
  // rótulos para sobrescrever os hardcoded.
  const carregarI18n = useCallback(async (idioma) => {
    const lang = idioma && idioma !== 'pt-BR' ? idioma : null;
    if (!lang) { setI18n(null); return; }
    try {
      const r = await fetch('/api/survey/config?slug=spa-locc-v1&idioma=' + encodeURIComponent(lang));
      if (!r.ok) return;
      const d = await r.json();
      if (!d?.ok || !d.pesquisa) return;
      const labels = {};         // { s0: 'Your expectations.', ... }
      const ratings = {};        // { otimo: 'Excellent', bom: 'Good', ... }
      const sectionTitles = {};  // { servicos: 'Services', ... }
      for (const sec of d.pesquisa.secoes || []) {
        if (sec.chave) sectionTitles[sec.chave] = sec.titulo;
        for (const q of sec.perguntas || []) {
          const id = _MAP_CHAVE_ID[q.mapeia_campo_legado] || _MAP_CHAVE_ID[q.chave];
          if (id) labels[id] = q.rotulo;
          if (Array.isArray(q.opcoes)) {
            for (const o of q.opcoes) if (o.chave && o.rotulo) ratings[o.chave] = o.rotulo;
          }
        }
      }
      setI18n({ lang, labels, ratings, sectionTitles });
    } catch {}
  }, []);

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
      {screen === 'form'    && <FormScreen         visible={visible} onSubmit={() => go('confirm')} onBack={() => go('welcome')} prefill={tokenData} formStart={formStart} onTimeout={() => go('welcome', { clearToken: true })} i18n={i18n} />}
      {screen === 'confirm' && <ConfirmationScreen visible={visible} onRestart={() => go('welcome', { afterSubmit: true })} i18n={i18n} />}
    </div>
  );
}
