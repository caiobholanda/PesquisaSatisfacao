import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[Gran SPA] React error boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="eb-wrap">
          <div className="eb-band"></div>
          <h1 className="eb-title serif">Algo inesperado ocorreu.</h1>
          <p className="eb-msg">
            Pedimos desculpas pelo inconveniente. Por favor, recarregue a página e tente novamente.
          </p>
          <button
            className="eb-btn"
            onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
          >
            Recarregar página
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
