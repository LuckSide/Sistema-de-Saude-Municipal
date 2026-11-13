import hashlib
import io
import json
import zipfile
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text
from sqlmodel import Session, func, or_, select

from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import (
    FilaPsf,
    ItemSolic,
    Laboratorio,
    LabLoteArtefato,
    LabLoteItem,
    LabLoteLiberacao,
    LabOrcamentoMensal,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.tfd import Paciente
from app.schemas.lab_fase6 import (
    LabLoteConsolidarIn,
    LabLoteDiaDistribuicaoOut,
    LabLoteItemOut,
    LabLoteOut,
    LabLotePreviaIn,
    LabLotePreviaItemOut,
    LabLotePreviaOut,
    LabLotePreviaProcedimento,
    LabOrcamentoIn,
    LabOrcamentoOut,
)
from app.services.export_xlsx import gerar_xlsx
from app.services.geradores import gerar_prontuario_aleatorio, gerar_protocolo_lab_aleatorio
from app.services.lab_preparo import determinar_preparo


# ==============================================================================
# 1. GESTÃO DE ORÇAMENTO MENSAL
# ==============================================================================

def sincronizar_consumo_orcamento(db: Session, competencia: str) -> LabOrcamentoMensal | None:
    """Recalcula o total consumido na competência somando lotes ativos."""
    orc = db.exec(
        select(LabOrcamentoMensal).where(LabOrcamentoMensal.competencia == competencia)
    ).first()
    if not orc:
        return None

    tot = db.exec(
        select(func.coalesce(func.sum(LabLoteLiberacao.valor_consumido), 0.0)).where(
            LabLoteLiberacao.competencia == competencia,
            LabLoteLiberacao.status == "consolidado",
        )
    ).one()
    orc.valor_consumido = round(float(tot or 0.0), 2)
    orc.updated_at = datetime.utcnow()
    db.add(orc)
    db.commit()
    db.refresh(orc)
    return orc


def definir_orcamento_mensal(
    db: Session,
    dados: LabOrcamentoIn,
    usuario_nome: str = "",
) -> LabOrcamentoOut:
    """Define ou atualiza o teto financeiro mensal da competência (AAAA-MM)."""
    comp = dados.competencia.strip()
    orc = db.exec(
        select(LabOrcamentoMensal).where(LabOrcamentoMensal.competencia == comp)
    ).first()

    if not orc:
        orc = LabOrcamentoMensal(
            competencia=comp,
            teto_mensal=round(float(dados.teto_mensal), 2),
            valor_consumido=0.0,
            observacoes=dados.observacoes.strip(),
            atualizado_por=usuario_nome or "Sistema",
        )
        db.add(orc)
        db.commit()
        db.refresh(orc)
    else:
        orc.teto_mensal = round(float(dados.teto_mensal), 2)
        orc.observacoes = dados.observacoes.strip()
        orc.atualizado_por = usuario_nome or orc.atualizado_por
        orc.updated_at = datetime.utcnow()
        db.add(orc)
        db.commit()
        db.refresh(orc)

    sincronizar_consumo_orcamento(db, comp)
    return formatar_orcamento_out(db, orc)


def obter_orcamento_competencia(db: Session, competencia: str) -> LabOrcamentoOut | None:
    """Retorna o orçamento da competência com totais atualizados."""
    orc = db.exec(
        select(LabOrcamentoMensal).where(LabOrcamentoMensal.competencia == competencia.strip())
    ).first()
    if not orc:
        return None
    return formatar_orcamento_out(db, orc)


def listar_orcamentos(db: Session, ano: int | None = None) -> list[LabOrcamentoOut]:
    """Lista todos os orçamentos mensais cadastrados, ordenados decrescente."""
    stmt = select(LabOrcamentoMensal).order_by(LabOrcamentoMensal.competencia.desc())
    if ano:
        stmt = stmt.where(LabOrcamentoMensal.competencia.like(f"{ano}-%"))
    rows = db.exec(stmt).all()
    return [formatar_orcamento_out(db, r) for r in rows]


def formatar_orcamento_out(db: Session, orc: LabOrcamentoMensal) -> LabOrcamentoOut:
    saldo = max(0.0, round(float(orc.teto_mensal - orc.valor_consumido), 2))
    pct = (
        round((orc.valor_consumido / orc.teto_mensal) * 100, 1)
        if orc.teto_mensal > 0
        else 0.0
    )
    qtd_lotes = (
        db.exec(
            select(func.count(LabLoteLiberacao.id)).where(
                LabLoteLiberacao.competencia == orc.competencia,
                LabLoteLiberacao.status == "consolidado",
            )
        ).one()
        or 0
    )
    return LabOrcamentoOut(
        id=orc.id or 0,
        competencia=orc.competencia,
        teto_mensal=float(orc.teto_mensal),
        valor_consumido=float(orc.valor_consumido),
        saldo_disponivel=float(saldo),
        percentual_consumido=float(pct),
        observacoes=orc.observacoes or "",
        atualizado_por=orc.atualizado_por or "",
        created_at=orc.created_at,
        updated_at=orc.updated_at,
        lotes_count=qtd_lotes,
    )


# ==============================================================================
# 2. MOTOR DE EXTRAÇÃO DE EXAMES E PREÇOS SIGTAP
# ==============================================================================

def extrair_sigtap_ids_fila(fila: FilaPsf) -> list[int]:
    """Extrai IDs do SIGTAP com fallback estruturado (JSON ou observacoes)."""
    if fila.sigtap_ids_json:
        try:
            parsed = json.loads(fila.sigtap_ids_json)
            if isinstance(parsed, list) and parsed:
                return [int(x) for x in parsed if isinstance(x, (int, str)) and str(x).isdigit()]
        except Exception:
            pass

    obs = fila.observacoes or ""
    if "SIGTAP_IDS:" in obs:
        try:
            trecho = obs.split("SIGTAP_IDS:")[1].split("|")[0].strip()
            parsed = json.loads(trecho)
            if isinstance(parsed, list) and parsed:
                return [int(x) for x in parsed if isinstance(x, (int, str)) and str(x).isdigit()]
        except Exception:
            pass

    return []


def calcular_custo_exames_fila(
    db: Session,
    sigtap_ids: list[int],
    cache_procs: dict[int, SigtapProcedimento],
) -> tuple[float, list[LabLotePreviaProcedimento]]:
    """Calcula o custo monetário total baseado no valor ambulatorial SIGTAP (valor_sa)."""
    procs_out: list[LabLotePreviaProcedimento] = []
    custo_total = 0.0

    ids_para_buscar = [sid for sid in sigtap_ids if sid not in cache_procs]
    if ids_para_buscar:
        for p in db.exec(select(SigtapProcedimento).where(SigtapProcedimento.id.in_(ids_para_buscar))).all():
            if p.id is not None:
                cache_procs[p.id] = p

    for sid in sigtap_ids:
        proc = cache_procs.get(sid)
        if not proc:
            continue
        v_un = float(proc.valor_sa or proc.valor_sp or 0.0)
        v_un = round(v_un, 2)
        procs_out.append(
            LabLotePreviaProcedimento(
                sigtap_id=proc.id or sid,
                codigo=proc.codigo,
                descricao=proc.descricao,
                valor_unitario=v_un,
                quantidade=1,
                valor_total=v_un,
            )
        )
        custo_total += v_un

    return round(custo_total, 2), procs_out


# ==============================================================================
# 3. CÁLCULO DE PRÉVIA DO LOTE (FILA + ORÇAMENTO + VAGAS)
# ==============================================================================

def calcular_previa_lote(db: Session, dados: LabLotePreviaIn) -> LabLotePreviaOut:
    """Calcula a prévia do lote cruzando fila prioritária, orçamento e capacidade de vagas."""
    lab = db.get(Laboratorio, dados.laboratorio_id)
    if not lab or not lab.ativo:
        raise HTTPException(400, "Laboratório selecionado não encontrado ou inativo.")

    comp = dados.competencia.strip()
    orc = db.exec(select(LabOrcamentoMensal).where(LabOrcamentoMensal.competencia == comp)).first()
    teto_atual = float(orc.teto_mensal) if orc else 0.0
    consumido_atual = float(orc.valor_consumido) if orc else 0.0
    saldo_atual = max(0.0, round(teto_atual - consumido_atual, 2)) if orc else dados.valor_limite

    motivos_bloqueio: list[str] = []
    bloqueado = False

    if orc and dados.valor_limite > saldo_atual:
        motivos_bloqueio.append(
            f"O valor solicitado (R$ {dados.valor_limite:,.2f}) excede o saldo disponível do mês (R$ {saldo_atual:,.2f})."
        )
        bloqueado = True

    datas_validas = sorted(list({d for d in dados.datas_agendamento if d >= date.today()}))
    if not datas_validas:
        raise HTTPException(400, "Informe ao menos uma data futura válida para agendamento.")

    # Busca fila pendente em ordem de prioridade clínica e cronológica
    stmt_fila = (
        select(FilaPsf)
        .where(FilaPsf.status == "na_fila")
        .order_by(
            text("CASE WHEN prioridade = 'urgente' THEN 1 WHEN prioridade = 'alta' THEN 2 ELSE 3 END"),
            FilaPsf.data_solicitacao.asc(),
            FilaPsf.id.asc(),
        )
    )
    if dados.unidade_psf and dados.unidade_psf.strip():
        stmt_fila = stmt_fila.where(FilaPsf.unidade_psf.ilike(f"%{dados.unidade_psf.strip()}%"))

    filas_pendentes = list(db.exec(stmt_fila).all())
    pac_ids = {f.paciente_id for f in filas_pendentes if f.paciente_id}
    pacs_map = {p.id: p for p in db.exec(select(Paciente).where(Paciente.id.in_(pac_ids))).all()} if pac_ids else {}

    cache_procs: dict[int, SigtapProcedimento] = {}
    pacientes_selecionados: list[LabLotePreviaItemOut] = []
    valor_acumulado = 0.0
    total_exames = 0

    for f in filas_pendentes:
        sids = extrair_sigtap_ids_fila(f)
        if not sids:
            continue
        custo_paciente, procs = calcular_custo_exames_fila(db, sids, cache_procs)
        if not procs:
            continue

        if valor_acumulado > 0 and (valor_acumulado + custo_paciente) > (dados.valor_limite + 0.01):
            # Encerra quando o próximo paciente estoura o teto estipulado
            break

        pac = pacs_map.get(f.paciente_id)
        pront = getattr(pac, "codigo_prontuario", "") or (
            gerar_prontuario_aleatorio(pac_id=pac.id) if pac and pac.id else ""
        )

        item_previa = LabLotePreviaItemOut(
            fila_id=f.id or 0,
            paciente_id=f.paciente_id,
            paciente_nome=pac.nome if pac else "Paciente não localizado",
            paciente_cpf=getattr(pac, "cpf", "") or "",
            paciente_prontuario=pront,
            data_solicitacao=f.data_solicitacao,
            prioridade=getattr(f, "prioridade", "rotina") or "rotina",
            unidade_psf=f.unidade_psf or "Secretaria de Saúde",
            medico_solicitante=f.medico_solicitante or "",
            justificativa=f.justificativa or "",
            procedimentos=procs,
            valor_total=custo_paciente,
        )
        pacientes_selecionados.append(item_previa)
        valor_acumulado = round(valor_acumulado + custo_paciente, 2)
        total_exames += len(procs)

    if not pacientes_selecionados:
        motivos_bloqueio.append("Nenhum paciente pendente com exames SIGTAP válidos foi encontrado na fila.")
        bloqueado = True

    # Consulta capacidade de vagas do laboratório nas datas escolhidas
    vagas_db = db.exec(
        select(VagaLab).where(
            VagaLab.laboratorio_id == dados.laboratorio_id,
            VagaLab.data.in_(datas_validas),
        )
    ).all()
    vagas_map = {v.data: v for v in vagas_db}

    # Distribuição equilibrada dos pacientes entre as datas selecionadas
    n_datas = len(datas_validas)
    alocados_por_data: dict[date, list[LabLotePreviaItemOut]] = {d: [] for d in datas_validas}
    for idx, p_item in enumerate(pacientes_selecionados):
        d_alvo = datas_validas[idx % n_datas]
        p_item.data_agendada_sugerida = d_alvo
        alocados_por_data[d_alvo].append(p_item)

    distribuicao_dias: list[LabLoteDiaDistribuicaoOut] = []
    tem_deficit = False
    deficit_total = 0

    for d in datas_validas:
        alocados = alocados_por_data[d]
        qtd_alocados = len(alocados)
        v_dia = round(sum(it.valor_total for it in alocados), 2)
        vaga = vagas_map.get(d)
        v_totais = vaga.vagas_totais if vaga else 0
        v_ocupadas = vaga.vagas_ocupadas if vaga else 0
        v_livres = max(0, v_totais - v_ocupadas)

        deficit = max(0, qtd_alocados - v_livres)
        if not vaga:
            st = "sem_vaga_cadastrada"
            deficit = qtd_alocados
            tem_deficit = True
            deficit_total += deficit
        elif deficit > 0:
            st = "deficit"
            tem_deficit = True
            deficit_total += deficit
        else:
            st = "ok"

        distribuicao_dias.append(
            LabLoteDiaDistribuicaoOut(
                data=d,
                pacientes_alocados=qtd_alocados,
                valor_dia=v_dia,
                vagas_totais=v_totais,
                vagas_ocupadas=v_ocupadas,
                vagas_livres=v_livres,
                vagas_restantes_apos=(v_livres - qtd_alocados),
                deficit=deficit,
                status=st,
            )
        )

    if tem_deficit:
        bloqueado = True
        motivos_bloqueio.append(
            f"Faltam vagas para alocar os exames selecionados (déficit total de {deficit_total} vaga(s)). "
            "Aumente as cotas de vagas na agenda do laboratório ou inclua mais datas para prosseguir."
        )

    saldo_apos = max(0.0, round(saldo_atual - valor_acumulado, 2)) if orc else 0.0

    sugestao = ""
    if tem_deficit:
        sugestao = "Acesse a tela 'Vagas e Agenda', abra novas cotas para os dias com déficit e recalcule o lote."
    elif not pacientes_selecionados:
        sugestao = "Verifique a 'Fila de Exames' para confirmar novas solicitações do PSF aguardando agendamento."
    else:
        sugestao = "Cotas e orçamento validados com sucesso! Prossiga para confirmar o agendamento em lote."

    return LabLotePreviaOut(
        competencia=comp,
        laboratorio_id=dados.laboratorio_id,
        laboratorio_nome=lab.nome,
        valor_solicitado=dados.valor_limite,
        valor_consumido_estimado=valor_acumulado,
        saldo_orcamento_atual=saldo_atual,
        saldo_orcamento_apos=saldo_apos,
        total_pacientes_contemplados=len(pacientes_selecionados),
        total_exames_contemplados=total_exames,
        pacientes=pacientes_selecionados,
        distribuicao_dias=distribuicao_dias,
        tem_deficit_vagas=tem_deficit,
        deficit_total_vagas=deficit_total,
        bloqueado=bloqueado,
        motivos_bloqueio=motivos_bloqueio,
        sugestao_acao=sugestao,
    )


# ==============================================================================
# 4. GERAÇÃO DE ARTEFATOS (PDF COMPROVANTES E EXCEL)
# ==============================================================================

def _escape_pdf(text_val: str) -> str:
    """Escapa caracteres especiais para strings em stream PDF."""
    clean = text_val.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return "".join(c if ord(c) < 128 else "?" for c in clean)


def gerar_pdf_comprovante_bytes(dados: dict) -> bytes:
    """Gera comprovante PDF 1.4 oficial puro (sem bibliotecas nativas externas)."""
    protocolo = dados.get("protocolo", "—")
    pac_nome = dados.get("paciente_nome", "—")
    pac_cpf = dados.get("paciente_cpf", "—")
    pac_cns = dados.get("paciente_cns", "—")
    pac_pront = dados.get("paciente_prontuario", "—")
    dt_agendada = dados.get("data_agendada", "—")
    hora_agendada = dados.get("hora_agendada", "07:00")
    lab_nome = dados.get("laboratorio_nome", "—")
    unidade_psf = dados.get("unidade_psf", "Secretaria de Saúde")
    itens = dados.get("itens", [])
    preparo_lista = dados.get("preparo_instrucoes", [])
    agora_fmt = datetime.now().strftime("%d/%m/%Y %H:%M")

    lines = [
        "BT",
        "/F1 14 Tf",
        "50 800 Td",
        f"({_escape_pdf('MUNICÍPIO DE GUAPÉ - SECRETARIA MUNICIPAL DE SAÚDE')}) Tj",
        "/F1 11 Tf",
        "0 -22 Td",
        f"({_escape_pdf('COMPROVANTE OFICIAL DE AGENDAMENTO DE EXAMES DE SANGUE')}) Tj",
        "/F1 9 Tf",
        "0 -18 Td",
        f"({_escape_pdf(f'Protocolo: {protocolo}   ·   Emitido em: {agora_fmt}')}) Tj",
        "0 -22 Td",
        f"({_escape_pdf('------------------------------------------------------------------------------------------------------------------------')}) Tj",
        "/F1 10 Tf",
        "0 -18 Td",
        f"({_escape_pdf('DADOS DO PACIENTE:')}) Tj",
        "/F1 9 Tf",
        "0 -15 Td",
        f"({_escape_pdf(f'Nome: {pac_nome}')}) Tj",
        "0 -14 Td",
        f"({_escape_pdf(f'CPF: {pac_cpf}   |   CNS: {pac_cns}   |   Prontuário: {pac_pront}')}) Tj",
        "0 -20 Td",
        f"({_escape_pdf('DADOS DA COLETA / AGENDAMENTO:')}) Tj",
        "/F1 9 Tf",
        "0 -15 Td",
        f"({_escape_pdf(f'Data Agendada: {dt_agendada} às {hora_agendada}')}) Tj",
        "0 -14 Td",
        f"({_escape_pdf(f'Local / Laboratório: {lab_nome}')}) Tj",
        "0 -14 Td",
        f"({_escape_pdf(f'Unidade de Saúde Solicitante: {unidade_psf}')}) Tj",
        "0 -20 Td",
        "/F1 10 Tf",
        f"({_escape_pdf('EXAMES AUTORIZADOS:')}) Tj",
        "/F1 9 Tf",
    ]

    for it in itens[:18]:
        cod = it.get("procedimento_codigo", "")
        desc = it.get("procedimento_descricao", "")
        lines.append("0 -13 Td")
        lines.append(f"({_escape_pdf(f'• {cod} - {desc}')}) Tj")

    lines.append("0 -20 Td")
    lines.append("/F1 10 Tf")
    lines.append(f"({_escape_pdf('ORIENTAÇÕES DE PREPARO CLÍNICO:')}) Tj")
    lines.append("/F1 9 Tf")

    if preparo_lista:
        for p_txt in preparo_lista[:5]:
            lines.append("0 -13 Td")
            lines.append(f"({_escape_pdf(f'* {p_txt}')}) Tj")
    else:
        lines.append("0 -13 Td")
        lines.append(f"({_escape_pdf('* Jejum obrigatório de 8 a 12 horas. Água pode ser consumida com moderação.')}) Tj")

    lines.append("0 -35 Td")
    lines.append(f"({_escape_pdf('____________________________________________________')}) Tj")
    lines.append("0 -13 Td")
    lines.append(f"({_escape_pdf('Assinatura do Responsável / Secretaria Municipal de Saúde')}) Tj")
    lines.append("ET")

    stream_content = "\n".join(lines).encode("latin-1", "replace")
    stream_len = len(stream_content)

    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {stream_len} >>\nstream\n".encode("ascii") + stream_content + b"\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    out = b"%PDF-1.4\n"
    offsets = []
    for i, obj in enumerate(objs, start=1):
        offsets.append(len(out))
        if isinstance(obj, str):
            out += f"{i} 0 obj\n{obj}\nendobj\n".encode("latin-1")
        else:
            out += f"{i} 0 obj\n".encode("ascii") + obj + b"\nendobj\n"
    xref_offset = len(out)
    out += b"xref\n"
    out += f"0 {len(objs) + 1}\n".encode("ascii")
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode("ascii")
    out += (
        f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    ).encode("ascii")
    return out


def gerar_zip_comprovantes(itens_lote: list[dict]) -> bytes:
    """Gera arquivo ZIP contendo o comprovante PDF de cada paciente do lote."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for it in itens_lote:
            pdf_bytes = gerar_pdf_comprovante_bytes(it)
            pront = it.get("paciente_prontuario", "paciente").replace("/", "_")
            nome_arq = f"comprovante_{pront}_{it.get('paciente_id', 0)}.pdf"
            zf.writestr(nome_arq, pdf_bytes)
    return buf.getvalue()


def gerar_excel_lote_bytes(codigo_lote: str, usuario_nome: str, linhas_excel: list[dict]) -> bytes:
    """Gera relatório XLSX do lote utilizando o serviço oficial export_xlsx."""
    colunas = [
        {"chave": "prontuario", "rotulo": "Prontuário", "largura": 16},
        {"chave": "paciente_nome", "rotulo": "Nome do Paciente", "largura": 32},
        {"chave": "paciente_cpf", "rotulo": "CPF", "largura": 16},
        {"chave": "data_solicitacao", "rotulo": "Data Solicitação", "largura": 16, "formato": "data"},
        {"chave": "data_agendada", "rotulo": "Data Agendamento", "largura": 18, "formato": "data"},
        {"chave": "laboratorio", "rotulo": "Laboratório", "largura": 22},
        {"chave": "exames", "rotulo": "Procedimentos Liberados", "largura": 42},
        {"chave": "qtd_exames", "rotulo": "Qtd", "largura": 10, "formato": "numero"},
        {"chave": "valor_total", "rotulo": "Valor Consumido", "largura": 18, "formato": "moeda"},
    ]
    return gerar_xlsx(
        titulo=f"Relatório de Liberação em Lote - {codigo_lote}",
        usuario_nome=usuario_nome,
        colunas=colunas,
        linhas=linhas_excel,
    )


# ==============================================================================
# 5. MOTOR DE AGENDAMENTO ATÔMICO COM LOCK PESSIMISTA (ACID)
# ==============================================================================

def consolidar_lote_atomico(
    db: Session,
    dados: LabLoteConsolidarIn,
    usuario_nome: str = "",
) -> LabLoteLiberacao:
    """Executa a liberação em lote com concorrência rigorosa e rollback total em caso de conflito."""
    lab = db.get(Laboratorio, dados.laboratorio_id)
    if not lab or not lab.ativo:
        raise HTTPException(400, "Laboratório selecionado não encontrado ou inativo.")

    comp = dados.competencia.strip()
    datas_alvo = sorted(list({d for d in dados.datas_agendamento if d >= date.today()}))
    if not datas_alvo:
        raise HTTPException(400, "Nenhuma data futura informada para o agendamento.")

    try:
        # 1. Lock pessimista no orçamento mensal
        orc = db.exec(
            select(LabOrcamentoMensal)
            .where(LabOrcamentoMensal.competencia == comp)
            .with_for_update()
        ).first()

        if orc:
            saldo_livre = round(float(orc.teto_mensal - orc.valor_consumido), 2)
            if dados.valor_solicitado > saldo_livre:
                raise HTTPException(
                    400,
                    f"Saldo orçamentário insuficiente. Saldo disponível: R$ {saldo_livre:,.2f}, solicitado: R$ {dados.valor_solicitado:,.2f}.",
                )

        # 2. Lock pessimista nas cotas de vagas do laboratório
        vagas_db = db.exec(
            select(VagaLab)
            .where(
                VagaLab.laboratorio_id == dados.laboratorio_id,
                VagaLab.data.in_(datas_alvo),
            )
            .with_for_update()
        ).all()
        vagas_map = {v.data: v for v in vagas_db}

        for d in datas_alvo:
            if d not in vagas_map:
                raise HTTPException(
                    400,
                    f"Não há cotas de vagas cadastradas para o laboratório {lab.nome} na data {d.strftime('%d/%m/%Y')}.",
                )

        # 3. Lock pessimista nos itens da FilaPsf candidatos
        if dados.fila_ids_confirmados:
            stmt_filas = (
                select(FilaPsf)
                .where(FilaPsf.id.in_(dados.fila_ids_confirmados))
                .with_for_update()
            )
        else:
            stmt_filas = (
                select(FilaPsf)
                .where(FilaPsf.status == "na_fila")
                .order_by(
                    text("CASE WHEN prioridade = 'urgente' THEN 1 WHEN prioridade = 'alta' THEN 2 ELSE 3 END"),
                    FilaPsf.data_solicitacao.asc(),
                    FilaPsf.id.asc(),
                )
                .with_for_update()
            )

        filas_candidatas = list(db.exec(stmt_filas).all())
        if dados.fila_ids_confirmados and len(filas_candidatas) != len(dados.fila_ids_confirmados):
            raise HTTPException(400, "Um ou mais pacientes da lista não foram localizados na fila.")

        for f in filas_candidatas:
            if f.status != "na_fila":
                raise HTTPException(
                    400,
                    f"O paciente da solicitação #{f.id} já foi agendado ou cancelado por outra transação.",
                )

        # Seleciona pacientes até o teto financeiro
        cache_procs: dict[int, SigtapProcedimento] = {}
        selecionados: list[dict] = []
        valor_acumulado = 0.0
        total_exames = 0

        for f in filas_candidatas:
            sids = extrair_sigtap_ids_fila(f)
            if not sids:
                continue
            custo_pac, procs = calcular_custo_exames_fila(db, sids, cache_procs)
            if not procs:
                continue

            if not dados.fila_ids_confirmados and valor_acumulado > 0 and (valor_acumulado + custo_pac) > (dados.valor_solicitado + 0.01):
                break

            selecionados.append({"fila": f, "custo": custo_pac, "procs": procs})
            valor_acumulado = round(valor_acumulado + custo_pac, 2)
            total_exames += len(procs)

        if not selecionados:
            raise HTTPException(400, "Nenhum paciente pendente apto para agendamento neste lote.")

        # 4. Distribuição e verificação rigorosa de vagas livres
        n_datas = len(datas_alvo)
        alocacao_dia: dict[date, list[dict]] = {d: [] for d in datas_alvo}
        for idx, item in enumerate(selecionados):
            d_alvo = datas_alvo[idx % n_datas]
            item["data_agendada"] = d_alvo
            alocacao_dia[d_alvo].append(item)

        for d, pacs in alocacao_dia.items():
            vg = vagas_map[d]
            v_livres = vg.vagas_totais - vg.vagas_ocupadas
            if len(pacs) > v_livres:
                raise HTTPException(
                    400,
                    f"Vagas insuficientes em {d.strftime('%d/%m/%Y')} (Livres: {v_livres}, Necessárias: {len(pacs)}). "
                    "A transação foi cancelada sem alterações.",
                )

        # 5. Criação do Lote
        prefixo = f"LOTE-{datetime.now().strftime('%Y%m')}"
        tot_mes = (
            db.exec(
                select(func.count(LabLoteLiberacao.id)).where(
                    LabLoteLiberacao.codigo_lote.like(f"{prefixo}%")
                )
            ).one()
            or 0
        )
        codigo_lote = f"{prefixo}-{(tot_mes + 1):04d}"

        datas_dist_resumo = [
            {"data": d.isoformat(), "pacientes": len(pacs), "valor": round(sum(p["custo"] for p in pacs), 2)}
            for d, pacs in alocacao_dia.items()
        ]

        lote = LabLoteLiberacao(
            codigo_lote=codigo_lote,
            orcamento_id=orc.id if orc else None,
            competencia=comp,
            laboratorio_id=dados.laboratorio_id,
            laboratorio_nome=lab.nome,
            valor_solicitado=dados.valor_solicitado,
            valor_consumido=valor_acumulado,
            qtd_pacientes=len(selecionados),
            qtd_exames=total_exames,
            datas_alocacao_json=json.dumps(datas_dist_resumo),
            status="consolidado",
            observacoes=dados.observacoes.strip(),
            criado_por=usuario_nome or "Sistema",
        )
        db.add(lote)
        db.flush()

        # 6. Agendamento dos pacientes e consumo de vagas
        comprovantes_dados: list[dict] = []
        linhas_excel: list[dict] = []

        pac_ids = {item["fila"].paciente_id for item in selecionados}
        pacs_map = {p.id: p for p in db.exec(select(Paciente).where(Paciente.id.in_(pac_ids))).all()}

        for ordem, item in enumerate(selecionados, start=1):
            f: FilaPsf = item["fila"]
            dt_agenda: date = item["data_agendada"]
            custo_pac: float = item["custo"]
            procs: list[LabLotePreviaProcedimento] = item["procs"]
            pac = pacs_map.get(f.paciente_id)
            pront = getattr(pac, "codigo_prontuario", "") or (
                gerar_prontuario_aleatorio(pac_id=pac.id) if pac and pac.id else ""
            )

            # Cria SolicitacaoMestre
            mestre = SolicitacaoMestre(
                paciente_id=f.paciente_id,
                data_agendada=dt_agenda,
                hora_agendada=dados.hora_padrao or "07:00",
                laboratorio_id=dados.laboratorio_id,
                status="agendado",
                agendado_por=usuario_nome or "Liberação em Lote",
                origem_fila_id=f.id,
                lote_id=lote.id,
                status_auditoria="pendente_conferencia",
                medico_solicitante=f.medico_solicitante or "",
                unidade_psf=f.unidade_psf or "Secretaria de Saúde",
                justificativa=f.justificativa or f"Agendamento via {codigo_lote}",
            )
            db.add(mestre)
            db.flush()

            # Cria ItemSolic para cada SIGTAP
            for p_info in procs:
                db.add(
                    ItemSolic(
                        solicitacao_id=mestre.id,
                        sigtap_id=p_info.sigtap_id,
                        quantidade=1,
                        status_auditoria="pendente_conferencia",
                    )
                )

            # Consome cota na VagaLab
            vg = vagas_map[dt_agenda]
            vg.vagas_ocupadas += 1
            db.add(vg)

            # Atualiza status na FilaPsf
            f.status = "agendado"
            f.lote_id = lote.id
            db.add(f)

            # Snapshot auditável no LabLoteItem
            procs_dict_list = [p_info.model_dump() for p_info in procs]
            db.add(
                LabLoteItem(
                    lote_id=lote.id,
                    fila_psf_id=f.id,
                    solicitacao_mestre_id=mestre.id,
                    paciente_id=f.paciente_id,
                    paciente_nome=pac.nome if pac else "?",
                    paciente_cpf=getattr(pac, "cpf", "") or "",
                    paciente_prontuario=pront,
                    data_agendada=dt_agenda,
                    ordem_selecao=ordem,
                    prioridade_fila=getattr(f, "prioridade", "rotina") or "rotina",
                    valor_consumido=custo_pac,
                    exames_snapshot_json=json.dumps(procs_dict_list, ensure_ascii=False),
                )
            )

            # Prepara dados para comprovante oficial
            nomes_procs = [p.descricao for p in procs]
            _, prep_inst, _ = determinar_preparo(nomes_procs)
            protocolo_comprovante = gerar_protocolo_lab_aleatorio(dt_agenda, mestre.id)

            comprovantes_dados.append({
                "protocolo": protocolo_comprovante,
                "paciente_id": f.paciente_id,
                "paciente_nome": pac.nome if pac else "?",
                "paciente_cpf": getattr(pac, "cpf", "") or "",
                "paciente_cns": getattr(pac, "cns", "") or "",
                "paciente_prontuario": pront,
                "data_agendada": dt_agenda.strftime("%d/%m/%Y"),
                "hora_agendada": dados.hora_padrao or "07:00",
                "laboratorio_nome": lab.nome,
                "unidade_psf": f.unidade_psf or "Secretaria de Saúde",
                "itens": [
                    {"procedimento_codigo": p.codigo, "procedimento_descricao": p.descricao}
                    for p in procs
                ],
                "preparo_instrucoes": prep_inst,
            })

            # Prepara dados para a planilha Excel
            linhas_excel.append({
                "prontuario": pront,
                "paciente_nome": pac.nome if pac else "?",
                "paciente_cpf": getattr(pac, "cpf", "") or "",
                "data_solicitacao": f.data_solicitacao,
                "data_agendada": dt_agenda,
                "laboratorio": lab.nome,
                "exames": "; ".join(nomes_procs),
                "qtd_exames": len(procs),
                "valor_total": custo_pac,
            })

        # 7. Atualiza consumo do orçamento mensal
        if orc:
            orc.valor_consumido = round(float(orc.valor_consumido + valor_acumulado), 2)
            orc.updated_at = datetime.utcnow()
            db.add(orc)

        # 8. Gera e armazena os artefatos binários (ZIP e XLSX)
        zip_bytes = gerar_zip_comprovantes(comprovantes_dados)
        zip_nome = f"comprovantes_{codigo_lote}.zip"
        zip_sha = hashlib.sha256(zip_bytes).hexdigest()

        xlsx_bytes = gerar_excel_lote_bytes(codigo_lote, usuario_nome, linhas_excel)
        xlsx_nome = f"relatorio_{codigo_lote}.xlsx"
        xlsx_sha = hashlib.sha256(xlsx_bytes).hexdigest()

        db.add(
            LabLoteArtefato(
                lote_id=lote.id,
                tipo="comprovantes_zip",
                nome_arquivo=zip_nome,
                mime_type="application/zip",
                tamanho_bytes=len(zip_bytes),
                sha256=zip_sha,
                conteudo=zip_bytes,
            )
        )
        db.add(
            LabLoteArtefato(
                lote_id=lote.id,
                tipo="relatorio_xlsx",
                nome_arquivo=xlsx_nome,
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                tamanho_bytes=len(xlsx_bytes),
                sha256=xlsx_sha,
                conteudo=xlsx_bytes,
            )
        )

        lote.arquivo_comprovantes_nome = zip_nome
        lote.arquivo_comprovantes_sha256 = zip_sha
        lote.arquivo_excel_nome = xlsx_nome
        lote.arquivo_excel_sha256 = xlsx_sha
        db.add(lote)

        db.commit()
        db.refresh(lote)
        return lote

    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            500,
            f"Erro interno durante a consolidação atômica do lote: {str(exc)}",
        ) from exc


# ==============================================================================
# 6. CONSULTAS E DOWNLOADS DE LOTES E ARTEFATOS
# ==============================================================================

def listar_lotes_liberacao(
    db: Session,
    competencia: str | None = None,
    laboratorio_id: int | None = None,
) -> list[LabLoteOut]:
    """Lista todos os lotes de exames emitidos no sistema."""
    stmt = select(LabLoteLiberacao).order_by(LabLoteLiberacao.created_at.desc(), LabLoteLiberacao.id.desc())
    if competencia:
        stmt = stmt.where(LabLoteLiberacao.competencia == competencia.strip())
    if laboratorio_id:
        stmt = stmt.where(LabLoteLiberacao.laboratorio_id == laboratorio_id)

    lotes = db.exec(stmt).all()
    resultado: list[LabLoteOut] = []
    for l in lotes:
        datas_dist = []
        try:
            datas_dist = json.loads(l.datas_alocacao_json or "[]")
        except Exception:
            datas_dist = []
        resultado.append(
            LabLoteOut(
                id=l.id or 0,
                codigo_lote=l.codigo_lote,
                orcamento_id=l.orcamento_id,
                competencia=l.competencia,
                laboratorio_id=l.laboratorio_id,
                laboratorio_nome=l.laboratorio_nome,
                valor_solicitado=float(l.valor_solicitado),
                valor_consumido=float(l.valor_consumido),
                qtd_pacientes=l.qtd_pacientes,
                qtd_exames=l.qtd_exames,
                datas_alocacao=datas_dist,
                status=l.status,
                observacoes=l.observacoes or "",
                arquivo_comprovantes_nome=l.arquivo_comprovantes_nome or "",
                arquivo_excel_nome=l.arquivo_excel_nome or "",
                tem_comprovantes=bool(l.arquivo_comprovantes_nome),
                tem_excel=bool(l.arquivo_excel_nome),
                criado_por=l.criado_por or "",
                created_at=l.created_at,
            )
        )
    return resultado


def obter_lote_detalhe(db: Session, lote_id: int) -> LabLoteOut:
    """Retorna dados detalhados do lote incluindo os itens e pacientes contemplados."""
    lote = db.get(LabLoteLiberacao, lote_id)
    if not lote:
        raise HTTPException(404, "Lote não encontrado.")

    itens_db = db.exec(
        select(LabLoteItem).where(LabLoteItem.lote_id == lote_id).order_by(LabLoteItem.ordem_selecao.asc())
    ).all()
    itens_out: list[LabLoteItemOut] = []

    for it in itens_db:
        exames_list = []
        try:
            exames_list = json.loads(it.exames_snapshot_json or "[]")
        except Exception:
            exames_list = []
        itens_out.append(
            LabLoteItemOut(
                id=it.id or 0,
                lote_id=it.lote_id,
                fila_psf_id=it.fila_psf_id,
                solicitacao_mestre_id=it.solicitacao_mestre_id,
                paciente_id=it.paciente_id,
                paciente_nome=it.paciente_nome,
                paciente_cpf=it.paciente_cpf,
                paciente_prontuario=it.paciente_prontuario,
                data_agendada=it.data_agendada,
                ordem_selecao=it.ordem_selecao,
                prioridade_fila=it.prioridade_fila,
                valor_consumido=float(it.valor_consumido),
                exames=exames_list,
            )
        )

    datas_dist = []
    try:
        datas_dist = json.loads(lote.datas_alocacao_json or "[]")
    except Exception:
        datas_dist = []

    return LabLoteOut(
        id=lote.id or 0,
        codigo_lote=lote.codigo_lote,
        orcamento_id=lote.orcamento_id,
        competencia=lote.competencia,
        laboratorio_id=lote.laboratorio_id,
        laboratorio_nome=lote.laboratorio_nome,
        valor_solicitado=float(lote.valor_solicitado),
        valor_consumido=float(lote.valor_consumido),
        qtd_pacientes=lote.qtd_pacientes,
        qtd_exames=lote.qtd_exames,
        datas_alocacao=datas_dist,
        status=lote.status,
        observacoes=lote.observacoes or "",
        arquivo_comprovantes_nome=lote.arquivo_comprovantes_nome or "",
        arquivo_excel_nome=lote.arquivo_excel_nome or "",
        tem_comprovantes=bool(lote.arquivo_comprovantes_nome),
        tem_excel=bool(lote.arquivo_excel_nome),
        criado_por=lote.criado_por or "",
        created_at=lote.created_at,
        itens=itens_out,
    )


def obter_artefato_lote(db: Session, lote_id: int, tipo: str) -> tuple[bytes, str, str]:
    """Retorna o binário, nome e mime_type do artefato solicitado."""
    art = db.exec(
        select(LabLoteArtefato).where(
            LabLoteArtefato.lote_id == lote_id,
            LabLoteArtefato.tipo == tipo,
        )
    ).first()
    if not art:
        raise HTTPException(404, f"Artefato do tipo '{tipo}' não encontrado para este lote.")
    return art.conteudo, art.nome_arquivo, art.mime_type
