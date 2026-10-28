import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, date
from typing import Any

from sqlmodel import Session, select

from app.models.integracoes import IntegrationSettings, WhatsAppLog
from app.models.tfd import Paciente, ExameFila
from app.services.lab_fase6 import determinar_preparo
from app.services.geradores import gerar_prontuario_aleatorio, gerar_exame_curto_aleatorio


def normalizar_telefone_whatsapp(telefone: str | None, ddd_padrao: str = "35") -> str | None:
    """Higieniza e formata o número de telefone no padrão internacional E.164 para WhatsApp.

    Exemplos:
    - '(35) 99999-1111' -> '5535999991111'
    - '99999-1111'      -> '5535999991111' (assume DDD 35 padrão)
    - '5535999991111'   -> '5535999991111'
    """
    if not telefone:
        return None
    digitos = re.sub(r"\D", "", str(telefone).strip())
    if not digitos or len(digitos) < 8:
        return None

    # Já possui DDI 55 com DDD e 8 ou 9 dígitos (12 ou 13 dígitos no total)
    if digitos.startswith("55") and len(digitos) in (12, 13):
        return digitos

    # Possui DDD (10 ou 11 dígitos): adiciona DDI 55
    if len(digitos) in (10, 11):
        return f"55{digitos}"

    # Apenas o número local (8 ou 9 dígitos): adiciona 55 + DDD padrão
    if len(digitos) in (8, 9):
        ddd = re.sub(r"\D", "", str(ddd_padrao or "35")) or "35"
        return f"55{ddd}{digitos}"

    return None


def formatar_telefone_exibicao(telefone: str | None) -> str:
    """Formata telefone para exibição amigável: (35) 99999-9999."""
    if not telefone:
        return "Não informado"
    d = re.sub(r"\D", "", str(telefone).strip())
    if d.startswith("55") and len(d) in (12, 13):
        d = d[2:]
    if len(d) == 11:
        return f"({d[:2]}) {d[2:7]}-{d[7:]}"
    if len(d) == 10:
        return f"({d[:2]}) {d[2:6]}-{d[6:]}"
    if len(d) == 9:
        return f"{d[:5]}-{d[5:]}"
    if len(d) == 8:
        return f"{d[:4]}-{d[4:]}"
    return str(telefone)


def _fmt_data(val: Any) -> str:
    if not val:
        return "—"
    if isinstance(val, (datetime, date)):
        return val.strftime("%d/%m/%Y")
    s = str(val).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return f"{s[8:10]}/{s[5:7]}/{s[0:4]}"
    return s


def gerar_texto_entrada_fila(paciente: Paciente, exame: Any, lista_exames: list[Any] | None = None) -> str:
    """Gera texto amigável para o paciente quando o pedido entra na fila de espera."""
    nome = (paciente.nome or "Paciente").strip().title()
    prontuario = getattr(paciente, "codigo_prontuario", "") or (gerar_prontuario_aleatorio(None, getattr(paciente, "id", None)) if getattr(paciente, "id", None) else "—")
    cod_pedido = getattr(exame, "numero_pedido", "") or getattr(exame, "codigo_curto", "") or (gerar_exame_curto_aleatorio(None, getattr(exame, "id", None)) if getattr(exame, "id", None) else "—")

    todos = lista_exames if lista_exames and len(lista_exames) > 1 else [exame]
    if len(todos) > 1:
        procs_linhas = []
        for i, ex in enumerate(todos, 1):
            n = getattr(ex, "exame", "") or "Procedimento"
            c = getattr(ex, "codigo_procedimento", "") or ""
            procs_linhas.append(f"  {i}. {c} - {n}" if c and c not in n else f"  {i}. {n}")
        proc_str = "\n".join(procs_linhas)
        bloco_proc = f"• *Procedimentos Solicitados ({len(todos)}):*\n{proc_str}"
    else:
        nome_proc = getattr(exame, "exame", "") or "Procedimento"
        cod_proc = getattr(exame, "codigo_procedimento", "") or ""
        proc_str = f"{cod_proc} - {nome_proc}" if cod_proc and cod_proc not in nome_proc else nome_proc
        bloco_proc = f"• *Procedimento:* {proc_str}"

    especialidade = getattr(exame, "nome_especialidade", "") or getattr(exame, "especialidade", "") or getattr(exame, "tipo_fila", "") or "Geral"
    data_ped = _fmt_data(getattr(exame, "data_pedido", None))
    unidade = getattr(exame, "unidade_nome", "") or getattr(exame, "destino", "") or "Secretaria Municipal de Saúde"

    linhas = [
        f"Olá, *{nome}*!",
        "Sua solicitação de atendimento foi inserida com sucesso na *Fila de Espera Regulada* da Secretaria Municipal de Saúde de Guapé.",
        "",
        "📋 *Detalhes da Solicitação:*",
        f"• *Prontuário:* {prontuario}",
        f"• *Nº do Pedido:* {cod_pedido}",
        bloco_proc,
        f"• *Especialidade:* {especialidade}",
        f"• *Data do Pedido:* {data_ped}",
        f"• *Origem / Unidade:* {unidade}",
        "• *Status:* Na Fila de Espera Regulada",
        "",
        "ℹ️ *O que acontece agora?*",
        "Seu pedido será regulado e agendado conforme a ordem cronológica e a classificação clínica de risco. Assim que as vagas forem disponibilizadas, você receberá uma nova notificação com a *data, horário e local de atendimento*.",
        "",
        "Em caso de dúvidas ou alteração de contato, procure seu PSF de referência.",
        "_Secretaria Municipal de Saúde de Guapé - MG_",
    ]
    return "\n".join(linhas)


