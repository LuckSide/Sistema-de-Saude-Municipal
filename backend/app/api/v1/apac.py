from datetime import date, datetime
import base64
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlmodel import Session, func, or_, select

from app.core.deps import get_db
from app.core.pagination import Pagina, page_params, paginar
from app.models.apac import (
    AnexoLaudoAPAC,
    FaixaNumeracaoAPAC,
    LoteFaturamentoAPAC,
    ProcedimentoSecundarioAPAC,
    SolicitacaoAPAC,
)
from app.models.cadastros_saude import Medico, UnidadeSaude
from app.models.lab_exames import SigtapCid, SigtapProcedimento
from app.models.tfd import Paciente
from app.models.user import User
from app.schemas.apac import (
    AnexoLaudoIn,
    AnexoLaudoOut,
    AutorizacaoIn,
    DevolucaoIn,
    DuplicarContinuidadeIn,
    FaixaNumeracaoCreate,
    FaixaNumeracaoOut,
    FaixaNumeracaoUpdate,
    GerarRemessaIn,
    IndeferimentoIn,
    LoteFaturamentoOut,
    ProcedimentoSecundarioOut,
    ResumoFaturamentoOut,
    SolicitacaoAPACCreate,
    SolicitacaoAPACDetailOut,
    SolicitacaoAPACItemOut,
    SolicitacaoAPACUpdate,
)
from app.services.apac_service import (
    autorizar_apac,
    calcular_flags_vencimento,
    duplicar_para_continuidade,
    gerar_arquivo_apac_mag,
    registrar_evento_tramitacao,
)
from app.services.permissoes import need_any_perm, need_perm

router = APIRouter()


def _montar_item_out(sol: SolicitacaoAPAC) -> SolicitacaoAPACItemOut:
    dias, vencida, proxima = calcular_flags_vencimento(sol.data_fim_validade)
    return SolicitacaoAPACItemOut(
        id=sol.id,
        numero_apac=sol.numero_apac or "",
        tipo_apac=sol.tipo_apac,
        apac_anterior_id=sol.apac_anterior_id,
        numero_apac_anterior=sol.numero_apac_anterior or "",
        status=sol.status,
        carater_atendimento=sol.carater_atendimento,
        paciente_id=sol.paciente_id,
        paciente_nome=sol.paciente_nome,
        paciente_cpf=sol.paciente_cpf,
        paciente_cns=sol.paciente_cns,
        medico_solicitante_nome=sol.medico_solicitante_nome,
        medico_autorizador_nome=sol.medico_autorizador_nome or "",
        procedimento_principal_codigo=sol.procedimento_principal_codigo,
        procedimento_principal_nome=sol.procedimento_principal_nome,
        cid_principal_codigo=sol.cid_principal_codigo,
        cid_principal_nome=sol.cid_principal_nome or "",
        quantidade_mes_1=sol.quantidade_mes_1,
        quantidade_mes_2=sol.quantidade_mes_2,
        quantidade_mes_3=sol.quantidade_mes_3,
        quantidade_total=sol.quantidade_total,
        valor_unitario=sol.valor_unitario,
        valor_total=sol.valor_total,
        data_solicitacao=sol.data_solicitacao,
        data_autorizacao=sol.data_autorizacao,
        data_inicio_validade=sol.data_inicio_validade,
        data_fim_validade=sol.data_fim_validade,
        competencia=sol.competencia or "",
        dias_restantes=dias,
        esta_vencida=vencida,
        proxima_do_vencimento=proxima,
        created_at=sol.created_at,
        updated_at=sol.updated_at,
    )


