import logging
logger = logging.getLogger(__name__)

import re
import threading
import time
import unicodedata
from datetime import date, datetime
import json as _json
from typing import Optional

from sqlalchemy import text
from sqlmodel import Session, select

from app.models.audit import AuditLog
from app.models.cadastros_saude import UnidadeSaude
from app.models.integracoes import IntegrationSettings, PecSyncLog
from app.models.settings import SystemSettings
from app.models.tfd import ExameFila, Paciente, PacienteHistorico, ViagemFila
from app.services.geradores import gerar_prontuario_aleatorio
from app.services.pec_tunnel import garantir_tunel_db

ADVISORY_LOCK_SYNC = 847291992
_SYNC_LOCK = threading.Lock()
_SYNC_RUNNING = False


def is_sync_running() -> bool:
    return _SYNC_RUNNING


def limpar_cpf(cpf: Optional[str]) -> str:
    if not cpf:
        return ""
    digits = re.sub(r"\D", "", str(cpf))
    if len(digits) != 11:
        return ""
    # Rejeita CPFs com todos os dígitos iguais
    if digits == digits[0] * 11:
        return ""
    return digits


def limpar_cns(cns: Optional[str]) -> str:
    if not cns:
        return ""
    digits = re.sub(r"\D", "", str(cns))
    if len(digits) != 15:
        return ""
    if digits == digits[0] * 15:
        return ""
    return digits


def normalizar_nome(texto: Optional[str]) -> str:
    if not texto:
        return ""
    n = unicodedata.normalize("NFKD", str(texto)).encode("ASCII", "ignore").decode("ASCII")
    return re.sub(r"\s+", " ", n).strip().upper()


def comparar_nomes_mae(mae1: Optional[str], mae2: Optional[str]) -> bool:
    """Verifica compatibilidade entre nomes de mãe.
    Se um deles estiver em branco, é compatível.
    Se ambos estiverem preenchidos, verifica se o primeiro nome bate ou se há correspondência.
    """
    n1 = normalizar_nome(mae1)
    n2 = normalizar_nome(mae2)
    if not n1 or not n2:
        return True
    if n1 == n2:
        return True
    p1 = n1.split()[0]
    p2 = n2.split()[0]
    return p1 == p2


def calcular_completude_endereco(logr: str, num: str, comp: str, bairro: str, cep: str) -> int:
    """Calcula score de completude e qualidade do endereço para priorização contra duplicatas."""
    score = 0
    l_clean = (logr or "").strip().upper()
    if l_clean and len(l_clean) > 3 and not any(x in l_clean for x in ("SEM NOME", "NAO INFORMADO", "NÃO INFORMADO", "IGNORADO", "SN", "S/N")):
        score += 4
    n_clean = (num or "").strip().upper()
    if n_clean and n_clean not in ("S/N", "SN", "0", "SEM NUMERO", "SEM NÚMERO", "NAO INFORMADO", "NÃO INFORMADO"):
        score += 3
    b_clean = (bairro or "").strip().upper()
    if b_clean and len(b_clean) > 2 and not any(x in b_clean for x in ("NAO INFORMADO", "NÃO INFORMADO", "IGNORADO")):
        score += 2
    c_clean = "".join(c for c in (cep or "") if c.isdigit())
    if len(c_clean) == 8:
        score += 2
    if comp and comp.strip():
        score += 1
    return score


def _eh_verdadeiro(val) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return int(val) == 1
    s = normalizar_nome(str(val or ""))
    return s in ("1", "TRUE", "T", "S", "SIM", "YES")


