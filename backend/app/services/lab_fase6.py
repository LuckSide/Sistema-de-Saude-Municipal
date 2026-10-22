import json
from datetime import date, datetime

from fastapi import HTTPException
from sqlmodel import Session, func, select

from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import (
    STATUS_AUDIT,
    FilaPsf,
    ItemSolic,
    Laboratorio,
    LabPedidoAjuste,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.tfd import Paciente

LABS_PADRAO = ["Municipal", "Santa Casa", "Terceirizado"]


def determinar_preparo(nomes_procedimentos: list[str]) -> tuple[str, list[str], list[str]]:
    """Calcula orientações clínicas de preparo com base nos exames solicitados."""
    nomes_upper = [str(n).upper() for n in nomes_procedimentos]

    # Procedimentos que exigem jejum de 8 a 12 horas
    exige_jejum_estrito = any(
        any(termo in n for termo in ("GLICOSE", "GLICEMIA", "LIPID", "COLESTEROL", "TRIGLICER", "INSULIN", "CURVA GLICEMICA"))
        for n in nomes_upper
    )

    # Procedimentos que exigem jejum leve (3 a 4h)
    exige_jejum_leve = any(
        any(termo in n for termo in ("HEMOGRAMA", "UREIA", "CREATININA", "TGO", "TGP", "TSH", "T4", "ACIDO URICO"))
        for n in nomes_upper
    )

    if exige_jejum_estrito:
        jejum_horas = "8 a 12 horas"
    elif exige_jejum_leve:
        jejum_horas = "4 horas"
    else:
        jejum_horas = "Sem jejum obrigatório"

    preparo_instrucoes = [
        f"Jejum alimentar recomendado: {jejum_horas} antes da coleta.",
        "Ingestão de água pura é permitida em quantidade moderada.",
        "Evitar bebidas alcoólicas nas 72 horas que antecedem o exame.",
        "Evitar a prática de atividades físicas intensas na véspera da coleta.",
        "Manter medicações de uso contínuo (anti-hipertensivos, tireoide, etc.), salvo orientação médica expressa.",
    ]

    orientacoes_gerais = [
        "Horário de atendimento para coleta matinal: de Segunda a Sexta, das 07:00 às 09:30.",
        "Apresentar obrigatoriamente: Documento Oficial com Foto (RG/CNH), Cartão Nacional de Saúde (SUS) e este Comprovante de Agendamento.",
        "Para exames de urina ou fezes associados, utilize apenas frascos esterilizados fornecidos pelo laboratório ou UBS.",
    ]

    return jejum_horas, preparo_instrucoes, orientacoes_gerais


def seed_laboratorios(db: Session) -> int:
    total = db.exec(select(func.count(Laboratorio.id))).one() or 0
    if total:
        return 0
    for nome in LABS_PADRAO:
        db.add(Laboratorio(nome=nome, ativo=True))
    db.commit()
    return len(LABS_PADRAO)


def get_lab_or_404(db: Session, laboratorio_id: int) -> Laboratorio:
    lab = db.get(Laboratorio, laboratorio_id)
    if not lab:
        raise HTTPException(404, "Laboratório não encontrado")
    if not lab.ativo:
        raise HTTPException(400, "Laboratório inativo")
    return lab


def vaga_livre(db: Session, laboratorio_id: int, data: date) -> VagaLab:
    if data < date.today():
        raise HTTPException(400, "Dia passado indisponível (sem vagas)")
    vaga = db.exec(
        select(VagaLab).where(
            VagaLab.laboratorio_id == laboratorio_id, VagaLab.data == data
        )
    ).first()
    if not vaga:
        raise HTTPException(400, "Sem vaga cadastrada p/ laboratório+data")
    if vaga.vagas_ocupadas >= vaga.vagas_totais:
        raise HTTPException(400, "Sem vaga livre p/ laboratório+data")
    return vaga


def ocupar_vaga(db: Session, vaga_id: int) -> VagaLab:
    """Abate 1 vaga com proteção contra concorrência.

    UPDATE atômico só sucede se ainda houver livre; rowcount 0 = esgotou.
    """
    from sqlalchemy import text

    res = db.exec(
        text(
            "UPDATE lab_vagas SET vagas_ocupadas = vagas_ocupadas + 1 "
            "WHERE id = :vid AND vagas_ocupadas < vagas_totais"
        ).bindparams(vid=vaga_id)
    )
    rowcount = getattr(res, "rowcount", 1)
    if rowcount == 0:
        raise HTTPException(400, "Sem vaga livre p/ laboratório+data")
    vaga = db.get(VagaLab, vaga_id)
    if not vaga:
        raise HTTPException(400, "Vaga removida durante agendamento")
    return vaga


def criar_solicitacao_mestre(
    db: Session,
    paciente_id: int,
    data_agendada: date,
    laboratorio_id: int,
    sigtap_ids: list[int] | None = None,
    origem_fila_id: int | None = None,
    agendado_por: str = "",
    itens: dict[int, int] | list[dict] | None = None,
    medico_id: int | None = None,
    medico_solicitante: str = "",
    unidade_saude_id: int | None = None,
    unidade_psf: str = "",
    justificativa: str = "",
    hora_agendada: str = "07:00",
) -> SolicitacaoMestre:
    """Cria mestre + itens com quantidade em transação única.

    Política linhas repetidas: mesmo sigtap soma quantidades em linha
    única (ex. [{id:5,qtd:1},{id:5,qtd:2}] vira 1 linha qtd 3, máx 99).
    """
    if not db.get(Paciente, paciente_id):
        raise HTTPException(404, "Paciente não encontrado")
    get_lab_or_404(db, laboratorio_id)

    totais: dict[int, int] = {}
    for sid in sigtap_ids or []:
        totais[sid] = totais.get(sid, 0) + 1
    if isinstance(itens, dict):
        for sid, qtd in itens.items():
            totais[int(sid)] = totais.get(int(sid), 0) + int(qtd)
    elif isinstance(itens, list):
        for row in itens:
            sid = int(row.get("sigtap_id"))
            qtd = int(row.get("quantidade", 1))
            totais[sid] = totais.get(sid, 0) + qtd
    if not totais:
        raise HTTPException(400, "Informe ao menos 1 sigtap_id")
    for sid, qtd in totais.items():
        if qtd < 1 or qtd > 99:
            raise HTTPException(400, f"Quantidade inválida p/ sigtap {sid}: {qtd} (1..99)")
    for sid in totais:
        if not db.get(SigtapProcedimento, sid):
            raise HTTPException(404, f"SIGTAP {sid} não encontrado")

    fila = None
    if origem_fila_id:
        fila = db.get(FilaPsf, origem_fila_id)
        if not fila:
            raise HTTPException(404, "Origem fila não encontrada")
        if fila.status != "na_fila":
            raise HTTPException(400, "Fila já agendada/cancelada")

    vaga = vaga_livre(db, laboratorio_id, data_agendada)

    # Transação única
    try:
        mestre = SolicitacaoMestre(
            paciente_id=paciente_id,
            data_agendada=data_agendada,
            hora_agendada=hora_agendada or "07:00",
            laboratorio_id=laboratorio_id,
            status="agendado",
            agendado_por=agendado_por,
            origem_fila_id=origem_fila_id,
            status_auditoria="pendente_conferencia",
            medico_id=medico_id,
            medico_solicitante=medico_solicitante,
            unidade_saude_id=unidade_saude_id,
            unidade_psf=unidade_psf,
            justificativa=justificativa,
        )
        db.add(mestre)
        db.flush()
        for sid, qtd in sorted(totais.items()):
            db.add(ItemSolic(solicitacao_id=mestre.id, sigtap_id=sid, quantidade=qtd))
        db.flush()
        ocupar_vaga(db, vaga.id)
        if fila:
            fila.status = "agendado"
            db.add(fila)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"Falha ao agendar: {e}")
    db.refresh(mestre)
    return mestre


