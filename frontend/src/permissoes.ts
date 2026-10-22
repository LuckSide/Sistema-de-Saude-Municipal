import {
  Activity,
  Ambulance,
  BookOpenText,
  Bus,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  Database,
  FileCheck,
  FlaskConical,
  LayoutDashboard,
  ListOrdered,
  MapPin,
  Microscope,
  Network,
  ReceiptText,
  Settings,
  ShieldCheck,
  Stethoscope,
  Upload,
  Users,
  Ticket,
  type LucideIcon,
} from "lucide-react";

export type Acao = "ver" | "criar" | "editar" | "excluir";

export const ACOES: { id: Acao; rotulo: string }[] = [
  { id: "ver", rotulo: "Ver" },
  { id: "criar", rotulo: "Criar" },
  { id: "editar", rotulo: "Editar" },
  { id: "excluir", rotulo: "Excluir" },
];

export interface NoPermissao {
  codigo: string;
  rotulo: string;
  icone: LucideIcon;
  rota?: string;
  filhos?: NoPermissao[];
}

/** Árvore espelha Sidebar + rotas. Ícones idênticos aos do menu. */
export const MODULOS: NoPermissao[] = [
  {
    codigo: "dashboard",
    rotulo: "Painel",
    icone: LayoutDashboard,
    rota: "/",
    filhos: [
      { codigo: "dash_indicadores", rotulo: "Indicadores e Agenda", icone: ChartColumn, rota: "/indicadores" },
    ],
  },
  {
    codigo: "tfd",
    rotulo: "Transporte · TFD",
    icone: Ambulance,
    rota: "/tfd",
    filhos: [
      { codigo: "tfd_resumo", rotulo: "Resumo TFD", icone: ClipboardList, rota: "/tfd" },
      { codigo: "tfd_viagens", rotulo: "Viagens", icone: Ambulance, rota: "/tfd/viagens" },
      { codigo: "tfd_viagens_passadas", rotulo: "Viagens — alterar/editar datas passadas", icone: CalendarDays, rota: "/tfd/quadro" },
      { codigo: "tfd_pacientes", rotulo: "Pacientes", icone: Users, rota: "/tfd/pacientes" },
      { codigo: "tfd_exames", rotulo: "Fila de Procedimentos", icone: ListOrdered, rota: "/fila-exames" },
      { codigo: "tfd_fila_lancamento", rotulo: "Fila — somente lançamento (sem agendar/urgente)", icone: ListOrdered, rota: "/fila-exames" },
      { codigo: "tfd_agenda", rotulo: "Agenda TFD", icone: CalendarDays, rota: "/tfd/agenda" },
      { codigo: "tfd_agendamentos", rotulo: "Agendamentos (calendário)", icone: CalendarDays, rota: "/tfd/agendamentos" },
      { codigo: "tfd_medico", rotulo: "Painel Médico (prioridades)", icone: Stethoscope, rota: "/painel-medico" },
      { codigo: "tfd_catalogo", rotulo: "Catálogo de procedimentos", icone: BookOpenText, rota: "/tfd/catalogo" },
      { codigo: "tfd_destinos", rotulo: "Destinos", icone: MapPin, rota: "/tfd/destinos" },
      { codigo: "tfd_frota", rotulo: "Frota", icone: CalendarDays, rota: "/tfd/frota" },
      { codigo: "tfd_frota_gestao", rotulo: "Gestão de frota (só veículos/motoristas)", icone: Bus, rota: "/tfd/quadro" },
      { codigo: "tfd_faturamento", rotulo: "Faturamento", icone: ReceiptText, rota: "/tfd/faturamento" },
    ],
  },
  {
    codigo: "lab",
    rotulo: "Exames laboratoriais",
    icone: FlaskConical,
    rota: "/lab",
    filhos: [
      { codigo: "lab_recepcao", rotulo: "Laboratório · Recepção e Coleta", icone: FlaskConical, rota: "/lab/recepcao" },
      { codigo: "lab_marcacao", rotulo: "Marcação de exames de sangue", icone: ClipboardList, rota: "/lab/marcacao" },
      { codigo: "lab_fila", rotulo: "Fila de exames", icone: ListOrdered, rota: "/lab/fila" },
      { codigo: "lab_agenda", rotulo: "Vagas e agenda", icone: CalendarDays, rota: "/lab/agenda" },
      { codigo: "lab_vagas", rotulo: "Vagas", icone: Ticket, rota: "/lab/vagas" },
      { codigo: "lab_audit", rotulo: "Auditoria", icone: ShieldCheck, rota: "/lab/auditoria" },
      { codigo: "lab_faturamento", rotulo: "Faturamento BPA", icone: ReceiptText, rota: "/lab/faturamento" },
      { codigo: "lab_sigtap", rotulo: "Tabela SIGTAP", icone: Microscope, rota: "/lab/sigtap" },
    ],
  },
  {
    codigo: "apac",
    rotulo: "APAC · Alta Complexidade",
    icone: ShieldCheck,
    rota: "/apac/solicitacoes",
    filhos: [
      { codigo: "apac_solicitacao", rotulo: "Laudos e Solicitações de APAC", icone: FileCheck, rota: "/apac/solicitacoes" },
      { codigo: "apac_regulacao", rotulo: "Regulação e Autorização de APAC", icone: Stethoscope, rota: "/apac/regulacao" },
      { codigo: "apac_faturamento", rotulo: "Faturamento APAC (SIA/SUS)", icone: ReceiptText, rota: "/apac/faturamento" },
    ],
  },
  {
    codigo: "aps",
    rotulo: "Indicadores · APS Previne",
    icone: Activity,
    rota: "/aps",
  },
  {
    codigo: "usuarios",
    rotulo: "Contas",
    icone: Users,
    rota: "/usuarios",
  },
  {
    codigo: "integracoes",
    rotulo: "Configurações",
    icone: Settings,
    rota: "/configuracoes",
    filhos: [
      { codigo: "cfg_geral", rotulo: "Geral (município, marca, sistema)", icone: Settings, rota: "/configuracoes?aba=geral" },
      { codigo: "cfg_filas", rotulo: "Importação de filas", icone: Upload, rota: "/configuracoes?aba=filas" },
      { codigo: "cfg_pec", rotulo: "Integração PEC / e-SUS APS", icone: Database, rota: "/configuracoes?aba=pec" },
      { codigo: "cfg_rnds", rotulo: "Integração RNDS", icone: Network, rota: "/configuracoes?aba=rnds" },
      { codigo: "cfg_backup", rotulo: "Backup e Restauração", icone: Database, rota: "/configuracoes?aba=backup" },
    ],
  },
];

