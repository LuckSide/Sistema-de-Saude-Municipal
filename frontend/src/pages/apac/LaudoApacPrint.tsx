import { Printer, X } from "lucide-react";
import type { SolicitacaoApac } from "../../services/api";

interface LaudoApacPrintProps {
  solicitacao: SolicitacaoApac;
  onFechar: () => void;
}

export default function LaudoApacPrint({ solicitacao, onFechar }: LaudoApacPrintProps) {
  const handlePrint = () => {
    window.print();
  };

  const formatarData = (d?: string | null) => {
    if (!d) return "___/___/______";
    try {
      const parte = d.split("T")[0];
      const [ano, mes, dia] = parte.split("-");
      if (ano && mes && dia) return `${dia}/${mes}/${ano}`;
      return d;
    } catch {
      return d;
    }
  };

  const formatarCpf = (cpf?: string) => {
    if (!cpf) return "___.___.___-__";
    const limpo = cpf.replace(/\D/g, "");
    if (limpo.length !== 11) return cpf;
    return `${limpo.slice(0, 3)}.${limpo.slice(3, 6)}.${limpo.slice(6, 9)}-${limpo.slice(9)}`;
  };

  const formatarCns = (cns?: string) => {
    if (!cns) return "_______________";
    const limpo = cns.replace(/\D/g, "");
    if (limpo.length === 15) {
      return `${limpo.slice(0, 3)} ${limpo.slice(3, 7)} ${limpo.slice(7, 11)} ${limpo.slice(11)}`;
    }
    return cns;
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-sm p-4 sm:p-6 print:p-0 print:bg-white print:fixed-none print:inset-auto">
      {/* Barra superior de controle (oculta na impressão) */}
      <div className="max-w-4xl mx-auto mb-4 flex items-center justify-between bg-white px-5 py-3 rounded-xl shadow-lg border border-slate-200 print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold">
            SUS
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800">
              Laudo Oficial de Solicitação/Autorização de Procedimento Ambulatorial (APAC)
            </h2>
            <p className="text-xs text-slate-500">
              {solicitacao.numero_apac ? `APAC Nº: ${solicitacao.numero_apac}` : "Solicitação em análise (Número gerado na autorização)"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm rounded-lg shadow transition"
          >
            <Printer className="w-4 h-4" />
            Imprimir / Salvar PDF
          </button>
          <button
            onClick={onFechar}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Folha Oficial A4 */}
      <div className="max-w-4xl mx-auto bg-white text-slate-950 p-6 sm:p-8 rounded-xl shadow-xl border border-slate-300 print:p-0 print:shadow-none print:border-none print:rounded-none print:text-black">
        {/* Cabeçalho Oficial do SUS */}
        <div className="border-2 border-slate-900 p-3 mb-2 flex items-center justify-between text-center">
          <div className="w-16 flex flex-col items-center justify-center">
            <span className="font-black text-2xl tracking-tighter text-slate-900 border-2 border-slate-900 px-1.5 py-0.5 rounded">
              SUS
            </span>
          </div>
          <div className="flex-1 px-4 text-center">
            <h1 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              República Federativa do Brasil · Ministério da Saúde
            </h1>
            <h2 className="text-sm font-black uppercase text-slate-900">
              Sistema Único de Saúde · SIA / DATASUS
            </h2>
            <p className="text-xs font-extrabold uppercase bg-slate-100 py-0.5 mt-1 border border-slate-400">
              Laudo para Solicitação / Autorização de Procedimento Ambulatorial (APAC)
            </p>
          </div>
          <div className="w-24 text-right">
            <span className="inline-block text-[10px] font-bold border border-slate-800 px-1 py-0.5 uppercase">
              {solicitacao.tipo_solicitacao === "continuidade" ? "Continuidade" : "Inicial"}
            </span>
            {solicitacao.numero_apac_anterior && (
              <p className="text-[9px] text-slate-600 mt-1">
                Ant: {solicitacao.numero_apac_anterior}
              </p>
            )}
          </div>
        </div>

        {/* BLOCO 1: Identificação dos Estabelecimentos */}
        <div className="border border-slate-900 mb-2">
          <div className="bg-slate-200 border-b border-slate-900 px-2 py-0.5 font-bold text-[11px] uppercase tracking-wide">
            1. Identificação do Estabelecimento de Saúde
          </div>
          <div className="grid grid-cols-12 text-[10px] divide-x divide-slate-400">
            <div className="col-span-8 p-1.5">
              <span className="font-bold text-slate-700 block">Nome do Estabelecimento Solicitante:</span>
              <span className="font-semibold text-slate-900 uppercase">
                {solicitacao.unidade_solicitante_nome || "SECRETARIA MUNICIPAL DE SAÚDE DE GUAPÉ / PSF"}
              </span>
            </div>
            <div className="col-span-4 p-1.5">
              <span className="font-bold text-slate-700 block">CNES Solicitante:</span>
              <span className="font-semibold font-mono text-slate-900">
                {solicitacao.unidade_solicitante_cnes || "2156828"}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-12 text-[10px] border-t border-slate-400 divide-x divide-slate-400">
            <div className="col-span-8 p-1.5 bg-slate-50">
              <span className="font-bold text-slate-700 block">Nome do Estabelecimento Executante:</span>
              <span className="font-semibold text-slate-900 uppercase">
                {solicitacao.unidade_executante_nome || "HOSPITAL / CLÍNICA DE REFERÊNCIA REGULADA"}
              </span>
            </div>
            <div className="col-span-4 p-1.5 bg-slate-50">
              <span className="font-bold text-slate-700 block">CNES Executante:</span>
              <span className="font-semibold font-mono text-slate-900">
                {solicitacao.unidade_executante_cnes || "_______"}
              </span>
            </div>
          </div>
        </div>

        {/* BLOCO 2: Identificação do Paciente */}
        <div className="border border-slate-900 mb-2">
          <div className="bg-slate-200 border-b border-slate-900 px-2 py-0.5 font-bold text-[11px] uppercase tracking-wide">
            2. Identificação do Paciente
          </div>
          <div className="grid grid-cols-12 text-[10px] divide-x divide-slate-400">
            <div className="col-span-7 p-1.5">
              <span className="font-bold text-slate-700 block">Nome do Paciente:</span>
              <span className="font-bold text-slate-900 text-[11px] uppercase">
                {solicitacao.paciente_nome}
              </span>
            </div>
            <div className="col-span-3 p-1.5">
              <span className="font-bold text-slate-700 block">Cartão Nacional de Saúde (CNS):</span>
              <span className="font-mono font-bold text-slate-900">
                {formatarCns(solicitacao.paciente_cns)}
              </span>
            </div>
            <div className="col-span-2 p-1.5">
              <span className="font-bold text-slate-700 block">Data de Nascimento:</span>
              <span className="font-semibold text-slate-900">
                {formatarData(solicitacao.paciente_data_nascimento)}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-12 text-[10px] border-t border-slate-400 divide-x divide-slate-400">
            <div className="col-span-3 p-1.5">
              <span className="font-bold text-slate-700 block">CPF:</span>
              <span className="font-mono font-semibold text-slate-900">
                {formatarCpf(solicitacao.paciente_cpf)}
              </span>
            </div>
            <div className="col-span-2 p-1.5">
              <span className="font-bold text-slate-700 block">Sexo:</span>
              <span className="font-semibold text-slate-900 uppercase">
                {solicitacao.paciente_sexo === "M" ? "Masculino" : solicitacao.paciente_sexo === "F" ? "Feminino" : solicitacao.paciente_sexo || "Não inf."}
              </span>
            </div>
            <div className="col-span-7 p-1.5">
              <span className="font-bold text-slate-700 block">Nome da Mãe:</span>
              <span className="font-semibold text-slate-900 uppercase">
                {solicitacao.paciente_nome_mae || "NÃO DECLARADO"}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-12 text-[10px] border-t border-slate-400 divide-x divide-slate-400">
            <div className="col-span-6 p-1.5">
              <span className="font-bold text-slate-700 block">Endereço Residencial:</span>
              <span className="font-semibold text-slate-900 uppercase">
                {solicitacao.paciente_endereco || "Zona Urbana/Rural"} - {solicitacao.paciente_bairro || "Centro"}
              </span>
            </div>
            <div className="col-span-4 p-1.5">
              <span className="font-bold text-slate-700 block">Município de Residência / UF:</span>
              <span className="font-semibold text-slate-900 uppercase">
                {solicitacao.paciente_municipio || "Guapé"} / MG · CEP: {solicitacao.paciente_cep || "37177-000"}
              </span>
            </div>
            <div className="col-span-2 p-1.5">
              <span className="font-bold text-slate-700 block">Telefone:</span>
              <span className="font-semibold text-slate-900">
                {solicitacao.paciente_telefone || "Não inf."}
              </span>
            </div>
          </div>
        </div>

        {/* BLOCO 3: Procedimento Principal Solicitado */}
        <div className="border border-slate-900 mb-2">
          <div className="bg-slate-200 border-b border-slate-900 px-2 py-0.5 font-bold text-[11px] uppercase tracking-wide flex justify-between">
            <span>3. Procedimento Principal Solicitado (Tabela de Procedimentos do SUS / SIGTAP)</span>
            <span className="text-[10px] font-mono">10 Dígitos</span>
          </div>
          <div className="grid grid-cols-12 text-[10px] divide-x divide-slate-400">
            <div className="col-span-3 p-1.5">
              <span className="font-bold text-slate-700 block">Código do Procedimento:</span>
              <span className="font-mono font-black text-slate-900 text-xs">
                {solicitacao.codigo_procedimento_principal}
              </span>
            </div>
            <div className="col-span-9 p-1.5">
              <span className="font-bold text-slate-700 block">Nome do Procedimento Principal:</span>
              <span className="font-bold text-slate-900 uppercase">
                {solicitacao.nome_procedimento_principal}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-12 text-[10px] border-t border-slate-400 divide-x divide-slate-400 bg-slate-50 text-center">
            <div className="col-span-3 p-1.5">
              <span className="font-bold text-slate-700 block text-[9px] uppercase">Qtd Mês 1:</span>
              <span className="font-bold text-slate-900 text-sm">{solicitacao.qtd_mes1 ?? 0}</span>
            </div>
            <div className="col-span-3 p-1.5">
              <span className="font-bold text-slate-700 block text-[9px] uppercase">Qtd Mês 2:</span>
              <span className="font-bold text-slate-900 text-sm">{solicitacao.qtd_mes2 ?? 0}</span>
            </div>
            <div className="col-span-3 p-1.5">
              <span className="font-bold text-slate-700 block text-[9px] uppercase">Qtd Mês 3:</span>
              <span className="font-bold text-slate-900 text-sm">{solicitacao.qtd_mes3 ?? 0}</span>
            </div>
            <div className="col-span-3 p-1.5 bg-slate-100">
              <span className="font-bold text-slate-700 block text-[9px] uppercase">Qtd Total Período:</span>
              <span className="font-black text-slate-900 text-sm">{solicitacao.qtd_total ?? 0}</span>
            </div>
          </div>
        </div>

        {/* BLOCO 4: Procedimentos Secundários */}
        <div className="border border-slate-900 mb-2">
          <div className="bg-slate-200 border-b border-slate-900 px-2 py-0.5 font-bold text-[11px] uppercase tracking-wide">
            4. Procedimentos Secundários
          </div>
          {solicitacao.procedimentos_secundarios && solicitacao.procedimentos_secundarios.length > 0 ? (
            <table className="w-full text-left text-[10px] border-collapse">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-50 font-bold text-slate-700">
                  <th className="p-1 w-28">Código SIGTAP</th>
                  <th className="p-1">Descrição do Procedimento Secundário</th>
                  <th className="p-1 w-16 text-center">Qtd</th>
                  <th className="p-1 w-44">Justificativa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300">
                {solicitacao.procedimentos_secundarios.map((sec, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="p-1 font-mono font-bold">{sec.codigo_procedimento}</td>
                    <td className="p-1 uppercase">{sec.nome_procedimento}</td>
                    <td className="p-1 font-bold text-center">{sec.quantidade}</td>
                    <td className="p-1 text-slate-600 truncate max-w-xs">{sec.justificativa || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-2 text-center text-[10px] text-slate-500 italic">
              Sem procedimentos secundários apensados a esta solicitação.
            </div>
          )}
        </div>

        {/* BLOCO 5: Diagnóstico e CID-10 */}
        <div className="border border-slate-900 mb-2">
          <div className="bg-slate-200 border-b border-slate-900 px-2 py-0.5 font-bold text-[11px] uppercase tracking-wide">
            5. Diagnóstico e CID-10
          </div>
          <div className="grid grid-cols-12 text-[10px] divide-x divide-slate-400">
            <div className="col-span-3 p-1.5">
              <span className="font-bold text-slate-700 block">CID-10 Principal:</span>
              <span className="font-mono font-black text-slate-900 text-xs">
                {solicitacao.cid_principal_codigo}
              </span>
            </div>
            <div className="col-span-9 p-1.5">
              <span className="font-bold text-slate-700 block">Descrição do CID-10 Principal:</span>
              <span className="font-semibold text-slate-900 uppercase">
                {solicitacao.cid_principal_descricao || "Doença / Agravo diagnosticado conforme CID-10"}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-12 text-[10px] border-t border-slate-400 divide-x divide-slate-400">
            <div className="col-span-3 p-1.5">
              <span className="font-bold text-slate-700 block">CID-10 Secundário:</span>
              <span className="font-mono font-semibold text-slate-900">
                {solicitacao.cid_secundario_codigo || "Não aplicável"}
              </span>
            </div>
            <div className="col-span-5 p-1.5">
              <span className="font-bold text-slate-700 block">Causas Associadas / Comorbidades:</span>
              <span className="font-semibold text-slate-900">
                {solicitacao.cid_causas_associadas || "Sem causas associadas registradas"}
              </span>
            </div>
            <div className="col-span-4 p-1.5">
              <span className="font-bold text-slate-700 block">Estadiamento Clínico (Oncologia):</span>
              <span className="font-semibold text-slate-900 uppercase">
                {solicitacao.estadiamento_clinico || "Não se aplica / Não oncológico"}
              </span>
            </div>
          </div>
        </div>

        {/* BLOCO 6: Justificativa Clínica e Diagnóstico Fundamentado */}
        <div className="border border-slate-900 mb-2">
          <div className="bg-slate-200 border-b border-slate-900 px-2 py-0.5 font-bold text-[11px] uppercase tracking-wide">
            6. Justificativa Clínica do Procedimento (Anamnese, Sinais/Sintomas e Exames)
          </div>
          <div className="p-2 text-[10px] text-slate-800 leading-relaxed min-h-[70px] whitespace-pre-wrap">
            {solicitacao.justificativa_clinica}
            {solicitacao.anamnese_diagnostico && (
              <div className="mt-1 pt-1 border-t border-slate-200 text-slate-700">
                <span className="font-bold text-slate-900">Diagnóstico fundamentado / Anamnese: </span>
                {solicitacao.anamnese_diagnostico}
              </div>
            )}
          </div>
        </div>

        {/* BLOCO 7: Identificação e Assinatura do Profissional Solicitante */}
        <div className="border border-slate-900 mb-2">
          <div className="bg-slate-200 border-b border-slate-900 px-2 py-0.5 font-bold text-[11px] uppercase tracking-wide">
            7. Identificação e Assinatura do Profissional Solicitante
          </div>
          <div className="grid grid-cols-12 text-[10px] divide-x divide-slate-400">
            <div className="col-span-5 p-1.5">
              <span className="font-bold text-slate-700 block">Nome do Médico Solicitante:</span>
              <span className="font-bold text-slate-900 uppercase">
                {solicitacao.medico_solicitante_nome || "Médico Responsável"}
              </span>
            </div>
            <div className="col-span-2 p-1.5">
              <span className="font-bold text-slate-700 block">CRM / UF:</span>
              <span className="font-semibold font-mono text-slate-900">
                {solicitacao.medico_solicitante_crm || "_______-MG"}
              </span>
            </div>
            <div className="col-span-2 p-1.5">
              <span className="font-bold text-slate-700 block">CBO:</span>
              <span className="font-semibold font-mono text-slate-900">
                {solicitacao.medico_solicitante_cbo || "2251-25"}
              </span>
            </div>
            <div className="col-span-3 p-1.5">
              <span className="font-bold text-slate-700 block">CNS do Solicitante:</span>
              <span className="font-semibold font-mono text-slate-900">
                {solicitacao.medico_solicitante_cns || "_______________"}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-12 text-[10px] border-t border-slate-400 divide-x divide-slate-400 h-16">
            <div className="col-span-3 p-1.5 flex flex-col justify-between">
              <span className="font-bold text-slate-700">Data da Solicitação:</span>
              <span className="font-semibold text-slate-900 font-mono text-center">
                {formatarData(solicitacao.criado_em)}
              </span>
            </div>
            <div className="col-span-9 p-1.5 flex flex-col justify-end items-center pb-1">
              <div className="w-80 border-b border-slate-800 text-center mb-0.5"></div>
              <span className="text-[9px] text-slate-600 font-medium">
                Carimbo e Assinatura do Médico Solicitante
              </span>
            </div>
          </div>
        </div>

        {/* BLOCO 8: Identificação e Despacho do Autorizador / Órgão Regulador */}
        <div className="border-2 border-slate-900">
          <div className="bg-slate-300 border-b-2 border-slate-900 px-2 py-0.5 font-black text-[11px] uppercase tracking-wide flex justify-between">
            <span>8. Autorização do Gestor / Órgão Regulador do SUS</span>
            <span className="font-mono">SIA / APAC-Mag</span>
          </div>
          <div className="grid grid-cols-12 text-[10px] divide-x divide-slate-400 bg-slate-50">
            <div className="col-span-4 p-1.5">
              <span className="font-black text-slate-800 block text-[9px] uppercase">
                Número da APAC Autorizada:
              </span>
              <span className="font-mono font-black text-slate-900 text-sm">
                {solicitacao.numero_apac || "AGUARDANDO AUTORIZAÇÃO"}
              </span>
            </div>
            <div className="col-span-4 p-1.5">
              <span className="font-bold text-slate-700 block text-[9px] uppercase">
                Período de Validade da APAC:
              </span>
              <span className="font-semibold text-slate-900">
                {formatarData(solicitacao.data_validade_inicio)} até {formatarData(solicitacao.data_validade_fim)}
                {solicitacao.meses_vigencia ? ` (${solicitacao.meses_vigencia} meses)` : ""}
              </span>
            </div>
            <div className="col-span-4 p-1.5">
              <span className="font-bold text-slate-700 block text-[9px] uppercase">
                Situação do Laudo:
              </span>
              <span className={`inline-block font-bold px-2 py-0.5 text-[10px] rounded uppercase ${
                solicitacao.status === "AUTORIZADO"
                  ? "bg-emerald-100 text-emerald-900 border border-emerald-500"
                  : solicitacao.status === "INDEFERIDO"
                  ? "bg-red-100 text-red-900 border border-red-500"
                  : solicitacao.status === "PENDENTE"
                  ? "bg-amber-100 text-amber-900 border border-amber-500"
                  : "bg-blue-100 text-blue-900 border border-blue-500"
              }`}>
                {solicitacao.status}
              </span>
            </div>
          </div>

          <div className="p-1.5 text-[10px] border-t border-slate-400">
            <span className="font-bold text-slate-700 block">Parecer do Autorizador / Despacho Regulatório:</span>
            <p className="text-slate-800 italic mt-0.5 whitespace-pre-wrap">
              {solicitacao.parecer_autorizador ||
                (solicitacao.status === "AUTORIZADO"
                  ? "Procedimento de alta complexidade deferido conforme diretrizes clínicas e protocolo de regulação do SUS."
                  : solicitacao.motivo_indeferimento
                  ? `Indeferido: ${solicitacao.motivo_indeferimento}`
                  : solicitacao.motivo_pendencia
                  ? `Devolvido p/ Complementação: ${solicitacao.motivo_pendencia}`
                  : "Em processo de regulação e análise técnica pelo médico auditor.")}
            </p>
          </div>

          <div className="grid grid-cols-12 text-[10px] border-t border-slate-400 divide-x divide-slate-400">
            <div className="col-span-5 p-1.5">
              <span className="font-bold text-slate-700 block">Nome do Médico Autorizador:</span>
              <span className="font-bold text-slate-900 uppercase">
                {solicitacao.medico_autorizador_nome || "ÓRGÃO REGULADOR DO MUNICÍPIO DE GUAPÉ"}
              </span>
            </div>
            <div className="col-span-3 p-1.5">
              <span className="font-bold text-slate-700 block">CRM Autorizador:</span>
              <span className="font-semibold font-mono text-slate-900">
                {solicitacao.medico_autorizador_crm || "_______-MG"}
              </span>
            </div>
            <div className="col-span-4 p-1.5">
              <span className="font-bold text-slate-700 block">Data da Autorização:</span>
              <span className="font-semibold text-slate-900 font-mono">
                {formatarData(solicitacao.data_autorizacao)}
              </span>
            </div>
          </div>

          <div className="border-t border-slate-400 h-16 flex flex-col justify-end items-center pb-1">
            <div className="w-96 border-b border-slate-800 text-center mb-0.5"></div>
            <span className="text-[9px] text-slate-600 font-medium">
              Carimbo e Assinatura do Médico Autorizador / Órgão Regulador SUS
            </span>
          </div>
        </div>

        {/* Rodapé institucional */}
        <div className="mt-2 text-[9px] text-slate-500 flex justify-between items-center print:text-black">
          <span>Sistema de Gestão Municipal de Saúde · Guapé / MG</span>
          <span>Via oficial de arquivo médico e faturamento SIA/SUS</span>
          <span>Impresso em {new Date().toLocaleDateString("pt-BR")} às {new Date().toLocaleTimeString("pt-BR")}</span>
        </div>
      </div>
    </div>
  );
}