def _parse_data_opcional(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    s = str(val).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            continue
    return None


def classificar_situacao_pec(row_map: dict, municipio_sede: str = "Guapé") -> tuple[str, str, date | None]:
    """Identifica se o registro do e-SUS PEC indica Óbito ou Mudança de Município.

    Retorna `(situacao, detalhe, data_obito)` onde `situacao` é `'obito'`,
    `'mudanca_municipio'` ou `'ativo'`.
    """
    st_faleceu = any(
        _eh_verdadeiro(row_map.get(k))
        for k in ("st_faleceu_pec", "st_faleceu", "faleceu", "c_st_faleceu", "f_st_faleceu")
    )
    dt_obito = None
    for k in ("dt_obito_pec", "dt_obito"):
        dt_obito = _parse_data_opcional(row_map.get(k))
        if dt_obito:
            break

    ds_saida = normalizar_nome(
        row_map.get("ds_tipo_saida_pec") or row_map.get("ds_tipo_saida") or ""
    )
    co_saida = row_map.get("co_tipo_saida_pec") or row_map.get("co_dim_tipo_saida_cadastro")
    try:
        co_saida_int = int(co_saida) if co_saida is not None and str(co_saida).strip().isdigit() else None
    except Exception:
        co_saida_int = None

    if st_faleceu or dt_obito is not None or "OBITO" in ds_saida or co_saida_int == 1:
        dt_str = f" em {dt_obito.strftime('%d/%m/%Y')}" if dt_obito else ""
        return "obito", f"Óbito identificado no e-SUS PEC{dt_str}.", dt_obito

    st_mudanca = any(
        _eh_verdadeiro(row_map.get(k))
        for k in ("st_mudanca_pec", "st_mudanca_territorio", "st_mudanca_municipio", "st_mudanca")
    )
    muni_raw = str(
        row_map.get("no_municipio_raw")
        or row_map.get("no_municipio_domicilio")
        or row_map.get("no_municipio_tb_cidadao")
        or row_map.get("no_municipio")
        or ""
    ).strip()
    muni_norm = normalizar_nome(muni_raw)
    sede_norm = normalizar_nome(municipio_sede or "Guapé") or "GUAPE"

    mudanca_por_saida = (
        st_mudanca
        or "MUDANCA" in ds_saida
        or "OUTRO MUNICIPIO" in ds_saida
        or co_saida_int == 2
    )
    mudanca_por_cidade = (
        bool(muni_norm)
        and len(muni_norm) >= 3
        and muni_norm not in ("NAO INFORMADO", "IGNORADO", "SEM INFORMACAO")
        and sede_norm not in muni_norm
    )

    if mudanca_por_saida or mudanca_por_cidade:
        detalhe = (
            f"Mudança de Município identificada no e-SUS PEC ({muni_raw})."
            if mudanca_por_cidade
            else "Mudança de Município / Território registrada no e-SUS PEC."
        )
        return "mudanca_municipio", detalhe, None

    return "ativo", "", None


def aplicar_baixa_automatica_paciente(
    db: Session,
    paciente: Paciente,
    situacao: str,
    detalhe: str,
    data_obito: date | None = None,
    origem: str = "e-SUS PEC",
    agora: datetime | None = None,
) -> int:
    """Remove automaticamente o paciente da fila de espera ativa e registra histórico no prontuário."""
    if situacao not in ("obito", "mudanca_municipio") or not paciente.id:
        return 0

    agora = agora or datetime.utcnow()
    rotulo = "Óbito" if situacao == "obito" else "Mudança de Município"
    situacao_anterior = (getattr(paciente, "situacao_cadastral", None) or "ativo").strip().lower()

    paciente.situacao_cadastral = situacao
    paciente.motivo_situacao = (detalhe or rotulo)[:255]
    paciente.situacao_atualizada_em = agora
    if situacao == "obito" and data_obito is not None:
        paciente.data_obito = data_obito

    motivo_fila = f"Baixa automática ({rotulo}) via {origem}: {detalhe}".strip()[:500]
    itens_ativos = list(
        db.exec(
            select(ExameFila).where(
                ExameFila.paciente_id == paciente.id,
                ExameFila.ativo == True,  # noqa: E712
                ExameFila.status.in_(["aguardando", "agendado"]),
            )
        ).all()
    )

    ids_baixados: list[int] = []
    for ex in itens_ativos:
        ex.status_anterior = ex.status or ""
        ex.status = "cancelado"
        ex.ativo = False
        ex.motivo_remocao = motivo_fila
        ex.removido_em = agora
        ex.removido_por = f"Sincronização {origem}"[:120]
        db.add(ex)
        if ex.id:
            ids_baixados.append(ex.id)
        db.add(
            AuditLog(
                user_id=None,
                user_name=f"Sincronização {origem}"[:120],
                action="EXAM_REMOVE_AUTO",
                entity="EXAM",
                entity_id=ex.id,
                details=_json.dumps(
                    {
                        "situacao": situacao,
                        "motivo": motivo_fila,
                        "paciente_id": paciente.id,
                    },
                    ensure_ascii=False,
                ),
            )
        )

    viagens_ativas = list(
        db.exec(
            select(ViagemFila).where(
                ViagemFila.paciente_id == paciente.id,
                ViagemFila.status.in_(["aguardando", "alocado"]),
            )
        ).all()
    )
    for vf in viagens_ativas:
        vf.status = "cancelado"
        obs_atual = (vf.observacoes or "").strip()
        if motivo_fila not in obs_atual:
            vf.observacoes = f"{obs_atual} | {motivo_fila}"[:500] if obs_atual else motivo_fila
        db.add(vf)

    mudou_situacao = situacao_anterior != situacao
    if ids_baixados or mudou_situacao:
        tipo_ev = "OBITO_PEC" if situacao == "obito" else "MUDANCA_MUNICIPIO_PEC"
        resumo_hist = (
            f"{detalhe} {len(ids_baixados)} solicitação(ões) removida(s) automaticamente da fila ativa."
            if ids_baixados
            else f"{detalhe} Nenhuma solicitação ativa pendente na fila."
        )[:500]
        db.add(
            PacienteHistorico(
                paciente_id=paciente.id,
                tipo_evento=tipo_ev,
                motivo=rotulo,
                descricao=resumo_hist,
                origem=origem[:50],
                exames_baixados_qtd=len(ids_baixados),
                exames_baixados_ids=",".join(str(x) for x in ids_baixados)[:500],
                registrado_por=f"Sincronização {origem}"[:120],
                registrado_em=agora,
            )
        )
        carimbo_obs = f"[{agora.strftime('%d/%m/%Y')}] {rotulo} ({origem}): {detalhe}"
        obs_pac = (paciente.observacoes or "").strip()
        if carimbo_obs not in obs_pac:
            paciente.observacoes = f"{obs_pac}\n{carimbo_obs}"[-500:] if obs_pac else carimbo_obs[:500]

    db.add(paciente)
    return len(ids_baixados)


def _inspecionar_colunas_pec(pec_conn) -> dict[str, set[str]]:
    """Descobre colunas existentes nas tabelas do e-SUS PEC para compatibilidade entre versões."""
    mapa: dict[str, set[str]] = {}
    try:
        rows = pec_conn.execute(
            text(
                """
                SELECT table_name, column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name IN (
                      'tb_cidadao',
                      'tb_acomp_cidadaos_vinculados',
                      'tb_fat_cidadao_pec',
                      'tb_dim_tipo_saida_cadastro'
                  )
                """
            )
        ).all()
        for tname, cname in rows:
            mapa.setdefault(str(tname), set()).add(str(cname))
    except Exception:
        pass
    return mapa


def sincronizar_pacientes_pec(db: Session, origem: str = "manual") -> PecSyncLog:
    """Executa a rotina completa de importação e upsert com desduplicação
    dos cidadãos e prontuários do e-SUS PEC para a base de dados local (`tfd_pacientes`).
    Garante que nenhum paciente seja duplicado, mesmo quando o e-SUS tiver múltiplos
    registros da mesma pessoa (ex: um com CNS e outro com CPF).
    Utiliza Advisory Lock no PostgreSQL para evitar concorrência entre múltiplos workers.
    """
    global _SYNC_RUNNING

    # 1. Trava em memória no processo atual
    if not _SYNC_LOCK.acquire(blocking=False):
        log_ativo = db.exec(
            select(PecSyncLog).where(PecSyncLog.status == "EM_EXECUCAO").order_by(PecSyncLog.iniciado_em.desc())
        ).first()
        return log_ativo or PecSyncLog(
            status="EM_EXECUCAO",
            mensagem="Sincronização já está em execução em segundo plano neste processo.",
            origem=origem,
        )

    # 2. Trava distribuída no PostgreSQL (evita conflito entre múltiplos workers Gunicorn)
    is_pg_locked = False
    try:
        res = db.execute(text(f"SELECT pg_try_advisory_lock({ADVISORY_LOCK_SYNC})")).scalar()
        if res is False:
            _SYNC_LOCK.release()
            log_ativo = db.exec(
                select(PecSyncLog).where(PecSyncLog.status == "EM_EXECUCAO").order_by(PecSyncLog.iniciado_em.desc())
            ).first()
            return log_ativo or PecSyncLog(
                status="EM_EXECUCAO",
                mensagem="Sincronização já em execução em outro processo do servidor.",
                origem=origem,
            )
        if res is True:
            is_pg_locked = True
    except Exception:
        # SQLite em ambiente de teste não possui pg_try_advisory_lock
        pass

    _SYNC_RUNNING = True
    t0 = time.time()

    # Cria registro inicial de log
    log = PecSyncLog(
        iniciado_em=datetime.utcnow(),
        status="EM_EXECUCAO",
        origem=origem,
        mensagem="Iniciando sincronização com e-SUS PEC...",
    )
    db.add(log)
    try:
        cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
        if cfg:
            cfg.pec_sync_ultimo_status = "EM_EXECUCAO"
            db.add(cfg)
        db.commit()
        db.refresh(log)
    except Exception:
        db.rollback()

    try:
        # 3. Garante conexão com o banco do e-SUS PEC
        cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
        conectado, dsn = garantir_tunel_db(cfg)
        if not conectado or not dsn:
            raise RuntimeError(
                "Não foi possível conectar ao e-SUS PEC. Verifique se o Túnel SSH ou os parâmetros do PostgreSQL estão configurados."
            )

        # 4. Carrega e indexa todas as Unidades de Saúde locais por CNES
        unidades_locais = db.exec(select(UnidadeSaude)).all()
        unidades_map: dict[str, int] = {}
        for u in unidades_locais:
            if u.cnes and u.id:
                unidades_map[u.cnes.strip()] = u.id

        def obter_ou_criar_unidade(cnes: str, nome_unidade: str) -> Optional[int]:
            cnes = (cnes or "").strip()
            if not cnes:
                return None
            if cnes in unidades_map:
                return unidades_map[cnes]
            nome_limpo = (nome_unidade or f"UBS {cnes}").strip()
            nova_u = UnidadeSaude(
                nome=nome_limpo[:150],
                cnes=cnes[:20],
                tipo="UBS",
                ativo=True,
            )
            db.add(nova_u)
            db.flush()
            unidades_map[cnes] = nova_u.id
            return nova_u.id

        # 5. Carrega e indexa os pacientes locais existentes para desduplicação rápida em memória
        pacientes_locais = db.exec(select(Paciente)).all()
        pacientes_cache: dict[int, Paciente] = {}
        cpf_map: dict[str, int] = {}
        cns_map: dict[str, int] = {}
        nome_nasc_map: dict[tuple[str, str], list[int]] = {}
        pec_id_map: dict[int, int] = {}

        for p in pacientes_locais:
            if not p.id:
                continue
            pacientes_cache[p.id] = p
            cpf_p = limpar_cpf(p.cpf)
            if cpf_p:
                cpf_map[cpf_p] = p.id
            cns_p = limpar_cns(p.cns)
            if cns_p:
                cns_map[cns_p] = p.id
            if p.nome and p.nascimento:
                chave_nn = (normalizar_nome(p.nome), str(p.nascimento))
                nome_nasc_map.setdefault(chave_nn, []).append(p.id)
            if p.co_seq_cidadao_pec:
                pec_id_map[p.co_seq_cidadao_pec] = p.id

        # 6. Conecta no PostgreSQL do e-SUS PEC e busca os cidadãos com dados cadastrais e territoriais
        from sqlalchemy import create_engine
        pec_engine = create_engine(dsn, pool_pre_ping=True, connect_args={"connect_timeout": 8})

        sys_cfg = db.exec(select(SystemSettings).where(SystemSettings.id == 1)).first()
        municipio_sede = (getattr(sys_cfg, "cidade", None) or "Guapé").strip() or "Guapé"

        total_lidos = 0
        total_inseridos = 0
        total_atualizados = 0
        total_duplicados_mesclados = 0
        total_baixas_fila = 0
        total_erros = 0
        pacientes_processados_nesta_execucao: set[int] = set()

        with pec_engine.connect() as pec_conn:
            cols_pec = _inspecionar_colunas_pec(pec_conn)
            c_cols = cols_pec.get("tb_cidadao", set())
            v_cols = cols_pec.get("tb_acomp_cidadaos_vinculados", set())
            f_cols = cols_pec.get("tb_fat_cidadao_pec", set())
            ts_cols = cols_pec.get("tb_dim_tipo_saida_cadastro", set())

            faleceu_exprs = []
            if "st_faleceu" in c_cols:
                faleceu_exprs.append("c.st_faleceu::text")
            if "st_faleceu" in f_cols:
                faleceu_exprs.append("f.st_faleceu::text")
            if "st_vivo" in c_cols:
                faleceu_exprs.append("CASE WHEN c.st_vivo IN (0, false) THEN '1' ELSE '0' END")
            sel_faleceu = f"COALESCE({', '.join(faleceu_exprs)}, '') AS st_faleceu_pec" if faleceu_exprs else "'' AS st_faleceu_pec"

            sel_dt_obito = "c.dt_obito AS dt_obito_pec" if "dt_obito" in c_cols else "NULL::date AS dt_obito_pec"

            mudanca_exprs = []
            if "st_mudanca_territorio" in v_cols:
                mudanca_exprs.append("v.st_mudanca_territorio::text")
            if "st_mudanca" in c_cols:
                mudanca_exprs.append("c.st_mudanca::text")
            if "st_mudou_se" in f_cols:
                mudanca_exprs.append("f.st_mudou_se::text")
            sel_mudanca = f"COALESCE({', '.join(mudanca_exprs)}, '') AS st_mudanca_pec" if mudanca_exprs else "'' AS st_mudanca_pec"

            if "co_dim_tipo_saida_cadastro" in f_cols:
                sel_co_saida = "f.co_dim_tipo_saida_cadastro AS co_tipo_saida_pec"
                if ts_cols and "ds_tipo_saida" in ts_cols:
                    join_saida = "LEFT JOIN tb_dim_tipo_saida_cadastro ts ON ts.co_seq_dim_tipo_saida_cadastro = f.co_dim_tipo_saida_cadastro"
                    sel_ds_saida = "COALESCE(ts.ds_tipo_saida, '') AS ds_tipo_saida_pec"
                else:
                    join_saida = ""
                    sel_ds_saida = "'' AS ds_tipo_saida_pec"
            else:
                sel_co_saida = "NULL::integer AS co_tipo_saida_pec"
                join_saida = ""
                sel_ds_saida = "'' AS ds_tipo_saida_pec"

            muni_exprs = [
                "NULLIF(TRIM(v.no_municipio_domicilio), '')",
                "NULLIF(TRIM(v.no_municipio_tb_cidadao), '')",
            ]
            if "no_municipio" in c_cols:
                muni_exprs.append("NULLIF(TRIM(c.no_municipio), '')")
            sel_muni_raw = f"COALESCE({', '.join(muni_exprs)}, '') AS no_municipio_raw"

            query_pec = text(f"""
                SELECT
                    c.co_seq_cidadao,
                    c.no_cidadao,
                    c.no_social,
                    c.nu_cpf,
                    c.nu_cns,
                    c.dt_nascimento,
                    c.no_sexo,
                    c.no_mae,
                    c.nu_telefone_celular,
                    c.nu_telefone_contato,
                    c.nu_telefone_residencial,
                    COALESCE(NULLIF(TRIM(v.ds_logradouro_domicilio), ''), NULLIF(TRIM(v.ds_logradouro_tb_cidadao), ''), c.ds_logradouro) AS ds_logradouro,
                    COALESCE(NULLIF(TRIM(v.nu_numero_domicilio), ''), NULLIF(TRIM(v.nu_numero_tb_cidadao), ''), c.nu_numero) AS nu_numero,
                    COALESCE(NULLIF(TRIM(v.ds_complemento_domicilio), ''), NULLIF(TRIM(v.ds_complemento_tb_cidadao), ''), c.ds_complemento) AS ds_complemento,
                    COALESCE(NULLIF(TRIM(v.no_bairro_domicilio), ''), NULLIF(TRIM(v.no_bairro_tb_cidadao), ''), c.no_bairro) AS no_bairro,
                    COALESCE(NULLIF(TRIM(v.ds_cep_domicilio), ''), NULLIF(TRIM(v.ds_cep_tb_cidadao), ''), c.ds_cep) AS ds_cep,
                    c.ds_ponto_referencia,
                    COALESCE(NULLIF(TRIM(v.nu_micro_area_domicilio), ''), NULLIF(TRIM(v.nu_micro_area_tb_cidadao), ''), c.nu_micro_area) AS nu_micro_area,
                    COALESCE(NULLIF(TRIM(v.no_municipio_domicilio), ''), NULLIF(TRIM(v.no_municipio_tb_cidadao), ''), '') AS no_municipio,
                    {sel_muni_raw},
                    {sel_faleceu},
                    {sel_dt_obito},
                    {sel_mudanca},
                    {sel_co_saida},
                    {sel_ds_saida},
                    c.dt_atualizado,
                    c.st_ativo,
                    COALESCE(NULLIF(TRIM(v.nu_cnes_vinc_equipe), ''), u.nu_cnes) AS nu_cnes,
                    u.no_unidade_saude,
                    COALESCE(NULLIF(TRIM(v.nu_ine_vinc_equipe), ''), e.nu_ine) AS nu_ine,
                    COALESCE(NULLIF(TRIM(v.no_equipe_vinc_equipe), ''), e.no_equipe) AS no_equipe
                FROM tb_cidadao c
                LEFT JOIN tb_acomp_cidadaos_vinculados v ON v.co_cidadao = c.co_seq_cidadao
                LEFT JOIN tb_fat_cidadao_pec f ON f.co_cidadao = c.co_seq_cidadao
                {join_saida}
                LEFT JOIN tb_dim_unidade_saude u ON u.co_seq_dim_unidade_saude = f.co_dim_unidade_saude_vinc
                LEFT JOIN tb_dim_equipe e ON e.co_seq_dim_equipe = f.co_dim_equipe_vinc
                ORDER BY c.dt_atualizado DESC NULLS LAST, c.co_seq_cidadao DESC;
            """)

            result = pec_conn.execute(query_pec)
            batch_count = 0

            for row_map in result.mappings():
                total_lidos += 1
                try:
                    with db.begin_nested():
                        pec_id = int(row_map["co_seq_cidadao"])
                        nome_raw = row_map["no_cidadao"]
                        if not nome_raw or not str(nome_raw).strip():
                            continue

                        nome = str(nome_raw).strip()[:150]
                        nome_norm = normalizar_nome(nome)
                        cpf = limpar_cpf(row_map["nu_cpf"])
                        cns = limpar_cns(row_map["nu_cns"])
                        dt_nasc = row_map["dt_nascimento"]
                        dt_nasc_str = str(dt_nasc) if dt_nasc else ""
                        nome_mae_raw = row_map["no_mae"]

                        # Estratégia de Desduplicação em 4 níveis
                        paciente_id: Optional[int] = None
                        duplicata_encontrada = False

                        # 1º Nível: CPF
                        if cpf and cpf in cpf_map:
                            paciente_id = cpf_map[cpf]
                            duplicata_encontrada = True

                        # 2º Nível: CNS
                        if not paciente_id and cns and cns in cns_map:
                            paciente_id = cns_map[cns]
                            duplicata_encontrada = True

                        # 3º Nível: Nome Completo + Data de Nascimento + Compatibilidade de Nome da Mãe
                        if not paciente_id and nome_norm and dt_nasc_str and (nome_norm, dt_nasc_str) in nome_nasc_map:
                            candidatos = nome_nasc_map[(nome_norm, dt_nasc_str)]
                            for cand_id in candidatos:
                                cand_p = pacientes_cache.get(cand_id)
                                if cand_p and comparar_nomes_mae(cand_p.nome_mae, nome_mae_raw):
                                    paciente_id = cand_id
                                    duplicata_encontrada = True
                                    break

                        # 4º Nível: Vínculo pelo próprio ID do PEC
                        if not paciente_id and pec_id in pec_id_map:
                            paciente_id = pec_id_map[pec_id]

                        # Resolve Telefone
                        tel = (
                            row_map.get("nu_telefone_celular")
                            or row_map.get("nu_telefone_contato")
                            or row_map.get("nu_telefone_residencial")
                            or ""
                        )
                        tel_limpo = str(tel).strip()[:50]

                        # Resolve Unidade e Equipe
                        cnes_raw = str(row_map.get("nu_cnes") or "").strip()
                        unidade_nome_raw = str(row_map.get("no_unidade_saude") or "").strip()
                        uid = obter_ou_criar_unidade(cnes_raw, unidade_nome_raw) if cnes_raw else None

                        agora = datetime.utcnow()

                        if paciente_id:
                            # Registro existente -> Consolidação / Mesclagem
                            p = pacientes_cache.get(paciente_id)
                            if p:
                                if paciente_id in pacientes_processados_nesta_execucao:
                                    total_duplicados_mesclados += 1
                                elif duplicata_encontrada and p.co_seq_cidadao_pec and p.co_seq_cidadao_pec != pec_id:
                                    total_duplicados_mesclados += 1
                                else:
                                    total_atualizados += 1

                                # Completa campos em falta
                                if not p.cpf and cpf:
                                    p.cpf = cpf
                                    cpf_map[cpf] = p.id
                                if not p.cns and cns:
                                    p.cns = cns
                                    cns_map[cns] = p.id
                                if not p.nome_social and row_map.get("no_social"):
                                    p.nome_social = str(row_map.get("no_social")).strip()[:150]
                                if not p.nome_mae and row_map.get("no_mae"):
                                    p.nome_mae = str(row_map.get("no_mae")).strip()[:150]
                                if not p.sexo and row_map.get("no_sexo"):
                                    p.sexo = str(row_map.get("no_sexo")).strip()[:20]
                                if not p.nascimento and dt_nasc:
                                    p.nascimento = dt_nasc
                                if not p.telefone and tel_limpo:
                                    p.telefone = tel_limpo

                                # Atualiza endereço priorizando o registro mais completo e atualizado (Item 5)
                                logr_p = str(row_map.get("ds_logradouro") or "").strip()
                                num_p = str(row_map.get("nu_numero") or "").strip()
                                comp_p = str(row_map.get("ds_complemento") or "").strip()
                                bairro_p = str(row_map.get("no_bairro") or "").strip()
                                cep_p = str(row_map.get("ds_cep") or "").strip()
                                muni_p = str(row_map.get("no_municipio") or "").strip()
                                pt_ref_p = str(row_map.get("ds_ponto_referencia") or "").strip()

                                score_novo = calcular_completude_endereco(logr_p, num_p, comp_p, bairro_p, cep_p)
                                score_atual = calcular_completude_endereco(p.endereco or "", p.endereco_numero or "", p.complemento or "", p.bairro or "", p.cep or "")

                                if score_novo >= score_atual and (logr_p or bairro_p):
                                    if logr_p:
                                        p.endereco = logr_p[:255]
                                    if num_p:
                                        p.endereco_numero = num_p[:20]
                                    if comp_p:
                                        p.complemento = comp_p[:100]
                                    if bairro_p:
                                        p.bairro = bairro_p[:100]
                                    if cep_p:
                                        p.cep = cep_p[:10]
                                    if muni_p:
                                        p.municipio = muni_p[:100]
                                    if pt_ref_p:
                                        p.ponto_referencia = pt_ref_p[:150]
                                else:
                                    # Preserva endereço atual mais completo e preenche apenas campos faltantes
                                    if not p.endereco and logr_p:
                                        p.endereco = logr_p[:255]
                                    if not p.endereco_numero and num_p:
                                        p.endereco_numero = num_p[:20]
                                    if not p.complemento and comp_p:
                                        p.complemento = comp_p[:100]
                                    if not p.bairro and bairro_p:
                                        p.bairro = bairro_p[:100]
                                    if not p.cep and cep_p:
                                        p.cep = cep_p[:10]
                                    if not p.municipio and muni_p:
                                        p.municipio = muni_p[:100]
                                    if not p.ponto_referencia and pt_ref_p:
                                        p.ponto_referencia = pt_ref_p[:150]

                                # Atualiza território / APS
                                if cnes_raw:
                                    p.unidade_cnes = cnes_raw[:20]
                                    p.unidade_nome = unidade_nome_raw[:150]
                                    if uid:
                                        p.unidade_saude_id = uid
                                if str(row_map.get("nu_ine") or "").strip():
                                    p.equipe_ine = str(row_map.get("nu_ine")).strip()[:20]
                                    p.equipe_esf = str(row_map.get("no_equipe") or "").strip()[:80]
                                if str(row_map.get("nu_micro_area") or "").strip():
                                    p.microarea = str(row_map.get("nu_micro_area")).strip()[:20]

                                p.sincronizado_em = agora
                                p.updated_at = agora
                                db.add(p)
                                db.flush()

                                situacao_pec, detalhe_pec, dt_obito_pec = classificar_situacao_pec(row_map, municipio_sede)
                                if situacao_pec in ("obito", "mudanca_municipio"):
                                    total_baixas_fila += aplicar_baixa_automatica_paciente(
                                        db,
                                        p,
                                        situacao_pec,
                                        detalhe_pec,
                                        data_obito=dt_obito_pec,
                                        origem="e-SUS PEC",
                                        agora=agora,
                                    )

                                pacientes_processados_nesta_execucao.add(p.id)
                                pec_id_map[pec_id] = p.id
                        else:
                            situacao_pec, detalhe_pec, dt_obito_pec = classificar_situacao_pec(row_map, municipio_sede)
                            # Paciente Inédito -> Inserção
                            novo_p = Paciente(
                                nome=nome,
                                nome_social=str(row_map.get("no_social") or "").strip()[:150],
                                cpf=cpf,
                                cns=cns,
                                nascimento=dt_nasc,
                                sexo=str(row_map.get("no_sexo") or "").strip()[:20],
                                nome_mae=str(row_map.get("no_mae") or "").strip()[:150],
                                telefone=tel_limpo,
                                endereco=str(row_map.get("ds_logradouro") or "").strip()[:255],
                                endereco_numero=str(row_map.get("nu_numero") or "").strip()[:20],
                                complemento=str(row_map.get("ds_complemento") or "").strip()[:100],
                                bairro=str(row_map.get("no_bairro") or "").strip()[:100],
                                municipio=str(row_map.get("no_municipio") or municipio_sede).strip()[:100],
                                cep=str(row_map.get("ds_cep") or "").strip()[:10],
                                ponto_referencia=str(row_map.get("ds_ponto_referencia") or "").strip()[:150],
                                unidade_saude_id=uid,
                                unidade_cnes=cnes_raw[:20],
                                unidade_nome=unidade_nome_raw[:150],
                                equipe_ine=str(row_map.get("nu_ine") or "").strip()[:20],
                                equipe_esf=str(row_map.get("no_equipe") or "").strip()[:80],
                                microarea=str(row_map.get("nu_micro_area") or "").strip()[:20],
                                co_seq_cidadao_pec=pec_id,
                                situacao_cadastral=situacao_pec,
                                data_obito=dt_obito_pec,
                                motivo_situacao=detalhe_pec[:255],
                                situacao_atualizada_em=agora if situacao_pec != "ativo" else None,
                                sincronizado_em=agora,
                                created_at=agora,
                                updated_at=agora,
                            )
                            db.add(novo_p)
                            db.flush()
                            if novo_p.id and not novo_p.codigo_prontuario:
                                novo_p.codigo_prontuario = gerar_prontuario_aleatorio(db, novo_p.id)
                                db.add(novo_p)
                            if novo_p.id and situacao_pec in ("obito", "mudanca_municipio"):
                                db.add(
                                    PacienteHistorico(
                                        paciente_id=novo_p.id,
                                        tipo_evento="OBITO_PEC" if situacao_pec == "obito" else "MUDANCA_MUNICIPIO_PEC",
                                        motivo="Óbito" if situacao_pec == "obito" else "Mudança de Município",
                                        descricao=detalhe_pec[:500],
                                        origem="e-SUS PEC",
                                        registrado_por="Sincronização Automática e-SUS PEC",
                                        registrado_em=agora,
                                    )
                                )

                            pacientes_cache[novo_p.id] = novo_p

                            if cpf:
                                cpf_map[cpf] = novo_p.id
                            if cns:
                                cns_map[cns] = novo_p.id
                            if nome_norm and dt_nasc_str:
                                nome_nasc_map.setdefault((nome_norm, dt_nasc_str), []).append(novo_p.id)
                            pec_id_map[pec_id] = novo_p.id

                            pacientes_processados_nesta_execucao.add(novo_p.id)
                            total_inseridos += 1

                        batch_count += 1
                        if batch_count >= 500:
                            db.commit()
                            batch_count = 0

                except Exception:
                    total_erros += 1

            # Commit das alterações pendentes
            db.commit()

        duracao = round(time.time() - t0, 2)
        log.finalizado_em = datetime.utcnow()
        log.status = "SUCESSO"
        log.total_lidos = total_lidos
        log.total_inseridos = total_inseridos
        log.total_atualizados = total_atualizados
        log.total_duplicados_mesclados = total_duplicados_mesclados
        log.total_baixas_fila = total_baixas_fila
        log.total_erros = total_erros
        log.duracao_segundos = duracao
        log.mensagem = (
            f"Sincronização concluída com sucesso: {total_lidos} cidadãos lidos do e-SUS PEC, "
            f"{total_inseridos} novos cadastros, {total_atualizados} atualizados, "
            f"{total_duplicados_mesclados} registros duplicados unificados e "
            f"{total_baixas_fila} baixa(s) automática(s) na fila em {duracao}s."
        )

        cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
        if cfg:
            cfg.pec_sync_ultima_execucao = datetime.utcnow()
            cfg.pec_sync_ultimo_status = "SUCESSO"
            cfg.pec_sync_total_pacientes = total_inseridos + total_atualizados
            db.add(cfg)

        db.add(log)
        db.commit()
        db.refresh(log)
        return log

    except Exception as e:
        logger.error(f"Erro na sincronização e-SUS PEC: {e}", exc_info=True)
        duracao = round(time.time() - t0, 2)
        err_msg = "Ocorreu um erro interno durante a sincronizacao."
        try:
            db.rollback()
        except Exception:
            pass

        log.finalizado_em = datetime.utcnow()
        log.status = "ERRO"
        log.duracao_segundos = duracao
        log.mensagem = f"Falha na sincronização: {err_msg}"
        log.detalhes = str(e)[:2000]

        try:
            cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
            if cfg:
                cfg.pec_sync_ultima_execucao = datetime.utcnow()
                cfg.pec_sync_ultimo_status = "ERRO"
                db.add(cfg)
            db.add(log)
            db.commit()
            db.refresh(log)
        except Exception:
            pass
        return log

    finally:
        if is_pg_locked:
            try:
                db.execute(text(f"SELECT pg_advisory_unlock({ADVISORY_LOCK_SYNC})"))
            except Exception:
                pass
        _SYNC_RUNNING = False
        _SYNC_LOCK.release()


def atualizar_enderecos_pacientes_pec(db: Session) -> dict:
    """Sincroniza e atualiza em alta velocidade os endereços de todos os pacientes locais
    a partir das fichas territoriais e domiciliares do e-SUS PEC (tb_acomp_cidadaos_vinculados + tb_cidadao).
    """
    cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
    conectado, dsn = garantir_tunel_db(cfg)
    if not conectado or not dsn:
        return {"ok": False, "mensagem": "Não conectado ao e-SUS PEC."}

    from sqlalchemy import create_engine
    pec_engine = create_engine(dsn, pool_pre_ping=True, connect_args={"connect_timeout": 8})

    query = text("""
        SELECT 
            c.co_seq_cidadao,
            c.nu_cpf,
            c.nu_cns,
            c.no_cidadao,
            c.dt_nascimento,
            COALESCE(NULLIF(TRIM(v.ds_logradouro_domicilio), ''), NULLIF(TRIM(v.ds_logradouro_tb_cidadao), ''), c.ds_logradouro) as logradouro,
            COALESCE(NULLIF(TRIM(v.nu_numero_domicilio), ''), NULLIF(TRIM(v.nu_numero_tb_cidadao), ''), c.nu_numero) as numero,
            COALESCE(NULLIF(TRIM(v.ds_complemento_domicilio), ''), NULLIF(TRIM(v.ds_complemento_tb_cidadao), ''), c.ds_complemento) as complemento,
            COALESCE(NULLIF(TRIM(v.no_bairro_domicilio), ''), NULLIF(TRIM(v.no_bairro_tb_cidadao), ''), c.no_bairro) as bairro,
            COALESCE(NULLIF(TRIM(v.ds_cep_domicilio), ''), NULLIF(TRIM(v.ds_cep_tb_cidadao), ''), c.ds_cep) as cep,
            COALESCE(NULLIF(TRIM(v.no_municipio_domicilio), ''), NULLIF(TRIM(v.no_municipio_tb_cidadao), ''), 'Guapé') as municipio,
            c.ds_ponto_referencia as ponto_ref,
            COALESCE(NULLIF(TRIM(v.nu_micro_area_domicilio), ''), NULLIF(TRIM(v.nu_micro_area_tb_cidadao), ''), c.nu_micro_area) as microarea
        FROM tb_cidadao c
        LEFT JOIN tb_acomp_cidadaos_vinculados v ON v.co_cidadao = c.co_seq_cidadao
        WHERE COALESCE(NULLIF(TRIM(v.ds_logradouro_domicilio), ''), NULLIF(TRIM(v.ds_logradouro_tb_cidadao), ''), c.ds_logradouro) IS NOT NULL
           OR COALESCE(NULLIF(TRIM(v.no_bairro_domicilio), ''), NULLIF(TRIM(v.no_bairro_tb_cidadao), ''), c.no_bairro) IS NOT NULL
    """)

    with pec_engine.connect() as pec_conn:
        pec_rows = pec_conn.execute(query).mappings().all()

    pec_by_co_seq: dict[int, dict] = {}
    pec_by_cpf: dict[str, dict] = {}
    pec_by_cns: dict[str, dict] = {}
    pec_by_nn: dict[tuple[str, str], dict] = {}

    for r in pec_rows:
        cid = int(r["co_seq_cidadao"])
        pec_by_co_seq[cid] = r
        cpf = limpar_cpf(r["nu_cpf"])
        if cpf:
            pec_by_cpf[cpf] = r
        cns = limpar_cns(r["nu_cns"])
        if cns:
            pec_by_cns[cns] = r
        nome_n = normalizar_nome(r["no_cidadao"])
        dt_s = str(r["dt_nascimento"]) if r["dt_nascimento"] else ""
        if nome_n and dt_s:
            pec_by_nn[(nome_n, dt_s)] = r

    # Processa os pacientes locais
    pacientes = db.exec(select(Paciente)).all()
    total_analisados = len(pacientes)
    total_atualizados = 0
    agora = datetime.utcnow()

    for p in pacientes:
        m: Optional[dict] = None
        if p.co_seq_cidadao_pec and p.co_seq_cidadao_pec in pec_by_co_seq:
            m = pec_by_co_seq[p.co_seq_cidadao_pec]
        if not m and p.cpf:
            cpf_p = limpar_cpf(p.cpf)
            if cpf_p and cpf_p in pec_by_cpf:
                m = pec_by_cpf[cpf_p]
        if not m and p.cns:
            cns_p = limpar_cns(p.cns)
            if cns_p and cns_p in pec_by_cns:
                m = pec_by_cns[cns_p]
        if not m and p.nome and p.nascimento:
            chave = (normalizar_nome(p.nome), str(p.nascimento))
            if chave in pec_by_nn:
                m = pec_by_nn[chave]

        if m:
            alterou = False
            logr = (m["logradouro"] or "").strip()
            num = (m["numero"] or "").strip()
            compl = (m["complemento"] or "").strip()
            bairro = (m["bairro"] or "").strip()
            cep = (m["cep"] or "").strip()
            muni = (m["municipio"] or "Guapé").strip()
            ponto = (m["ponto_ref"] or "").strip()
            micro = (m["microarea"] or "").strip()

            if logr and p.endereco != logr[:255]:
                p.endereco = logr[:255]
                alterou = True
            if num and p.endereco_numero != num[:20]:
                p.endereco_numero = num[:20]
                alterou = True
            if compl and p.complemento != compl[:100]:
                p.complemento = compl[:100]
                alterou = True
            if bairro and p.bairro != bairro[:100]:
                p.bairro = bairro[:100]
                alterou = True
            if cep and p.cep != cep[:10]:
                p.cep = cep[:10]
                alterou = True
            if muni and (not p.municipio or p.municipio != muni[:100]):
                p.municipio = muni[:100]
                alterou = True
            if ponto and not p.ponto_referencia:
                p.ponto_referencia = ponto[:150]
                alterou = True
            if micro and not p.microarea:
                p.microarea = micro[:20]
                alterou = True
            if not p.co_seq_cidadao_pec and m["co_seq_cidadao"]:
                p.co_seq_cidadao_pec = int(m["co_seq_cidadao"])
                alterou = True

            if alterou:
                p.updated_at = agora
                db.add(p)
                total_atualizados += 1

    db.commit()
    return {
        "ok": True,
        "total_analisados": total_analisados,
        "total_atualizados": total_atualizados,
        "mensagem": f"{total_atualizados} cadastros de pacientes atualizados com seus endereços do e-SUS PEC!",
    }
