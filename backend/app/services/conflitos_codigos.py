"""Diagnóstico e resolução segura/idempotente de conflitos e códigos legados longos de solicitações."""

from sqlalchemy import text
from sqlmodel import Session, select

from app.models.lab_fase6 import FilaPsf, SolicitacaoMestre
from app.models.tfd import ExameFila
from app.services.geradores import gerar_exame_curto_aleatorio, gerar_protocolo_lab_aleatorio


def _carregar_codigos_em_uso(db: Session) -> set[str]:
    usados: set[str] = set()
    for col_stmt in (
        select(ExameFila.codigo_curto).where(ExameFila.codigo_curto != ""),
        select(ExameFila.numero_pedido).where(ExameFila.numero_pedido != ""),
        select(FilaPsf.codigo_solicitacao).where(FilaPsf.codigo_solicitacao != ""),
        select(SolicitacaoMestre.codigo_solicitacao).where(SolicitacaoMestre.codigo_solicitacao != ""),
    ):
        for c in db.exec(col_stmt).all():
            if c:
                usados.add(str(c).strip().upper())
    return usados


def _codigo_lab_longo_ou_vazio(cod: str) -> bool:
    s = (cod or "").strip().upper()
    if not s:
        return True
    if s.startswith("LAB-"):
        return True
    return len(s) > 10