def buscar_transporte_vinculado(db: Session, paciente_id: int | None, data_alvo: Any) -> dict | None:
    """Verifica se o paciente possui viagem de transporte vinculada na data do exame."""
    if not paciente_id or not data_alvo:
        return None

    dt: date | None = None
    if isinstance(data_alvo, (datetime, date)):
        dt = data_alvo.date() if isinstance(data_alvo, datetime) else data_alvo
    elif isinstance(data_alvo, str) and len(data_alvo) >= 10:
        try:
            dt = datetime.strptime(data_alvo[:10], "%Y-%m-%d").date()
        except Exception:
            pass

    if not dt:
        return None

    try:
        from app.models.tfd import Viagem, ViagemPaciente, Veiculo

        stmt = (
            select(Viagem, ViagemPaciente)
            .join(ViagemPaciente, ViagemPaciente.viagem_id == Viagem.id)
            .where(
                ViagemPaciente.paciente_id == paciente_id,
                Viagem.data_viagem == dt,
                Viagem.status != "cancelada",
            )
            .order_by(Viagem.id.desc())
        )
        res = db.exec(stmt).first()
        if not res:
            return None

        viagem, vp = res
        veiculo = db.get(Veiculo, viagem.veiculo_id) if viagem.veiculo_id else None

        modelo = getattr(veiculo, "modelo", "") or ""
        placa = getattr(veiculo, "placa", "") or ""
        tipo_v = getattr(veiculo, "tipo", "") or "carro"
        if modelo and placa:
            desc_veiculo = f"{modelo} (Placa: {placa})"
        elif modelo:
            desc_veiculo = modelo
        elif placa:
            desc_veiculo = f"Veículo placa {placa}"
        else:
            desc_veiculo = viagem.departamento or "Veículo da Secretaria de Saúde"

        ponto_saida = getattr(viagem, "ponto_saida", "") or "Prefeitura Municipal de Guapé"
        obs = viagem.observacoes or ""
        if obs and any(k in obs.lower() for k in ["ponto", "embarque", "saida", "saída", "local"]):
            ponto_saida = obs

        hora_saida = viagem.hora_saida or "06:00"

        return {
            "possui_viagem": True,
            "viagem_id": viagem.id,
            "veiculo": desc_veiculo,
            "modelo_veiculo": modelo,
            "placa_veiculo": placa,
            "tipo_veiculo": tipo_v,
            "ponto_saida": ponto_saida,
            "horario_saida": hora_saida,
            "destino": viagem.destino or "Atendimento Especializado",
            "motorista": viagem.motorista or "",
            "acompanhante": vp.acompanhante or "",
            "observacoes": obs,
            "status_confirmacao": getattr(vp, "status_confirmacao", "pendente") or "pendente",
            "token_confirmacao": getattr(vp, "token_confirmacao", "") or "",
        }
    except Exception:
        return None


