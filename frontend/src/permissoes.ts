import {
  Activity,
  Ambulance,
  BookOpenText,
  Boxes,
  Building2,
  Bus,
  CalendarClock,
  CalendarDays,
  Car,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Database,
  FileCheck,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  History,
  Landmark,
  LayoutDashboard,
  ListOrdered,
  MapPin,
  MessageCircle,
  Network,
  Package,
  Pill,
  PlusCircle,
  ReceiptText,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Stethoscope,
  Ticket,
  Truck,
  Tv,
  Upload,
  UserCheck,
  UserCog,
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
  apenasGrupo?: boolean;
  filhos?: NoPermissao[];
}

/** Árvore espelha a estrutura e ordem atuais da Sidebar. Ícones e rótulos alinhados ao menu. */
export const MODULOS: NoPermissao[] = [
  {
    codigo: "dashboard",
    rotulo: "Painel Principal",
    icone: LayoutDashboard,
    rota: "/",
  },
  {
    codigo: "aps",
    rotulo: "Indicadores (APS Previne)",
    icone: Activity,
    rota: "/aps",
  },
  {
    codigo: "grupo_frota",
    rotulo: "Frota e Logística",
    icone: Truck,
    apenasGrupo: true,
    filhos: [
      { codigo: "tfd_frota", rotulo: "Veículos", icone: Car, rota: "/tfd/frota" },
      { codigo: "tfd_motoristas", rotulo: "Motoristas", icone: UserCheck, rota: "/tfd/motoristas" },
      { codigo: "tfd_frota_gestao", rotulo: "Gestão de frota (veículos, motoristas e escalas)", icone: Bus, rota: "/tfd/quadro" },
    ],
  },
  {
    codigo: "tfd",
    rotulo: "TFD · Transporte",
    icone: Ambulance,
    rota: "/tfd/viagens",
    filhos: [
      { codigo: "tfd_viagens", rotulo: "Viagens e Escalas / Ordens de Viagem", icone: Ambulance, rota: "/tfd/viagens" },
      { codigo: "tfd_viagens_passadas", rotulo: "Viagens — alterar/editar datas passadas", icone: CalendarDays, rota: "/tfd/quadro" },
      { codigo: "dash_indicadores", rotulo: "Relatórios da Fila", icone: ChartColumn, rota: "/indicadores" },
    ],
  },
  {
    codigo: "grupo_solicitacoes",
    rotulo: "Solicitações",
    icone: ListOrdered,
    apenasGrupo: true,
    filhos: [
      { codigo: "tfd_fila_lancamento", rotulo: "Nova Solicitação (somente lançamento PSF)", icone: PlusCircle, rota: "/tfd/solicitacoes/nova" },
      { codigo: "tfd_exames", rotulo: "Nova Solicitação e Fila de Espera", icone: ListOrdered, rota: "/fila-exames" },
      { codigo: "tfd_agenda", rotulo: "Agenda e Recepção", icone: CalendarDays, rota: "/tfd/agendamentos" },
      { codigo: "tfd_relatorio_agendados", rotulo: "Relatório de Agendados", icone: ChartColumn, rota: "/tfd/relatorio-agendados" },
      { codigo: "tfd_medico", rotulo: "Regulação Médica", icone: Stethoscope, rota: "/painel-medico" },
    ],
  },
  {
    codigo: "grupo_cadastros",
    rotulo: "Cadastros",
    icone: BookOpenText,
    apenasGrupo: true,
    filhos: [
      { codigo: "tfd_pacientes", rotulo: "Pacientes", icone: Users, rota: "/tfd/pacientes" },
      { codigo: "cfg_laboratorios", rotulo: "Prestadores de Serviços", icone: Building2, rota: "/prestadores" },
      { codigo: "tfd_catalogo", rotulo: "Catálogo de Procedimentos", icone: ListOrdered, rota: "/tfd/catalogo" },
      { codigo: "lab_sigtap", rotulo: "Tabela Oficial SIGTAP (SUS)", icone: BookOpenText, rota: "/tfd/catalogo?aba=sigtap" },
      { codigo: "tfd_destinos", rotulo: "Destinos", icone: MapPin, rota: "/tfd/destinos" },
    ],
  },
  {
    codigo: "lab",
    rotulo: "Exames laboratoriais",
    icone: FlaskConical,
    rota: "/lab/recepcao",
    filhos: [
      { codigo: "lab_recepcao", rotulo: "Recepção e Coleta", icone: FlaskConical, rota: "/lab/recepcao" },
      { codigo: "lab_marcacao", rotulo: "Marcação de exames de sangue", icone: ClipboardCheck, rota: "/lab/marcacao" },
      { codigo: "lab_fila", rotulo: "Fila de exames", icone: ListOrdered, rota: "/lab/fila" },
      { codigo: "lab_agenda", rotulo: "Vagas e Agenda", icone: CalendarDays, rota: "/lab/agenda" },
      { codigo: "lab_portal", rotulo: "Portal do Laboratório", icone: FileCheck, rota: "/lab/portal-producao" },
      { codigo: "lab_audit", rotulo: "Auditoria de Exames e Laudos", icone: ShieldAlert, rota: "/lab/auditoria" },
    ],
  },
  {
    codigo: "apac",
    rotulo: "Faturamento",
    icone: ReceiptText,
    rota: "/faturamento/bpa",
    filhos: [
      { codigo: "faturamento_bpa", rotulo: "Faturamento BPA (SIA/SUS)", icone: FileCheck, rota: "/faturamento/bpa" },
      { codigo: "producao_ambulatorial", rotulo: "Produção Ambulatorial (BPA)", icone: Activity, rota: "/producao-ambulatorial" },
      { codigo: "apac_faturamento", rotulo: "Faturamento APAC-Mag", icone: ReceiptText, rota: "/apac/faturamento" },
      { codigo: "lab_faturamento", rotulo: "Faturamento de Prestadores", icone: ReceiptText, rota: "/lab/faturamento" },
      { codigo: "lab_orcamento", rotulo: "Orçamento e Lotes de Exames", icone: Coins, rota: "/lab/orcamento" },
      { codigo: "tfd_faturamento", rotulo: "Faturamento e Custos TFD", icone: Landmark, rota: "/tfd/faturamento" },
      { codigo: "apac_solicitacao", rotulo: "Laudos e Solicitações APAC", icone: FileCheck, rota: "/apac/solicitacoes" },
      { codigo: "apac_regulacao", rotulo: "Regulação e Autorização APAC", icone: Stethoscope, rota: "/apac/regulacao" },
    ],
  },
  {
    codigo: "oxigenio",
    rotulo: "Oxigênio & Equipamentos",
    icone: Wind,
    rota: "/oxigenio",
    filhos: [
      { codigo: "oxigenio_estoque", rotulo: "Estoque e Licitações", icone: Package, rota: "/oxigenio" },
      { codigo: "oxigenio_equipamentos", rotulo: "Gestão de Equipamentos", icone: Stethoscope, rota: "/oxigenio/equipamentos" },
      { codigo: "oxigenio_emprestimos", rotulo: "Empréstimos e Saídas", icone: ClipboardList, rota: "/oxigenio/emprestimos" },
      { codigo: "oxigenio_empresas", rotulo: "Empresas e Fornecedores", icone: Building2, rota: "/oxigenio/empresas" },
      { codigo: "oxigenio_relatorios", rotulo: "Relatórios e Requisição AF", icone: FileText, rota: "/oxigenio/relatorios" },
    ],
  },
  {
    codigo: "farmacia",
    rotulo: "Farmácia & Insumos",
    icone: Pill,
    rota: "/farmacia",
    filhos: [
      { codigo: "farmacia_estoque", rotulo: "Medicamentos & Estoque", icone: Pill, rota: "/farmacia" },
      { codigo: "farmacia_validade", rotulo: "Controle de Validade", icone: CalendarClock, rota: "/farmacia/validade" },
      { codigo: "farmacia_links", rotulo: "Painéis TV & Consulta", icone: Tv, rota: "/farmacia/links" },
      { codigo: "farmacia_insumos", rotulo: "Insumos & Materiais", icone: Boxes, rota: "/farmacia/insumos" },
    ],
  },
  {
    codigo: "grupo_admin",
    rotulo: "Administração",
    icone: Settings,
    apenasGrupo: true,
    filhos: [
      { codigo: "usuarios", rotulo: "Usuários e Acessos", icone: UserCog, rota: "/usuarios" },
      { codigo: "admin_tickets", rotulo: "Tickets de Suporte", icone: ClipboardCheck, rota: "/admin/tickets" },
      { codigo: "auditoria", rotulo: "Auditoria / Logs (requer Superuser)", icone: History, rota: "/auditoria" },
    ],
  },
  {
    codigo: "integracoes",
    rotulo: "Configurações do Sistema",
    icone: SlidersHorizontal,
    rota: "/configuracoes",
    filhos: [
      { codigo: "cfg_geral", rotulo: "Geral (município, marca, sistema)", icone: SlidersHorizontal, rota: "/configuracoes?aba=geral" },
      { codigo: "cfg_filas", rotulo: "Tipos de Serviço & Regras CBO", icone: ListOrdered, rota: "/configuracoes?aba=gestao_filas" },
      { codigo: "cfg_importar", rotulo: "Importar Dados / Filas", icone: Upload, rota: "/configuracoes?aba=filas" },
      { codigo: "cfg_pec", rotulo: "Integração PEC / e-SUS APS", icone: Database, rota: "/configuracoes?aba=pec" },
      { codigo: "cfg_rnds", rotulo: "Integração RNDS", icone: Network, rota: "/configuracoes?aba=rnds" },
      { codigo: "cfg_whatsapp", rotulo: "WhatsApp / Notificações", icone: MessageCircle, rota: "/configuracoes?aba=whatsapp" },
      { codigo: "cfg_exames", rotulo: "Procedimentos / Exames Permitidos", icone: FileSpreadsheet, rota: "/configuracoes?aba=exames" },
      { codigo: "cfg_medicos", rotulo: "Médicos e Profissionais de Saúde", icone: Stethoscope, rota: "/configuracoes?aba=medicos" },
      { codigo: "cfg_unidades", rotulo: "Unidades de Saúde e PSFs", icone: Building2, rota: "/configuracoes?aba=unidades" },
      { codigo: "cfg_dados", rotulo: "Gerenciamento de Dados (Inconsistências e Limpeza)", icone: Database, rota: "/configuracoes?aba=dados" },
      { codigo: "cfg_backup", rotulo: "Backup do Sistema (Superuser)", icone: Database, rota: "/configuracoes?aba=backup" },
    ],
  },
];

