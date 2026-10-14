import { useEffect, useState } from "react";
import { fetchSettingsPublic, type SystemSettings } from "../services/api";

const DEFAULTS: SystemSettings = { cidade: "Guapé", uf: "MG", subtitulo: "Secretaria Municipal" };

function aplicarVisual(s: SystemSettings) {
  const cidade = (s.cidade || "Guapé").trim() || "Guapé";
  document.title = `Saúde ${cidade} — Gestão SMS`;
  // Favicon cruz médica com inicial da cidade (ex: G p/ Guapé)
  const inicial = (cidade.trim()[0] || "S").toUpperCase();
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
    `<rect width='64' height='64' rx='14' fill='#0A3D62'/>` +
    `<rect x='26' y='12' width='12' height='40' rx='3' fill='#ffffff'/>` +
    `<rect x='12' y='26' width='40' height='12' rx='3' fill='#ffffff'/>` +
    `<text x='32' y='60' font-size='11' text-anchor='middle' fill='#14B8A6' font-family='sans-serif' font-weight='bold'>${inicial}</text></svg>`;
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/svg+xml";
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function useCidadeDinamica() {
  const [settings, setSettings] = useState<SystemSettings>(DEFAULTS);
  useEffect(() => {
    let vivo = true;
    fetchSettingsPublic()
      .then((s) => {
        if (!vivo) return;
        setSettings(s);
        aplicarVisual(s);
      })
      .catch(() => aplicarVisual(DEFAULTS));
    return () => {
      vivo = false;
    };
  }, []);
  return settings;
}

export function nomeCidade(settings: SystemSettings): string {
  return (settings.cidade || "Guapé").trim() || "Guapé";
}