def gerar_texto_agendamento(
    paciente: Paciente,
    exame: Any,
    local_nome: str = "",
    preparo_texto: str = "",
    lista_exames: list[Any] | None = None,
    instrucoes_adicionais: str = "",
    transporte_info: dict | None = None,
) -> str:
    """Gera texto completo de agendamento confirmado contendo data, horário, local e preparo clínico."""
    nome = (paciente.nome or "Paciente").strip().title()
    prontuario = getattr(paciente, "codigo_prontuario", "") or (gerar_prontuario_aleatorio(None, getattr(paciente, "id", None)) if getattr(paciente, "id", None) else "—")
    cod_pedido = getattr(exame, "numero_pedido", "") or getattr(exame, "codigo_curto", "") or (gerar_exame_curto_aleatorio(None, getattr(exame, "id", None)) if getattr(exame, "id", None) else "—")

    todos = lista_exames if lista_exames and len(lista_exames) > 1 else [exame]
    nomes_para_preparo = []
    if len(todos) > 1:
        procs_linhas = []
        for i, ex in enumerate(todos, 1):
            n = getattr(ex, "exame", "") or getattr(ex, "procedimento_descricao", "") or "Procedimento"
            c = getattr(ex, "codigo_procedimento", "") or getattr(ex, "procedimento_codigo", "") or ""
            procs_linhas.append(f"  {i}. {c} - {n}" if c and c not in n else f"  {i}. {n}")
            nomes_para_preparo.append(n)
        proc_str = "\n".join(procs_linhas)
        bloco_proc = f"• *Procedimentos Agendados ({len(todos)}):*\n{proc_str}"
    else:
        nome_proc = getattr(exame, "exame", "") or getattr(exame, "procedimento_descricao", "") or "Procedimento"
        cod_proc = getattr(exame, "codigo_procedimento", "") or getattr(exame, "procedimento_codigo", "") or ""
        proc_str = f"{cod_proc} - {nome_proc}" if cod_proc and cod_proc not in nome_proc else nome_proc
        bloco_proc = f"• *Procedimento:* {proc_str}"
        nomes_para_preparo.append(nome_proc)

    data_ag = _fmt_data(getattr(exame, "data_agendada", None))
    hora_ag = getattr(exame, "hora_agendada", "") or "07:30"
    local = local_nome or getattr(exame, "unidade_nome", "") or getattr(exame, "destino", "") or "Laboratório / Unidade Conveniada"
    medico = getattr(exame, "medico_nome", "") or getattr(exame, "medico_solicitante", "")

    def _eh_lab_ex(item: Any) -> bool:
        tf = (getattr(item, "tipo_fila", "") or "").upper()
        if tf in ("LAB", "LABORATORIO", "EXAMES LABORATORIAIS", "SANGUE", "EXAMES DE SANGUE"):
            return True
        c = (getattr(item, "codigo_procedimento", "") or getattr(item, "procedimento_codigo", "") or "").strip()
        if c.startswith("0202"):
            return True
        n = (getattr(item, "exame", "") or getattr(item, "procedimento_descricao", "") or "").upper()
        palavras = (
            "HEMOGRAMA", "GLICOSE", "COLESTEROL", "TRIGLICER", "UREIA", "CREATININA",
            "COAGULOGRAMA", "TSH", "PSA", "TGO", "TGP", "LIPIDOGRAMA", "ACIDO URICO",
            "EAS", "URINA", "FEZES", "PARASITOLOGICO", "BILIRRUBINA", "INSULINA",
            "PROLACTINA", "FERRITINA", "SOROLOGIA", "SANGUE"
        )
        return any(p in n for p in palavras)

    eh_lab = any(_eh_lab_ex(x) for x in todos)

    bloco_preparo = ""
    if preparo_texto:
        bloco_preparo = preparo_texto
    elif eh_lab:
        jejum_h, prep_itens, _ = determinar_preparo(nomes_para_preparo)
        preparo_linhas = [f"• *Jejum:* {jejum_h}"]
        preparo_linhas.extend([f"• {item}" for item in prep_itens[:6]])
        bloco_preparo = "\n".join(preparo_linhas)

    linhas = [
        f"Olá, *{nome}*!",
        "Temos uma ótima notícia! Seu exame/procedimento foi *AGENDADO* pela Secretaria Municipal de Saúde de Guapé.",
        "",
        "🗓️ *Dados do Agendamento:*",
        f"• *Paciente:* {nome} (Prontuário: {prontuario})",
        bloco_proc,
        f"• *Data do Atendimento:* *{data_ag}*",
        f"• *Horário:* *{hora_ag}*",
        f"• *Local de Atendimento:* {local}",
    ]
    if medico:
        linhas.append(f"• *Profissional / Requisitante:* {medico}")

    linhas.append(f"• *Código do Pedido:* {cod_pedido}")
    linhas.append("")

    if transporte_info and transporte_info.get("possui_viagem"):
        v_linhas = [
            "🚌 *Transporte Municipal Vinculado (TFD):*",
            f"• *Veículo / Carro:* {transporte_info.get('veiculo')}",
            f"• *Ponto de Saída:* {transporte_info.get('ponto_saida')}",
            f"• *Horário de Embarque:* *{transporte_info.get('horario_saida')}*",
        ]
        if transporte_info.get("destino"):
            v_linhas.append(f"• *Destino da Viagem:* {transporte_info.get('destino')}")
        if transporte_info.get("motorista"):
            v_linhas.append(f"• *Motorista:* {transporte_info.get('motorista')}")
        if transporte_info.get("acompanhante"):
            v_linhas.append(f"• *Acompanhante Registrado:* {transporte_info.get('acompanhante')}")
        v_linhas.append("")
        linhas.extend(v_linhas)

    instrucoes = instrucoes_adicionais or getattr(exame, "instrucoes_transporte", "") or ""
    if instrucoes.strip():
        linhas.extend([
            "📝 *Orientações de Transporte / Instruções Adicionais:*",
            instrucoes.strip(),
            "",
        ])

    if bloco_preparo.strip():
        linhas.extend([
            "⚠️ *Instruções e Preparo Necessário:*",
            bloco_preparo,
            "",
        ])

    linhas.extend([
        "📌 *Recomendações Importantes:*",
        "1. Chegue com *15 minutos de antecedência* ao local ou ponto de saída.",
        "2. Apresente obrigatoriamente: *Documento com foto (RG/CNH)* e *Cartão Nacional de Saúde (SUS)*.",
        "3. Em caso de imprevisto ou impossibilidade de comparecimento, avise imediatamente a Secretaria de Saúde para que a vaga seja concedida a outro cidadão.",
        "",
        "_Secretaria Municipal de Saúde de Guapé - MG_",
    ])
    return "\n".join(linhas)


