import { useState, useEffect, useRef, useCallback } from 'react';
import WelcomeScreen      from './components/WelcomeScreen.jsx';
import FormScreen         from './components/FormScreen.jsx';
import ConfirmationScreen from './components/ConfirmationScreen.jsx';

export default function App() {
  const [screen,       setScreen]       = useState('welcome');
  const [visible,      setVisible]      = useState(true);
  const [tokenData,    setTokenData]    = useState(null);
  const [tokenChecked, setTokenChecked] = useState(false);
  const [formStart,    setFormStart]    = useState(null);
  const pollRef = useRef(null);

  const startPolling = useCallback(() => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      fetch('/api/survey/live')
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d?.ok) {
            setTokenData(d.dados);
            clearInterval(pollRef.current);
          }
        })
        .catch(() => {});
    }, 4000);
  }, []);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');

    if (token) {
      fetch(`/api/survey/${encodeURIComponent(token)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.ok) setTokenData(d.dados); })
        .catch(() => {})
        .finally(() => setTokenChecked(true));
      return;
    }

    setTokenChecked(true);
    startPolling();
    return () => clearInterval(pollRef.current);
  }, [startPolling]);

  useEffect(() => {
    if (screen !== 'welcome') clearInterval(pollRef.current);
  }, [screen]);

  const go = (next, opts = {}) => {
    setVisible(false);
    setTimeout(() => {
      setScreen(next);
      window.scrollTo(0, 0);
      setVisible(true);
      if (next === 'form') setFormStart(Date.now());
      if (opts.afterSubmit) {
        setTokenData(null);
        startPolling();
      }
    }, 600);
  };

  if (!tokenChecked) return null;

  return (
    <div className="app-root">
      {screen === 'welcome' && <WelcomeScreen      visible={visible} onStart={() => go('form')}    tokenData={tokenData} />}
      {screen === 'form'    && <FormScreen         visible={visible} onSubmit={() => go('confirm')} onBack={() => go('welcome')} prefill={tokenData} formStart={formStart} onTimeout={() => go('welcome')} />}
      {screen === 'confirm' && <ConfirmationScreen visible={visible} onRestart={() => go('welcome', { afterSubmit: true })} />}
    </div>
  );
}