def enriquecer_mestre(db: Session, m: SolicitacaoMestre) -> dict:
    pac = db.get(Paciente, m.paciente_id)
    lab = db.get(Laboratorio, m.laboratorio_id)
    itens = list(
        db.exec(
            select(ItemSolic).where(ItemSolic.solicitacao_id == m.id)
        ).all()
    )
    itens_out = []
    for it in itens:
        proc = db.get(SigtapProcedimento, it.sigtap_id)
        itens_out.append(
            {
                "id": it.id,
                "solicitacao_id": it.solicitacao_id,
                "sigtap_id": it.sigtap_id,
                "quantidade": it.quantidade or 1,
                "status_auditoria": it.status_auditoria,
                "observacao": it.observacao,
                "procedimento_codigo": proc.codigo if proc else "?",
                "procedimento_descricao": proc.descricao if proc else "?",
            }
        )
    nomes_procs = [it["procedimento_descricao"] for it in itens_out]
    jejum, prep, _ = determinar_preparo(nomes_procs)
    return {
        "id": m.id,
        "paciente_id": m.paciente_id,
        "paciente_nome": pac.nome if pac else "?",
        "paciente_cpf": getattr(pac, "cpf", "") or "",
        "paciente_cns": getattr(pac, "cns", "") or "",
        "paciente_prontuario": getattr(pac, "prontuario", "") or (f"PR-{pac.id:05d}" if pac and pac.id else ""),
        "paciente_nascimento": pac.data_nascimento.isoformat() if pac and getattr(pac, "data_nascimento", None) else "",
        "data_agendada": m.data_agendada,
        "hora_agendada": getattr(m, "hora_agendada", "07:00") or "07:00",
        "laboratorio_id": m.laboratorio_id,
        "laboratorio_nome": lab.nome if lab else "?",
        "status": m.status,
        "agendado_por": m.agendado_por,
        "origem_fila_id": m.origem_fila_id,
        "status_auditoria": m.status_auditoria,
        "observacao_laboratorio": m.observacao_laboratorio,
        "medico_id": getattr(m, "medico_id", None),
        "medico_solicitante": getattr(m, "medico_solicitante", ""),
        "unidade_saude_id": getattr(m, "unidade_saude_id", None),
        "unidade_psf": getattr(m, "unidade_psf", ""),
        "justificativa": getattr(m, "justificativa", ""),
        "coletado_em": getattr(m, "coletado_em", None),
        "coletado_por": getattr(m, "coletado_por", "") or "",
        "preparo_instrucoes": prep,
        "itens": itens_out,
    }


