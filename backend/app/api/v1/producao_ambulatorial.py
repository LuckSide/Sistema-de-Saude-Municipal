from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, col, func, or_, select

from app.core.deps import get_current_user, get_db
from app.models.cadastros_saude import EquipeSaude, Medico, UnidadeSaude
from app.models.lab_exames import SigtapCbo, SigtapCid, SigtapProcedimento
from app.models.producao_ambulatorial import ProducaoAmbulatorial
from app.models.tfd import Paciente
from app.models.user import User
from app.schemas.producao_ambulatorial import (
    ProcedimentoSigtapItem,
    ProducaoAmbulatorialCreate,
    ProducaoAmbulatorialOut,
    ProducaoAmbulatorialUpdate,
    ResumoCompetenciaOut,
)
from app.services.producao_service import (
    atualizar_producao,
    calcular_idade_em_anos,
    criar_producao,
    excluir_producao,
    extrair_competencia,
    normalizar_cbo,
    obter_resumo_competencia,
)

router = APIRouter()


def _enriquecer_producao_out(
    p: ProducaoAmbulatorial,
    map_medicos: dict[int, str],
    map_unidades: dict[int, str],
    map_equipes: dict[int, tuple[str, str]],
) -> ProducaoAmbulatorialOut:
    """Preenche metadados humanos para exibição amigável no frontend."""
    eq_info = map_equipes.get(p.equipe_id) if p.equipe_id else None
    idade = calcular_idade_em_anos(p.paciente_data_nascimento, p.data_atendimento) if p.paciente_data_nascimento else None

    return ProducaoAmbulatorialOut(
        id=p.id,
        unidade_saude_id=p.unidade_saude_id,
        unidade_saude_nome=map_unidades.get(p.unidade_saude_id, f"Unidade #{p.unidade_saude_id}"),
        medico_id=p.medico_id,
        medico_nome=map_medicos.get(p.medico_id, f"Profissional #{p.medico_id}"),
        equipe_id=p.equipe_id,
        equipe_nome=eq_info[0] if eq_info else None,
        equipe_ine=eq_info[1] if eq_info else None,
        procedimento_id=p.procedimento_id,
        procedimento_codigo=p.procedimento_codigo,
        procedimento_nome=p.procedimento_nome,
        cbo_codigo=p.cbo_codigo,
        competencia=p.competencia,
        data_atendimento=p.data_atendimento,
        instrumento_registro=p.instrumento_registro,
        quantidade=p.quantidade,
        valor_unitario=p.valor_unitario,
        valor_total=p.valor_total,
        paciente_id=p.paciente_id,
        paciente_nome=p.paciente_nome,
        paciente_cns=p.paciente_cns,
        paciente_sexo=p.paciente_sexo,
        paciente_data_nascimento=p.paciente_data_nascimento,
        paciente_idade=idade,
        paciente_municipio_ibge=p.paciente_municipio_ibge,
        cid10=p.cid10,
        numero_autorizacao=p.numero_autorizacao,
        servico_codigo=p.servico_codigo,
        classificacao_codigo=p.classificacao_codigo,
        origem=p.origem,
        status=p.status,
        usuario_id=p.usuario_id,
        criado_em=p.criado_em,
        atualizado_em=p.atualizado_em,
    )


