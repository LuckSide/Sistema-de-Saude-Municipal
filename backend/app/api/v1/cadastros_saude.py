from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.core.deps import get_db as _get_db
from app.models.cadastros_saude import Medico, UnidadeSaude
from app.schemas.cadastros_saude import (
    MedicoIn,
    MedicoOut,
    UnidadeIn,
    UnidadeOut,
)
from app.services.permissoes import need_any_perm, need_perm


router = APIRouter()

# ---------- Médicos ----------
@router.get("/medicos", response_model=list[MedicoOut])
def listar_medicos(db: Session = Depends(_get_db), _=Depends(need_any_perm("usuarios", "tfd_exames", "tfd_medico"))):
    return [MedicoOut(**m.model_dump()) for m in db.exec(select(Medico).order_by(Medico.nome)).all()]


@router.post("/medicos", response_model=MedicoOut, status_code=201)
def criar_medico(data: MedicoIn, db: Session = Depends(_get_db), _=Depends(need_perm("usuarios", "criar"))):
    obj = Medico(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return MedicoOut(**obj.model_dump())


@router.put("/medicos/{mid}", response_model=MedicoOut)
def atualizar_medico(mid: int, data: MedicoIn, db: Session = Depends(_get_db), _=Depends(need_perm("usuarios", "editar"))):
    obj = db.get(Medico, mid)
    if not obj:
        raise HTTPException(404, "Médico não encontrado")
    for k, v in data.model_dump().items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return MedicoOut(**obj.model_dump())


@router.delete("/medicos/{mid}", status_code=204)
def inativar_medico(mid: int, db: Session = Depends(_get_db), _=Depends(need_perm("usuarios", "excluir"))):
    obj = db.get(Medico, mid)
    if not obj:
        raise HTTPException(404, "Médico não encontrado")
    obj.ativo = False
    db.add(obj)
    db.commit()


# ---------- Unidades / PSFs ----------
@router.get("/unidades-saude", response_model=list[UnidadeOut])
def listar_unidades(db: Session = Depends(_get_db), _=Depends(need_any_perm("usuarios", "tfd_exames", "tfd_medico"))):
    return [UnidadeOut(**u.model_dump()) for u in db.exec(select(UnidadeSaude).order_by(UnidadeSaude.nome)).all()]


@router.post("/unidades-saude", response_model=UnidadeOut, status_code=201)
def criar_unidade(data: UnidadeIn, db: Session = Depends(_get_db), _=Depends(need_perm("usuarios", "criar"))):
    obj = UnidadeSaude(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return UnidadeOut(**obj.model_dump())


@router.put("/unidades-saude/{uid}", response_model=UnidadeOut)
def atualizar_unidade(uid: int, data: UnidadeIn, db: Session = Depends(_get_db), _=Depends(need_perm("usuarios", "editar"))):
    obj = db.get(UnidadeSaude, uid)
    if not obj:
        raise HTTPException(404, "Unidade não encontrada")
    for k, v in data.model_dump().items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return UnidadeOut(**obj.model_dump())


@router.delete("/unidades-saude/{uid}", status_code=204)
def inativar_unidade(uid: int, db: Session = Depends(_get_db), _=Depends(need_perm("usuarios", "excluir"))):
    obj = db.get(UnidadeSaude, uid)
    if not obj:
        raise HTTPException(404, "Unidade não encontrada")
    obj.ativo = False
    db.add(obj)
    db.commit()


# ---------- Exportações XLSX ----------
@router.get("/medicos/exportar")
def exportar_medicos(
    db: Session = Depends(_get_db), ator=Depends(need_perm("usuarios")),
):
    from app.services.export_xlsx import resposta_xlsx

    linhas = [{
        "nome": m.nome, "cpf": m.cpf or "", "crm": m.crm or "",
        "cbo": " ".join(x for x in [m.cbo_codigo or "", m.cbo_descricao or ""] if x),
        "esps": m.especialidades or "", "contato": " ".join(x for x in [m.telefone or "", m.email or ""] if x),
        "status": "ativo" if m.ativo else "inativo",
    } for m in db.exec(select(Medico).order_by(Medico.nome)).all()]
    return resposta_xlsx(
        "Médicos / profissionais", getattr(ator, "nome", "") or getattr(ator, "username", ""),
        [
            {"chave": "nome", "rotulo": "Nome completo", "largura": 34},
            {"chave": "cpf", "rotulo": "CPF", "largura": 18},
            {"chave": "crm", "rotulo": "CRM", "largura": 16},
            {"chave": "cbo", "rotulo": "CBO", "largura": 30},
            {"chave": "esps", "rotulo": "Especialidades", "largura": 34},
            {"chave": "contato", "rotulo": "Contato", "largura": 34},
            {"chave": "status", "rotulo": "Status", "largura": 12},
        ],
        linhas, "medicos",
    )


@router.get("/unidades-saude/exportar")
def exportar_unidades(
    db: Session = Depends(_get_db), ator=Depends(need_perm("usuarios")),
):
    from app.services.export_xlsx import resposta_xlsx

    linhas = [{
        "nome": u.nome, "cnes": u.cnes or "",
        "endereco": " ".join(x for x in [
            u.endereco or "", f"Nº {u.numero}" if getattr(u, "numero", "") else "",
            u.bairro or "", getattr(u, "municipio", "") or "",
            f"CEP {u.cep}" if getattr(u, "cep", "") else "",
        ] if x),
        "telefone": u.telefone or "",
        "status": "ativo" if u.ativo else "inativo",
    } for u in db.exec(select(UnidadeSaude).order_by(UnidadeSaude.nome)).all()]
    return resposta_xlsx(
        "PSFs / Unidades de saúde", getattr(ator, "nome", "") or getattr(ator, "username", ""),
        [
            {"chave": "nome", "rotulo": "Nome", "largura": 34},
            {"chave": "cnes", "rotulo": "CNES", "largura": 14},
            {"chave": "endereco", "rotulo": "Endereço completo", "largura": 52},
            {"chave": "telefone", "rotulo": "Telefone", "largura": 16},
            {"chave": "status", "rotulo": "Status", "largura": 12},
        ],
        linhas, "unidades_saude",
    )