def gerar_texto_lembrete(
    paciente: Paciente,
    exame: Any,
    local_nome: str = "",
    preparo_texto: str = "",
    lista_exames: list[Any] | None = None,
    instrucoes_adicionais: str = "",
    transporte_info: dict | None = None,
) -> str:
    """Gera texto de lembrete na véspera (dia anterior) do exame/procedimento agendado."""
    nome = (paciente.nome or "Paciente").strip().title()
    prontuario = getattr(paciente, "codigo_prontuario", "") or (gerar_prontuario_aleatorio(None, getattr(paciente, "id", None)) if getattr(paciente, "id", None) else "—")
    cod_pedido = getattr(exame, "numero_pedido", "") or getattr(exame, "codigo_curto", "") or (gerar_exame_curto_aleatorio(None, getattr(exame, "id", None)) if getattr(exame, "id", None) else "—")

    todos = lista_exames if lista_exames and len(lista_exames) > 1 else [exame]
    nomes_para_preparo = []
    if len(todos) > 1:
        procs_linhas = []
        for i, ex in enumerate(todos, 1):
            n = getattr(ex, "exame", "") or getattr(ex, "procedimento_descricao", "") or "Procedimento"
            c = getattr(ex, "codigo_procedimento", "") or getattr(ex, "procedimento_codigo", "") or ""
            procs_linhas.append(f"  {i}. {c} - {n}" if c and c not in n else f"  {i}. {n}")
            nomes_para_preparo.append(n)
        proc_str = "\n".join(procs_linhas)
        bloco_proc = f"• *Procedimentos Agendados ({len(todos)}):*\n{proc_str}"
    else:
        nome_proc = getattr(exame, "exame", "") or getattr(exame, "procedimento_descricao", "") or "Procedimento"
        cod_proc = getattr(exame, "codigo_procedimento", "") or getattr(exame, "procedimento_codigo", "") or ""
        proc_str = f"{cod_proc} - {nome_proc}" if cod_proc and cod_proc not in nome_proc else nome_proc
        bloco_proc = f"• *Procedimento:* {proc_str}"
        nomes_para_preparo.append(nome_proc)

    data_ag = _fmt_data(getattr(exame, "data_agendada", None))
    hora_ag = getattr(exame, "hora_agendada", "") or "07:30"
    local = local_nome or getattr(exame, "unidade_nome", "") or getattr(exame, "destino", "") or "Laboratório / Unidade Conveniada"

    def _eh_lab_ex(item: Any) -> bool:
        tf = (getattr(item, "tipo_fila", "") or "").upper()
        if tf in ("LAB", "LABORATORIO", "EXAMES LABORATORIAIS", "SANGUE", "EXAMES DE SANGUE"):
            return True
        c = (getattr(item, "codigo_procedimento", "") or getattr(item, "procedimento_codigo", "") or "").strip()
        if c.startswith("0202"):
            return True
        n = (getattr(item, "exame", "") or getattr(item, "procedimento_descricao", "") or "").upper()
        palavras = (
            "HEMOGRAMA", "GLICOSE", "COLESTEROL", "TRIGLICER", "UREIA", "CREATININA",
            "COAGULOGRAMA", "TSH", "PSA", "TGO", "TGP", "LIPIDOGRAMA", "ACIDO URICO",
            "EAS", "URINA", "FEZES", "PARASITOLOGICO", "BILIRRUBINA", "INSULINA",
            "PROLACTINA", "FERRITINA", "SOROLOGIA", "SANGUE"
        )
        return any(p in n for p in palavras)

    eh_lab = any(_eh_lab_ex(x) for x in todos)

    bloco_preparo = ""
    if preparo_texto:
        bloco_preparo = preparo_texto
    elif eh_lab:
        jejum_h, prep_itens, _ = determinar_preparo(nomes_para_preparo)
        preparo_linhas = [f"• *Jejum:* {jejum_h}"]
        preparo_linhas.extend([f"• {item}" for item in prep_itens[:6]])
        bloco_preparo = "\n".join(preparo_linhas)

    linhas = [
        f"🔔 *LEMBRETE DE AGENDAMENTO - AMANHÃ ({data_ag})*",
        "",
        f"Olá, *{nome}*!",
        f"Lembramos que o seu atendimento está marcado para *amanhã, {data_ag}*.",
        "",
        "🗓️ *Detalhes do Agendamento:*",
        f"• *Paciente:* {nome} (Prontuário: {prontuario})",
        bloco_proc,
        f"• *Data:* *{data_ag}*",
        f"• *Horário:* *{hora_ag}*",
        f"• *Local:* {local}",
        f"• *Nº do Pedido:* {cod_pedido}",
        "",
    ]

    if transporte_info and transporte_info.get("possui_viagem"):
        linhas.extend([
            "🚌 *Transporte Municipal Vinculado (TFD):*",
            f"• *Veículo / Carro:* {transporte_info.get('veiculo')}",
            f"• *Ponto de Saída:* {transporte_info.get('ponto_saida')}",
            f"• *Horário de Embarque:* *{transporte_info.get('horario_saida')}*",
            "",
        ])

    instrucoes = instrucoes_adicionais or getattr(exame, "instrucoes_transporte", "") or ""
    if instrucoes.strip():
        linhas.extend([
            "📝 *Instruções Adicionais / Transporte:*",
            instrucoes.strip(),
            "",
        ])

    if bloco_preparo.strip():
        linhas.extend([
            "⚠️ *Lembrete de Preparo e Jejum:*",
            bloco_preparo,
            "",
        ])

    linhas.extend([
        "📌 *Recomendações para amanhã:*",
        "1. Chegue com antecedência ao local ou ponto de saída.",
        "2. Apresente Documento com foto (RG/CNH) e Cartão SUS.",
        "3. Em caso de imprevisto, avise a Secretaria de Saúde com antecedência.",
        "",
        "_Secretaria Municipal de Saúde de Guapé - MG_",
    ])
    return "\n".join(linhas)