export const PAI_DE: Record<string, string> = {};
for (const m of MODULOS) {
  for (const f of m.filhos ?? []) PAI_DE[f.codigo] = m.codigo;
}

export function descendentes(no: NoPermissao): string[] {
  return [no.codigo, ...(no.filhos ?? []).flatMap(descendentes)];
}

export function todosCodigos(): string[] {
  return MODULOS.flatMap(descendentes);
}

/** Pai implica filhas (payloads antigos com só o pai continuam valendo),
 * exceto telas exclusivas (ex: tfd_medico exige concessão explícita). */
export const EXCLUSIVAS = new Set(["tfd_medico", "tfd_fila_lancamento", "tfd_viagens_passadas", "apac_regulacao", "lab_recepcao"]);
export function concedida(telas: string[], codigo: string): boolean {
  if (telas.includes(codigo)) return true;
  if (EXCLUSIVAS.has(codigo)) return false;
  const pai = PAI_DE[codigo];
  return !!pai && telas.includes(pai);
}

/** Ações efetivas: próprias > do pai > todas (legado = tudo). */
export function acoesEfetivas(acoes: Record<string, Acao[]>, codigo: string): Acao[] {
  const todas: Acao[] = ["ver", "criar", "editar", "excluir"];
  if (acoes[codigo]) return acoes[codigo];
  if (!EXCLUSIVAS.has(codigo) && PAI_DE[codigo]) return acoes[PAI_DE[codigo]] ?? todas;
  return todas;
}
