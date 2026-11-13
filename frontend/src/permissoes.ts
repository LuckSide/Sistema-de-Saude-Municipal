import {
  Activity,
  Ambulance,
  BookOpenText,
  Boxes,
  Building2,
  Bus,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  Coins,
  Database,
  FileCheck,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  HeartPulse,
  History,
  LayoutDashboard,
  ListOrdered,
  MapPin,
  MessageCircle,
  Microscope,
  Network,
  Package,
  Pill,
  ReceiptText,
  Settings,
  ShieldCheck,
  Stethoscope,
  Ticket,
  Tv,
  CalendarClock,
  Upload,
  UserCheck,
  Users,
  Wind,
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
      { codigo: "tfd_exames", rotulo: "Fila de Espera e Solicitações", icone: ListOrdered, rota: "/fila-exames" },
      { codigo: "tfd_fila_lancamento", rotulo: "Solicitações — somente lançamento PSF (sem agendar/urgente)", icone: ListOrdered, rota: "/tfd/solicitacoes/nova" },
      { codigo: "tfd_agenda", rotulo: "Agenda e Recepção", icone: CalendarDays, rota: "/tfd/agendamentos" },
      { codigo: "tfd_relatorio_agendados", rotulo: "Relatório de Agendados", icone: ChartColumn, rota: "/tfd/relatorio-agendados" },
      { codigo: "tfd_medico", rotulo: "Painel Médico (prioridades)", icone: Stethoscope, rota: "/painel-medico" },
      { codigo: "tfd_catalogo", rotulo: "Catálogo de procedimentos", icone: BookOpenText, rota: "/tfd/catalogo" },
      { codigo: "tfd_destinos", rotulo: "Destinos", icone: MapPin, rota: "/tfd/destinos" },
      { codigo: "tfd_frota", rotulo: "Frota (Veículos)", icone: CalendarDays, rota: "/tfd/frota" },
      { codigo: "tfd_motoristas", rotulo: "Motoristas", icone: UserCheck, rota: "/tfd/motoristas" },
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
      { codigo: "lab_orcamento", rotulo: "Controle de Orçamento e Lotes", icone: Coins, rota: "/lab/orcamento" },
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
    codigo: "oxigenio",
    rotulo: "Oxigênio & Equipamentos",
    icone: Wind,
    rota: "/oxigenio",
    filhos: [
      { codigo: "oxigenio_estoque", rotulo: "Estoque e Licitações", icone: Package, rota: "/oxigenio" },
      { codigo: "oxigenio_equipamentos", rotulo: "Gestão de Equipamentos (CPAP/BiPAP/Concentradores)", icone: Stethoscope, rota: "/oxigenio/equipamentos" },
      { codigo: "oxigenio_emprestimos", rotulo: "Empréstimos e Saídas", icone: ClipboardList, rota: "/oxigenio/emprestimos" },
      { codigo: "oxigenio_empresas", rotulo: "Empresas e Fornecedores", icone: Building2, rota: "/oxigenio/empresas" },
      { codigo: "oxigenio_relatorios", rotulo: "Relatórios e Requisição AF", icone: FileText, rota: "/oxigenio/relatorios" },
    ],
  },
  {
    codigo: "farmacia",
    rotulo: "Farmácia Municipal & Insumos",
    icone: Pill,
    rota: "/farmacia",
    filhos: [
      { codigo: "farmacia_estoque", rotulo: "Medicamentos & Estoque", icone: Pill, rota: "/farmacia" },
      { codigo: "farmacia_validade", rotulo: "Controle de Validade & Lotes", icone: CalendarClock, rota: "/farmacia/validade" },
      { codigo: "farmacia_links", rotulo: "Painéis TV & Consulta Pública", icone: Tv, rota: "/farmacia/links" },
      { codigo: "farmacia_insumos", rotulo: "Insumos & Materiais Internos", icone: Boxes, rota: "/farmacia/insumos" },
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
    rotulo: "Contas e Administração",
    icone: Users,
    rota: "/usuarios",
    filhos: [
      { codigo: "auditoria", rotulo: "Auditoria / Logs (requer Superuser)", icone: History, rota: "/auditoria" },
    ],
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
      { codigo: "cfg_whatsapp", rotulo: "WhatsApp / Notificações", icone: MessageCircle, rota: "/configuracoes?aba=whatsapp" },
      { codigo: "cfg_exames", rotulo: "Procedimentos / Exames Permitidos", icone: FileSpreadsheet, rota: "/configuracoes?aba=exames" },
      { codigo: "cfg_medicos", rotulo: "Médicos e Profissionais", icone: Stethoscope, rota: "/configuracoes?aba=medicos" },
      { codigo: "cfg_unidades", rotulo: "Unidades de Saúde e PSFs", icone: Building2, rota: "/configuracoes?aba=unidades" },
      { codigo: "cfg_laboratorios", rotulo: "Laboratórios Conveniados", icone: FlaskConical, rota: "/configuracoes?aba=laboratorios" },
      { codigo: "cfg_backup", rotulo: "Backup e Restauração (Superuser)", icone: Database, rota: "/configuracoes?aba=backup" },
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
  if (codigo === "tfd_agenda" && telas.includes("tfd_agendamentos")) return true;
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
