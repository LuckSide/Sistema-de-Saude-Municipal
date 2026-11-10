from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select, desc

from app.core.deps import get_current_user_senha_ok as get_current_user, get_db
from app.models.user import User
from app.models.tfd import Paciente, ExameFila
from app.models.integracoes import IntegrationSettings, WhatsAppLog
from app.services.permissoes import tem_tela
from app.services.whatsapp import (
    normalizar_telefone_whatsapp,
    formatar_telefone_exibicao,
    gerar_texto_entrada_fila,
    gerar_texto_agendamento,
    gerar_link_whatsapp,
    disparar_whatsapp_gateway,
)

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])


class WhatsAppPreviewOut(BaseModel):
    exame_id: int | None = None
    paciente_id: int | None = None
    paciente_nome: str
    telefone_original: str
    telefone_formatado: str
    telefone_whatsapp: str | None
    tipo_evento: str
    mensagem: str
    link_whatsapp: str
    whatsapp_configurado: bool
    whatsapp_habilitado: bool


class WhatsAppEnviarIn(BaseModel):
    exame_id: int
    tipo: str = "auto"  # auto | entrada_fila | agendamento
    telefone_customizado: str | None = None
    mensagem_customizada: str | None = None


class WhatsAppTestarIn(BaseModel):
    telefone: str
    mensagem: str = "Olá! Esta é uma mensagem de teste da Secretaria Municipal de Saúde de Guapé via WhatsApp."


class WhatsAppConfigIn(BaseModel):
    whatsapp_habilitado: bool = False
    whatsapp_provedor: str = Field(default="api_oficial", max_length=50)
    whatsapp_api_url: str = Field(default="", max_length=500)
    whatsapp_api_token: str | None = Field(default=None, max_length=500)
    whatsapp_instancia_id: str = Field(default="", max_length=150)
    whatsapp_notificar_entrada_fila: bool = True
    whatsapp_notificar_agendamento: bool = True
    whatsapp_ddd_padrao: str = Field(default="35", max_length=5)


class WhatsAppConfigOut(BaseModel):
    whatsapp_habilitado: bool
    whatsapp_provedor: str
    whatsapp_api_url: str
    whatsapp_token_configurado: bool
    whatsapp_instancia_id: str
    whatsapp_notificar_entrada_fila: bool
    whatsapp_notificar_agendamento: bool
    whatsapp_ddd_padrao: str


@router.get("/preview", response_model=WhatsAppPreviewOut)
def obter_preview_whatsapp(
    exame_id: int = Query(...),
    tipo: str = Query(default="auto", pattern="^(auto|entrada_fila|agendamento)$"),
    db: Session = Depends(get_db),
    ator: User = Depends(get_current_user),
):
    """Retorna o texto estruturado, número formatado e link direto para cópia rápida e envio via WhatsApp."""
    if not (
        bool(getattr(ator, "is_superuser", False))
        or tem_tela(ator, "tfd_exames")
        or tem_tela(ator, "tfd_fila_lancamento")
        or tem_tela(ator, "tfd_agenda")
        or tem_tela(ator, "tfd_medico")
        or tem_tela(ator, "lab_recepcao")
        or tem_tela(ator, "lab_marcacao")
        or tem_tela(ator, "cfg_geral")
    ):
        raise HTTPException(403, "Sem permissão para visualizar dados do agendamento.")

    exame = db.get(ExameFila, exame_id)
    if not exame or not exame.ativo:
        raise HTTPException(404, "Solicitação/Exame não encontrado")

    if not bool(getattr(ator, "is_superuser", False)) and getattr(ator, "unidade_saude_id", None):
        if exame.unidade_saude_id and exame.unidade_saude_id != ator.unidade_saude_id:
            if not tem_tela(ator, "tfd"):
                raise HTTPException(403, "Sem permissão para acessar solicitações de outra unidade.")

    paciente = db.get(Paciente, exame.paciente_id)
    if not paciente:
        raise HTTPException(404, "Paciente vinculado não encontrado")

    c = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
    ddd_padrao = getattr(c, "whatsapp_ddd_padrao", "35") or "35" if c else "35"

    # Determina tipo de evento
    if tipo == "auto":
        eh_agendado = bool(exame.data_agendada or (exame.status or "").lower() == "agendado")
        tipo_efetivo = "agendamento" if eh_agendado else "entrada_fila"
    else:
        tipo_efetivo = tipo

    # Busca exames irmãos do mesmo pedido/solicitação para consolidar mensagem
    irmaos: list[ExameFila] = []
    if exame.numero_pedido:
        irmaos = db.exec(
            select(ExameFila).where(
                ExameFila.numero_pedido == exame.numero_pedido,
                ExameFila.ativo == True,
            )
        ).all()
    elif exame.paciente_id and exame.data_pedido:
        irmaos = db.exec(
            select(ExameFila).where(
                ExameFila.paciente_id == exame.paciente_id,
                ExameFila.data_pedido == exame.data_pedido,
                ExameFila.ativo == True,
            )
        ).all()

    if tipo_efetivo == "agendamento":
        texto = gerar_texto_agendamento(paciente, exame, lista_exames=irmaos)
    else:
        texto = gerar_texto_entrada_fila(paciente, exame, lista_exames=irmaos)

    tel_raw = paciente.telefone or ""
    tel_norm = normalizar_telefone_whatsapp(tel_raw, ddd_padrao=ddd_padrao)
    link = gerar_link_whatsapp(tel_raw, texto, ddd_padrao=ddd_padrao)

    token_cfg = bool((getattr(c, "whatsapp_api_token", "") or "").strip()) if c else False
    url_cfg = bool((getattr(c, "whatsapp_api_url", "") or "").strip()) if c else False
    habilitado = bool(getattr(c, "whatsapp_habilitado", False)) if c else False

    return WhatsAppPreviewOut(
        exame_id=exame.id,
        paciente_id=paciente.id,
        paciente_nome=paciente.nome or "",
        telefone_original=tel_raw,
        telefone_formatado=formatar_telefone_exibicao(tel_raw),
        telefone_whatsapp=tel_norm,
        tipo_evento=tipo_efetivo,
        mensagem=texto,
        link_whatsapp=link,
        whatsapp_configurado=bool(url_cfg and token_cfg),
        whatsapp_habilitado=habilitado,
    )