def _montar_detail_out(
    sol: SolicitacaoAPAC,
    secundarios: list[ProcedimentoSecundarioAPAC],
    anexos: list[AnexoLaudoAPAC],
) -> SolicitacaoAPACDetailOut:
    dias, vencida, proxima = calcular_flags_vencimento(sol.data_fim_validade)
    sec_outs = [ProcedimentoSecundarioOut.model_validate(s) for s in secundarios]
    anexo_outs = [AnexoLaudoOut.model_validate(a) for a in anexos]

    return SolicitacaoAPACDetailOut(
        id=sol.id,
        numero_apac=sol.numero_apac or "",
        tipo_apac=sol.tipo_apac,
        apac_anterior_id=sol.apac_anterior_id,
        numero_apac_anterior=sol.numero_apac_anterior or "",
        status=sol.status,
        carater_atendimento=sol.carater_atendimento,
        paciente_id=sol.paciente_id,
        paciente_nome=sol.paciente_nome,
        paciente_cpf=sol.paciente_cpf,
        paciente_cns=sol.paciente_cns,
        paciente_nascimento=sol.paciente_nascimento,
        paciente_sexo=sol.paciente_sexo or "",
        paciente_nome_mae=sol.paciente_nome_mae or "",
        paciente_telefone=sol.paciente_telefone or "",
        paciente_endereco=sol.paciente_endereco or "",
        paciente_bairro=sol.paciente_bairro or "",
        paciente_municipio=sol.paciente_municipio or "",
        paciente_cep=sol.paciente_cep or "",
        estabelecimento_solicitante_id=sol.estabelecimento_solicitante_id,
        estabelecimento_solicitante_cnes=sol.estabelecimento_solicitante_cnes or "",
        estabelecimento_solicitante_nome=sol.estabelecimento_solicitante_nome or "",
        estabelecimento_executante_id=sol.estabelecimento_executante_id,
        estabelecimento_executante_cnes=sol.estabelecimento_executante_cnes or "",
        estabelecimento_executante_nome=sol.estabelecimento_executante_nome or "",
        medico_solicitante_id=sol.medico_solicitante_id,
        medico_solicitante_nome=sol.medico_solicitante_nome,
        medico_solicitante_cpf=sol.medico_solicitante_cpf or "",
        medico_solicitante_cns=sol.medico_solicitante_cns or "",
        medico_solicitante_crm=sol.medico_solicitante_crm or "",
        medico_solicitante_cbo=sol.medico_solicitante_cbo or "",
        medico_autorizador_id=sol.medico_autorizador_id,
        medico_autorizador_nome=sol.medico_autorizador_nome or "",
        medico_autorizador_cpf=sol.medico_autorizador_cpf or "",
        medico_autorizador_cns=sol.medico_autorizador_cns or "",
        medico_autorizador_crm=sol.medico_autorizador_crm or "",
        medico_autorizador_cbo=sol.medico_autorizador_cbo or "",
        autorizador_usuario_id=sol.autorizador_usuario_id,
        procedimento_principal_codigo=sol.procedimento_principal_codigo,
        procedimento_principal_nome=sol.procedimento_principal_nome,
        quantidade_mes_1=sol.quantidade_mes_1,
        quantidade_mes_2=sol.quantidade_mes_2,
        quantidade_mes_3=sol.quantidade_mes_3,
        quantidade_total=sol.quantidade_total,
        valor_unitario=sol.valor_unitario,
        valor_total=sol.valor_total,
        cid_principal_codigo=sol.cid_principal_codigo,
        cid_principal_nome=sol.cid_principal_nome or "",
        cid_secundario_codigo=sol.cid_secundario_codigo or "",
        cid_secundario_nome=sol.cid_secundario_nome or "",
        cid_causas_associadas=sol.cid_causas_associadas or "",
        anamnese_diagnostico=sol.anamnese_diagnostico or "",
        justificativa_solicitacao=sol.justificativa_solicitacao,
        estadiamento_grau=sol.estadiamento_grau or "",
        indicacao_clinica=sol.indicacao_clinica or "",
        data_solicitacao=sol.data_solicitacao,
        data_autorizacao=sol.data_autorizacao,
        data_inicio_validade=sol.data_inicio_validade,
        data_fim_validade=sol.data_fim_validade,
        competencia=sol.competencia or "",
        parecer_regulador=sol.parecer_regulador or "",
        motivo_devolucao=sol.motivo_devolucao or "",
        motivo_indeferimento=sol.motivo_indeferimento or "",
        historico_tramitacao=sol.historico_tramitacao or "[]",
        dias_restantes=dias,
        esta_vencida=vencida,
        proxima_do_vencimento=proxima,
        procedimentos_secundarios=sec_outs,
        anexos=anexo_outs,
        created_at=sol.created_at,
        updated_at=sol.updated_at,
    )


# --------------------------------------------------------------------------
# 1. SOLICITAÇÕES CRUD
# --------------------------------------------------------------------------


@router.get("/solicitacoes", response_model=Pagina[SolicitacaoAPACItemOut])
def listar_solicitacoes(
    status: str | None = None,
    paciente_id: int | None = None,
    q: str | None = None,
    competencia: str | None = None,
    tipo_apac: str | None = None,
    alerta_vencimento: str | None = None,  # vencidas | proximas
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_solicitacao", "ver")),
    p: tuple[int, int] = Depends(page_params),
):
    """Listagem paginada de solicitações de APAC com filtros de busca e vencimento."""
    page, limit = p
    query = select(SolicitacaoAPAC)

    if status:
        query = query.where(SolicitacaoAPAC.status == status.upper())
    if paciente_id:
        query = query.where(SolicitacaoAPAC.paciente_id == paciente_id)
    if competencia:
        query = query.where(SolicitacaoAPAC.competencia == competencia)
    if tipo_apac:
        query = query.where(SolicitacaoAPAC.tipo_apac == tipo_apac)

    if q:
        termo = f"%{q.strip()}%"
        query = query.where(
            or_(
                SolicitacaoAPAC.paciente_nome.ilike(termo),
                SolicitacaoAPAC.paciente_cpf.ilike(termo),
                SolicitacaoAPAC.paciente_cns.ilike(termo),
                SolicitacaoAPAC.numero_apac.ilike(termo),
                SolicitacaoAPAC.procedimento_principal_codigo.ilike(termo),
                SolicitacaoAPAC.procedimento_principal_nome.ilike(termo),
                SolicitacaoAPAC.cid_principal_codigo.ilike(termo),
            )
        )

    hoje = date.today()
    if alerta_vencimento == "vencidas":
        query = query.where(
            SolicitacaoAPAC.data_fim_validade != None,  # noqa: E711
            SolicitacaoAPAC.data_fim_validade < hoje,
            SolicitacaoAPAC.status == "AUTORIZADO",
        )
    elif alerta_vencimento == "proximas":
        limite_30d = hoje + (date(2026, 2, 2) - date(2026, 1, 3))  # 30 dias
        from datetime import timedelta
        limite_30d = hoje + timedelta(days=30)
        query = query.where(
            SolicitacaoAPAC.data_fim_validade != None,  # noqa: E711
            SolicitacaoAPAC.data_fim_validade >= hoje,
            SolicitacaoAPAC.data_fim_validade <= limite_30d,
            SolicitacaoAPAC.status == "AUTORIZADO",
        )

    # Total
    total_query = select(func.count()).select_from(query.subquery())
    total = db.exec(total_query).one() or 0

    p_info = paginar(total, page, limit)
    itens = db.exec(
        query.order_by(SolicitacaoAPAC.id.desc()).offset(p_info["offset"]).limit(limit)
    ).all()

    data_outs = [_montar_item_out(s) for s in itens]
    return Pagina[SolicitacaoAPACItemOut](
        data=data_outs,
        total=total,
        page=p_info["page"],
        pages=p_info["pages"],
    )


