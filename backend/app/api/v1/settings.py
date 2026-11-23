"""Settings globais (cidade/favicon/título) — leitura pública p/ título, escrita só admin."""

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.core.deps import get_current_user_senha_ok as get_user_ok, get_db
from app.db.session import engine
from app.models.settings import SystemSettings
from app.models.user import User
from app.services.permissoes import need_any_perm, need_perm

router = APIRouter()

URL_MARCA_RE = re.compile(r"^(https?://|data:image/)")


def validar_url_marca(v: str, campo: str) -> str:
    v = (v or "").strip()
    if v and not URL_MARCA_RE.match(v):
        raise HTTPException(status_code=400, detail=f"{campo} deve ser https://… ou data:image/…")
    return v


class SettingsOut(BaseModel):
    cidade: str = "Guapé"
    uf: str = "MG"
    subtitulo: str = "Secretaria Municipal"
    brasao_url: str = ""
    icone_url: str = ""


class SettingsIn(BaseModel):
    cidade: str = Field(min_length=2, max_length=80)
    uf: str = Field(default="MG", min_length=2, max_length=2)
    subtitulo: str = Field(default="Secretaria Municipal", max_length=120)
    brasao_url: str = Field(default="", max_length=500)
    icone_url: str = Field(default="", max_length=500)


def get_settings(db: Session) -> SystemSettings:
    obj = db.exec(select(SystemSettings).where(SystemSettings.id == 1)).first()
    if not obj:
        obj = SystemSettings(id=1, cidade="Guapé", uf="MG", subtitulo="Secretaria Municipal")
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj


def to_out(s: SystemSettings) -> SettingsOut:
    return SettingsOut(
        cidade=s.cidade, uf=s.uf, subtitulo=s.subtitulo,
        brasao_url=s.brasao_url or "", icone_url=s.icone_url or "",
    )


@router.get("/settings", response_model=SettingsOut)
def ler_settings(db: Session = Depends(get_db), _=Depends(get_user_ok)):
    return to_out(get_settings(db))


@router.get("/settings/public", response_model=SettingsOut)
def ler_settings_public():
    """Sem login: só nome cidade p/ título/login. Sem PII."""
    from sqlmodel import Session as S

    with S(engine) as db:
        return to_out(get_settings(db))


@router.put("/settings", response_model=SettingsOut)
def salvar_settings(
    data: SettingsIn,
    db: Session = Depends(get_db),
    # Cidade/marca: superuser ou cfg_geral+editar (need_perm já bloqueia troca pendente).
    user: User = Depends(need_perm("cfg_geral", "editar")),
):
    _ = user
    try:
        s = get_settings(db)
        s.cidade = data.cidade.strip()
        s.uf = data.uf.strip().upper()
        s.subtitulo = data.subtitulo.strip() or "Secretaria Municipal"
        s.brasao_url = validar_url_marca(data.brasao_url, "Brasão")
        s.icone_url = validar_url_marca(data.icone_url, "Ícone")
        if len(s.cidade) < 2:
            raise HTTPException(status_code=400, detail="Cidade inválida")
        db.add(s)
        db.commit()
        db.refresh(s)
    except HTTPException:
        raise
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Falha ao salvar configurações")
    return to_out(s)


# ---------- Gestão de Procedimentos / Exames Permitidos (SIGTAP) ----------
class ExamesPermitidosIn(BaseModel):
    codigos: list[str] = Field(default_factory=list)
    exames_por_tipo_fila: dict[str, list[str]] = Field(default_factory=dict)
    valores_combinados: dict[str, float] = Field(default_factory=dict)


