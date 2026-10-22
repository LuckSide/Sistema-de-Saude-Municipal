"""Rótulos em linguagem natural p/ trilha de auditoria (tela + exportação)."""

ACTION_LABELS = {
    # Exportações e Pesquisas
    "EXPORT_EXCEL": "Exportação de relatório (Excel)",
    "SEARCH": "Pesquisa / Consulta de dados",
    "AUDIT_ROTATION": "Rotação e arquivamento de logs",
    # Autenticação e Usuários
    "AUTH_CREATE": "Login / Autenticação de sessão",
    "USER_CREATE": "Criação de usuário / permissão",
    "USER_UPDATE": "Atualização de usuário",
    "USER_DELETE": "Exclusão de conta de usuário",
    "USER_PASSWORD": "Alteração de senha",
    # Pacientes
    "PATIENT_CREATE": "Cadastro de paciente",
    "PATIENT_UPDATE": "Atualização de cadastro",
    "PATIENT_DELETE": "Exclusão de paciente",
    # Exames e Fila de Espera
    "EXAM_CREATE": "Inclusão na fila de exames",
    "EXAM_UPDATE": "Atualização de exame/agendamento",
    "EXAM_DELETE": "Cancelamento de exame",
    "EXAM_REMOVE": "Remoção da fila de espera",
    "EXAM_TOKEN": "Regeneração de link do exame",
    # Transporte e Viagens
    "TRIP_CREATE": "Agendamento de viagem",
    "TRIP_UPDATE": "Atualização de viagem",
    "TRIP_DELETE": "Cancelamento de viagem",
    "PASSENGER_CREATE": "Alocação de passageiro",
    "PASSENGER_DELETE": "Desalocação de passageiro",
    "DESTINATION_CREATE": "Cadastro de destino",
    "DESTINATION_UPDATE": "Atualização de destino",
    "DESTINATION_DELETE": "Remoção de destino",
    "VEHICLE_CREATE": "Cadastro de veículo",
    "VEHICLE_UPDATE": "Atualização de veículo",
    "VEHICLE_DELETE": "Inativação de veículo",
    "TRIPQUEUE_CREATE": "Entrada na fila de viagem",
    "TRIPQUEUE_UPDATE": "Atualização da fila de viagem",
    "TRIPQUEUE_DELETE": "Remoção da fila de viagem",
    # Médicos e Unidades
    "DOCTOR_CREATE": "Cadastro de médico",
    "DOCTOR_UPDATE": "Atualização de médico",
    "DOCTOR_DELETE": "Inativação de médico",
    "MEDICOS_CREATE": "Cadastro de médico",
    "MEDICOS_UPDATE": "Atualização de médico",
    "UNIT_CREATE": "Cadastro de unidade de saúde",
    "UNIT_UPDATE": "Atualização de unidade de saúde",
    "UNIT_DELETE": "Inativação de unidade de saúde",
    "UNIDADES_SAUDE_CREATE": "Cadastro de unidade de saúde",
    "UNIDADES_SAUDE_UPDATE": "Atualização de unidade de saúde",
    # Catálogo e SIGTAP
    "CATALOG_CREATE": "Cadastro em catálogo",
    "CATALOG_UPDATE": "Atualização de catálogo",
    "CATALOG_DELETE": "Remoção de catálogo",
    "SIGTAP_CREATE": "Importação SIGTAP",
    "SIGTAP_UPDATE": "Atualização SIGTAP",
    # Faturamento e Laboratório
    "BILLING_CREATE": "Lançamento de fatura",
    "BILLING_UPDATE": "Atualização de fatura",
    "BILLING_DELETE": "Remoção de fatura",
    "REQUEST_CREATE": "Solicitação laboratorial",
    "REQUEST_UPDATE": "Atualização laboratorial",
    "REQUEST_DELETE": "Remoção de solicitação lab",
    "SLOT_CREATE": "Abertura de vaga em agenda",
    "SLOT_UPDATE": "Alteração de vaga em agenda",
    "SLOT_DELETE": "Remoção de vaga em agenda",
    # APAC
    "APAC_CREATE": "Solicitação de APAC",
    "APAC_UPDATE": "Atualização de APAC",
    "APAC_AUTHORIZE": "Autorização de APAC",
    "APAC_REJECT": "Indeferimento de APAC",
    "APAC_RETURN": "Devolução de APAC",
    "APAC_LOT": "Geração de remessa APAC-Mag",
    # Configurações e Backup
    "SETTINGS_UPDATE": "Atualização de configurações",
    "INTEGRATION_CREATE": "Configuração de integração",
    "INTEGRATION_UPDATE": "Atualização de integração",
    "INTEGRATION_IMPORT": "Sincronização / Importação de dados",
    "SYSTEM_UPDATE": "Atualização do sistema",
    "BACKUP_EXPORT": "Geração de backup criptografado",
    "BACKUP_RESTORE": "Restauração de dados do sistema",
    "DASHBOARD_UPDATE": "Preferências do painel",
}