@router.get("", response_model=dict[str, Any])
@router.get("/", response_model=dict[str, Any], include_in_schema=False)
def listar_producoes(
    competencia: str | None = Query(default=None, description="Competência AAAAMM"),
    medico_id: int | None = Query(default=None, description="ID do profissional executante"),
    unidade_saude_id: int | None = Query(default=None, description="ID da Unidade"),
    data_inicio: date | None = Query(default=None, description="Data início do atendimento"),
    data_fim: date | None = Query(default=None, description="Data fim do atendimento"),
    instrumento: str | None = Query(default=None, description="BPA-C ou BPA-I"),
    termo: str | None = Query(default=None, description="Busca textual por código/nome de procedimento ou paciente"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _ator: User = Depends(get_current_user),
):
    """Lista os registros de produção ambulatorial com filtros e paginação."""
    stmt = select(ProducaoAmbulatorial)

    if competencia:
        comp_limpa = extrair_competencia(None, competencia)
        stmt = stmt.where(ProducaoAmbulatorial.competencia == comp_limpa)

    if medico_id:
        stmt = stmt.where(ProducaoAmbulatorial.medico_id == medico_id)

    if unidade_saude_id:
        stmt = stmt.where(ProducaoAmbulatorial.unidade_saude_id == unidade_saude_id)

    if data_inicio:
        stmt = stmt.where(ProducaoAmbulatorial.data_atendimento >= data_inicio)

    if data_fim:
        stmt = stmt.where(ProducaoAmbulatorial.data_atendimento <= data_fim)

    if instrumento:
        stmt = stmt.where(ProducaoAmbulatorial.instrumento_registro == instrumento.upper().strip())

    if termo and termo.strip():
        t = f"%{termo.strip()}%"
        stmt = stmt.where(
            or_(
                ProducaoAmbulatorial.procedimento_codigo.ilike(t),
                ProducaoAmbulatorial.procedimento_nome.ilike(t),
                ProducaoAmbulatorial.paciente_nome.ilike(t),
                ProducaoAmbulatorial.paciente_cns.ilike(t),
                ProducaoAmbulatorial.cid10.ilike(t),
            )
        )

    # Conta total
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = db.exec(count_stmt).one() or 0

    # Ordenação e paginação
    stmt = stmt.order_by(ProducaoAmbulatorial.data_atendimento.desc(), ProducaoAmbulatorial.id.desc())
    stmt = stmt.offset(offset).limit(limit)
    itens = list(db.exec(stmt).all())

    # Mapas de metadados
    medicos_ids = {p.medico_id for p in itens if p.medico_id}
    unidades_ids = {p.unidade_saude_id for p in itens if p.unidade_saude_id}
    equipes_ids = {p.equipe_id for p in itens if p.equipe_id}

    map_medicos = {}
    if medicos_ids:
        for m in db.exec(select(Medico).where(Medico.id.in_(medicos_ids))).all():
            map_medicos[m.id] = m.nome

    map_unidades = {}
    if unidades_ids:
        for u in db.exec(select(UnidadeSaude).where(UnidadeSaude.id.in_(unidades_ids))).all():
            map_unidades[u.id] = u.nome

    map_equipes = {}
    if equipes_ids:
        for eq in db.exec(select(EquipeSaude).where(EquipeSaude.id.in_(equipes_ids))).all():
            map_equipes[eq.id] = (eq.nome_equipe, eq.ine)

    itens_out = [_enriquecer_producao_out(p, map_medicos, map_unidades, map_equipes) for p in itens]

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "itens": itens_out,
    }


@router.get("/resumo-competencia", response_model=ResumoCompetenciaOut)
def resumo_competencia(
    competencia: str = Query(..., description="Competência no formato AAAAMM"),
    medico_id: int | None = Query(default=None, description="Filtrar por médico"),
    unidade_saude_id: int | None = Query(default=None, description="Filtrar por unidade de saúde"),
    db: Session = Depends(get_db),
    _ator: User = Depends(get_current_user),
):
    """Retorna indicadores agregados da produção ambulatorial na competência."""
    return obter_resumo_competencia(
        db=db,
        competencia=competencia,
        medico_id=medico_id,
        unidade_saude_id=unidade_saude_id,
    )


@router.post("", response_model=ProducaoAmbulatorialOut, status_code=201)
@router.post("/", response_model=ProducaoAmbulatorialOut, status_code=201, include_in_schema=False)
def cadastrar_producao(
    dados: ProducaoAmbulatorialCreate,
    db: Session = Depends(get_db),
    ator: User = Depends(get_current_user),
):
    """Lança nova produção ambulatorial com validação rigorosa de regras SIA/SUS e SIGTAP."""
    registro = criar_producao(db, dados, usuario_atual=ator)

    # Enriquecimento
    medico = db.get(Medico, registro.medico_id)
    unidade = db.get(UnidadeSaude, registro.unidade_saude_id)
    equipe = db.get(EquipeSaude, registro.equipe_id) if registro.equipe_id else None

    map_medicos = {medico.id: medico.nome} if medico else {}
    map_unidades = {unidade.id: unidade.nome} if unidade else {}
    map_equipes = {equipe.id: (equipe.nome_equipe, equipe.ine)} if equipe else {}

    return _enriquecer_producao_out(registro, map_medicos, map_unidades, map_equipes)


@router.put("/{producao_id}", response_model=ProducaoAmbulatorialOut)
def alterar_producao(
    producao_id: int,
    dados: ProducaoAmbulatorialUpdate,
    db: Session = Depends(get_db),
    ator: User = Depends(get_current_user),
):
    """Atualiza registro de produção ambulatorial existente."""
    registro = atualizar_producao(db, producao_id, dados, usuario_atual=ator)

    medico = db.get(Medico, registro.medico_id)
    unidade = db.get(UnidadeSaude, registro.unidade_saude_id)
    equipe = db.get(EquipeSaude, registro.equipe_id) if registro.equipe_id else None

    map_medicos = {medico.id: medico.nome} if medico else {}
    map_unidades = {unidade.id: unidade.nome} if unidade else {}
    map_equipes = {equipe.id: (equipe.nome_equipe, equipe.ine)} if equipe else {}

    return _enriquecer_producao_out(registro, map_medicos, map_unidades, map_equipes)