def gerar_texto_lembrete_viagem(
    paciente: Paciente,
    viagem: Any,
    vp: Any,
    veiculo: Any = None,
    link_confirmacao: str = "",
) -> str:
    """Gera texto de lembrete com link direto de confirmação de presença na véspera da viagem."""
    nome = (paciente.nome or "Paciente").strip().title()
    prontuario = getattr(paciente, "codigo_prontuario", "") or (gerar_prontuario_aleatorio(None, getattr(paciente, "id", None)) if getattr(paciente, "id", None) else "—")
    dt_str = _fmt_data(getattr(viagem, "data_viagem", None))
    hora_saida = getattr(viagem, "hora_saida", "") or "06:00"
    ponto_saida = getattr(viagem, "ponto_saida", "") or "Prefeitura Municipal de Guapé"
    obs_viag = getattr(viagem, "observacoes", "") or ""
    if obs_viag and any(k in obs_viag.lower() for k in ["ponto", "embarque", "saida", "saída", "local"]):
        ponto_saida = obs_viag

    destino = getattr(viagem, "destino", "") or "Atendimento Especializado"
    unidade = getattr(vp, "unidade", "") or getattr(viagem, "unidade", "") or ""

    desc_veiculo = ""
    if veiculo:
        mod = getattr(veiculo, "modelo", "") or ""
        plc = getattr(veiculo, "placa", "") or ""
        if mod and plc:
            desc_veiculo = f"{mod} (Placa: {plc})"
        else:
            desc_veiculo = mod or plc
    if not desc_veiculo:
        desc_veiculo = getattr(viagem, "departamento", "") or "Veículo Municipal"

    motorista = getattr(viagem, "motorista", "")
    acomp = (getattr(vp, "acompanhante", "") or "").strip()

    linhas = [
        f"🔔 *LEMBRETE DE VIAGEM E TRANSPORTE (TFD) - AMANHÃ ({dt_str})*",
        "",
        f"Olá, *{nome}*!",
        f"Lembramos que sua viagem pelo Transporte da Saúde para *{destino}* está agendada para *amanhã, {dt_str}*.",
        "",
        "🚌 *Dados do Transporte:*",
        f"• *Paciente:* {nome} (Prontuário: {prontuario})",
        f"• *Destino:* *{destino}*{f' - {unidade}' if unidade else ''}",
        f"• *Data da Viagem:* *{dt_str}*",
        f"• *Horário de Embarque:* *{hora_saida}*",
        f"• *Ponto de Saída:* *{ponto_saida}*",
        f"• *Veículo:* {desc_veiculo}",
    ]
    if motorista:
        linhas.append(f"• *Motorista:* {motorista}")
    if acomp:
        linhas.append(f"• *Acompanhante Registrado:* {acomp}")

    if link_confirmacao:
        linhas.extend([
            "",
            "✅ *CONFIRMAÇÃO OBRIGATÓRIA DE PRESENÇA:*",
            "Para garantir o seu assento no veículo, confirme sua presença clicando no link abaixo:",
            f"👉 {link_confirmacao}",
            "",
            "⚠️ *Caso não possa comparecer:*",
            "Acesse o link acima e selecione 'Não poderei comparecer' para liberarmos a vaga a outro paciente.",
        ])

    linhas.extend([
        "",
        "📌 *Recomendações importantes para a viagem:*",
        "1. Chegue com *15 minutos de antecedência* ao ponto de saída.",
        "2. Apresente Documento com foto (RG/CNH) e Cartão SUS.",
        "",
        "_Secretaria Municipal de Saúde de Guapé - MG_",
    ])
    return "\n".join(linhas)