def enriquecer_mestre_lote(db: Session, mestres: list[SolicitacaoMestre]) -> list[dict]:
    """Enriquece múltiplas solicitações mestre em lote único sem queries N+1."""
    if not mestres:
        return []

    pac_ids = {m.paciente_id for m in mestres if m.paciente_id}
    lab_ids = {m.laboratorio_id for m in mestres if m.laboratorio_id}
    mestre_ids = [m.id for m in mestres if m.id]

    pacs = {p.id: p for p in db.exec(select(Paciente).where(Paciente.id.in_(pac_ids))).all()} if pac_ids else {}
    labs = {l.id: l for l in db.exec(select(Laboratorio).where(Laboratorio.id.in_(lab_ids))).all()} if lab_ids else {}

    todos_itens = list(db.exec(select(ItemSolic).where(ItemSolic.solicitacao_id.in_(mestre_ids))).all()) if mestre_ids else []
    itens_by_solic: dict[int, list[ItemSolic]] = {}
    proc_ids = set()
    for it in todos_itens:
        itens_by_solic.setdefault(it.solicitacao_id, []).append(it)
        if it.sigtap_id:
            proc_ids.add(it.sigtap_id)

    procs = {pr.id: pr for pr in db.exec(select(SigtapProcedimento).where(SigtapProcedimento.id.in_(proc_ids))).all()} if proc_ids else {}

    out = []
    for m in mestres:
        pac = pacs.get(m.paciente_id)
        lab = labs.get(m.laboratorio_id)
        itens_m = itens_by_solic.get(m.id, [])
        itens_out = [
            {
                "id": it.id,
                "solicitacao_id": it.solicitacao_id,
                "sigtap_id": it.sigtap_id,
                "quantidade": it.quantidade or 1,
                "status_auditoria": it.status_auditoria,
                "observacao": it.observacao,
                "procedimento_codigo": procs.get(it.sigtap_id).codigo if procs.get(it.sigtap_id) else "?",
                "procedimento_descricao": procs.get(it.sigtap_id).descricao if procs.get(it.sigtap_id) else "?",
            }
            for it in itens_m
        ]
        nomes_procs = [it["procedimento_descricao"] for it in itens_out]
        _, prep, _ = determinar_preparo(nomes_procs)
        out.append({
            "id": m.id,
            "paciente_id": m.paciente_id,
            "paciente_nome": pac.nome if pac else "?",
            "paciente_cpf": getattr(pac, "cpf", "") or "",
            "paciente_cns": getattr(pac, "cns", "") or "",
            "paciente_prontuario": getattr(pac, "prontuario", "") or (f"PR-{pac.id:05d}" if pac and pac.id else ""),
            "paciente_nascimento": pac.data_nascimento.isoformat() if pac and getattr(pac, "data_nascimento", None) else "",
            "data_agendada": m.data_agendada,
            "hora_agendada": getattr(m, "hora_agendada", "07:00") or "07:00",
            "laboratorio_id": m.laboratorio_id,
            "laboratorio_nome": lab.nome if lab else "?",
            "status": m.status,
            "agendado_por": m.agendado_por,
            "origem_fila_id": m.origem_fila_id,
            "status_auditoria": m.status_auditoria,
            "observacao_laboratorio": m.observacao_laboratorio,
            "medico_id": getattr(m, "medico_id", None),
            "medico_solicitante": getattr(m, "medico_solicitante", ""),
            "unidade_saude_id": getattr(m, "unidade_saude_id", None),
            "unidade_psf": getattr(m, "unidade_psf", ""),
            "justificativa": getattr(m, "justificativa", ""),
            "coletado_em": getattr(m, "coletado_em", None),
            "coletado_por": getattr(m, "coletado_por", "") or "",
            "preparo_instrucoes": prep,
            "itens": itens_out,
        })
    return out