@router.delete("/{producao_id}", status_code=204)
def remover_producao(
    producao_id: int,
    db: Session = Depends(get_db),
    _ator: User = Depends(get_current_user),
):
    """Exclui um registro de produção ambulatorial."""
    excluir_producao(db, producao_id)


@router.get("/procedimentos-sigtap", response_model=list[ProcedimentoSigtapItem])
def buscar_procedimentos_sigtap(
    termo: str = Query(..., min_length=1, description="Código (10 dígitos) ou nome do procedimento"),
    cbo: str | None = Query(default=None, description="Filtrar por CBO do profissional"),
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    _ator: User = Depends(get_current_user),
):
    """Busca rápida de procedimentos do SIGTAP com valores e regras de validação para autocomplete."""
    termo_limpo = termo.strip()
    termo_num = normalizar_cbo(termo_limpo)

    stmt = select(SigtapProcedimento)
    if termo_num and len(termo_num) >= 2:
        stmt = stmt.where(
            or_(
                SigtapProcedimento.codigo.like(f"{termo_limpo}%"),
                SigtapProcedimento.descricao.ilike(f"%{termo_limpo}%"),
            )
        )
    else:
        stmt = stmt.where(SigtapProcedimento.descricao.ilike(f"%{termo_limpo}%"))

    # Filtro opcional por CBO
    if cbo and cbo.strip():
        cbo_limpo = normalizar_cbo(cbo)
        if cbo_limpo:
            procs_cbo = list(
                db.exec(
                    select(SigtapCbo.procedimento_codigo).where(SigtapCbo.cbo == cbo_limpo)
                ).all()
            )
            if procs_cbo:
                stmt = stmt.where(
                    or_(
                        SigtapProcedimento.codigo.in_(procs_cbo),
                        SigtapProcedimento.codigo.in_([c[:10] for c in procs_cbo]),
                    )
                )

    stmt = stmt.order_by(SigtapProcedimento.codigo).limit(limit)
    procs = list(db.exec(stmt).all())

    itens: list[ProcedimentoSigtapItem] = []
    for p in procs:
        vl_sa = float(p.valor_sa or 0.0)
        vl_sp = float(p.valor_sp or 0.0)
        vl_comb = float(p.valor_combinado or 0.0)
        vl_tot = round(vl_sa + vl_sp, 2)
        if vl_tot <= 0.0 and vl_comb > 0.0:
            vl_tot = round(vl_comb, 2)

        itens.append(
            ProcedimentoSigtapItem(
                id=p.id,
                codigo=p.codigo[:10],
                descricao=p.descricao,
                complexidade=p.complexidade or "AB",
                instrumento=(p.instrumento or "BPA-C").upper(),
                sexo=(p.sexo or "I").upper(),
                idade_min=p.idade_min or 0,
                idade_max=p.idade_max or 0,
                qtd_maxima=p.qtd_maxima or 0,
                pontos=p.pontos or 0,
                valor_sa=vl_sa,
                valor_sp=vl_sp,
                valor_total=vl_tot,
            )
        )
    return itens


@router.get("/cids", response_model=list[dict[str, str]])
def buscar_cids(
    termo: str = Query(..., min_length=1, description="Código CID ou descrição"),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    _ator: User = Depends(get_current_user),
):
    """Busca rápida de diagnósticos CID-10 para preenchimento de BPA-I."""
    t = f"%{termo.strip()}%"
    stmt = (
        select(SigtapCid)
        .where(or_(SigtapCid.cid.ilike(t), SigtapCid.descricao.ilike(t)))
        .order_by(SigtapCid.cid)
        .limit(limit)
    )
    resultados = list(db.exec(stmt).all())
    vistos = set()
    out = []
    for c in resultados:
        if c.cid not in vistos:
            vistos.add(c.cid)
            out.append({"codigo": c.cid, "descricao": c.descricao})
    return out


@router.get("/equipes-saude", response_model=list[dict[str, Any]])
def listar_equipes_saude(
    unidade_saude_id: int | None = Query(default=None, description="Filtrar por unidade"),
    somente_ativas: bool = Query(default=True),
    db: Session = Depends(get_db),
    _ator: User = Depends(get_current_user),
):
    """Lista as equipes de saúde com código INE para vinculação de atendimento."""
    stmt = select(EquipeSaude)
    if unidade_saude_id:
        stmt = stmt.where(EquipeSaude.unidade_saude_id == unidade_saude_id)
    if somente_ativas:
        stmt = stmt.where(EquipeSaude.ativo != False)  # noqa: E712
    stmt = stmt.order_by(EquipeSaude.nome_equipe)

    equipes = list(db.exec(stmt).all())
    return [
        {
            "id": eq.id,
            "unidade_saude_id": eq.unidade_saude_id,
            "ine": eq.ine,
            "nome_equipe": eq.nome_equipe,
            "tipo_equipe": eq.tipo_equipe,
            "ativo": eq.ativo,
        }
        for eq in equipes
    ]
