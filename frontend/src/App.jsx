import { useState, useEffect } from 'react';
import WelcomeScreen      from './components/WelcomeScreen.jsx';
import FormScreen         from './components/FormScreen.jsx';
import ConfirmationScreen from './components/ConfirmationScreen.jsx';

export default function App() {
  const [screen,       setScreen]       = useState('welcome');
  const [visible,      setVisible]      = useState(true);
  const [tokenData,    setTokenData]    = useState(null);
  const [tokenChecked, setTokenChecked] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) { setTokenChecked(true); return; }
    fetch(`/api/survey/${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setTokenData(d.dados); })
      .catch(() => {})
      .finally(() => setTokenChecked(true));
  }, []);

  const go = (next) => {
    setVisible(false);
    setTimeout(() => { setScreen(next); window.scrollTo(0, 0); setVisible(true); }, 600);
  };

  if (!tokenChecked) return null;

  return (
    <div className="app-root">
      {screen === 'welcome' && <WelcomeScreen      visible={visible} onStart={() => go('form')}    tokenData={tokenData} />}
      {screen === 'form'    && <FormScreen         visible={visible} onSubmit={() => go('confirm')} onBack={() => go('welcome')} prefill={tokenData} />}
      {screen === 'confirm' && <ConfirmationScreen visible={visible} onRestart={() => go('welcome')} />}
    </div>
  );
}