def analisar_e_resolver_codigos(db: Session, aplicar: bool = False) -> dict:
    """Analisa duplicidades, colisões entre filas e códigos longos de exames de sangue.

    Quando `aplicar=True`, gera novos códigos compactos (`SL-XXXXXX`) de forma atômica,
    mantendo sincronizados `FilaPsf.codigo_solicitacao` e `SolicitacaoMestre.codigo_solicitacao`
    vinculados via `origem_fila_id`.
    """
    if aplicar:
        try:
            bind = db.get_bind()
            if bind and bind.dialect.name == "postgresql":
                db.execute(text("SELECT pg_advisory_xact_lock(9284017)"))
        except Exception:
            pass

    usados = _carregar_codigos_em_uso(db)
    exames = list(db.exec(select(ExameFila).order_by(ExameFila.id)).all())
    filas_psf = list(db.exec(select(FilaPsf).order_by(FilaPsf.id)).all())
    mestres = list(db.exec(select(SolicitacaoMestre).order_by(SolicitacaoMestre.id)).all())

    fila_by_id = {f.id: f for f in filas_psf if f.id is not None}
    mestre_by_fila: dict[int, list[SolicitacaoMestre]] = {}
    for m in mestres:
        if m.origem_fila_id:
            mestre_by_fila.setdefault(m.origem_fila_id, []).append(m)

    duplicados_tfd = 0
    vazios_tfd = 0
    duplicados_lab = 0
    longos_lab = 0
    colisoes_cruzadas = 0
    atualizados_tfd = 0
    atualizados_lab = 0
    exemplos: list[dict] = []

    def registrar_exemplo(tabela: str, registro_id: int, motivo: str, antigo: str, novo: str = "") -> None:
        if len(exemplos) < 25:
            exemplos.append({
                "tabela": tabela,
                "id": registro_id,
                "motivo": motivo,
                "codigo_antigo": antigo or "(vazio)",
                "codigo_novo": novo,
            })

    # 1. Verifica TFD (ExameFila.codigo_curto único por solicitação)
    vistos_tfd_curto: set[str] = set()
    for ex in exames:
        cod = (ex.codigo_curto or "").strip().upper()
        if not cod:
            vazios_tfd += 1
            novo = gerar_exame_curto_aleatorio(db=None, usados=usados)
            registrar_exemplo("tfd_exames_fila", ex.id or 0, "sem_codigo", cod, novo)
            if aplicar:
                ex.codigo_curto = novo
                if not (ex.numero_pedido or "").strip():
                    ex.numero_pedido = novo
                db.add(ex)
                atualizados_tfd += 1
            else:
                vistos_tfd_curto.add(novo)
            continue

        if cod in vistos_tfd_curto:
            duplicados_tfd += 1
            novo = gerar_exame_curto_aleatorio(db=None, usados=usados)
            registrar_exemplo("tfd_exames_fila", ex.id or 0, "duplicado_tfd", cod, novo)
            if aplicar:
                ex.codigo_curto = novo
                db.add(ex)
                atualizados_tfd += 1
        else:
            vistos_tfd_curto.add(cod)

    # Conjunto oficial de códigos TFD para detectar colisões cruzadas com Lab
    codigos_tfd_ativos = set(vistos_tfd_curto)
    for ex in exames:
        if (ex.numero_pedido or "").strip():
            codigos_tfd_ativos.add(ex.numero_pedido.strip().upper())

    # 2. Verifica FilaPsf e SolicitacaoMestre vinculados (sincronizando ambos)
    vistos_lab: set[str] = set()
    mestres_processados: set[int] = set()

    for f in filas_psf:
        cod = (f.codigo_solicitacao or "").strip().upper()
        vinculados = [m for m in mestre_by_fila.get(f.id or -1, []) if m.status != "cancelado"]
        if not vinculados and f.id in mestre_by_fila:
            vinculados = mestre_by_fila[f.id]

        motivo = ""
        if not cod or _codigo_lab_longo_ou_vazio(cod):
            longos_lab += 1
            motivo = "codigo_lab_longo_ou_vazio"
        elif cod in codigos_tfd_ativos:
            colisoes_cruzadas += 1
            motivo = "colisao_com_solicitacao_tfd"
        elif cod in vistos_lab:
            duplicados_lab += 1
            motivo = "duplicado_lab"

        if motivo:
            novo = gerar_protocolo_lab_aleatorio(db=None, usados=usados)
            vistos_lab.add(novo)
            registrar_exemplo("lab_fila_psf", f.id or 0, motivo, cod, novo)
            if aplicar:
                f.codigo_solicitacao = novo
                db.add(f)
                atualizados_lab += 1
                for m in vinculados:
                    m.codigo_solicitacao = novo
                    db.add(m)
                    if m.id is not None:
                        mestres_processados.add(m.id)
                    atualizados_lab += 1
            else:
                for m in vinculados:
                    if m.id is not None:
                        mestres_processados.add(m.id)
        else:
            vistos_lab.add(cod)
            for m in vinculados:
                if m.id is not None:
                    mestres_processados.add(m.id)
                m_cod = (m.codigo_solicitacao or "").strip().upper()
                if m_cod != cod:
                    duplicados_lab += 1
                    registrar_exemplo("lab_solic_mestre", m.id or 0, "dessincronizado_fila_psf", m_cod, cod)
                    if aplicar:
                        m.codigo_solicitacao = cod
                        db.add(m)
                        atualizados_lab += 1

    # 3. Verifica SolicitacaoMestre avulsos (marcação direta sem FilaPsf)
    for m in mestres:
        if m.id is not None and m.id in mestres_processados:
            continue
        cod = (m.codigo_solicitacao or "").strip().upper()
        # Se tem origem_fila_id que já tem outro código válido, sincroniza
        if m.origem_fila_id and m.origem_fila_id in fila_by_id:
            f_orig = fila_by_id[m.origem_fila_id]
            cod_orig = (f_orig.codigo_solicitacao or "").strip().upper()
            if cod_orig and cod != cod_orig:
                duplicados_lab += 1
                registrar_exemplo("lab_solic_mestre", m.id or 0, "dessincronizado_fila_psf", cod, cod_orig)
                if aplicar:
                    m.codigo_solicitacao = cod_orig
                    db.add(m)
                    atualizados_lab += 1
                continue

        motivo = ""
        if not cod or _codigo_lab_longo_ou_vazio(cod):
            longos_lab += 1
            motivo = "codigo_lab_longo_ou_vazio"
        elif cod in codigos_tfd_ativos:
            colisoes_cruzadas += 1
            motivo = "colisao_com_solicitacao_tfd"
        elif cod in vistos_lab:
            duplicados_lab += 1
            motivo = "duplicado_lab"

        if motivo:
            novo = gerar_protocolo_lab_aleatorio(db=None, usados=usados)
            vistos_lab.add(novo)
            registrar_exemplo("lab_solic_mestre", m.id or 0, motivo, cod, novo)
            if aplicar:
                m.codigo_solicitacao = novo
                db.add(m)
                atualizados_lab += 1
        else:
            vistos_lab.add(cod)

    if aplicar and (atualizados_tfd > 0 or atualizados_lab > 0):
        db.commit()

    total_pendencias = duplicados_tfd + vazios_tfd + duplicados_lab + longos_lab + colisoes_cruzadas
    return {
        "aplicado": aplicar,
        "total_pendencias": total_pendencias,
        "duplicados_tfd": duplicados_tfd,
        "vazios_tfd": vazios_tfd,
        "duplicados_lab": duplicados_lab,
        "longos_lab": longos_lab,
        "colisoes_cruzadas": colisoes_cruzadas,
        "atualizados_tfd": atualizados_tfd,
        "atualizados_lab": atualizados_lab,
        "total_atualizados": atualizados_tfd + atualizados_lab,
        "exemplos": exemplos,
    }