@router.post("/enviar")
def enviar_mensagem_whatsapp(
    data: WhatsAppEnviarIn,
    db: Session = Depends(get_db),
    ator: User = Depends(get_current_user),
):
    """Dispara a mensagem via gateway WhatsApp ou registra log caso o envio manual/cópia tenha sido realizado."""
    if not (
        bool(getattr(ator, "is_superuser", False))
        or tem_tela(ator, "tfd_exames")
        or tem_tela(ator, "tfd_fila_lancamento")
        or tem_tela(ator, "tfd_agenda")
        or tem_tela(ator, "cfg_geral")
    ):
        raise HTTPException(403, "Sem permissão para disparar notificações via WhatsApp.")

    exame = db.get(ExameFila, data.exame_id)
    if not exame or not exame.ativo:
        raise HTTPException(404, "Solicitação não encontrada")

    paciente = db.get(Paciente, exame.paciente_id)
    if not paciente:
        raise HTTPException(404, "Paciente não encontrado")

    # Se não for superuser, impede envio para telefone arbitrário diferente do paciente
    if not bool(getattr(ator, "is_superuser", False)) and data.telefone_customizado:
        d_cust = "".join(c for c in data.telefone_customizado if c.isdigit())
        d_pac = "".join(c for c in (paciente.telefone or "") if c.isdigit())
        if not (d_pac and d_cust and (d_cust.endswith(d_pac[-8:]) or d_pac.endswith(d_cust[-8:]))):
            raise HTTPException(403, "Operadores só podem enviar notificações para o telefone cadastrado do paciente.")

    tipo_efetivo = data.tipo
    if tipo_efetivo == "auto":
        eh_agendado = bool(exame.data_agendada or (exame.status or "").lower() == "agendado")
        tipo_efetivo = "agendamento" if eh_agendado else "entrada_fila"

    if data.mensagem_customizada:
        texto = data.mensagem_customizada
    elif tipo_efetivo == "agendamento":
        texto = gerar_texto_agendamento(paciente, exame)
    else:
        texto = gerar_texto_entrada_fila(paciente, exame)

    tel = data.telefone_customizado if data.telefone_customizado else paciente.telefone

    resultado = disparar_whatsapp_gateway(
        db=db,
        telefone=tel,
        mensagem=texto,
        paciente_id=paciente.id,
        exame_id=exame.id,
        paciente_nome=paciente.nome or "",
        tipo_evento=tipo_efetivo,
    )
    return resultado


@router.get("/configuracao", response_model=WhatsAppConfigOut)
def obter_configuracao_whatsapp(
    db: Session = Depends(get_db),
    ator: User = Depends(get_current_user),
):
    """Consulta os parâmetros de integração de WhatsApp (apenas campos seguros/mascarados)."""
    if not (bool(getattr(ator, "is_superuser", False)) or tem_tela(ator, "cfg_geral") or tem_tela(ator, "integracoes")):
        raise HTTPException(403, "Apenas administradores podem visualizar configurações de integração")
    c = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
    if not c:
        c = IntegrationSettings(id=1)
        db.add(c)
        db.commit()

    return WhatsAppConfigOut(
        whatsapp_habilitado=bool(getattr(c, "whatsapp_habilitado", False)),
        whatsapp_provedor=getattr(c, "whatsapp_provedor", "api_oficial") or "api_oficial",
        whatsapp_api_url=getattr(c, "whatsapp_api_url", "") or "",
        whatsapp_token_configurado=bool((getattr(c, "whatsapp_api_token", "") or "").strip()),
        whatsapp_instancia_id=getattr(c, "whatsapp_instancia_id", "") or "",
        whatsapp_notificar_entrada_fila=bool(getattr(c, "whatsapp_notificar_entrada_fila", True)),
        whatsapp_notificar_agendamento=bool(getattr(c, "whatsapp_notificar_agendamento", True)),
        whatsapp_ddd_padrao=getattr(c, "whatsapp_ddd_padrao", "35") or "35",
    )