def auditar_mestre(
    db: Session,
    mestre_id: int,
    status_auditoria: str,
    observacao: str,
    itens: list[dict],
) -> SolicitacaoMestre:
    if status_auditoria not in STATUS_AUDIT:
        raise HTTPException(400, "status_auditoria inválido")
    m = db.get(SolicitacaoMestre, mestre_id)
    if not m:
        raise HTTPException(404, "Solicitação não encontrada")
    # Valida itens antes de mutar (evita sessão suja em erro parcial)
    validados: list[tuple] = []
    for row in itens or []:
        it = db.get(ItemSolic, row["item_id"])
        if not it or it.solicitacao_id != mestre_id:
            raise HTTPException(404, f"Item {row['item_id']} não encontrado")
        if row["status"] not in STATUS_AUDIT:
            raise HTTPException(400, "status item inválido")
        validados.append((it, row["status"], row.get("obs") or ""))
    try:
        m.status_auditoria = status_auditoria
        m.observacao_laboratorio = observacao or ""
        db.add(m)
        for it, st, obs_txt in validados:
            it.status_auditoria = st
            it.observacao = obs_txt
            db.add(it)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"Falha ao auditar: {e}")
    db.refresh(m)
    return m


def gerar_comprovante_agendamento(db: Session, mestre_id: int) -> dict:
    """Gera dados formatados e enriquecidos para o Comprovante Oficial de Exame."""
    m = db.get(SolicitacaoMestre, mestre_id)
    if not m:
        raise HTTPException(404, "Solicitação não encontrada")
    dados = enriquecer_mestre(db, m)
    nomes_procs = [it["procedimento_descricao"] for it in dados["itens"]]
    jejum, prep, orient = determinar_preparo(nomes_procs)
    pac = db.get(Paciente, m.paciente_id)
    lab = db.get(Laboratorio, m.laboratorio_id)
    return {
        "id": m.id,
        "protocolo": f"LAB-{m.data_agendada.strftime('%Y%m')}-{m.id:06d}",
        "paciente_id": m.paciente_id,
        "paciente_nome": pac.nome if pac else "?",
        "paciente_cpf": getattr(pac, "cpf", "") or "",
        "paciente_cns": getattr(pac, "cns", "") or "",
        "paciente_prontuario": getattr(pac, "prontuario", "") or (f"PR-{pac.id:05d}" if pac and pac.id else ""),
        "paciente_nascimento": pac.data_nascimento.isoformat() if pac and getattr(pac, "data_nascimento", None) else "",
        "data_agendada": m.data_agendada.isoformat(),
        "hora_agendada": getattr(m, "hora_agendada", "07:00") or "07:00",
        "laboratorio_id": m.laboratorio_id,
        "laboratorio_nome": lab.nome if lab else "?",
        "unidade_psf": getattr(m, "unidade_psf", "") or "Secretaria de Saúde",
        "medico_solicitante": getattr(m, "medico_solicitante", "") or "Médico da Unidade",
        "justificativa": getattr(m, "justificativa", "") or "",
        "status": m.status,
        "status_auditoria": m.status_auditoria,
        "itens": dados["itens"],
        "jejum_horas": jejum,
        "preparo_instrucoes": prep,
        "orientacoes_gerais": orient,
        "emitido_em": datetime.utcnow().isoformat(),
        "agendado_por": m.agendado_por,
    }


