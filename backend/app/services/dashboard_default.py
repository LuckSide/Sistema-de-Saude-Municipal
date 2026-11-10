"""Geração de dashboard padrão customizado de acordo com o perfil/permissões do usuário."""
import json
import uuid
from sqlmodel import Session
from app.models.dashboard_prefs import UserDashboardPrefs
from app.models.user import User
from app.services.permissoes import tem_tela


def _uid(ref: str) -> str:
    return f"{ref}-{uuid.uuid4().hex[:8]}"


def gerar_layout_padrao_para_usuario(user: User) -> list[dict]:
    items: list[dict] = []

    # 1. ATALHOS baseados nas telas permitidas
    atalhos_candidatos: list[str] = []

    if user.is_superuser:
        atalhos_candidatos = [
            "tfd_exames",
            "tfd_medico",
            "tfd_viagens",
            "tfd_frota",
            "dash_indicadores",
            "usuarios",
            "cfg_geral",
        ]
    elif user.medico_id or getattr(user, "area", "") == "medico":
        atalhos_candidatos = [
            "tfd_medico",
            "tfd_exames",
            "tfd_agenda",
            "dash_indicadores",
        ]
    elif getattr(user, "area", "") == "motorista":
        atalhos_candidatos = [
            "tfd_viagens",
            "tfd_frota",
        ]
    else:
        # Se médico:
        if tem_tela(user, "tfd_medico"):
            atalhos_candidatos.append("tfd_medico")
        if tem_tela(user, "tfd_exames"):
            atalhos_candidatos.append("tfd_exames")
        if tem_tela(user, "tfd_agenda"):
            atalhos_candidatos.append("tfd_agenda")

        # Se gestão de viagens / frota:
        if tem_tela(user, "tfd_viagens") or tem_tela(user, "tfd_frota_gestao"):
            atalhos_candidatos.append("tfd_viagens")
        if tem_tela(user, "tfd_frota") or tem_tela(user, "tfd_frota_gestao"):
            atalhos_candidatos.append("tfd_frota")

        # Se TFD geral:
        if tem_tela(user, "tfd_resumo") or tem_tela(user, "tfd"):
            if "tfd_resumo" not in atalhos_candidatos and tem_tela(user, "tfd_resumo"):
                atalhos_candidatos.append("tfd_resumo")
            if tem_tela(user, "tfd_pacientes"):
                atalhos_candidatos.append("tfd_pacientes")
            if tem_tela(user, "tfd_faturamento"):
                atalhos_candidatos.append("tfd_faturamento")

        # Se APS:
        if tem_tela(user, "aps"):
            atalhos_candidatos.append("aps")

        # Se Laboratório:
        if tem_tela(user, "lab_marcacao"):
            atalhos_candidatos.append("lab_marcacao")
        if tem_tela(user, "lab_fila"):
            atalhos_candidatos.append("lab_fila")
        if tem_tela(user, "lab_agenda"):
            atalhos_candidatos.append("lab_agenda")

        # Se Indicadores / Admin:
        if tem_tela(user, "dash_indicadores"):
            atalhos_candidatos.append("dash_indicadores")
        if tem_tela(user, "usuarios"):
            atalhos_candidatos.append("usuarios")

    vistos_atalhos = set()
    for ref in atalhos_candidatos:
        if ref not in vistos_atalhos and tem_tela(user, ref):
            vistos_atalhos.add(ref)
            items.append({"id": _uid(ref), "tipo": "atalho", "ref": ref})

    # 2. WIDGETS / GRÁFICOS baseados nas permissões
    widgets_candidatos: list[str] = []

    if user.is_superuser:
        widgets_candidatos = [
            "resumo-tfd",
            "fila-prioridades",
            "frota-status",
            "fila-especialidade",
        ]
    elif user.medico_id or getattr(user, "area", "") == "medico":
        widgets_candidatos = [
            "fila-prioridades",
            "fila-especialidade",
            "tempo-fila-indicadores",
        ]
    elif getattr(user, "area", "") == "motorista":
        widgets_candidatos = [
            "frota-status",
            "viagens-proximas",
        ]
    else:
        if tem_tela(user, "tfd_resumo") or tem_tela(user, "tfd"):
            widgets_candidatos.append("resumo-tfd")
        if tem_tela(user, "tfd_exames") or tem_tela(user, "tfd_medico"):
            widgets_candidatos.append("fila-prioridades")
            widgets_candidatos.append("fila-especialidade")
        if tem_tela(user, "tfd_frota") or tem_tela(user, "tfd_frota_gestao"):
            widgets_candidatos.append("frota-status")
        if tem_tela(user, "tfd_viagens"):
            widgets_candidatos.append("viagens-proximas")
        if tem_tela(user, "dash_indicadores"):
            widgets_candidatos.append("tempo-fila-indicadores")
        if tem_tela(user, "aps"):
            widgets_candidatos.append("painel-aps")
        if tem_tela(user, "lab_agenda") or tem_tela(user, "lab_vagas") or tem_tela(user, "lab"):
            widgets_candidatos.append("agenda-semana")

    vistos_widgets = set()
    for w_id in widgets_candidatos:
        if w_id not in vistos_widgets:
            vistos_widgets.add(w_id)
            items.append({"id": _uid(w_id), "tipo": "widget", "ref": w_id})

    return items


def criar_dashboard_padrao_se_ausente(db: Session, user: User) -> list[dict]:
    row = db.get(UserDashboardPrefs, user.id)
    if row and (row.layout or "").strip() and row.layout != "[]":
        try:
            dados = json.loads(row.layout)
            if isinstance(dados, list) and len(dados) > 0:
                return dados
        except Exception:
            pass

    layout_padrao = gerar_layout_padrao_para_usuario(user)
    if not row:
        row = UserDashboardPrefs(user_id=user.id, layout=json.dumps(layout_padrao))
    else:
        row.layout = json.dumps(layout_padrao)
    db.add(row)
    db.commit()
    db.refresh(row)
    return layout_padrao