def gerar_link_whatsapp(telefone: str | None, mensagem: str, ddd_padrao: str = "35") -> str:
    """Gera link direto para abertura no WhatsApp Web ou App: https://wa.me/55..."""
    tel_norm = normalizar_telefone_whatsapp(telefone, ddd_padrao=ddd_padrao)
    texto_encoded = urllib.parse.quote(mensagem)
    if tel_norm:
        return f"https://wa.me/{tel_norm}?text={texto_encoded}"
    return f"https://wa.me/?text={texto_encoded}"


def disparar_whatsapp_gateway(
    db: Session,
    telefone: str | None,
    mensagem: str,
    paciente_id: int | None = None,
    exame_id: int | None = None,
    paciente_nome: str = "",
    tipo_evento: str = "geral",
) -> dict:
    """Envia mensagem de WhatsApp através do gateway configurado em IntegrationSettings.

    Suporta:
    - api_oficial (Cloud API Meta)
    - z_api (Z-API WhatsApp Gateway)
    - evolution (Evolution API)
    - webhook_generico (Webhook HTTP REST personalizado)
    """
    c = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
    ddd_padrao = getattr(c, "whatsapp_ddd_padrao", "35") or "35" if c else "35"
    tel_norm = normalizar_telefone_whatsapp(telefone, ddd_padrao=ddd_padrao)

    if not tel_norm:
        log = WhatsAppLog(
            exame_id=exame_id,
            paciente_id=paciente_id,
            tipo_evento=tipo_evento,
            telefone_destinatario=str(telefone or ""),
            paciente_nome=paciente_nome,
            mensagem=mensagem,
            status="FALHA",
            sucesso=False,
            erro="Número de telefone inválido ou não informado no cadastro",
        )
        db.add(log)
        db.commit()
        return {"sucesso": False, "motivo": "telefone_invalido", "erro": "Telefone inválido ou não informado"}

    if not c or not getattr(c, "whatsapp_habilitado", False):
        log = WhatsAppLog(
            exame_id=exame_id,
            paciente_id=paciente_id,
            tipo_evento=tipo_evento,
            telefone_destinatario=tel_norm,
            paciente_nome=paciente_nome,
            mensagem=mensagem,
            status="PENDENTE",
            sucesso=False,
            erro="Integração WhatsApp desabilitada nas configurações do sistema",
        )
        db.add(log)
        db.commit()
        return {"sucesso": False, "motivo": "whatsapp_desabilitado", "mensagem": mensagem, "telefone": tel_norm}

    provedor = getattr(c, "whatsapp_provedor", "api_oficial") or "api_oficial"
    api_url = (getattr(c, "whatsapp_api_url", "") or "").strip()
    token = (getattr(c, "whatsapp_api_token", "") or "").strip()
    instancia = getattr(c, "whatsapp_instancia_id", "") or "default"

    if not api_url:
        log = WhatsAppLog(
            exame_id=exame_id,
            paciente_id=paciente_id,
            tipo_evento=tipo_evento,
            telefone_destinatario=tel_norm,
            paciente_nome=paciente_nome,
            mensagem=mensagem,
            status="FALHA",
            sucesso=False,
            erro="URL da API de WhatsApp não configurada",
        )
        db.add(log)
        db.commit()
        return {"sucesso": False, "motivo": "url_nao_configurada", "erro": "URL da API não configurada"}

    sucesso = False
    resposta_texto = ""
    erro_msg = ""

    try:
        req_url = api_url
        headers: dict[str, str] = {"Content-Type": "application/json"}
        payload: dict[str, Any] = {}

        if provedor == "api_oficial":
            # Meta WhatsApp Cloud API
            headers["Authorization"] = f"Bearer {token}"
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": tel_norm,
                "type": "text",
                "text": {"preview_url": False, "body": mensagem},
            }

        elif provedor == "z_api":
            # Z-API Gateway
            req_url = f"{api_url.rstrip('/')}/send-text"
            if token:
                headers["Client-Token"] = token
            payload = {"phone": tel_norm, "message": mensagem}

        elif provedor == "evolution":
            # Evolution API
            req_url = f"{api_url.rstrip('/')}/message/sendText/{instancia}"
            if token:
                headers["apikey"] = token
            payload = {"number": tel_norm, "text": mensagem}

        else:
            # Webhook Genérico REST
            if token:
                headers["Authorization"] = f"Bearer {token}"
            payload = {
                "telefone": tel_norm,
                "mensagem": mensagem,
                "paciente_id": paciente_id,
                "exame_id": exame_id,
                "paciente_nome": paciente_nome,
                "evento": tipo_evento,
                "data_hora": datetime.utcnow().isoformat(),
            }

        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(req_url, data=data_bytes, headers=headers, method="POST")

        with urllib.request.urlopen(req, timeout=8.0) as resp:
            resposta_texto = resp.read().decode("utf-8", errors="replace")
            status_code = getattr(resp, "status", 200)
            sucesso = 200 <= status_code < 300

    except urllib.error.HTTPError as err:
        sucesso = False
        status_code = err.code
        resposta_texto = err.read().decode("utf-8", errors="replace")
        erro_msg = f"HTTP {status_code}: {resposta_texto[:200]}"
    except Exception as e:
        sucesso = False
        erro_msg = str(e)
        resposta_texto = ""

    # Salva log de auditoria
    log = WhatsAppLog(
        exame_id=exame_id,
        paciente_id=paciente_id,
        tipo_evento=tipo_evento,
        telefone_destinatario=tel_norm,
        paciente_nome=paciente_nome,
        mensagem=mensagem,
        status="ENVIADO" if sucesso else "FALHA",
        sucesso=sucesso,
        resposta_gateway=resposta_texto[:2000],
        erro=erro_msg[:500],
    )
    db.add(log)
    db.commit()

    return {
        "sucesso": sucesso,
        "telefone": tel_norm,
        "status": "ENVIADO" if sucesso else "FALHA",
        "erro": erro_msg,
        "mensagem": mensagem,
    }