@router.post("/solicitacoes", response_model=SolicitacaoAPACDetailOut, status_code=status.HTTP_201_CREATED)
def criar_solicitacao(
    payload: SolicitacaoAPACCreate,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_solicitacao", "criar")),
):
    """Criação de laudo / solicitação de APAC inicial."""
    paciente = db.get(Paciente, payload.paciente_id)
    if not paciente:
        raise HTTPException(status_code=404, detail="Paciente não encontrado.")

    medico = db.get(Medico, payload.medico_solicitante_id)
    if not medico:
        raise HTTPException(status_code=404, detail="Médico solicitante não encontrado.")

    # Estabelecimentos
    est_sol_cnes, est_sol_nome = "", ""
    if payload.estabelecimento_solicitante_id:
        est_sol = db.get(UnidadeSaude, payload.estabelecimento_solicitante_id)
        if est_sol:
            est_sol_cnes, est_sol_nome = est_sol.cnes, est_sol.nome

    est_exe_cnes, est_exe_nome = "", ""
    if payload.estabelecimento_executante_id:
        est_exe = db.get(UnidadeSaude, payload.estabelecimento_executante_id)
        if est_exe:
            est_exe_cnes, est_exe_nome = est_exe.cnes, est_exe.nome

    # Busca procedimento SIGTAP principal para obter nome e valores se disponíveis
    proc_sigtap = db.exec(
        select(SigtapProcedimento).where(
            SigtapProcedimento.codigo == payload.procedimento_principal_codigo
        )
    ).first()
    proc_nome = proc_sigtap.descricao if proc_sigtap else f"Procedimento {payload.procedimento_principal_codigo}"
    val_unit = float(proc_sigtap.valor_sa + proc_sigtap.valor_sp + proc_sigtap.valor_sh) if proc_sigtap else 0.0

    # Busca CID principal para descrição se disponível
    cid_sigtap = db.exec(
        select(SigtapCid).where(SigtapCid.cid == payload.cid_principal_codigo.upper())
    ).first()
    cid_nome = cid_sigtap.descricao if cid_sigtap else ""

    cid_sec_nome = ""
    if payload.cid_secundario_codigo:
        cid_sec = db.exec(
            select(SigtapCid).where(SigtapCid.cid == payload.cid_secundario_codigo.upper())
        ).first()
        if cid_sec:
            cid_sec_nome = cid_sec.descricao

    dt_sol = payload.data_solicitacao or date.today()
    qtd_total = payload.quantidade_mes_1 + payload.quantidade_mes_2 + payload.quantidade_mes_3
    if qtd_total <= 0:
        qtd_total = 1
        payload.quantidade_mes_1 = 1

    val_total = round(val_unit * qtd_total, 2)

    nova_sol = SolicitacaoAPAC(
        numero_apac="",
        tipo_apac="inicial",
        status="SOLICITADO",
        carater_atendimento=payload.carater_atendimento,
        # Paciente
        paciente_id=paciente.id,
        paciente_nome=paciente.nome,
        paciente_cpf=paciente.cpf or "",
        paciente_cns=paciente.cns or "",
        paciente_nascimento=paciente.nascimento,
        paciente_sexo="",
        paciente_nome_mae="",
        paciente_telefone=paciente.telefone or "",
        paciente_endereco=paciente.endereco or "",
        paciente_bairro=paciente.bairro or "",
        paciente_municipio="Guapé",
        paciente_cep=paciente.cep or "",
        # Estabelecimentos
        estabelecimento_solicitante_id=payload.estabelecimento_solicitante_id,
        estabelecimento_solicitante_cnes=est_sol_cnes,
        estabelecimento_solicitante_nome=est_sol_nome,
        estabelecimento_executante_id=payload.estabelecimento_executante_id,
        estabelecimento_executante_cnes=est_exe_cnes,
        estabelecimento_executante_nome=est_exe_nome,
        # Médico solicitante
        medico_solicitante_id=medico.id,
        medico_solicitante_nome=medico.nome,
        medico_solicitante_cpf=medico.cpf or "",
        medico_solicitante_cns=getattr(medico, "cns", "") or "",
        medico_solicitante_crm=medico.crm or "",
        medico_solicitante_cbo=medico.cbo_codigo or "",
        # Procedimento Principal
        procedimento_principal_codigo=payload.procedimento_principal_codigo,
        procedimento_principal_nome=proc_nome,
        quantidade_mes_1=payload.quantidade_mes_1,
        quantidade_mes_2=payload.quantidade_mes_2,
        quantidade_mes_3=payload.quantidade_mes_3,
        quantidade_total=qtd_total,
        valor_unitario=val_unit,
        valor_total=val_total,
        # Dados clínicos
        cid_principal_codigo=payload.cid_principal_codigo.upper(),
        cid_principal_nome=cid_nome,
        cid_secundario_codigo=payload.cid_secundario_codigo.upper() if payload.cid_secundario_codigo else "",
        cid_secundario_nome=cid_sec_nome,
        cid_causas_associadas=payload.cid_causas_associadas or "",
        anamnese_diagnostico=payload.anamnese_diagnostico or "",
        justificativa_solicitacao=payload.justificativa_solicitacao,
        estadiamento_grau=payload.estadiamento_grau or "",
        indicacao_clinica=payload.indicacao_clinica or "",
        data_solicitacao=dt_sol,
        competencia=dt_sol.strftime("%Y-%m"),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    registrar_evento_tramitacao(
        nova_sol,
        user.username or user.nome or "Sistema",
        "CRIACAO",
        f"Solicitação criada para o paciente {paciente.nome} - Procedimento {proc_nome}.",
    )
    db.add(nova_sol)
    db.flush()

    # Adiciona procedimentos secundários
    sec_adicionados: list[ProcedimentoSecundarioAPAC] = []
    for sec_in in payload.procedimentos_secundarios:
        s_proc = db.exec(
            select(SigtapProcedimento).where(SigtapProcedimento.codigo == sec_in.codigo)
        ).first()
        s_desc = sec_in.descricao or (s_proc.descricao if s_proc else f"Procedimento {sec_in.codigo}")
        s_val_unit = sec_in.valor_unitario or (
            float(s_proc.valor_sa + s_proc.valor_sp + s_proc.valor_sh) if s_proc else 0.0
        )
        s_qtd_tot = sec_in.quantidade_mes_1 + sec_in.quantidade_mes_2 + sec_in.quantidade_mes_3
        if s_qtd_tot <= 0:
            s_qtd_tot = 1
        s_val_tot = round(s_val_unit * s_qtd_tot, 2)

        sec_obj = ProcedimentoSecundarioAPAC(
            solicitacao_apac_id=nova_sol.id,
            codigo=sec_in.codigo,
            descricao=s_desc,
            quantidade_mes_1=sec_in.quantidade_mes_1,
            quantidade_mes_2=sec_in.quantidade_mes_2,
            quantidade_mes_3=sec_in.quantidade_mes_3,
            quantidade_total=s_qtd_tot,
            valor_unitario=s_val_unit,
            valor_total=s_val_tot,
        )
        db.add(sec_obj)
        sec_adicionados.append(sec_obj)

    db.commit()
    db.refresh(nova_sol)
    return _montar_detail_out(nova_sol, sec_adicionados, [])


@router.get("/solicitacoes/{id}", response_model=SolicitacaoAPACDetailOut)
def detalhar_solicitacao(
    id: int,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_solicitacao", "ver")),
):
    """Consulta detalhes completos de uma solicitação de APAC."""
    sol = db.get(SolicitacaoAPAC, id)
    if not sol:
        raise HTTPException(status_code=404, detail="Solicitação de APAC não encontrada.")

    secundarios = db.exec(
        select(ProcedimentoSecundarioAPAC).where(
            ProcedimentoSecundarioAPAC.solicitacao_apac_id == sol.id
        )
    ).all()
    anexos = db.exec(
        select(AnexoLaudoAPAC).where(AnexoLaudoAPAC.solicitacao_apac_id == sol.id)
    ).all()

    return _montar_detail_out(sol, list(secundarios), list(anexos))


@router.put("/solicitacoes/{id}", response_model=SolicitacaoAPACDetailOut)
def atualizar_solicitacao(
    id: int,
    payload: SolicitacaoAPACUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_solicitacao", "editar")),
):
    """Edição de solicitação de APAC (permitida em status SOLICITADO ou PENDENTE)."""
    sol = db.get(SolicitacaoAPAC, id)
    if not sol:
        raise HTTPException(status_code=404, detail="Solicitação de APAC não encontrada.")

    if sol.status not in ("SOLICITADO", "PENDENTE"):
        raise HTTPException(
            status_code=400,
            detail=f"Não é permitido editar solicitação em status '{sol.status}'.",
        )

    if payload.carater_atendimento is not None:
        sol.carater_atendimento = payload.carater_atendimento

    if payload.estabelecimento_solicitante_id is not None:
        sol.estabelecimento_solicitante_id = payload.estabelecimento_solicitante_id
        est = db.get(UnidadeSaude, payload.estabelecimento_solicitante_id)
        if est:
            sol.estabelecimento_solicitante_cnes = est.cnes
            sol.estabelecimento_solicitante_nome = est.nome

    if payload.estabelecimento_executante_id is not None:
        sol.estabelecimento_executante_id = payload.estabelecimento_executante_id
        est = db.get(UnidadeSaude, payload.estabelecimento_executante_id)
        if est:
            sol.estabelecimento_executante_cnes = est.cnes
            sol.estabelecimento_executante_nome = est.nome

    if payload.medico_solicitante_id is not None:
        med = db.get(Medico, payload.medico_solicitante_id)
        if med:
            sol.medico_solicitante_id = med.id
            sol.medico_solicitante_nome = med.nome
            sol.medico_solicitante_cpf = med.cpf or ""
            sol.medico_solicitante_crm = med.crm or ""
            sol.medico_solicitante_cbo = med.cbo_codigo or ""

    if payload.procedimento_principal_codigo is not None:
        sol.procedimento_principal_codigo = payload.procedimento_principal_codigo
        proc = db.exec(
            select(SigtapProcedimento).where(
                SigtapProcedimento.codigo == payload.procedimento_principal_codigo
            )
        ).first()
        if proc:
            sol.procedimento_principal_nome = proc.descricao
            sol.valor_unitario = float(proc.valor_sa + proc.valor_sp + proc.valor_sh)

    if payload.quantidade_mes_1 is not None:
        sol.quantidade_mes_1 = payload.quantidade_mes_1
    if payload.quantidade_mes_2 is not None:
        sol.quantidade_mes_2 = payload.quantidade_mes_2
    if payload.quantidade_mes_3 is not None:
        sol.quantidade_mes_3 = payload.quantidade_mes_3

    sol.quantidade_total = sol.quantidade_mes_1 + sol.quantidade_mes_2 + sol.quantidade_mes_3
    sol.valor_total = round(sol.valor_unitario * sol.quantidade_total, 2)

    if payload.cid_principal_codigo is not None:
        sol.cid_principal_codigo = payload.cid_principal_codigo.upper()
        cid = db.exec(
            select(SigtapCid).where(SigtapCid.cid == sol.cid_principal_codigo)
        ).first()
        if cid:
            sol.cid_principal_nome = cid.descricao

    if payload.cid_secundario_codigo is not None:
        sol.cid_secundario_codigo = payload.cid_secundario_codigo.upper()
        cid_s = db.exec(
            select(SigtapCid).where(SigtapCid.cid == sol.cid_secundario_codigo)
        ).first()
        if cid_s:
            sol.cid_secundario_nome = cid_s.descricao

    if payload.cid_causas_associadas is not None:
        sol.cid_causas_associadas = payload.cid_causas_associadas
    if payload.anamnese_diagnostico is not None:
        sol.anamnese_diagnostico = payload.anamnese_diagnostico
    if payload.justificativa_solicitacao is not None:
        sol.justificativa_solicitacao = payload.justificativa_solicitacao
    if payload.estadiamento_grau is not None:
        sol.estadiamento_grau = payload.estadiamento_grau
    if payload.indicacao_clinica is not None:
        sol.indicacao_clinica = payload.indicacao_clinica

    sol.updated_at = datetime.utcnow()
    registrar_evento_tramitacao(sol, user.username or user.nome or "Sistema", "EDICAO", "Dados da solicitação atualizados.")

    # Atualiza secundários se passados
    if payload.procedimentos_secundarios is not None:
        antigos = db.exec(
            select(ProcedimentoSecundarioAPAC).where(
                ProcedimentoSecundarioAPAC.solicitacao_apac_id == sol.id
            )
        ).all()
        for ant in antigos:
            db.delete(ant)
        db.flush()

        for s_in in payload.procedimentos_secundarios:
            s_proc = db.exec(
                select(SigtapProcedimento).where(SigtapProcedimento.codigo == s_in.codigo)
            ).first()
            s_desc = s_in.descricao or (s_proc.descricao if s_proc else f"Procedimento {s_in.codigo}")
            s_val = s_in.valor_unitario or (
                float(s_proc.valor_sa + s_proc.valor_sp + s_proc.valor_sh) if s_proc else 0.0
            )
            s_tot_qtd = s_in.quantidade_mes_1 + s_in.quantidade_mes_2 + s_in.quantidade_mes_3
            db.add(
                ProcedimentoSecundarioAPAC(
                    solicitacao_apac_id=sol.id,
                    codigo=s_in.codigo,
                    descricao=s_desc,
                    quantidade_mes_1=s_in.quantidade_mes_1,
                    quantidade_mes_2=s_in.quantidade_mes_2,
                    quantidade_mes_3=s_in.quantidade_mes_3,
                    quantidade_total=s_tot_qtd,
                    valor_unitario=s_val,
                    valor_total=round(s_val * s_tot_qtd, 2),
                )
            )

    db.add(sol)
    db.commit()
    db.refresh(sol)

    secundarios = db.exec(
        select(ProcedimentoSecundarioAPAC).where(
            ProcedimentoSecundarioAPAC.solicitacao_apac_id == sol.id
        )
    ).all()
    anexos = db.exec(
        select(AnexoLaudoAPAC).where(AnexoLaudoAPAC.solicitacao_apac_id == sol.id)
    ).all()
    return _montar_detail_out(sol, list(secundarios), list(anexos))


@router.post("/solicitacoes/{id}/duplicar-continuidade", response_model=SolicitacaoAPACDetailOut)
def duplicar_continuidade(
    id: int,
    payload: DuplicarContinuidadeIn,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_solicitacao", "criar")),
):
    """Gera solicitação de continuidade vinculada à APAC anterior."""
    nova_sol = duplicar_para_continuidade(
        db,
        apac_id_anterior=id,
        justificativa_atualizada=payload.justificativa_solicitacao,
        usuario_ator=user.username or user.nome or "Sistema",
        anamnese_diagnostico=payload.anamnese_diagnostico,
    )
    secundarios = db.exec(
        select(ProcedimentoSecundarioAPAC).where(
            ProcedimentoSecundarioAPAC.solicitacao_apac_id == nova_sol.id
        )
    ).all()
    return _montar_detail_out(nova_sol, list(secundarios), [])


@router.post("/solicitacoes/{id}/anexos", response_model=AnexoLaudoOut, status_code=status.HTTP_201_CREATED)
def adicionar_anexo(
    id: int,
    payload: AnexoLaudoIn,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_solicitacao", "editar")),
):
    """Upload de laudo ou anexo comprobatório."""
    sol = db.get(SolicitacaoAPAC, id)
    if not sol:
        raise HTTPException(status_code=404, detail="Solicitação de APAC não encontrada.")

    try:
        conteudo_bytes = base64.b64decode(payload.conteudo_base64)
        tam = len(conteudo_bytes)
    except Exception:
        tam = len(payload.conteudo_base64)

    anexo = AnexoLaudoAPAC(
        solicitacao_apac_id=sol.id,
        tipo_documento=payload.tipo_documento,
        titulo=payload.titulo,
        nome_arquivo=payload.nome_arquivo,
        conteudo_base64=payload.conteudo_base64,
        tamanho_bytes=tam,
        created_at=datetime.utcnow(),
    )
    registrar_evento_tramitacao(
        sol,
        user.username or user.nome or "Sistema",
        "ANEXO_ADICIONADO",
        f"Anexado documento '{payload.titulo}' ({payload.nome_arquivo}).",
    )
    db.add(anexo)
    db.add(sol)
    db.commit()
    db.refresh(anexo)
    return anexo


@router.delete("/solicitacoes/{id}")
def cancelar_solicitacao(
    id: int,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_solicitacao", "excluir")),
):
    """Cancela a solicitação de APAC."""
    sol = db.get(SolicitacaoAPAC, id)
    if not sol:
        raise HTTPException(status_code=404, detail="Solicitação de APAC não encontrada.")

    if sol.status == "CANCELADO":
        return {"ok": True, "mensagem": "Solicitação já está cancelada."}

    sol.status = "CANCELADO"
    sol.updated_at = datetime.utcnow()
    registrar_evento_tramitacao(
        sol,
        user.username or user.nome or "Sistema",
        "CANCELAMENTO",
        "Solicitação cancelada pelo operador.",
    )
    db.add(sol)
    db.commit()
    return {"ok": True, "mensagem": "Solicitação cancelada com sucesso."}


# --------------------------------------------------------------------------
# 2. REGULAÇÃO E AUTORIZAÇÃO TÉCNICA (EXCLUSIVA)
# --------------------------------------------------------------------------


@router.post("/regulacao/{id}/iniciar-analise", response_model=SolicitacaoAPACDetailOut)
def iniciar_analise_regulacao(
    id: int,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_regulacao")),
):
    """Muda status da solicitação para EM_ANALISE."""
    sol = db.get(SolicitacaoAPAC, id)
    if not sol:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")

    if sol.status not in ("SOLICITADO", "PENDENTE"):
        raise HTTPException(
            status_code=400,
            detail=f"Não é possível iniciar análise em status '{sol.status}'.",
        )

    sol.status = "EM_ANALISE"
    sol.updated_at = datetime.utcnow()
    registrar_evento_tramitacao(
        sol,
        user.username or user.nome or "Regulador",
        "INICIO_ANALISE",
        "Iniciada análise técnica e regulação do pedido de APAC.",
    )
    db.add(sol)
    db.commit()
    db.refresh(sol)

    secundarios = db.exec(
        select(ProcedimentoSecundarioAPAC).where(
            ProcedimentoSecundarioAPAC.solicitacao_apac_id == sol.id
        )
    ).all()
    anexos = db.exec(
        select(AnexoLaudoAPAC).where(AnexoLaudoAPAC.solicitacao_apac_id == sol.id)
    ).all()
    return _montar_detail_out(sol, list(secundarios), list(anexos))


@router.post("/regulacao/{id}/autorizar", response_model=SolicitacaoAPACDetailOut)
def autorizar_solicitacao_regulacao(
    id: int,
    payload: AutorizacaoIn,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_regulacao")),
):
    """Autoriza a APAC com validação de incompatibilidade profissional e alocação de número."""
    sol_autorizada = autorizar_apac(
        db=db,
        solicitacao_id=id,
        medico_autorizador_id=payload.medico_autorizador_id,
        parecer=payload.parecer,
        usuario_ator=user.username or user.nome or "Regulador",
        data_autorizacao=payload.data_autorizacao,
        validade_meses=payload.validade_meses,
    )

    secundarios = db.exec(
        select(ProcedimentoSecundarioAPAC).where(
            ProcedimentoSecundarioAPAC.solicitacao_apac_id == sol_autorizada.id
        )
    ).all()
    anexos = db.exec(
        select(AnexoLaudoAPAC).where(AnexoLaudoAPAC.solicitacao_apac_id == sol_autorizada.id)
    ).all()
    return _montar_detail_out(sol_autorizada, list(secundarios), list(anexos))


@router.post("/regulacao/{id}/devolver", response_model=SolicitacaoAPACDetailOut)
def devolver_solicitacao_regulacao(
    id: int,
    payload: DevolucaoIn,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_regulacao")),
):
    """Devolve a solicitação com pendência técnica documental."""
    sol = db.get(SolicitacaoAPAC, id)
    if not sol:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")

    sol.status = "PENDENTE"
    sol.motivo_devolucao = payload.motivo
    sol.updated_at = datetime.utcnow()
    registrar_evento_tramitacao(
        sol,
        user.username or user.nome or "Regulador",
        "DEVOLUCAO",
        f"Solicitação devolvida com pendência: {payload.motivo}",
    )
    db.add(sol)
    db.commit()
    db.refresh(sol)

    secundarios = db.exec(
        select(ProcedimentoSecundarioAPAC).where(
            ProcedimentoSecundarioAPAC.solicitacao_apac_id == sol.id
        )
    ).all()
    anexos = db.exec(
        select(AnexoLaudoAPAC).where(AnexoLaudoAPAC.solicitacao_apac_id == sol.id)
    ).all()
    return _montar_detail_out(sol, list(secundarios), list(anexos))


@router.post("/regulacao/{id}/indeferir", response_model=SolicitacaoAPACDetailOut)
def indeferir_solicitacao_regulacao(
    id: int,
    payload: IndeferimentoIn,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_regulacao")),
):
    """Indefere a solicitação de APAC."""
    sol = db.get(SolicitacaoAPAC, id)
    if not sol:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")

    sol.status = "INDEFERIDO"
    sol.motivo_indeferimento = payload.motivo
    sol.updated_at = datetime.utcnow()
    registrar_evento_tramitacao(
        sol,
        user.username or user.nome or "Regulador",
        "INDEFERIMENTO",
        f"Solicitação indeferida: {payload.motivo}",
    )
    db.add(sol)
    db.commit()
    db.refresh(sol)

    secundarios = db.exec(
        select(ProcedimentoSecundarioAPAC).where(
            ProcedimentoSecundarioAPAC.solicitacao_apac_id == sol.id
        )
    ).all()
    anexos = db.exec(
        select(AnexoLaudoAPAC).where(AnexoLaudoAPAC.solicitacao_apac_id == sol.id)
    ).all()
    return _montar_detail_out(sol, list(secundarios), list(anexos))


# --------------------------------------------------------------------------
# 3. FAIXAS DE NUMERAÇÃO APAC
# --------------------------------------------------------------------------


@router.get("/faixas", response_model=list[FaixaNumeracaoOut])
def listar_faixas(
    db: Session = Depends(get_db),
    user: User = Depends(need_any_perm("apac_solicitacao", "apac_regulacao", "apac_faturamento")),
):
    """Lista todas as faixas cadastradas da SES/SIA-SUS."""
    faixas = db.exec(select(FaixaNumeracaoAPAC).order_by(FaixaNumeracaoAPAC.ano.desc(), FaixaNumeracaoAPAC.id.desc())).all()
    out = []
    for f in faixas:
        tot_disp = max(0, f.numero_final - f.proximo_numero + 1) if f.ativo else 0
        tot_util = max(0, f.proximo_numero - f.numero_inicial)
        f_dict = f.model_dump()
        f_dict["total_disponivel"] = tot_disp
        f_dict["total_utilizado"] = tot_util
        out.append(FaixaNumeracaoOut(**f_dict))
    return out


@router.post("/faixas", response_model=FaixaNumeracaoOut, status_code=status.HTTP_201_CREATED)
def criar_faixa(
    payload: FaixaNumeracaoCreate,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_regulacao")),
):
    """Cadastra nova faixa autorizada da SES/SIA-SUS."""
    prox = payload.proximo_numero or payload.numero_inicial
    faixa = FaixaNumeracaoAPAC(
        ano=payload.ano,
        uf=payload.uf.upper(),
        serie=payload.serie.upper(),
        numero_inicial=payload.numero_inicial,
        numero_final=payload.numero_final,
        proximo_numero=prox,
        tipo_procedimento=payload.tipo_procedimento,
        ativo=payload.ativo,
        descricao=payload.descricao,
        created_at=datetime.utcnow(),
    )
    db.add(faixa)
    db.commit()
    db.refresh(faixa)

    tot_disp = max(0, faixa.numero_final - faixa.proximo_numero + 1) if faixa.ativo else 0
    tot_util = max(0, faixa.proximo_numero - faixa.numero_inicial)
    f_dict = faixa.model_dump()
    f_dict["total_disponivel"] = tot_disp
    f_dict["total_utilizado"] = tot_util
    return FaixaNumeracaoOut(**f_dict)


@router.put("/faixas/{id}", response_model=FaixaNumeracaoOut)
def atualizar_faixa(
    id: int,
    payload: FaixaNumeracaoUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_regulacao")),
):
    """Atualiza dados de uma faixa."""
    faixa = db.get(FaixaNumeracaoAPAC, id)
    if not faixa:
        raise HTTPException(status_code=404, detail="Faixa de numeração não encontrada.")

    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(faixa, k, v)

    db.add(faixa)
    db.commit()
    db.refresh(faixa)

    tot_disp = max(0, faixa.numero_final - faixa.proximo_numero + 1) if faixa.ativo else 0
    tot_util = max(0, faixa.proximo_numero - faixa.numero_inicial)
    f_dict = faixa.model_dump()
    f_dict["total_disponivel"] = tot_disp
    f_dict["total_utilizado"] = tot_util
    return FaixaNumeracaoOut(**f_dict)


# --------------------------------------------------------------------------
# 4. FATURAMENTO AMBULATORIAL APAC
# --------------------------------------------------------------------------


@router.get("/faturamento/resumo", response_model=ResumoFaturamentoOut)
def resumo_faturamento(
    competencia: str = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_faturamento")),
):
    """Totais e consolidados do faturamento de APAC para a competência."""
    comp = competencia or date.today().strftime("%Y-%m")

    # Autorizadas
    sol_aut = db.exec(
        select(SolicitacaoAPAC).where(
            SolicitacaoAPAC.status == "AUTORIZADO",
            SolicitacaoAPAC.competencia == comp,
        )
    ).all()

    tot_apacs = len(sol_aut)
    tot_procs = sum(s.quantidade_total for s in sol_aut)
    val_tot = sum(float(s.valor_total or 0.0) for s in sol_aut)

    # Secundários
    if sol_aut:
        ids_aut = [s.id for s in sol_aut]
        secs = db.exec(
            select(ProcedimentoSecundarioAPAC).where(
                ProcedimentoSecundarioAPAC.solicitacao_apac_id.in_(ids_aut)
            )
        ).all()
        tot_procs += sum(s.quantidade_total for s in secs)
        val_tot += sum(float(s.valor_total or 0.0) for s in secs)

    # Pendentes
    tot_pend = db.exec(
        select(func.count(SolicitacaoAPAC.id)).where(
            SolicitacaoAPAC.status.in_(["SOLICITADO", "EM_ANALISE", "PENDENTE"]),
            SolicitacaoAPAC.competencia == comp,
        )
    ).one() or 0

    # Vencidas
    hoje = date.today()
    tot_venc = db.exec(
        select(func.count(SolicitacaoAPAC.id)).where(
            SolicitacaoAPAC.status == "AUTORIZADO",
            SolicitacaoAPAC.data_fim_validade < hoje,
        )
    ).one() or 0

    # Lotes
    lotes_count = db.exec(
        select(func.count(LoteFaturamentoAPAC.id)).where(
            LoteFaturamentoAPAC.competencia == comp
        )
    ).one() or 0

    return ResumoFaturamentoOut(
        competencia=comp,
        total_apacs_autorizadas=tot_apacs,
        total_procedimentos=tot_procs,
        valor_total_aprovado=round(val_tot, 2),
        total_pendentes=tot_pend,
        total_vencidas=tot_venc,
        lotes_gerados=lotes_count,
    )


@router.post("/faturamento/gerar-remessa", response_model=LoteFaturamentoOut)
def gerar_remessa_apac(
    payload: GerarRemessaIn,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_faturamento")),
):
    """Gera lote e arquivo texto magnético APAC-Mag para SIA-SUS."""
    lote = gerar_arquivo_apac_mag(
        db=db,
        competencia=payload.competencia,
        cnes_executante=payload.cnes_executante,
        usuario_ator=user.username or user.nome or "Sistema",
    )
    return lote


@router.get("/faturamento/lotes", response_model=list[LoteFaturamentoOut])
def listar_lotes(
    competencia: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_faturamento")),
):
    """Lista todos os lotes de remessa magnética gerados."""
    q = select(LoteFaturamentoAPAC).order_by(LoteFaturamentoAPAC.id.desc())
    if competencia:
        q = q.where(LoteFaturamentoAPAC.competencia == competencia)
    return db.exec(q).all()


@router.get("/faturamento/lotes/{id}/download")
def download_lote_apac(
    id: int,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_faturamento")),
):
    """Download do arquivo magnético posicional DATASUS (.TXT)."""
    lote = db.get(LoteFaturamentoAPAC, id)
    if not lote:
        raise HTTPException(status_code=404, detail="Lote de faturamento não encontrado.")

    return Response(
        content=lote.conteudo_arquivo,
        media_type="text/plain; charset=iso-8859-1",
        headers={
            "Content-Disposition": f'attachment; filename="{lote.arquivo_nome}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/faturamento/exportar-excel")
def exportar_excel_apac(
    competencia: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("apac_faturamento")),
):
    """Exportação da produção ambulatorial de APAC em planilha XLSX padronizada."""
    from app.services.export_xlsx import resposta_xlsx

    comp = competencia or date.today().strftime("%Y-%m")
    query = (
        select(SolicitacaoAPAC)
        .where(
            SolicitacaoAPAC.status == "AUTORIZADO",
            SolicitacaoAPAC.competencia == comp,
        )
        .order_by(SolicitacaoAPAC.id.asc())
    )
    solicitacoes = list(db.exec(query).all())

    linhas = []
    for s in solicitacoes:
        linhas.append(
            {
                "numero_apac": s.numero_apac or str(s.id),
                "paciente": s.paciente_nome,
                "cpf": s.paciente_cpf,
                "cns": s.paciente_cns,
                "procedimento": f"{s.procedimento_principal_codigo} - {s.procedimento_principal_nome}",
                "cid": f"{s.cid_principal_codigo} - {s.cid_principal_nome}",
                "qtd": s.quantidade_total,
                "valor_unitario": float(s.valor_unitario or 0.0),
                "valor_total": float(s.valor_total or 0.0),
                "solicitante": s.medico_solicitante_nome,
                "autorizador": s.medico_autorizador_nome or "",
                "validade": s.data_fim_validade.strftime("%d/%m/%Y") if s.data_fim_validade else "",
            }
        )

    colunas = [
        {"chave": "numero_apac", "rotulo": "Nº APAC", "largura": 18},
        {"chave": "paciente", "rotulo": "Paciente", "largura": 32},
        {"chave": "cpf", "rotulo": "CPF", "largura": 15},
        {"chave": "cns", "rotulo": "Cartão SUS (CNS)", "largura": 18},
        {"chave": "procedimento", "rotulo": "Procedimento SIGTAP", "largura": 40},
        {"chave": "cid", "rotulo": "CID-10 Principal", "largura": 25},
        {"chave": "qtd", "rotulo": "Qtd", "largura": 8},
        {"chave": "valor_unitario", "rotulo": "Valor Unit.", "largura": 14, "formato": "moeda"},
        {"chave": "valor_total", "rotulo": "Valor Total", "largura": 14, "formato": "moeda"},
        {"chave": "solicitante", "rotulo": "Médico Solicitante", "largura": 25},
        {"chave": "autorizador", "rotulo": "Médico Autorizador", "largura": 25},
        {"chave": "validade", "rotulo": "Validade", "largura": 12},
    ]

    return resposta_xlsx(
        f"Produção APAC SIA-SUS — {comp}",
        user.nome or user.username,
        colunas,
        linhas,
        f"apac_faturamento_{comp}",
    )


# --------------------------------------------------------------------------
# 5. CATÁLOGO E APOIO (SIGTAP E CIDS)
# --------------------------------------------------------------------------


@router.get("/sigtap-procedimentos")
def listar_sigtap_apac(
    q: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(need_any_perm("apac_solicitacao", "apac_regulacao", "apac_faturamento")),
):
    """Lista procedimentos SIGTAP habilitados para instrumento APAC ou de Alta Complexidade."""
    query = select(SigtapProcedimento).where(
        or_(
            SigtapProcedimento.instrumento.in_(["APAC", "APAC-M", "APAC-U", "BPA-I"]),
            SigtapProcedimento.complexidade.ilike("%alta%"),
        )
    )
    if q:
        termo = f"%{q.strip()}%"
        query = query.where(
            or_(
                SigtapProcedimento.codigo.ilike(termo),
                SigtapProcedimento.descricao.ilike(termo),
            )
        )
    return db.exec(query.order_by(SigtapProcedimento.codigo.asc()).limit(100)).all()


@router.get("/cids")
def buscar_cids(
    q: str = Query(min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(need_any_perm("apac_solicitacao", "apac_regulacao")),
):
    """Busca rápida de CID-10 por código ou descrição."""
    termo = f"%{q.strip()}%"
    cids = db.exec(
        select(SigtapCid)
        .where(
            or_(
                SigtapCid.cid.ilike(termo),
                SigtapCid.descricao.ilike(termo),
            )
        )
        .order_by(SigtapCid.cid.asc())
        .limit(100)
    ).all()

    # Elimina duplicatas de CID com mesma descrição (pois SigtapCid relaciona por procedimento)
    vistos = set()
    resultado = []
    for c in cids:
        if c.cid not in vistos:
            vistos.add(c.cid)
            resultado.append({"codigo": c.cid, "descricao": c.descricao})
    return resultado