@router.put("/configuracao", response_model=WhatsAppConfigOut)
def salvar_configuracao_whatsapp(
    data: WhatsAppConfigIn,
    db: Session = Depends(get_db),
    ator: User = Depends(get_current_user),
):
    """Salva as configurações de integração com WhatsApp (Meta Cloud API, Z-API, Evolution ou Webhook)."""
    if not (bool(getattr(ator, "is_superuser", False)) or tem_tela(ator, "cfg_geral") or tem_tela(ator, "integracoes")):
        raise HTTPException(403, "Apenas administradores podem configurar integrações")

    c = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
    if not c:
        c = IntegrationSettings(id=1)
        db.add(c)

    c.whatsapp_habilitado = data.whatsapp_habilitado
    c.whatsapp_provedor = data.whatsapp_provedor
    c.whatsapp_api_url = data.whatsapp_api_url.strip()
    if data.whatsapp_api_token is not None and data.whatsapp_api_token.strip():
        c.whatsapp_api_token = data.whatsapp_api_token.strip()
    c.whatsapp_instancia_id = data.whatsapp_instancia_id.strip()
    c.whatsapp_notificar_entrada_fila = data.whatsapp_notificar_entrada_fila
    c.whatsapp_notificar_agendamento = data.whatsapp_notificar_agendamento
    c.whatsapp_ddd_padrao = data.whatsapp_ddd_padrao.strip() or "35"

    db.add(c)
    db.commit()
    db.refresh(c)

    return WhatsAppConfigOut(
        whatsapp_habilitado=bool(c.whatsapp_habilitado),
        whatsapp_provedor=c.whatsapp_provedor or "api_oficial",
        whatsapp_api_url=c.whatsapp_api_url or "",
        whatsapp_token_configurado=bool((c.whatsapp_api_token or "").strip()),
        whatsapp_instancia_id=c.whatsapp_instancia_id or "",
        whatsapp_notificar_entrada_fila=bool(c.whatsapp_notificar_entrada_fila),
        whatsapp_notificar_agendamento=bool(c.whatsapp_notificar_agendamento),
        whatsapp_ddd_padrao=c.whatsapp_ddd_padrao or "35",
    )


@router.post("/testar")
def endpoint_testar_whatsapp(
    data: WhatsAppTestarIn,
    db: Session = Depends(get_db),
    ator: User = Depends(get_current_user),
):
    """Realiza um disparo de teste para verificar a conectividade do gateway com o WhatsApp."""
    if not (bool(getattr(ator, "is_superuser", False)) or tem_tela(ator, "cfg_geral") or tem_tela(ator, "integracoes")):
        raise HTTPException(403, "Apenas administradores podem testar integrações")

    resultado = disparar_whatsapp_gateway(
        db=db,
        telefone=data.telefone,
        mensagem=data.mensagem,
        tipo_evento="teste",
        paciente_nome=f"Teste por {ator.nome or ator.username}",
    )
    return resultado


@router.get("/logs")
def listar_logs_whatsapp(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    ator: User = Depends(get_current_user),
):
    """Consulta os últimos disparos e tentativas de envio via WhatsApp."""
    if not (bool(getattr(ator, "is_superuser", False)) or tem_tela(ator, "cfg_geral") or tem_tela(ator, "integracoes")):
        raise HTTPException(403, "Apenas administradores podem visualizar o histórico de logs do WhatsApp.")
    stmt = select(WhatsAppLog).order_by(desc(WhatsAppLog.criado_em)).limit(limit)
    rows = db.exec(stmt).all()
    return rows


@router.post("/lembretes/disparar")
def disparar_lembretes_manualmente(
    data_alvo: str | None = Query(default=None, description="Data alvo no formato AAAA-MM-DD (padrão: amanhã)"),
    db: Session = Depends(get_db),
    ator: User = Depends(get_current_user),
):
    """Executa imediatamente a rotina de envio de lembretes via WhatsApp para os pacientes com exame marcado para o dia seguinte."""
    if not (bool(getattr(ator, "is_superuser", False)) or tem_tela(ator, "cfg_geral")):
        raise HTTPException(403, "Apenas administradores podem disparar rotinas de lembretes em lote.")
    from datetime import datetime
    from app.services.whatsapp_reminder_worker import executar_disparo_lembretes_dia_anterior

    target = None
    if data_alvo:
        try:
            target = datetime.strptime(data_alvo, "%Y-%m-%d").date()
        except Exception:
            raise HTTPException(400, "Formato de data inválido. Use AAAA-MM-DD.")

    res = executar_disparo_lembretes_dia_anterior(db, target_date=target)
    return res
