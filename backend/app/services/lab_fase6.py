import json
import urllib.parse
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
from app.services.geradores import gerar_prontuario_aleatorio, gerar_protocolo_lab_aleatorio
from app.services.lab_preparo import determinar_preparo, obter_preparo_exame

LABS_PADRAO = ["Municipal", "Santa Casa", "Terceirizado"]


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
        fila = db.exec(
            select(FilaPsf).where(FilaPsf.id == origem_fila_id).with_for_update()
        ).first()
        if not fila:
            raise HTTPException(404, "Origem fila não encontrada")
        if fila.status != "na_fila":
            raise HTTPException(400, "Fila já agendada/cancelada")

    vaga = vaga_livre(db, laboratorio_id, data_agendada)

    # Transação única
    try:
        import secrets as _secrets

        cod_solic = (getattr(fila, "codigo_solicitacao", "") or "").strip() if fila else ""
        if not cod_solic:
            cod_solic = gerar_protocolo_lab_aleatorio(data_agendada=data_agendada, db=db)
        pub_tok = (getattr(fila, "public_token", "") or "").strip() if fila else ""
        if not pub_tok:
            pub_tok = _secrets.token_urlsafe(24)
        lab_obj = get_lab_or_404(db, laboratorio_id)
        mestre = SolicitacaoMestre(
            codigo_solicitacao=cod_solic,
            public_token=pub_tok,
            paciente_id=paciente_id,
            data_agendada=data_agendada,
            hora_agendada=hora_agendada or "07:00",
            laboratorio_id=laboratorio_id,
            laboratorio_nome_snapshot=lab_obj.nome,
            laboratorio_responsavel_snapshot=getattr(lab_obj, "responsavel_tecnico", "") or "",
            laboratorio_horario_snapshot=getattr(lab_obj, "horario_funcionamento", "") or "",
            laboratorio_cnpj_snapshot=getattr(lab_obj, "cnpj", "") or "",
            laboratorio_cnes_snapshot=getattr(lab_obj, "cnes", "") or "",
            laboratorio_telefone_snapshot=getattr(lab_obj, "telefone", "") or "",
            laboratorio_endereco_snapshot=getattr(lab_obj, "endereco", "") or "",
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
        raise HTTPException(400, "Falha interna ao agendar. Verifique os dados fornecidos e tente novamente.")
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
        desc = proc.descricao if proc else "?"
        p_info = obter_preparo_exame(desc)
        itens_out.append(
            {
                "id": it.id,
                "solicitacao_id": it.solicitacao_id,
                "sigtap_id": it.sigtap_id,
                "quantidade": it.quantidade or 1,
                "status_auditoria": it.status_auditoria,
                "observacao": it.observacao,
                "procedimento_codigo": proc.codigo if proc else "?",
                "procedimento_descricao": desc,
                "preparo_especifico": p_info.get("badge", ""),
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
        "paciente_prontuario": getattr(pac, "codigo_prontuario", "") or (gerar_prontuario_aleatorio(pac_id=pac.id) if pac and pac.id else ""),
        "paciente_nascimento": pac.data_nascimento.isoformat() if pac and getattr(pac, "data_nascimento", None) else "",
        "data_agendada": m.data_agendada,
        "hora_agendada": getattr(m, "hora_agendada", "07:00") or "07:00",
        "laboratorio_id": m.laboratorio_id,
        "laboratorio_nome": getattr(m, "laboratorio_nome_snapshot", "") or (lab.nome if lab else "?"),
        "laboratorio_responsavel": getattr(m, "laboratorio_responsavel_snapshot", "") or (getattr(lab, "responsavel_tecnico", "") if lab else ""),
        "laboratorio_horario": getattr(m, "laboratorio_horario_snapshot", "") or (getattr(lab, "horario_funcionamento", "") if lab else ""),
        "status": m.status,
        "agendado_por": m.agendado_por,
        "agendado_por_nome": m.agendado_por or "Sistema",
        "criado_por_nome": m.agendado_por or "Sistema",
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
        "laudo_arquivo_id": getattr(m, "laudo_arquivo_id", None),
        "tem_laudo": bool(getattr(m, "laudo_arquivo_id", None)),
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
                "preparo_especifico": obter_preparo_exame(procs.get(it.sigtap_id).descricao)["badge"] if procs.get(it.sigtap_id) else "",
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
            "paciente_prontuario": getattr(pac, "codigo_prontuario", "") or (gerar_prontuario_aleatorio(pac_id=pac.id) if pac and pac.id else ""),
            "paciente_nascimento": pac.data_nascimento.isoformat() if pac and getattr(pac, "data_nascimento", None) else "",
            "data_agendada": m.data_agendada,
            "hora_agendada": getattr(m, "hora_agendada", "07:00") or "07:00",
            "laboratorio_id": m.laboratorio_id,
            "laboratorio_nome": lab.nome if lab else "?",
            "status": m.status,
            "agendado_por": m.agendado_por,
            "agendado_por_nome": m.agendado_por or "Sistema",
            "criado_por_nome": m.agendado_por or "Sistema",
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
            "laudo_arquivo_id": getattr(m, "laudo_arquivo_id", None),
            "tem_laudo": bool(getattr(m, "laudo_arquivo_id", None)),
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
        raise HTTPException(400, "Falha interna ao auditar o pedido. Verifique os dados fornecidos e tente novamente.")
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
    protocolo = (getattr(m, "codigo_solicitacao", "") or getattr(m, "protocolo", "") or "").strip()
    if not protocolo:
        protocolo = gerar_protocolo_lab_aleatorio(m.data_agendada, db=db)
        m.codigo_solicitacao = protocolo
        db.add(m)
        db.commit()
    prontuario = (getattr(pac, "codigo_prontuario", "") or "").strip()
    if not prontuario and pac and pac.id:
        prontuario = gerar_prontuario_aleatorio(db=db)
        pac.codigo_prontuario = prontuario
        db.add(pac)
        db.commit()
    pub_tok = (getattr(m, "public_token", "") or "").strip()
    if not pub_tok:
        import secrets as _secrets
        pub_tok = _secrets.token_urlsafe(24)
        m.public_token = pub_tok
        db.add(m)
        db.commit()
    acompanhar_path = f"/acompanhar/{urllib.parse.quote(pub_tok)}"
    qr_url = acompanhar_path

    from app.services.whatsapp import buscar_transporte_vinculado

    status_norm = (getattr(m, "status", "") or "").strip().lower()
    eh_cancelado = status_norm in {"cancelado", "cancelada", "desistiu", "recusado"}
    eh_realizado = status_norm in {"realizado", "realizada", "coletado", "concluido", "concluida"}

    transporte_info = None if eh_cancelado else buscar_transporte_vinculado(db, m.paciente_id, m.data_agendada)
    itens_out = (
        [{**it, "preparo_especifico": ""} for it in dados["itens"]]
        if (eh_cancelado or eh_realizado)
        else dados["itens"]
    )
    d_ped = getattr(m, "data_solicitacao", None) or (m.created_at.date() if getattr(m, "created_at", None) else None)
    tipo_comp = "cancelado" if eh_cancelado else ("realizado" if eh_realizado else "agendamento")

    nasc_obj = (getattr(pac, "nascimento", None) or getattr(pac, "data_nascimento", None)) if pac else None
    return {
        "id": m.id,
        "tipo_comprovante": tipo_comp,
        "origem_modulo": "laboratorio",
        "protocolo": protocolo,
        "codigo_curto": protocolo,
        "codigo_solicitacao": protocolo,
        "numero_pedido": protocolo,
        "public_token": pub_tok,
        "acompanhar_path": acompanhar_path,
        "qr_code_url": qr_url,
        "paciente_id": m.paciente_id,
        "paciente_nome": pac.nome if pac else "?",
        "paciente_cpf": getattr(pac, "cpf", "") or "",
        "paciente_cns": getattr(pac, "cns", "") or "",
        "paciente_prontuario": prontuario,
        "paciente_nascimento": nasc_obj.isoformat() if nasc_obj else "",
        "data_agendada": "" if eh_cancelado else m.data_agendada.isoformat(),
        "hora_agendada": "" if eh_cancelado else (getattr(m, "hora_agendada", "07:00") or "07:00"),
        "data_pedido": d_ped.isoformat() if d_ped else "",
        "data_solicitacao": d_ped.isoformat() if d_ped else "",
        "laboratorio_id": 0 if eh_cancelado else m.laboratorio_id,
        "laboratorio_nome": "" if eh_cancelado else (getattr(m, "laboratorio_nome_snapshot", "") or (lab.nome if lab else "?")),
        "laboratorio_responsavel": "" if eh_cancelado else (getattr(m, "laboratorio_responsavel_snapshot", "") or (getattr(lab, "responsavel_tecnico", "") if lab else "")),
        "laboratorio_horario": "" if eh_cancelado else (getattr(m, "laboratorio_horario_snapshot", "") or (getattr(lab, "horario_funcionamento", "") if lab else "")),
        "unidade_psf": getattr(m, "unidade_psf", "") or "Secretaria de Saúde",
        "medico_solicitante": getattr(m, "medico_solicitante", "") or "Médico da Unidade",
        "fila_nome": getattr(m, "tipo_servico", "") or "Exames de Sangue",
        "justificativa": getattr(m, "justificativa", "") or "",
        "instrucoes_transporte": "" if eh_cancelado else (getattr(m, "instrucoes_transporte", "") or ""),
        "transporte": transporte_info,
        "status": m.status,
        "status_auditoria": m.status_auditoria,
        "motivo_cancelamento": (getattr(m, "observacao_laboratorio", "") or getattr(m, "observacoes", "") or "") if eh_cancelado else "",
        "itens": itens_out,
        "jejum_horas": "" if (eh_cancelado or eh_realizado) else jejum,
        "preparo_instrucoes": [] if (eh_cancelado or eh_realizado) else prep,
        "orientacoes_gerais": [] if (eh_cancelado or eh_realizado) else orient,
        "emitido_em": datetime.utcnow().strftime("%d/%m/%Y %H:%M"),
        "agendado_por": m.agendado_por,
        "exige_preparo": not (eh_cancelado or eh_realizado),
    }


def gerar_codigo_fila_psf_unico(
    db: Session,
    data_ref: date | None = None,
    usados: set[str] | None = None,
) -> str:
    """Gera código de solicitação aleatório único entre lab_fila_psf e lab_solic_mestre."""
    local_usados = usados if usados is not None else set()
    for _ in range(40):
        cod = gerar_protocolo_lab_aleatorio(data_agendada=data_ref, db=db, usados=local_usados)
        existe_fila = db.exec(
            select(FilaPsf.id).where(FilaPsf.codigo_solicitacao == cod)
        ).first()
        if not existe_fila:
            return cod
        local_usados.add(cod)
    return gerar_protocolo_lab_aleatorio(data_agendada=data_ref, db=db, usados=local_usados)


def backfill_codigos_fila_psf(db_or_conn) -> int:
    """Preenche codigo_solicitacao em registros legados de lab_fila_psf de forma idempotente."""
    from sqlalchemy import text

    is_session = isinstance(db_or_conn, Session)
    pendentes = list(
        db_or_conn.execute(
            text(
                "SELECT id, data_pedido, data_solicitacao FROM lab_fila_psf "
                "WHERE codigo_solicitacao IS NULL OR TRIM(codigo_solicitacao) = ''"
            )
        ).fetchall()
    )
    if not pendentes:
        return 0

    usados: set[str] = set()
    for tabela in ("lab_fila_psf", "lab_solic_mestre"):
        try:
            rows = db_or_conn.execute(
                text(
                    f"SELECT codigo_solicitacao FROM {tabela} "
                    "WHERE codigo_solicitacao IS NOT NULL AND TRIM(codigo_solicitacao) != ''"
                )
            ).fetchall()
            for (c,) in rows:
                if c:
                    usados.add(str(c).strip())
        except Exception:
            pass

    atualizados = 0
    for fid, d_ped, d_sol in pendentes:
        dt_ref: date | None = None
        for cand in (d_ped, d_sol):
            if isinstance(cand, date):
                dt_ref = cand
                break
            if isinstance(cand, str) and cand.strip():
                try:
                    dt_ref = date.fromisoformat(cand.strip()[:10])
                    break
                except ValueError:
                    pass
        cod = gerar_protocolo_lab_aleatorio(data_agendada=dt_ref or date.today(), db=None, usados=usados)
        res = db_or_conn.execute(
            text(
                "UPDATE lab_fila_psf SET codigo_solicitacao = :cod "
                "WHERE id = :fid AND (codigo_solicitacao IS NULL OR TRIM(codigo_solicitacao) = '')"
            ).bindparams(cod=cod, fid=int(fid))
        )
        atualizados += getattr(res, "rowcount", 1) or 0

    if is_session:
        db_or_conn.commit()
    return atualizados


def gerar_comprovante_fila_psf(db: Session, fila_id: int) -> dict:
    """Gera o comprovante de inclusão na fila de espera de exames de sangue (não agendado)."""
    fila = db.get(FilaPsf, fila_id)
    if not fila:
        raise HTTPException(404, "Pedido na fila não encontrado")
    pac = db.get(Paciente, fila.paciente_id)

    protocolo = (getattr(fila, "codigo_solicitacao", "") or "").strip()
    if not protocolo:
        protocolo = gerar_codigo_fila_psf_unico(db, fila.data_pedido or fila.data_solicitacao)
        fila.codigo_solicitacao = protocolo
        db.add(fila)
        db.commit()
        db.refresh(fila)

    prontuario = (getattr(pac, "codigo_prontuario", "") or "").strip()
    if not prontuario and pac and pac.id:
        prontuario = gerar_prontuario_aleatorio(db=db)
        pac.codigo_prontuario = prontuario
        db.add(pac)
        db.commit()

    # Extrair SIGTAP IDs preservando ordem e somando quantidades
    raw_ids: list[int] = []
    raw_json = getattr(fila, "sigtap_ids_json", None) or ""
    if raw_json and raw_json.strip() not in ("", "[]"):
        try:
            parsed = json.loads(raw_json)
            if isinstance(parsed, list):
                raw_ids = [int(x) for x in parsed if str(x).isdigit()]
        except Exception:
            raw_ids = []
    if not raw_ids and fila.observacoes and "SIGTAP_IDS:" in fila.observacoes:
        try:
            trecho = fila.observacoes.split("SIGTAP_IDS:")[1].split("|")[0].strip()
            parsed = json.loads(trecho)
            if isinstance(parsed, list):
                raw_ids = [int(x) for x in parsed if str(x).isdigit()]
        except Exception:
            raw_ids = []

    qtd_por_sid: dict[int, int] = {}
    for sid in raw_ids:
        qtd_por_sid[sid] = qtd_por_sid.get(sid, 0) + 1

    procs_map: dict[int, SigtapProcedimento] = {}
    if qtd_por_sid:
        procs = db.exec(
            select(SigtapProcedimento).where(SigtapProcedimento.id.in_(list(qtd_por_sid.keys())))
        ).all()
        procs_map = {p.id: p for p in procs if p.id is not None}

    itens_out: list[dict] = []
    for sid, qtd in qtd_por_sid.items():
        proc = procs_map.get(sid)
        itens_out.append(
            {
                "id": sid,
                "solicitacao_id": fila.id,
                "sigtap_id": sid,
                "quantidade": qtd,
                "status_auditoria": fila.status or "na_fila",
                "observacao": "",
                "procedimento_codigo": proc.codigo if proc else "",
                "procedimento_descricao": proc.descricao if proc else f"Exame SIGTAP #{sid}",
                "preparo_especifico": "",
            }
        )

    if not itens_out and fila.observacoes and "Exames:" in fila.observacoes:
        try:
            nomes_str = fila.observacoes.split("Exames:")[1].split("|")[0].strip()
            for idx, nome in enumerate([n.strip() for n in nomes_str.split(",") if n.strip()], start=1):
                itens_out.append(
                    {
                        "id": idx,
                        "solicitacao_id": fila.id,
                        "sigtap_id": 0,
                        "quantidade": 1,
                        "status_auditoria": fila.status or "na_fila",
                        "observacao": "",
                        "procedimento_codigo": "",
                        "procedimento_descricao": nome,
                        "preparo_especifico": "",
                    }
                )
        except Exception:
            pass

    d_ped_obj = fila.data_pedido or fila.data_solicitacao
    d_ped_str = d_ped_obj.isoformat() if d_ped_obj else ""
    d_sol_str = fila.data_solicitacao.isoformat() if fila.data_solicitacao else d_ped_str
    nasc_obj = (getattr(pac, "nascimento", None) or getattr(pac, "data_nascimento", None)) if pac else None

    status_norm = (getattr(fila, "status", "") or "na_fila").strip().lower()
    eh_cancelado = status_norm in {"cancelado", "cancelada", "desistiu", "recusado"}
    tipo_comp = "cancelado" if eh_cancelado else "inclusao_fila"

    pub_tok = (getattr(fila, "public_token", "") or "").strip()
    if not pub_tok:
        import secrets as _secrets
        pub_tok = _secrets.token_urlsafe(24)
        fila.public_token = pub_tok
        db.add(fila)
        db.commit()
    acompanhar_path = f"/acompanhar/{urllib.parse.quote(pub_tok)}"
    qr_url = acompanhar_path

    return {
        "id": fila.id,
        "tipo_comprovante": tipo_comp,
        "origem_modulo": "laboratorio",
        "protocolo": protocolo,
        "codigo_curto": protocolo,
        "codigo_solicitacao": protocolo,
        "numero_pedido": protocolo,
        "public_token": pub_tok,
        "acompanhar_path": acompanhar_path,
        "qr_code_url": qr_url,
        "paciente_id": fila.paciente_id,
        "paciente_nome": pac.nome if pac else "?",
        "paciente_cpf": getattr(pac, "cpf", "") or "",
        "paciente_cns": getattr(pac, "cns", "") or "",
        "paciente_prontuario": prontuario,
        "paciente_nascimento": nasc_obj.isoformat() if nasc_obj else "",
        "data_agendada": "",
        "hora_agendada": "",
        "data_pedido": d_ped_str,
        "data_solicitacao": d_sol_str,
        "laboratorio_id": 0,
        "laboratorio_nome": "" if eh_cancelado else "A definir no agendamento / Fila Municipal",
        "unidade_psf": getattr(fila, "unidade_psf", "") or "Secretaria de Saúde",
        "medico_solicitante": getattr(fila, "medico_solicitante", "") or "Médico da Unidade",
        "fila_nome": getattr(fila, "tipo_fila", "") or getattr(fila, "especialidade", "") or "Fila de Exames de Sangue",
        "tipo_fila": getattr(fila, "tipo_fila", "") or "",
        "especialidade": getattr(fila, "especialidade", "") or "",
        "prioridade": getattr(fila, "prioridade", "rotina") or "rotina",
        "justificativa": getattr(fila, "justificativa", "") or "",
        "motivo_cancelamento": (getattr(fila, "observacoes", "") or "") if eh_cancelado else "",
        "instrucoes_transporte": "",
        "transporte": None,
        "status": fila.status or "na_fila",
        "status_auditoria": fila.status or "na_fila",
        "itens": itens_out,
        "jejum_horas": "",
        "preparo_instrucoes": [],
        "orientacoes_gerais": [] if eh_cancelado else [
            "Este comprovante confirma a inclusão do pedido na Fila Municipal de Espera de Exames de Sangue.",
            "Aguarde o agendamento em lote realizado pela Secretaria Municipal de Saúde conforme disponibilidade de vagas.",
            "Quando o exame for agendado, você receberá a confirmação com data, horário, laboratório e instruções de preparo/jejum.",
            f"Guarde o número do pedido ({protocolo}) para acompanhamento junto à sua Unidade de Saúde (PSF).",
        ],
        "emitido_em": datetime.utcnow().strftime("%d/%m/%Y %H:%M"),
        "agendado_por": getattr(fila, "criado_por", "") or "Unidade de Saúde",
        "exige_preparo": False,
    }


def agendar_lote_fila(
    db: Session,
    fila_ids: list[int],
    laboratorio_id: int,
    data_agendada: date,
    hora_agendada: str,
    sigtap_ids: list[int],
    agendado_por: str,
    instrucoes_transporte: str = "",
) -> list[SolicitacaoMestre]:
    """Marcação mensal em lote da fila do PSF para laboratórios conveniados."""
    if not sigtap_ids:
        sigtap_ids = list(db.exec(select(SigtapProcedimento.id).limit(2)).all())
    agendados: list[SolicitacaoMestre] = []
    for fid in fila_ids:
        fila = db.get(FilaPsf, fid)
        if not fila or fila.status != "na_fila":
            continue
        ids_exames = sigtap_ids
        parsed_ids: list[int] = []
        if getattr(fila, "sigtap_ids_json", None):
            try:
                import json
                parsed = json.loads(fila.sigtap_ids_json)
                if isinstance(parsed, list) and parsed:
                    parsed_ids = [int(x) for x in parsed if str(x).isdigit()]
            except Exception:
                parsed_ids = []
        if not parsed_ids and fila.observacoes and "SIGTAP_IDS:" in fila.observacoes:
            try:
                import json
                trecho = fila.observacoes.split("SIGTAP_IDS:")[1].split("|")[0].strip()
                parsed = json.loads(trecho)
                if isinstance(parsed, list) and parsed:
                    parsed_ids = [int(x) for x in parsed if str(x).isdigit()]
            except Exception:
                parsed_ids = []
        if parsed_ids:
            ids_exames = parsed_ids
        try:
            m = criar_solicitacao_mestre(
                db,
                paciente_id=fila.paciente_id,
                data_agendada=data_agendada,
                hora_agendada=hora_agendada or "07:00",
                laboratorio_id=laboratorio_id,
                sigtap_ids=ids_exames,
                origem_fila_id=fila.id,
                agendado_por=agendado_por,
                medico_solicitante=fila.medico_solicitante,
                unidade_psf=fila.unidade_psf,
                justificativa=fila.justificativa or "Agendamento mensal em lote da fila PSF",
            )
            if instrucoes_transporte:
                m.instrucoes_transporte = instrucoes_transporte
                db.add(m)
                db.commit()
                db.refresh(m)
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
                    "valor_unitario": float(getattr(proc, "valor_combinado", 0.0) or getattr(proc, "valor_sa", 0.0) or getattr(proc, "vl_sa", 0.0) or getattr(proc, "valor_ambulatorial", 0.0) or 0.0),
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


def remover_item_solicitacao(
    db: Session,
    solicitacao_id: int,
    item_id: int,
    justificativa: str,
    usuario_nome: str = "Laboratório",
) -> dict:
    """Permite ao laboratório remover um exame específico do pedido com justificativa técnica.

    Exemplo: Paciente não trouxe frasco/amostra, ou não conseguiu colher material.
    O exame é removido do pedido para que não gere glosa/inconsistência no laudo e não seja faturado.
    """
    mestre = db.get(SolicitacaoMestre, solicitacao_id)
    if not mestre:
        raise HTTPException(404, "Solicitação de exames não encontrada.")
    if mestre.status == "cancelado":
        raise HTTPException(400, "Não é permitido alterar uma solicitação já cancelada.")
    if mestre.status == "realizado":
        raise HTTPException(400, "A solicitação já foi finalizada com laudo homologado.")

    item = db.get(ItemSolic, item_id)
    if not item or item.solicitacao_id != solicitacao_id:
        raise HTTPException(404, "Procedimento/exame não encontrado nesta solicitação.")

    proc = db.get(SigtapProcedimento, item.sigtap_id)
    proc_desc = f"{proc.codigo} · {proc.descricao}" if proc else f"SIGTAP #{item.sigtap_id}"

    # Registra no log de auditoria e observações do pedido
    ts = datetime.now().strftime("%d/%m/%Y %H:%M")
    obs_registro = (
        f"[Exame {proc_desc} removido por {usuario_nome} em {ts}. "
        f"Justificativa: {justificativa.strip()}]"
    )
    if mestre.observacao_laboratorio:
        mestre.observacao_laboratorio = f"{mestre.observacao_laboratorio} | {obs_registro}"
    else:
        mestre.observacao_laboratorio = obs_registro

    # Exclui o item para não ser faturado nem cobrado na leitura do laudo
    db.delete(item)
    db.add(mestre)
    db.commit()
    db.refresh(mestre)
    return enriquecer_mestre(db, mestre)


def editar_pedido_exames(
    db: Session,
    solicitacao_id: int,
    itens_novos: dict[int, int],  # {sigtap_id: quantidade}
    medico_id: int | None = None,
    medico_nome: str = "",
    unidade_id: int | None = None,
    unidade_nome: str = "",
    justificativa: str = "",
    hora_agendada: str = "",
    usuario_nome: str = "Operador",
) -> dict:
    """Permite à regulação/operador editar os exames e dados de um pedido agendado."""
    mestre = db.get(SolicitacaoMestre, solicitacao_id)
    if not mestre:
        raise HTTPException(404, "Solicitação de exames não encontrada.")
    if mestre.status in ("cancelado", "realizado"):
        raise HTTPException(400, f"Não é possível editar uma solicitação com status '{mestre.status}'.")

    if not itens_novos:
        raise HTTPException(400, "O pedido deve conter ao menos 1 procedimento/exame.")

    # Valida procedimentos informados
    for sid, qtd in itens_novos.items():
        if qtd < 1 or qtd > 99:
            raise HTTPException(400, f"Quantidade inválida para o exame #{sid}: {qtd}")
        if not db.get(SigtapProcedimento, sid):
            raise HTTPException(404, f"Procedimento SIGTAP #{sid} não encontrado.")

    # Atualiza dados cadastrais se informados
    if medico_id is not None:
        mestre.medico_id = medico_id
    if medico_nome:
        mestre.medico_solicitante = medico_nome
    if unidade_id is not None:
        mestre.unidade_saude_id = unidade_id
    if unidade_nome:
        mestre.unidade_psf = unidade_nome
    if justificativa:
        mestre.justificativa = justificativa
    if hora_agendada:
        mestre.hora_agendada = hora_agendada

    # Itens existentes na base
    itens_atuais = db.exec(
        select(ItemSolic).where(ItemSolic.solicitacao_id == solicitacao_id)
    ).all()
    mapa_atuais = {it.sigtap_id: it for it in itens_atuais}

    from app.services.lab_contratos_service import resolver_preco_procedimento

    # Remove itens que saíram
    for sid, it in mapa_atuais.items():
        if sid not in itens_novos:
            db.delete(it)

    # Atualiza ou adiciona itens
    for sid, qtd in itens_novos.items():
        if sid in mapa_atuais:
            it = mapa_atuais[sid]
            it.quantidade = qtd
            db.add(it)
        else:
            proc = db.get(SigtapProcedimento, sid)
            v_un, origem, cid = resolver_preco_procedimento(
                db, mestre.laboratorio_id, sid, mestre.data_agendada, proc_padrao=proc
            )
            novo_item = ItemSolic(
                solicitacao_id=mestre.id,
                sigtap_id=sid,
                quantidade=qtd,
                valor_unitario_aplicado=v_un,
                origem_preco=origem,
                contrato_id=cid,
            )
            db.add(novo_item)

    ts = datetime.now().strftime("%d/%m/%Y %H:%M")
    obs_registro = f"[Pedido editado por {usuario_nome} em {ts}: {len(itens_novos)} exames]"
    if mestre.observacao_laboratorio:
        mestre.observacao_laboratorio = f"{mestre.observacao_laboratorio} | {obs_registro}"
    else:
        mestre.observacao_laboratorio = obs_registro

    db.add(mestre)
    db.commit()
    db.refresh(mestre)
    return enriquecer_mestre(db, mestre)
