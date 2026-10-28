import React, { useState } from "react";
import { Check, Copy, ExternalLink, MessageCircle, Send, X } from "lucide-react";
import { whatsappEnviar, whatsappPreview, type Exame } from "../services/api";

export interface BotaoWhatsAppProps {
  exameId: number;
  exame?: Exame | any;
  tipo?: "auto" | "entrada_fila" | "agendamento";
  variante?: "compacto" | "completo" | "card";
  onSucessoEnvio?: () => void;
}

/**
 * Utilitário cross-browser e cross-device para cópia de texto.
 * Usa navigator.clipboard.writeText quando disponível (HTTPS / localhost)
 * e aplica fallback robusto via textarea e document.execCommand('copy')
 * para redes locais (HTTP), navegadores legados e mobile.
 */
export async function copiarTextoClipboard(texto: string): Promise<boolean> {
  if (!texto) return false;
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Ignora e tenta fallback
    }
  }
  try {
    const el = document.createElement("textarea");
    el.value = texto;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.top = "-9999px";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch (err) {
    console.error("Falha ao copiar texto para área de transferência:", err);
    return false;
  }
}

export default function BotaoWhatsApp({
  exameId,
  exame,
  tipo = "auto",
  variante = "completo",
  onSucessoEnvio,
}: BotaoWhatsAppProps) {
  const [modalAberto, setModalAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [statusEnvio, setStatusEnvio] = useState<string>("");
  const [preview, setPreview] = useState<{
    telefone_formatado: string;
    telefone_whatsapp: string | null;
    mensagem: string;
    link_whatsapp: string;
    paciente_nome: string;
    tipo_evento: string;
    whatsapp_configurado: boolean;
  } | null>(null);

  // Gera texto de fallback local caso precise abrir instantaneamente
  function gerarTextoLocal(): string {
    const nome = (exame?.paciente_nome || "Paciente").trim();
    const pront = exame?.prontuario || (exame?.paciente_id ? `PR-${String(exame.paciente_id).padStart(5, "0")}` : "");
    const proc = exame?.exame || "Procedimento Solicitado";
    const ehAgendado = tipo === "agendamento" || Boolean(exame?.data_agendada);

    if (ehAgendado) {
      const data = exame?.data_agendada ? exame.data_agendada.slice(0, 10).split("-").reverse().join("/") : "";
      const hora = exame?.hora_agendada || "07:30";
      const local = exame?.unidade_nome || exame?.destino || "Laboratório / Unidade Conveniada";
      return (
        `Olá, *${nome}*!\n` +
        `Seu exame/procedimento foi *AGENDADO* com sucesso pela Secretaria de Saúde de Guapé:\n\n` +
        `🗓️ *Detalhes do Agendamento:*\n` +
        `• *Paciente:* ${nome} (Prontuário: ${pront})\n` +
        `• *Procedimento:* ${proc}\n` +
        `• *Data:* *${data}*\n` +
        `• *Horário:* *${hora}*\n` +
        `• *Local:* ${local}\n\n` +
        `⚠️ *Orientações:* Apresente documento com foto e Cartão SUS. Chegue com 15 min de antecedência.\n` +
        `_Secretaria Municipal de Saúde de Guapé_`
      );
    }

    return (
      `Olá, *${nome}*!\n` +
      `Sua solicitação foi cadastrada com sucesso na *Fila de Espera Regulada* da Secretaria de Saúde de Guapé:\n\n` +
      `📋 *Detalhes da Solicitação:*\n` +
      `• *Paciente:* ${nome} (Prontuário: ${pront})\n` +
      `• *Procedimento:* ${proc}\n` +
      `• *Status:* Na Fila de Espera Regulada\n\n` +
      `Assim que for agendado, você receberá uma nova notificação com a data, horário e instruções de preparo.\n` +
      `_Secretaria Municipal de Saúde de Guapé_`
    );
  }

  async function carregarPreview() {
    setCarregando(true);
    setStatusEnvio("");
    try {
      const res = await whatsappPreview(exameId, tipo);
      setPreview(res);
    } catch {
      // Fallback local se backend demorar ou falhar
      const fallbackTexto = gerarTextoLocal();
      const rawTel = exame?.paciente_telefone || "";
      const telDigitos = rawTel.replace(/\D/g, "");
      const telWhats = telDigitos ? (telDigitos.startsWith("55") ? telDigitos : `5535${telDigitos}`) : null;
      setPreview({
        telefone_formatado: rawTel || "Não informado",
        telefone_whatsapp: telWhats,
        mensagem: fallbackTexto,
        link_whatsapp: telWhats
          ? `https://wa.me/${telWhats}?text=${encodeURIComponent(fallbackTexto)}`
          : `https://wa.me/?text=${encodeURIComponent(fallbackTexto)}`,
        paciente_nome: exame?.paciente_nome || "Paciente",
        tipo_evento: tipo === "agendamento" ? "agendamento" : "entrada_fila",
        whatsapp_configurado: false,
      });
    } finally {
      setCarregando(false);
    }
  }

  function handleAbrirModal() {
    setModalAberto(true);
    carregarPreview();
  }

  async function handleCopiarRapido(e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    let texto = preview?.mensagem;
    if (!texto) {
      try {
        const res = await whatsappPreview(exameId, tipo);
        texto = res.mensagem;
      } catch {
        texto = gerarTextoLocal();
      }
    }
    const copiou = await copiarTextoClipboard(texto || "");
    if (copiou) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 3000);
    }
  }

  function handleAbrirWhatsApp(e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    if (preview?.link_whatsapp) {
      window.open(preview.link_whatsapp, "_blank");
    } else {
      const texto = gerarTextoLocal();
      const rawTel = exame?.paciente_telefone || "";
      const telDigitos = rawTel.replace(/\D/g, "");
      const telWhats = telDigitos ? (telDigitos.startsWith("55") ? telDigitos : `5535${telDigitos}`) : "";
      const link = telWhats
        ? `https://wa.me/${telWhats}?text=${encodeURIComponent(texto)}`
        : `https://wa.me/?text=${encodeURIComponent(texto)}`;
      window.open(link, "_blank");
    }
  }

  async function handleDispararAutomatico() {
    setEnviando(true);
    setStatusEnvio("");
    try {
      const res = await whatsappEnviar({
        exame_id: exameId,
        tipo,
        mensagem_customizada: preview?.mensagem,
      });
      if (res.sucesso) {
        setStatusEnvio("Mensagem disparada com sucesso via WhatsApp!");
        if (onSucessoEnvio) onSucessoEnvio();
      } else {
        setStatusEnvio(`Envio automático não realizado (${res.erro || res.status}). Utilize a cópia rápida abaixo.`);
      }
    } catch {
      setStatusEnvio("Erro de conexão com o gateway. Utilize o botão Copiar Mensagem para colar no WhatsApp.");
    } finally {
      setEnviando(false);
    }
  }

  if (variante === "compacto") {
    return (
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={handleCopiarRapido}
          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-bold transition shadow-2xs ${
            copiado
              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
              : "border-emerald-200 bg-emerald-50/80 text-emerald-800 hover:bg-emerald-100"
          }`}
          title="Copiar mensagem formatada do paciente para WhatsApp"
        >
          {copiado ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-emerald-700" />}
          <span>{copiado ? "Copiado!" : "WhatsApp"}</span>
        </button>
        <button
          type="button"
          onClick={handleAbrirModal}
          className="rounded-lg p-1 text-emerald-800 hover:bg-emerald-100 transition"
          title="Visualizar opções de WhatsApp"
        >
          <ExternalLink className="h-3 w-3" />
        </button>

        {modalAberto && (
          <ModalWhatsApp
            fechar={() => setModalAberto(false)}
            preview={preview}
            carregando={carregando}
            copiado={copiado}
            copiar={handleCopiarRapido}
            abrirWhatsApp={handleAbrirWhatsApp}
            enviando={enviando}
            enviarAutomatico={handleDispararAutomatico}
            statusEnvio={statusEnvio}
          />
        )}
      </div>
    );
  }

  if (variante === "card") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-emerald-200/60">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-2xs">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div>
              <p className="font-bold text-xs text-emerald-950">Notificação via WhatsApp</p>
              <p className="text-[11px] text-emerald-800/80">
                {exame?.paciente_telefone ? `Destinatário: ${exame.paciente_telefone}` : "Telefone do paciente"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleAbrirModal}
            className="text-[11px] font-bold text-emerald-800 hover:underline flex items-center gap-1"
          >
            <span>Ver mensagem</span>
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <button
            type="button"
            onClick={handleCopiarRapido}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition shadow-xs ${
              copiado
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-50"
            }`}
          >
            {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4 text-emerald-700" />}
            <span>{copiado ? "Mensagem Copiada!" : "Copiar Mensagem"}</span>
          </button>

          <button
            type="button"
            onClick={handleAbrirWhatsApp}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white transition shadow-xs hover:bg-emerald-800"
          >
            <MessageCircle className="h-4 w-4" />
            <span>Abrir WhatsApp</span>
          </button>
        </div>

        {modalAberto && (
          <ModalWhatsApp
            fechar={() => setModalAberto(false)}
            preview={preview}
            carregando={carregando}
            copiado={copiado}
            copiar={handleCopiarRapido}
            abrirWhatsApp={handleAbrirWhatsApp}
            enviando={enviando}
            enviarAutomatico={handleDispararAutomatico}
            statusEnvio={statusEnvio}
          />
        )}
      </div>
    );
  }

  // Variante Padrão: "completo"
  return (
    <>
      <div className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleCopiarRapido}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition shadow-2xs ${
            copiado
              ? "border-emerald-500 bg-emerald-600 text-white"
              : "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
          }`}
          title="Copiar texto formatado para colar no WhatsApp"
        >
          {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4 text-emerald-700" />}
          <span>{copiado ? "Mensagem Copiada!" : "Copiar Mensagem WhatsApp"}</span>
        </button>

        <button
          type="button"
          onClick={handleAbrirModal}
          className="inline-flex items-center gap-1 rounded-xl border border-emerald-300 bg-white px-2.5 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50 transition shadow-2xs"
          title="Abrir no WhatsApp e ver opções"
        >
          <MessageCircle className="h-4 w-4 text-emerald-600" />
          <span>Opções</span>
        </button>
      </div>

      {modalAberto && (
        <ModalWhatsApp
          fechar={() => setModalAberto(false)}
          preview={preview}
          carregando={carregando}
          copiado={copiado}
          copiar={handleCopiarRapido}
          abrirWhatsApp={handleAbrirWhatsApp}
          enviando={enviando}
          enviarAutomatico={handleDispararAutomatico}
          statusEnvio={statusEnvio}
        />
      )}
    </>
  );
}

function ModalWhatsApp({
  fechar,
  preview,
  carregando,
  copiado,
  copiar,
  abrirWhatsApp,
  enviando,
  enviarAutomatico,
  statusEnvio,
}: {
  fechar: () => void;
  preview: any;
  carregando: boolean;
  copiado: boolean;
  copiar: () => void;
  abrirWhatsApp: () => void;
  enviando: boolean;
  enviarAutomatico: () => void;
  statusEnvio: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4 print:hidden"
      onClick={fechar}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-emerald-200 bg-emerald-50 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-2xs">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-display text-sm font-bold text-emerald-950">
                Notificação WhatsApp · {preview?.paciente_nome || "Paciente"}
              </h3>
              <p className="text-[11px] text-emerald-800">
                {preview?.telefone_formatado ? `Contato: ${preview.telefone_formatado}` : "Telefone não informado"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={fechar}
            className="rounded-lg p-1.5 text-ink/40 hover:bg-white hover:text-ink transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {carregando ? (
            <div className="py-8 text-center text-xs text-ink/50">Carregando mensagem estruturada...</div>
          ) : (
            <>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wide text-ink/60">
                  Prévia do Texto Formatado para Envio:
                </label>
                <div className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-sus-900/10 bg-sand/30 p-3 font-sans text-xs text-sus-950 shadow-inner">
                  {preview?.mensagem}
                </div>
              </div>

              {statusEnvio && (
                <div
                  className={`rounded-xl p-2.5 text-xs font-semibold ${
                    statusEnvio.includes("sucesso")
                      ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                      : "bg-amber-50 text-amber-900 border border-amber-200"
                  }`}
                >
                  {statusEnvio}
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={copiar}
                  className={`w-full sm:flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition shadow-xs ${
                    copiado
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-sus-900/20 bg-white text-sus-900 hover:bg-sand"
                  }`}
                >
                  {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  <span>{copiado ? "Mensagem Copiada!" : "Copiar (Ctrl+V)"}</span>
                </button>

                <button
                  type="button"
                  onClick={abrirWhatsApp}
                  className="w-full sm:flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition"
                >
                  <MessageCircle className="h-4 w-4" />
                  <span>Abrir no WhatsApp</span>
                </button>

                {preview?.whatsapp_configurado && (
                  <button
                    type="button"
                    onClick={enviarAutomatico}
                    disabled={enviando}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900 hover:bg-emerald-100 transition disabled:opacity-50"
                    title="Disparar diretamente pelo gateway/API oficial"
                  >
                    <Send className={`h-3.5 w-3.5 ${enviando ? "animate-pulse" : ""}`} />
                    <span>{enviando ? "Enviando..." : "Disparar API"}</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
