import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { erro: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", erro, info.componentStack);
  }

  render() {
    if (!this.state.erro) return this.props.children;
    const erro = this.state.erro;
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 640, width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 24, boxShadow: "0 10px 30px rgba(0,0,0,.08)" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px", color: "#0f172a" }}>Algo deu errado ao carregar a tela</h1>
          <p style={{ margin: "0 0 12px", color: "#475569", fontSize: 14 }}>
            O erro foi capturado em vez de tela branca. Copie a mensagem abaixo para diagnóstico.
          </p>
          <pre style={{ background: "#0f172a", color: "#f8fafc", padding: 12, borderRadius: 8, overflow: "auto", fontSize: 12, maxHeight: 220 }}>
            {String(erro?.message || erro)}
            {erro?.stack ? `\n\n${erro.stack}` : ""}
          </pre>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              onClick={() => window.location.reload()}
              style={{ background: "#0f766e", color: "#fff", border: 0, borderRadius: 8, padding: "10px 16px", cursor: "pointer", fontWeight: 600 }}
            >
              Recarregar
            </button>
            <button
              onClick={() => { localStorage.removeItem("guape:token"); window.location.href = "/login"; }}
              style={{ background: "#e2e8f0", color: "#0f172a", border: 0, borderRadius: 8, padding: "10px 16px", cursor: "pointer", fontWeight: 600 }}
            >
              Ir para login
            </button>
          </div>
        </div>
      </div>
    );
  }
}