/** Hierarquia de herança espelhada do backend (PAI_DE) para compatibilidade com payloads legados. */
export const PAI_DE: Record<string, string> = {
  dash_indicadores: "tfd",
  tfd_resumo: "tfd",
  tfd_viagens: "tfd",
  tfd_viagens_passadas: "tfd",
  tfd_pacientes: "tfd",
  tfd_exames: "tfd",
  tfd_catalogo: "tfd",
  tfd_destinos: "tfd",
  tfd_frota: "tfd",
  tfd_frota_gestao: "tfd",
  tfd_motoristas: "tfd",
  tfd_faturamento: "tfd",
  tfd_medico: "tfd",
  tfd_fila_lancamento: "tfd",
  tfd_agenda: "tfd",
  tfd_relatorio_agendados: "tfd",
  lab_marcacao: "lab",
  lab_fila: "lab",
  lab_agenda: "lab",
  lab_vagas: "lab",
  lab_portal: "lab",
  lab_audit: "lab",
  lab_auditoria_laudos: "lab",
  lab_faturamento: "lab",
  lab_sigtap: "lab",
  lab_recepcao: "lab",
  lab_orcamento: "lab",
  cfg_geral: "integracoes",
  cfg_filas: "integracoes",
  cfg_importar: "integracoes",
  cfg_pec: "integracoes",
  cfg_rnds: "integracoes",
  cfg_whatsapp: "integracoes",
  cfg_exames: "integracoes",
  cfg_medicos: "integracoes",
  cfg_unidades: "integracoes",
  cfg_laboratorios: "integracoes",
  cfg_dados: "integracoes",
  cfg_backup: "integracoes",
  faturamento_bpa: "apac",
  producao_ambulatorial: "apac",
  apac_solicitacao: "apac",
  apac_regulacao: "apac",
  apac_faturamento: "apac",
  oxigenio_estoque: "oxigenio",
  oxigenio_equipamentos: "oxigenio",
  oxigenio_emprestimos: "oxigenio",
  oxigenio_empresas: "oxigenio",
  oxigenio_relatorios: "oxigenio",
  farmacia_estoque: "farmacia",
  farmacia_validade: "farmacia",
  farmacia_links: "farmacia",
  farmacia_insumos: "farmacia",
};

export function descendentes(no: NoPermissao): string[] {
  const filhos = (no.filhos ?? []).flatMap(descendentes);
  return no.apenasGrupo ? filhos : [no.codigo, ...filhos];
}

export function todosCodigos(): string[] {
  return MODULOS.flatMap(descendentes);
}

/** Pai implica filhas (payloads antigos com só o pai continuam valendo),
 * exceto telas exclusivas (ex: tfd_medico exige concessão explícita). */
export const EXCLUSIVAS = new Set([
  "tfd_medico",
  "tfd_fila_lancamento",
  "tfd_viagens_passadas",
  "apac_regulacao",
  "lab_recepcao",
  "auditoria",
  "cfg_backup",
  "cfg_geral",
  "admin_tickets",
]);
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
