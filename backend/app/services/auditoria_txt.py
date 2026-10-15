"""Rótulos em linguagem natural p/ trilha de auditoria (tela + exportação)."""

ACTION_LABELS = {
    "EXAM_CREATE": "Criação de pedido",
    "EXAM_UPDATE": "Atualização de Exame",
    "EXAM_DELETE": "Remoção de Exame",
    "EXAM_REMOVE": "Remoção da Fila de Espera",
    "EXAM_TOKEN": "Regeneração de link",
    "PATIENT_CREATE": "Cadastro de paciente",
    "PATIENT_UPDATE": "Atualização de paciente",
    "PATIENT_DELETE": "Remoção de paciente",
    "TRIP_CREATE": "Criação de viagem",
    "TRIP_UPDATE": "Atualização de viagem",
    "TRIP_DELETE": "Remoção de viagem",
    "PASSENGER_CREATE": "Inclusão de passageiro",
    "PASSENGER_DELETE": "Remoção de passageiro",
    "DESTINATION_CREATE": "Cadastro de destino",
    "DESTINATION_UPDATE": "Atualização de destino",
    "DESTINATION_DELETE": "Remoção de destino",
    "VEHICLE_CREATE": "Cadastro de veículo",
    "VEHICLE_UPDATE": "Atualização de veículo",
    "VEHICLE_DELETE": "Remoção de veículo",
    "USER_CREATE": "Criação de conta",
    "USER_UPDATE": "Atualização de conta",
    "USER_DELETE": "Remoção de conta",
    "USER_PASSWORD": "Troca de senha",
    "DOCTOR_CREATE": "Cadastro de médico",
    "DOCTOR_UPDATE": "Atualização de médico",
    "DOCTOR_DELETE": "Inativação de médico",
    "UNIT_CREATE": "Cadastro de unidade",
    "UNIT_UPDATE": "Atualização de unidade",
    "UNIT_DELETE": "Inativação de unidade",
    "TRIPQUEUE_CREATE": "Entrada na fila de viagem",
    "TRIPQUEUE_UPDATE": "Atualização da fila de viagem",
    "TRIPQUEUE_DELETE": "Remoção da fila de viagem",
    "CATALOG_CREATE": "Cadastro em catálogo",
    "CATALOG_UPDATE": "Atualização de catálogo",
    "CATALOG_DELETE": "Remoção de catálogo",
    "BILLING_CREATE": "Lançamento de fatura",
    "BILLING_UPDATE": "Atualização de fatura",
    "BILLING_DELETE": "Remoção de fatura",
    "REQUEST_CREATE": "Solicitação lab",
    "REQUEST_UPDATE": "Atualização lab",
    "REQUEST_DELETE": "Remoção lab",
    "SETTINGS_UPDATE": "Atualização de configurações",
    "INTEGRATION_UPDATE": "Atualização de integração",
    "INTEGRATION_IMPORT": "Importação de filas",
    "SYSTEM_UPDATE": "Atualização do sistema",
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
    "prioritaria": "Prioritário",
    "urgente": "Urgente",
    "aguardando": "Aguardando",
    "agendado": "Agendado",
    "realizado": "Realizado",
    "cancelado": "Cancelado",
    "alocado": "Alocado",
}


def rotulo_acao(action: str) -> str:
    return ACTION_LABELS.get((action or "").upper(), (action or "").replace("_", " ").title())


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