def notificar_paciente_evento(
    db: Session,
    evento: str,
    exame: Any,
    paciente: Paciente | None = None,
    instrucoes_adicionais: str = "",
    lista_exames: list[Any] | None = None,
) -> dict:
    """Dispara a notificação automática de WhatsApp caso a integração esteja ativa para o evento."""
    try:
        c = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
        if not c or not getattr(c, "whatsapp_habilitado", False):
            return {"sucesso": False, "motivo": "whatsapp_desabilitado"}

        if evento == "entrada_fila" and not getattr(c, "whatsapp_notificar_entrada_fila", True):
            return {"sucesso": False, "motivo": "notificacao_entrada_fila_desativada"}

        if evento in ("agendamento", "lembrete", "lembrete_dia_anterior") and not getattr(c, "whatsapp_notificar_agendamento", True):
            return {"sucesso": False, "motivo": "notificacao_agendamento_desativada"}

        # Carrega paciente se necessário
        if not paciente:
            pid = getattr(exame, "paciente_id", None)
            if pid:
                paciente = db.get(Paciente, pid)
        if not paciente:
            return {"sucesso": False, "motivo": "paciente_nao_encontrado"}

        # Detecção de detalhes para SolicitacaoMestre (Laboratório)
        local_nome = ""
        itens_solic = lista_exames
        if hasattr(exame, "laboratorio_id"):
            try:
                from app.models.lab_fase6 import Laboratorio, ItemSolic
                from app.models.cadastros_saude import SigtapProcedimento
                lab = db.get(Laboratorio, exame.laboratorio_id)
                if lab:
                    local_nome = lab.nome
                if not itens_solic:
                    rows = db.exec(
                        select(ItemSolic, SigtapProcedimento)
                        .join(SigtapProcedimento, SigtapProcedimento.id == ItemSolic.sigtap_id)
                        .where(ItemSolic.solicitacao_id == exame.id)
                    ).all()
                    if rows:
                        class _ItemWrap:
                            def __init__(self, cod: str, desc: str):
                                self.codigo_procedimento = cod
                                self.procedimento_codigo = cod
                                self.exame = desc
                                self.procedimento_descricao = desc
                                self.tipo_fila = "LAB"
                        itens_solic = [_ItemWrap(p.codigo, p.descricao) for _, p in rows]
            except Exception:
                pass

        # Verifica viagem vinculada na mesma data
        data_ag = getattr(exame, "data_agendada", None) or getattr(exame, "data_pedido", None)
        transporte_info = buscar_transporte_vinculado(db, paciente.id, data_ag)

        # Gera texto conforme evento
        if evento == "entrada_fila":
            mensagem = gerar_texto_entrada_fila(paciente, exame, lista_exames=itens_solic)
        elif evento in ("lembrete", "lembrete_dia_anterior"):
            mensagem = gerar_texto_lembrete(
                paciente=paciente,
                exame=exame,
                local_nome=local_nome,
                lista_exames=itens_solic,
                instrucoes_adicionais=instrucoes_adicionais,
                transporte_info=transporte_info,
            )
        elif evento == "agendamento":
            mensagem = gerar_texto_agendamento(
                paciente=paciente,
                exame=exame,
                local_nome=local_nome,
                lista_exames=itens_solic,
                instrucoes_adicionais=instrucoes_adicionais,
                transporte_info=transporte_info,
            )
        else:
            return {"sucesso": False, "motivo": "evento_desconhecido"}

        exame_id = getattr(exame, "id", None)
        return disparar_whatsapp_gateway(
            db=db,
            telefone=paciente.telefone,
            mensagem=mensagem,
            paciente_id=paciente.id,
            exame_id=exame_id,
            paciente_nome=paciente.nome or "",
            tipo_evento=evento,
        )
    except Exception as e:
        # Nunca quebra a transação de negócio principal
        return {"sucesso": False, "motivo": "erro_interno", "erro": str(e)}
