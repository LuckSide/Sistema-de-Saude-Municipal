import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * Barra sutil e ultra-rápida no topo da janela que indica transição de rota,
 * conferindo sensação de resposta imediata sem bloquear a tela ou aumentar o tempo de loading.
 */
export default function TopRouteProgressBar() {
  const loc = useLocation();
  const [visivel, setVisivel] = useState(false);
  const [progresso, setProgresso] = useState(0);

  useEffect(() => {
    // Ao iniciar a troca de página, anima a barra de progresso no topo
    setVisivel(true);
    setProgresso(30);

    const t1 = setTimeout(() => setProgresso(75), 50);
    const t2 = setTimeout(() => setProgresso(100), 160);
    const t3 = setTimeout(() => {
      setVisivel(false);
      setProgresso(0);
    }, 320);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [loc.pathname]);

  if (!visivel && progresso === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 z-50 h-[3px] pointer-events-none bg-transparent"
    >
      <div
        className="h-full bg-gradient-to-r from-teal via-emerald-400 to-teal shadow-xs transition-all duration-150 ease-out"
        style={{
          width: `${progresso}%`,
          opacity: progresso === 100 ? 0 : 1,
          transitionProperty: "width, opacity",
        }}
      />
    </div>
  );
}
