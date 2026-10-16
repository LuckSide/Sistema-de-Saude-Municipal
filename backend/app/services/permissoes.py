"""Matriz de permissões (RBAC granular).

Fonte única da hierarquia telas → subtelas no backend. O pai implica os
filhos (payloads antigos com só o pai continuam valendo). Ações são
opt-in: sem registro em `User.acoes`, tela concedida = todas as ações
(comportamento legado).
"""

import json

from fastapi import Depends, HTTPException

# NOTA: get_user_ok é importado dentro das factories (import circular:
# core.deps -> services.users -> este módulo).

ACOES_VALIDAS = ("ver", "criar", "editar", "excluir")

# subtela -> módulo pai (pai implica filhas)
PAI_DE: dict[str, str] = {
    "dash_indicadores": "dashboard",
    "tfd_resumo": "tfd",
    "tfd_viagens": "tfd",
    "tfd_pacientes": "tfd",
    "tfd_exames": "tfd",
    "tfd_catalogo": "tfd",
    "tfd_destinos": "tfd",
    "tfd_frota": "tfd",
    "tfd_frota_gestao": "tfd",
    "tfd_faturamento": "tfd",
    "tfd_medico": "tfd",
    "tfd_agenda": "tfd",
    "tfd_agendamentos": "tfd_agenda",
    "lab_marcacao": "lab",
    "lab_fila": "lab",
    "lab_agenda": "lab",
    "lab_vagas": "lab",
    "lab_audit": "lab",
    "lab_faturamento": "lab",
    "lab_sigtap": "lab",
    "cfg_geral": "integracoes",
    "cfg_filas": "integracoes",
    "cfg_pec": "integracoes",
    "cfg_rnds": "integracoes",
}

PAIS = ("dashboard", "tfd", "lab", "aps", "usuarios", "integracoes")

TODAS_TELAS = frozenset(list(PAI_DE) + list(PAI_DE.values()) + list(PAIS))

# Telas exclusivas: o pai NÃO implica a filha (ex: perfil Médico exige
# concessão explícita — ter "tfd" não dá acesso a "tfd_medico").
EXCLUSIVAS = frozenset({"tfd_medico"})


def telas_list(user) -> list[str]:
    return [t.strip() for t in (user.telas or "").split(",") if t.strip()]


def acoes_map(user) -> dict[str, list[str]]:
    """{codigo: [acoes]} sanitizado. Ausente = sem restrição (legado)."""
    try:
        raw = json.loads(getattr(user, "acoes", None) or "{}")
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, list[str]] = {}
    for k, v in raw.items():
        if k in TODAS_TELAS and isinstance(v, list):
            limpas = [a for a in v if a in ACOES_VALIDAS]
            if limpas:
                out[k] = limpas
    return out


def tem_tela(user, codigo: str) -> bool:
    if bool(getattr(user, "is_superuser", False)):
        return True
    proprias = telas_list(user)
    if codigo in proprias:
        return True
    if codigo in EXCLUSIVAS:
        return False
    pai = PAI_DE.get(codigo)
    return bool(pai) and pai in proprias


def tem_acao(user, codigo: str, acao: str) -> bool:
    if bool(getattr(user, "is_superuser", False)):
        return True
    mapa = acoes_map(user)
    atual = mapa.get(codigo)
    if atual is None and codigo not in EXCLUSIVAS:
        pai = PAI_DE.get(codigo)
        atual = mapa.get(pai) if pai else None
    if atual is None:
        return True  # sem registro = tudo permitido (compat)
    return acao in atual


def validar_acoes(raw) -> dict[str, list[str]]:
    """Valida payload {codigo: [acoes]} p/ gravar. Erro -> ValueError."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("acoes inválidas (use {tela: [ver, criar, editar, excluir]})")
    out: dict[str, list[str]] = {}
    for k, v in raw.items():
        if k not in TODAS_TELAS:
            raise ValueError(f"tela desconhecida em acoes: {k}")
        if not isinstance(v, list) or not v:
            raise ValueError(f"acoes vazias p/ {k}")
        limpas = [a for a in v if a in ACOES_VALIDAS]
        if len(limpas) != len(v):
            raise ValueError(f"ação inválida p/ {k} (use ver|criar|editar|excluir)")
        out[k] = limpas
    return out


def need_perm(codigo: str, *acoes: str):
    """Guarda tela (+ ações). Ex: need_perm("tfd_viagens", "criar")."""
    from app.core.deps import get_current_user_senha_ok as get_user_ok
    from app.models.user import User

    def check(user: User = Depends(get_user_ok)) -> User:
        if not tem_tela(user, codigo):
            raise HTTPException(status_code=403, detail=f"Sem acesso a {codigo}")
        for a in acoes:
            if not tem_acao(user, codigo, a):
                raise HTTPException(status_code=403, detail=f"Sem permissão '{a}' em {codigo}")
        return user

    return check


def need_any_perm(*codigos: str, acoes: tuple[str, ...] = ()):
    """Guarda OU entre telas (ex: agenda visível p/ lab_agenda ou lab_vagas).

    Com acoes, a ação é exigida na tela que concedeu o acesso.
    """

    from app.core.deps import get_current_user_senha_ok as get_user_ok
    from app.models.user import User

    def check(user: User = Depends(get_user_ok)) -> User:
        for c in codigos:
            if tem_tela(user, c) and all(tem_acao(user, c, a) for a in acoes):
                return user
        raise HTTPException(status_code=403, detail="Sem acesso")

    return check