ENTITY_LABELS = {
    "PATIENT": "Paciente",
    "USER": "Usuário do sistema",
    "EXAM": "Fila de exames",
    "TRIP": "Viagem / Transporte",
    "PASSENGER": "Passageiro",
    "DESTINATION": "Destino",
    "VEHICLE": "Veículo / Frota",
    "DOCTOR": "Médico / Profissional",
    "MEDICOS": "Médico / Profissional",
    "UNIT": "Unidade de Saúde (PSF)",
    "UNIDADES_SAUDE": "Unidade de Saúde (PSF)",
    "TRIPQUEUE": "Fila de Viagem",
    "CATALOG": "Catálogo de Procedimentos",
    "SIGTAP": "Tabela SIGTAP",
    "BILLING": "Faturamento TFD",
    "REQUEST": "Solicitação Laboratorial",
    "QUEUE": "Fila do PSF",
    "SLOT": "Vaga na Agenda",
    "LAB": "Laboratório",
    "APAC": "APAC Alta Complexidade",
    "SETTINGS": "Configurações",
    "INTEGRATION": "Integração / e-SUS PEC",
    "SYSTEM": "Sistema",
    "DASHBOARD": "Painel Principal",
    "AUDIT": "Auditoria",
    "PACIENTES": "Pacientes",
    "EXAMES": "Fila de Exames",
    "VIAGENS": "Viagens",
}

FIELD_LABELS = {
    "data_agendada": "Data Agendada",
    "data_pedido": "Data do Pedido",
    "data_viagem": "Data da Viagem",
    "data_consulta": "Data da Consulta",
    "data_retorno": "Data de Retorno",
    "data_solicitacao": "Data da Solicitação",
    "data_nascimento": "Data de Nascimento",
    "nascimento": "Data de Nascimento",
    "hora_agendada": "Hora Agendada",
    "hora_saida": "Hora de Saída",
    "hora_retorno": "Hora de Retorno",
    "hora_consulta": "Horário da Consulta",
    "prioridade": "Prioridade",
    "justificativa_prioridade": "Justificativa da Prioridade",
    "status": "Status",
    "destino": "Destino",
    "unidade": "Unidade",
    "unidade_nome": "Unidade de Atendimento",
    "motorista": "Motorista",
    "departamento": "Departamento",
    "veiculo_id": "Veículo",
    "medico_id": "Médico",
    "paciente_id": "Paciente",
    "exame": "Exame",
    "especialidade": "Especialidade",
    "nome_especialidade": "Especialidade (CBO)",
    "tipo_fila": "Tipo de Fila",
    "codigo_procedimento": "Código do Procedimento",
    "codigo_especialidade": "CBO",
    "observacoes": "Observações",
    "motivo_remocao": "Motivo da Remoção",
    "tratamento": "Tratamento",
    "acompanhante": "Acompanhante",
    "presente": "Presente",
    "placa": "Placa",
    "modelo": "Modelo",
    "capacidade": "Capacidade",
    "tipo": "Tipo",
    "nome": "Nome",
    "cpf": "CPF",
    "cns": "CNS",
    "cnes": "CNES",
    "crm": "CRM",
    "telefone": "Telefone",
    "email": "E-mail",
    "endereco": "Endereço",
    "bairro": "Bairro",
    "cep": "CEP",
    "municipio": "Município",
    "area": "Área",
    "telas": "Telas",
    "acoes": "Ações",
    "is_active": "Ativo",
    "is_superuser": "Superuser",
    "medico_id": "Médico Vinculado",
    "permite_retroativo": "Lançamentos Retroativos",
    "km_inicial": "Km Inicial",
    "km_final": "Km Final",
    "adiantamento": "Adiantamento (R$)",
    "finalidade": "Finalidade",
    "competencia": "Competência",
    "quantidade": "Quantidade",
    "valor": "Valor (R$)",
    "codigo": "Código",
    "descricao": "Descrição",
    "complexidade": "Complexidade",
    "instrumento": "Instrumento",
    "codigo_curto": "Código Curto",
}

VALOR_LABELS = {
    "rotina": "Eletivo",
    "urgente": "Priorizado",
    "aguardando": "Aguardando",
    "agendado": "Agendado",
    "realizado": "Realizado",
    "cancelado": "Cancelado",
    "alocado": "Alocado",
}


def rotulo_acao(action: str) -> str:
    return ACTION_LABELS.get((action or "").upper(), (action or "").replace("_", " ").title())


def rotulo_entidade(entity: str) -> str:
    return ENTITY_LABELS.get((entity or "").upper(), (entity or "").replace("_", " ").title())


def rotulo_campo(campo: str) -> str:
    if campo in FIELD_LABELS:
        return FIELD_LABELS[campo]
    return (campo or "").replace("_", " ").strip().capitalize()


def fmt_valor(v) -> str:
    if v is None or v == "":
        return "—"
    if isinstance(v, bool):
        return "Sim" if v else "Não"
    s = str(v).strip()
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return f"{s[8:10]}/{s[5:7]}/{s[0:4]}"
    if s.lower() in VALOR_LABELS:
        return VALOR_LABELS[s.lower()]
    return s


def parse_details(raw: str) -> dict:
    import json

    try:
        d = json.loads(raw or "null")
        return d if isinstance(d, dict) else {}
    except Exception:
        return {"texto": raw or ""}