@router.get("/settings/exames-permitidos")
def obter_exames_permitidos(
    db: Session = Depends(get_db),
    _user: User = Depends(get_user_ok),
):
    import json
    from app.models.lab_exames import SigtapProcedimento
    from app.models.tfd import TipoFila

    s = get_settings(db)
    raw = getattr(s, "exames_habilitados_sigtap", "") or ""
    codigos_habilitados = [c.strip() for c in raw.split(",") if c.strip()]

    raw_por_fila = getattr(s, "exames_por_tipo_fila_json", "{}") or "{}"
    try:
        exames_por_tipo_fila = json.loads(raw_por_fila)
        if not isinstance(exames_por_tipo_fila, dict):
            exames_por_tipo_fila = {}
    except Exception:
        exames_por_tipo_fila = {}

    raw_val_comb = getattr(s, "valores_combinados_sigtap_json", "{}") or "{}"
    try:
        valores_combinados = json.loads(raw_val_comb)
        if not isinstance(valores_combinados, dict):
            valores_combinados = {}
    except Exception:
        valores_combinados = {}

    # Busca tipos de filas laboratoriais/sangue do município
    filas_db = db.exec(
        select(TipoFila).where(TipoFila.ativo == True).order_by(TipoFila.nome)
    ).all()

    tipos_fila_nomes = set()
    tipos_fila_list = []

    filas_padrao = [
        {"id": "EX. LAB. PSF ROTINA", "nome": "EX. LAB. PSF ROTINA (Rotina PSF)", "codigo": "ROTINA"},
        {"id": "EX. LAB. PSF PRIORIDADE", "nome": "EX. LAB. PSF PRIORIDADE (Urgência / Prioritário)", "codigo": "PRIORIDADE"},
        {"id": "EX. LAB. GESTANTE / PRE-NATAL", "nome": "EX. LAB. GESTANTE / PRE-NATAL (Pré-Natal)", "codigo": "PRE_NATAL"},
        {"id": "EX. LAB. PEDIATRIA", "nome": "EX. LAB. PEDIATRIA (Infantil / Pediatria)", "codigo": "PEDIATRIA"},
        {"id": "EX. LAB. SECRETARIA", "nome": "EX. LAB. SECRETARIA (Secretaria de Saúde)", "codigo": "SECRETARIA"},
    ]
    for fp in filas_padrao:
        tipos_fila_nomes.add(fp["id"])
        tipos_fila_list.append(fp)

    for f in filas_db:
        nome_f = (f.nome or "").strip()
        if nome_f and nome_f not in tipos_fila_nomes:
            if f.tipo_fila == "EXAME_LABORATORIAL" or any(k in nome_f.upper() for k in ("LAB", "SANGUE", "EXAME", "ROTINA")):
                tipos_fila_nomes.add(nome_f)
                tipos_fila_list.append({"id": nome_f, "nome": nome_f, "codigo": f.codigo or ""})

    # Procedimentos laboratoriais da tabela SIGTAP (Grupo 02, Subgrupo 02 - Diagnóstico Laboratorial Clínico / Sangue)
    procs = db.exec(
        select(SigtapProcedimento)
        .where(SigtapProcedimento.codigo.like("0202%"))
        .order_by(SigtapProcedimento.descricao)
    ).all()

    lista_sigtap = [
        {
            "id": p.id,
            "codigo": p.codigo,
            "descricao": p.descricao,
            "instrumento": p.instrumento or "BPA-C",
            "valor_sa": round(float(p.valor_sa or 0.0), 2),
            "valor_sp": round(float(p.valor_sp or 0.0), 2),
            "valor_sh": round(float(p.valor_sh or 0.0), 2),
            "valor_sigtap": round(float(p.valor_sa or 0.0) + float(p.valor_sp or 0.0), 2),
            "valor_combinado": round(float(getattr(p, "valor_combinado", 0.0) or valores_combinados.get(p.codigo, 0.0) or 0.0), 2),
            "tipos_fila_permitidos": getattr(p, "tipos_fila_permitidos", "") or "",
        }
        for p in procs
    ]

    return {
        "codigos_habilitados": codigos_habilitados,
        "total_habilitados": len(codigos_habilitados),
        "procedimentos_sigtap": lista_sigtap,
        "tipos_fila": tipos_fila_list,
        "exames_por_tipo_fila": exames_por_tipo_fila,
        "valores_combinados": valores_combinados,
    }


@router.put("/settings/exames-permitidos")
def salvar_exames_permitidos(
    data: ExamesPermitidosIn,
    db: Session = Depends(get_db),
    _user: User = Depends(need_any_perm("cfg_geral", "cfg_exames", acoes=("editar",))),
):
    import json
    from app.models.lab_exames import SigtapProcedimento

    s = get_settings(db)
    limpos = sorted({c.strip() for c in data.codigos if c.strip()})
    s.exames_habilitados_sigtap = ",".join(limpos)

    clean_por_fila = {}
    for tf, cods in (data.exames_por_tipo_fila or {}).items():
        tf_clean = tf.strip()
        if tf_clean:
            clean_por_fila[tf_clean] = sorted({c.strip() for c in cods if c.strip()})
    s.exames_por_tipo_fila_json = json.dumps(clean_por_fila, ensure_ascii=False)

    clean_val_comb = {}
    for cod, val in (data.valores_combinados or {}).items():
        cod_clean = cod.strip()
        if cod_clean:
            clean_val_comb[cod_clean] = max(0.0, round(float(val or 0.0), 2))
    s.valores_combinados_sigtap_json = json.dumps(clean_val_comb, ensure_ascii=False)

    db.add(s)

    # Sincroniza em SigtapProcedimento
    procs = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo.like("0202%"))).all()
    for p in procs:
        alterado = False
        if p.codigo in clean_val_comb:
            novo_val = clean_val_comb[p.codigo]
            if getattr(p, "valor_combinado", 0.0) != novo_val:
                p.valor_combinado = novo_val
                alterado = True
        elif getattr(p, "valor_combinado", 0.0) > 0 and clean_val_comb:
            p.valor_combinado = 0.0
            alterado = True

        filas_contendo = [tf for tf, cods in clean_por_fila.items() if p.codigo in cods]
        novo_tf_str = ",".join(sorted(filas_contendo))
        if getattr(p, "tipos_fila_permitidos", "") != novo_tf_str:
            p.tipos_fila_permitidos = novo_tf_str
            alterado = True

        if alterado:
            db.add(p)

    db.commit()
    db.refresh(s)
    return {
        "ok": True,
        "total_habilitados": len(limpos),
        "codigos_habilitados": limpos,
        "exames_por_tipo_fila": clean_por_fila,
        "valores_combinados": clean_val_comb,
    }

