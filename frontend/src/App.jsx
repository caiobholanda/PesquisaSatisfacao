import { useState } from 'react';
import WelcomeScreen      from './components/WelcomeScreen.jsx';
import FormScreen         from './components/FormScreen.jsx';
import ConfirmationScreen from './components/ConfirmationScreen.jsx';

export default function App() {
  const [screen,  setScreen]  = useState('welcome');
  const [visible, setVisible] = useState(true);

  const go = (next) => {
    setVisible(false);
    setTimeout(() => { setScreen(next); window.scrollTo(0, 0); setVisible(true); }, 600);
  };

  return (
    <div className="app-root">
      {screen === 'welcome' && <WelcomeScreen      visible={visible} onStart={()   => go('form')}    />}
      {screen === 'form'    && <FormScreen         visible={visible} onSubmit={() => go('confirm')} onBack={() => go('welcome')} />}
      {screen === 'confirm' && <ConfirmationScreen visible={visible} onRestart={()  => go('welcome')} />}
    </div>
  );
}