def agendar_lote_fila(
    db: Session,
    fila_ids: list[int],
    laboratorio_id: int,
    data_agendada: date,
    hora_agendada: str,
    sigtap_ids: list[int],
    agendado_por: str,
) -> list[SolicitacaoMestre]:
    """Marcação mensal em lote da fila do PSF para laboratórios conveniados."""
    if not sigtap_ids:
        sigtap_ids = list(db.exec(select(SigtapProcedimento.id).limit(2)).all())
    agendados: list[SolicitacaoMestre] = []
    for fid in fila_ids:
        fila = db.get(FilaPsf, fid)
        if not fila or fila.status != "na_fila":
            continue
        try:
            m = criar_solicitacao_mestre(
                db,
                paciente_id=fila.paciente_id,
                data_agendada=data_agendada,
                hora_agendada=hora_agendada or "07:00",
                laboratorio_id=laboratorio_id,
                sigtap_ids=sigtap_ids,
                origem_fila_id=fila.id,
                agendado_por=agendado_por,
                medico_solicitante=fila.medico_solicitante,
                unidade_psf=fila.unidade_psf,
                justificativa=fila.justificativa or "Agendamento mensal em lote da fila PSF",
            )
            agendados.append(m)
        except HTTPException:
            # Se esgotar vagas no dia, interrompe e comita o que deu
            break
    return agendados


def recepcionar_coleta(db: Session, mestre_id: int, user_nome: str) -> SolicitacaoMestre:
    """Laboratório marca a recepção e coleta do paciente."""
    m = db.get(SolicitacaoMestre, mestre_id)
    if not m:
        raise HTTPException(404, "Solicitação não encontrada")
    if m.status == "cancelado":
        raise HTTPException(400, "Exame cancelado não pode ser recepcionado")
    m.status = "coletado"
    m.coletado_em = datetime.utcnow()
    m.coletado_por = user_nome
    if m.status_auditoria == "pendente_conferencia":
        m.status_auditoria = "aprovado"
    db.add(m)
    # Atualiza também status dos itens
    itens = list(db.exec(select(ItemSolic).where(ItemSolic.solicitacao_id == m.id)).all())
    for it in itens:
        if it.status_auditoria == "pendente_conferencia":
            it.status_auditoria = "aprovado"
            db.add(it)
    db.commit()
    db.refresh(m)
    return m


def pedir_ajuste_laboratorio(
    db: Session,
    mestre_id: int,
    laboratorio_id: int,
    tipo_ajuste: str,
    justificativa: str,
    itens_propostos: list[dict],
    solicitado_por: str,
) -> LabPedidoAjuste:
    """Laboratório submete pedido de alteração de pedido divergente."""
    m = db.get(SolicitacaoMestre, mestre_id)
    if not m:
        raise HTTPException(404, "Solicitação não encontrada")
    ajuste = LabPedidoAjuste(
        solicitacao_id=mestre_id,
        laboratorio_id=laboratorio_id,
        tipo_ajuste=tipo_ajuste,
        justificativa=justificativa,
        itens_propostos=json.dumps(itens_propostos or [], ensure_ascii=False),
        status="pendente",
        solicitado_por=solicitado_por,
        created_at=datetime.utcnow(),
    )
    db.add(ajuste)
    m.status_auditoria = "aguardando_autorizacao_sec"
    m.observacao_laboratorio = f"[Pedido de Ajuste]: {justificativa}"
    db.add(m)
    db.commit()
    db.refresh(ajuste)
    return ajuste


def analisar_pedido_ajuste(
    db: Session,
    ajuste_id: int,
    aprovado: bool,
    resposta: str,
    user_nome: str,
) -> LabPedidoAjuste:
    """Secretaria analisa, autoriza ou rejeita o pedido de ajuste do laboratório."""
    ajuste = db.get(LabPedidoAjuste, ajuste_id)
    if not ajuste:
        raise HTTPException(404, "Pedido de ajuste não encontrado")
    if ajuste.status != "pendente":
        raise HTTPException(400, "Pedido de ajuste já finalizado")
    m = db.get(SolicitacaoMestre, ajuste.solicitacao_id)
    ajuste.status = "aprovado" if aprovado else "rejeitado"
    ajuste.resposta_secretaria = resposta
    ajuste.analisado_por = user_nome
    ajuste.analisado_em = datetime.utcnow()
    db.add(ajuste)
    if m:
        if aprovado:
            m.status_auditoria = "aprovado"
            m.observacao_laboratorio = f"[Ajuste Aprovado]: {resposta}"
        else:
            m.status_auditoria = "divergente"
            m.observacao_laboratorio = f"[Ajuste Rejeitado]: {resposta}"
        db.add(m)
    db.commit()
    db.refresh(ajuste)
    return ajuste


def consolidar_bpa_laboratorial(db: Session, competencia: str) -> dict:
    """Consolida produção de exames realizados/coletados na competência para o BPA."""
    # Competência no formato AAAA-MM
    ano, mes = map(int, competencia.split("-"))
    from calendar import monthrange
    _, ndays = monthrange(ano, mes)
    de = date(ano, mes, 1)
    ate = date(ano, mes, ndays)

    mestres = list(
        db.exec(
            select(SolicitacaoMestre)
            .where(
                SolicitacaoMestre.status.in_(["coletado", "realizado"]),
                SolicitacaoMestre.data_agendada >= de,
                SolicitacaoMestre.data_agendada <= ate,
            )
        ).all()
    )
    mestre_ids = [m.id for m in mestres if m.id]
    paciente_ids = {m.paciente_id for m in mestres if m.paciente_id}

    itens_agrupados: dict[int, dict] = {}
    if mestre_ids:
        itens = list(
            db.exec(
                select(ItemSolic).where(ItemSolic.solicitacao_id.in_(mestre_ids))
            ).all()
        )
        for it in itens:
            proc = db.get(SigtapProcedimento, it.sigtap_id)
            if not proc:
                continue
            if it.sigtap_id not in itens_agrupados:
                itens_agrupados[it.sigtap_id] = {
                    "codigo": proc.codigo,
                    "descricao": proc.descricao,
                    "instrumento": getattr(proc, "instrumento", "BPA-C") or "BPA-C",
                    "quantidade": 0,
                    "valor_unitario": float(getattr(proc, "valor_sa", 0.0) or getattr(proc, "vl_sa", 0.0) or getattr(proc, "valor_ambulatorial", 0.0) or 0.0),
                    "pacientes": set(),
                }
            itens_agrupados[it.sigtap_id]["quantidade"] += (it.quantidade or 1)
            solic = next((m for m in mestres if m.id == it.solicitacao_id), None)
            if solic:
                itens_agrupados[it.sigtap_id]["pacientes"].add(solic.paciente_id)

    lista_itens = []
    total_procs = 0
    total_valor = 0.0
    for sid, data in sorted(itens_agrupados.items(), key=lambda x: x[1]["codigo"]):
        qtd = data["quantidade"]
        v_un = data["valor_unitario"]
        v_tot = round(qtd * v_un, 2)
        total_procs += qtd
        total_valor += v_tot
        lista_itens.append({
            "codigo": data["codigo"],
            "descricao": data["descricao"],
            "instrumento": data["instrumento"],
            "quantidade": qtd,
            "valor_unitario": v_un,
            "valor_total": v_tot,
            "total_pacientes": len(data["pacientes"]),
        })

    return {
        "competencia": competencia,
        "total_procedimentos": len(lista_itens),
        "total_exames": total_procs,
        "total_pacientes": len(paciente_ids),
        "valor_total": round(total_valor, 2),
        "itens": lista_itens,
    }
