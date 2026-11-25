"""Serviço de descoberta, download e atualização da Tabela do SIA/SUS (DATASUS FTP Oficial)."""

from __future__ import annotations

from datetime import datetime
import ftplib
import json
import logging
import os
import re
import shutil
import struct
import subprocess
import tempfile
import threading
from typing import Iterator, Optional

from sqlalchemy import text
from sqlmodel import Session, select

from app.models.integracoes import IntegrationSettings
from app.models.lab_exames import SigtapProcedimento, SigtapVersao
from app.services.sigtap_hierarquia import decompor_codigo_sigtap

logger = logging.getLogger("sia_sync")

FTP_HOST = "ftp.datasus.gov.br"
FTP_DIR = "/siasus/SIA"
ADVISORY_LOCK_SIA = 847291996
_SIA_LOCK = threading.Lock()
_SIA_RUNNING = False


def is_sia_sync_running() -> bool:
    return _SIA_RUNNING


def iterar_dbf(dbf_path: str) -> Iterator[dict[str, str]]:
    """Lê registros de arquivo DBF (dBase III/IV) de forma atômica e nativa com struct."""
    with open(dbf_path, "rb") as f:
        header = f.read(32)
        if len(header) < 12:
            return
        version, yy, mm, dd, num_records, header_len, record_len = struct.unpack("<BBBBIHH", header[:12])
        fields: list[tuple[str, int]] = []
        while True:
            fld_desc = f.read(32)
            if not fld_desc or fld_desc[0] == 0x0D:
                break
            name = fld_desc[:11].split(b"\x00")[0].decode("ascii", "ignore").strip()
            length = fld_desc[16]
            fields.append((name, length))

        f.seek(header_len)
        for _ in range(num_records):
            rec = f.read(record_len)
            if not rec:
                break
            if rec[0] == 0x2A:  # registro deletado (*)
                continue
            offset = 1
            row: dict[str, str] = {}
            for name, length in fields:
                val = rec[offset : offset + length].decode("latin-1", "ignore").strip()
                offset += length
                row[name] = val
            yield row


def descobrir_pacotes_sia_ftp(
    competencia: str | None = None,
    timeout: int = 15,
) -> list[dict]:
    """Lista pacotes BDSIA*.exe disponíveis no repositório FTP oficial do DATASUS.

    Retorna ordenado por competência e revisão mais recente decrescente.
    """
    alvo_ym = competencia.replace("-", "").strip() if competencia else ""
    pacotes: list[dict] = []

    ftp = ftplib.FTP(FTP_HOST, timeout=timeout)
    try:
        ftp.login()
        ftp.cwd(FTP_DIR)
        nomes = ftp.nlst()
    finally:
        try:
            ftp.quit()
        except Exception:
            try:
                ftp.close()
            except Exception:
                pass

    for nome in nomes:
        base = os.path.basename(nome)
        m = re.match(r"^BDSIA(\d{4})(\d{2})([a-z]?)\.exe$", base, re.IGNORECASE)
        if not m:
            continue
        ano, mes, rev = m.group(1), m.group(2), m.group(3).lower()
        comp_str = f"{ano}-{mes}"
        ym = f"{ano}{mes}"
        if not alvo_ym or ym == alvo_ym:
            pacotes.append({
                "competencia": comp_str,
                "arquivo": base,
                "ano": int(ano),
                "mes": int(mes),
                "rev": rev,
                "ym": ym,
            })

    # Ordena pelo ano desc, mes desc, revisão desc
    pacotes.sort(key=lambda x: (x["ano"], x["mes"], x["rev"]), reverse=True)
    return pacotes


def baixar_pacote_sia_ftp(
    nome_arquivo: str,
    dest_path: str,
    timeout: int = 60,
) -> str:
    """Baixa pacote executável do repositório FTP oficial do DATASUS."""
    ftp = ftplib.FTP(FTP_HOST, timeout=timeout)
    try:
        ftp.login()
        ftp.cwd(FTP_DIR)
        with open(dest_path, "wb") as f:
            ftp.retrbinary(f"RETR {nome_arquivo}", f.write)
    finally:
        try:
            ftp.quit()
        except Exception:
            try:
                ftp.close()
            except Exception:
                pass
    return dest_path


def extrair_dbfs_sia(exe_path: str, dest_dir: str) -> dict[str, str]:
    """Extrai os arquivos S_PROCED.DBF e S_PA.DBF do arquivo auto-extraível 7z (.exe)."""
    seven_z = shutil.which("7z") or shutil.which("7za")
    if not seven_z:
        raise RuntimeError("Utilitário 7z/7za não encontrado no sistema para descompactar o arquivo do SIA.")

    cmd = [seven_z, "e", exe_path, f"-o{dest_dir}", "S_PROCED.DBF", "S_PA.DBF", "-y"]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Erro ao extrair arquivos com 7z: {res.stderr}")

    # Extração opcional das tabelas auxiliares de serviço e CID do pacote BDSIA
    subprocess.run(
        [seven_z, "e", exe_path, f"-o{dest_dir}", "S_PASRV.DBF", "S_PACID.DBF", "-y"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    arquivos_extraidos: dict[str, str] = {}
    for item in os.listdir(dest_dir):
        upper = item.upper()
        if upper == "S_PROCED.DBF":
            arquivos_extraidos["S_PROCED"] = os.path.join(dest_dir, item)
        elif upper == "S_PA.DBF":
            arquivos_extraidos["S_PA"] = os.path.join(dest_dir, item)
        elif upper == "S_PASRV.DBF":
            arquivos_extraidos["S_PASRV"] = os.path.join(dest_dir, item)
        elif upper == "S_PACID.DBF":
            arquivos_extraidos["S_PACID"] = os.path.join(dest_dir, item)

    if "S_PROCED" not in arquivos_extraidos:
        raise FileNotFoundError("O arquivo S_PROCED.DBF não foi encontrado no pacote do SIA.")

    return arquivos_extraidos


def importar_tabela_sia(
    db: Session,
    proced_dbf_path: str,
    pa_dbf_path: str | None,
    competencia: str,
    nome_arquivo: str = "",
    usuario: str = "Sistema",
    simular: bool = False,
    pasrv_dbf_path: str | None = None,
    pacid_dbf_path: str | None = None,
) -> dict:
    """Importa e consolida os procedimentos da tabela SIA/SUS no banco de dados.

    Garante que:
    1. Preços e regras ambulatoriais oficiais do DATASUS sejam atualizados.
    2. Modificações locais (valor_combinado e tipos_fila_permitidos) NÃO sejam sobrescritas.
    3. Histórico de versão seja salvo em sigtap_versoes com origem='sia_ftp'.
    """
    comp_alvo_ym = competencia.replace("-", "").strip() if competencia else ""

    # 1. Carrega dados de apoio de S_PA.DBF (documento BPA/APAC, exigência de identificação)
    pa_lookup: dict[str, dict[str, str]] = {}
    if pa_dbf_path and os.path.exists(pa_dbf_path):
        for r in iterar_dbf(pa_dbf_path):
            cod = r.get("PA_ID", "") + r.get("PA_DV", "")
            if not cod:
                continue
            atual = pa_lookup.get(cod)
            if atual is None:
                pa_lookup[cod] = r
            else:
                if comp_alvo_ym:
                    if r.get("PA_CMP") == comp_alvo_ym:
                        pa_lookup[cod] = r
                    elif atual.get("PA_CMP") != comp_alvo_ym and r.get("PA_CMP", "") > atual.get("PA_CMP", ""):
                        pa_lookup[cod] = r
                else:
                    if r.get("PA_CMP", "") > atual.get("PA_CMP", ""):
                        pa_lookup[cod] = r

    # 2. Carrega procedimentos principais de S_PROCED.DBF
    proced_lookup: dict[str, dict[str, str]] = {}
    for r in iterar_dbf(proced_dbf_path):
        cod = r.get("PA_ID", "") + r.get("PA_DV", "")
        if not cod:
            continue
        atual = proced_lookup.get(cod)
        if atual is None:
            proced_lookup[cod] = r
        else:
            if comp_alvo_ym:
                if r.get("PA_CMP") == comp_alvo_ym:
                    proced_lookup[cod] = r
                elif atual.get("PA_CMP") != comp_alvo_ym and r.get("PA_CMP", "") > atual.get("PA_CMP", ""):
                    proced_lookup[cod] = r
            else:
                if r.get("PA_CMP", "") > atual.get("PA_CMP", ""):
                    proced_lookup[cod] = r

    # 2b. Carrega serviços/classificações (S_PASRV.DBF) e CIDs (S_PACID.DBF) se disponíveis
    srv_por_pa: dict[str, list[dict[str, str]]] = {}
    if pasrv_dbf_path and os.path.exists(pasrv_dbf_path):
        vistos_srv: set[tuple[str, str, str]] = set()
        for r in iterar_dbf(pasrv_dbf_path):
            pa9 = (r.get("PASRV_PA") or r.get("PA_ID") or "").strip()[:9]
            sv = (r.get("PASRV_SRV") or r.get("CO_SERVICO") or "").strip()
            cl = (r.get("PASRV_CLF") or r.get("CO_CLASSIFICACAO") or "").strip()
            if pa9 and sv and (pa9, sv, cl) not in vistos_srv:
                vistos_srv.add((pa9, sv, cl))
                srv_por_pa.setdefault(pa9, []).append({
                    "servico": sv,
                    "classificacao": cl,
                    "descricao": (r.get("PASRV_DSCR") or "").strip()[:120],
                })

    cids_pa9: set[str] = set()
    if pacid_dbf_path and os.path.exists(pacid_dbf_path):
        for r in iterar_dbf(pacid_dbf_path):
            pa9 = (r.get("PACID_PA") or r.get("PA_ID") or "").strip()[:9]
            if pa9:
                cids_pa9.add(pa9)

    # 3. Mapeia e prepara dados estruturados para upsert
    pend_proc: dict[str, dict] = {}
    for cod, r_proc in proced_lookup.items():
        desc = r_proc.get("PA_DC", "").strip()[:255]
        if not desc:
            continue

        cpx_raw = r_proc.get("PA_CPX", "").strip()
        complexidade = {"1": "AB", "2": "MC", "3": "AC"}.get(cpx_raw, "MC" if cpx_raw else "NA")

        # Instrumento de Registro (BPA-I, BPA-C, APAC, AIH, RAAS) e regras BPA (CPF/CNS/Idade/CBO)
        r_pa = pa_lookup.get(cod)
        inst = None
        exige_cpf = False
        exige_cns = False
        exige_idade_bpa = False
        exige_cbo = True
        if r_pa:
            pa_doc = r_pa.get("PA_DOC", "").strip().upper()
            pa_idebpa = r_pa.get("PA_IDEBPA", "").strip().upper()
            exige_cpf = r_pa.get("PA_CPFPCN", "").strip().upper() == "S"
            exige_cns = r_pa.get("PA_CNSPCN", "").strip().upper() == "S"
            exige_idade_bpa = pa_idebpa == "S"
            exige_cbo = r_pa.get("PA_EXIGCBO", "S").strip().upper() != "N"
            if pa_doc == "B":
                inst = "BPA-I" if pa_idebpa == "S" else "BPA-C"
            elif pa_doc == "P":
                inst = "APAC"

        tpreg = r_proc.get("PA_TPREG", "").strip()
        regs_sia: list[str] = []
        if "01" in tpreg:
            regs_sia.append("BPA-C")
        if "02" in tpreg:
            regs_sia.append("BPA-I")
        if "03" in tpreg:
            regs_sia.append("APAC")
        if "04" in tpreg:
            regs_sia.append("AIH")
        if "05" in tpreg:
            regs_sia.append("RAAS")

        if not inst:
            if "02" in tpreg:
                inst = "BPA-I"
            elif "01" in tpreg:
                inst = "BPA-C"
            elif "03" in tpreg:
                inst = "APAC"
            elif "04" in tpreg:
                inst = "AIH"
            elif "05" in tpreg:
                inst = "RAAS"
            else:
                inst = "BPA-C"
        if inst not in regs_sia:
            regs_sia.insert(0, inst)
        if inst == "BPA-I":
            exige_cns = True

        srvs_cod = srv_por_pa.get(cod[:9], [])
        exige_cid = (cod[:9] in cids_pa9) if cids_pa9 else False

        raw_sexo = r_proc.get("PA_SEXO", "").strip().upper()
        if raw_sexo == "A":
            sexo = "Ambos"
        elif raw_sexo in ("M", "F"):
            sexo = raw_sexo
        else:
            sexo = "Indiferente"

        try:
            idade_min = int(r_proc.get("PA_IDADEMN", 0) or 0)
        except Exception:
            idade_min = 0

        try:
            idade_max = int(r_proc.get("PA_IDADEMX", 0) or 0)
        except Exception:
            idade_max = 0

        try:
            qtd_maxima = int(r_proc.get("PA_QTDMAX", 0) or 0)
        except Exception:
            qtd_maxima = 0

        try:
            valor_sa = float(r_proc.get("PA_SA", 0.0) or 0.0)
        except Exception:
            valor_sa = 0.0

        try:
            valor_sp = float(r_proc.get("PA_SP", 0.0) or 0.0)
        except Exception:
            valor_sp = 0.0

        try:
            valor_sh = float(r_proc.get("PA_SH", 0.0) or 0.0)
        except Exception:
            valor_sh = 0.0

        hier = decompor_codigo_sigtap(cod)

        pend_proc[cod] = {
            "codigo": cod,
            "descricao": desc,
            "complexidade": complexidade,
            "instrumento": inst,
            "instrumentos_permitidos": ",".join(regs_sia)[:60],
            "sexo": sexo,
            "idade_min": idade_min,
            "idade_max": idade_max,
            "qtd_maxima": qtd_maxima,
            "pontos": 0,
            "valor_sa": round(valor_sa, 2),
            "valor_sp": round(valor_sp, 2),
            "valor_sh": round(valor_sh, 2),
            "competencia": competencia,
            "grupo_codigo": hier["grupo_codigo"],
            "grupo_nome": hier["grupo_nome"][:150],
            "subgrupo_codigo": hier["subgrupo_codigo"],
            "subgrupo_nome": hier["subgrupo_nome"][:180],
            "forma_organizacao_codigo": hier["forma_organizacao"][:6],
            "exige_cpf": exige_cpf,
            "exige_cns": exige_cns,
            "exige_cid": exige_cid,
            "exige_idade_bpa": exige_idade_bpa,
            "exige_cbo": exige_cbo,
            "exige_servico": len(srvs_cod) > 0,
            "servicos_permitidos_json": json.dumps(srvs_cod, ensure_ascii=False) if srvs_cod else "[]",
        }

    stats = {
        "total": len(pend_proc),
        "inseridos": 0,
        "atualizados": 0,
        "preservados_valor_combinado": 0,
        "preservados_tipos_fila": 0,
    }

    # 4. Upsert com preservação de customizações do município
    existentes = {p.codigo: p for p in db.exec(select(SigtapProcedimento)).all()}
    for cod, dados in pend_proc.items():
        obj = existentes.get(cod)
        if obj:
            v_comb = getattr(obj, "valor_combinado", 0.0)
            tp_perm = getattr(obj, "tipos_fila_permitidos", "")
            ex_cid_prev = bool(getattr(obj, "exige_cid", False))
            ex_srv_prev = bool(getattr(obj, "exige_servico", False))
            srvs_prev = getattr(obj, "servicos_permitidos_json", "[]") or "[]"

            for k, v in dados.items():
                setattr(obj, k, v)

            # Preserva customizações locais e metadados de DBFs auxiliares ausentes neste pacote
            if v_comb and v_comb > 0:
                obj.valor_combinado = v_comb
                stats["preservados_valor_combinado"] += 1
            if tp_perm:
                obj.tipos_fila_permitidos = tp_perm
                stats["preservados_tipos_fila"] += 1
            if not cids_pa9 and ex_cid_prev:
                obj.exige_cid = True
            if not srv_por_pa and ex_srv_prev:
                obj.exige_servico = True
                obj.servicos_permitidos_json = srvs_prev

            if not simular:
                db.add(obj)
            stats["atualizados"] += 1
        else:
            if not simular:
                db.add(SigtapProcedimento(**dados))
            stats["inseridos"] += 1

    if not simular:
        db.commit()
        versao = SigtapVersao(
            competencia=competencia,
            origem="sia_ftp",
            arquivo=nome_arquivo or f"BDSIA_{competencia}.exe",
            total_proc=stats["inseridos"] + stats["atualizados"],
            inseridos=stats["inseridos"],
            atualizados=stats["atualizados"],
            usuario=usuario,
        )
        db.add(versao)
        db.commit()

    return stats


def executar_sync_automatica_sia(
    db: Session,
    competencia: Optional[str] = None,
    usuario: str = "Rotina Automática SIA DATASUS",
    forcar: bool = False,
    simular: bool = False,
) -> dict:
    """Executa a rotina completa de descoberta, download e importação da Tabela SIA do FTP DATASUS."""
    global _SIA_RUNNING

    if not _SIA_LOCK.acquire(blocking=False):
        return {"ok": False, "status": "EM_EXECUCAO", "mensagem": "Sincronização da tabela SIA já em andamento."}

    is_pg_locked = False
    try:
        res = db.execute(text(f"SELECT pg_try_advisory_lock({ADVISORY_LOCK_SIA})")).scalar()
        if res is False:
            _SIA_LOCK.release()
            return {"ok": False, "status": "EM_EXECUCAO", "mensagem": "Sincronização SIA já em execução em outro worker."}
        if res is True:
            is_pg_locked = True
    except Exception:
        pass

    _SIA_RUNNING = True
    try:
        cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
        agora = datetime.utcnow()

        pacotes = descobrir_pacotes_sia_ftp(competencia=competencia)
        if not pacotes:
            msg = f"Nenhum pacote BDSIA encontrado no FTP oficial do DATASUS ({FTP_HOST}{FTP_DIR})."
            if cfg:
                cfg.sia_sync_ultima_execucao = agora
                cfg.sia_sync_ultimo_status = "INDISPONIVEL"
                cfg.sia_sync_ultimo_erro = msg
                db.add(cfg)
                db.commit()
            return {"ok": False, "status": "INDISPONIVEL", "mensagem": msg}

        pacote = pacotes[0]
        comp_encontrada = pacote["competencia"]
        nome_arq = pacote["arquivo"]

        if not forcar and not simular:
            ja_importada = db.exec(
                select(SigtapVersao).where(
                    SigtapVersao.competencia == comp_encontrada,
                    SigtapVersao.total_proc > 0,
                    SigtapVersao.origem == "sia_ftp",
                )
            ).first()
            if ja_importada:
                if cfg:
                    cfg.sia_sync_ultima_execucao = agora
                    cfg.sia_sync_ultimo_status = "SEM_NOVIDADE"
                    cfg.sia_sync_ultima_competencia = comp_encontrada
                    cfg.sia_sync_ultimo_erro = ""
                    db.add(cfg)
                    db.commit()
                return {
                    "ok": True,
                    "status": "SEM_NOVIDADE",
                    "competencia": comp_encontrada,
                    "arquivo": nome_arq,
                    "mensagem": f"Tabela SIA competência {comp_encontrada} já importada anteriormente.",
                }

        with tempfile.TemporaryDirectory() as tmp_dir:
            exe_dest = os.path.join(tmp_dir, nome_arq)
            logger.info(f"Baixando {nome_arq} do FTP DATASUS...")
            baixar_pacote_sia_ftp(nome_arq, exe_dest)

            logger.info(f"Extraindo arquivos DBF de {nome_arq}...")
            dbfs = extrair_dbfs_sia(exe_dest, tmp_dir)

            logger.info(f"Importando tabela SIA {comp_encontrada} para a base...")
            stats = importar_tabela_sia(
                db=db,
                proced_dbf_path=dbfs["S_PROCED"],
                pa_dbf_path=dbfs.get("S_PA"),
                competencia=comp_encontrada,
                nome_arquivo=nome_arq,
                usuario=usuario,
                simular=simular,
                pasrv_dbf_path=dbfs.get("S_PASRV"),
                pacid_dbf_path=dbfs.get("S_PACID"),
            )

        if cfg and not simular:
            cfg.sia_sync_ultima_execucao = agora
            cfg.sia_sync_ultimo_status = "SUCESSO"
            cfg.sia_sync_ultima_competencia = comp_encontrada
            cfg.sia_sync_ultimo_erro = ""
            db.add(cfg)
            db.commit()

        return {"ok": True, "status": "SUCESSO", "competencia": comp_encontrada, "arquivo": nome_arq, **stats}

    except Exception as e:
        logger.warning(f"Erro na sincronização da Tabela SIA (FTP DATASUS): {e}", exc_info=True)
        try:
            cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
            if cfg:
                cfg.sia_sync_ultima_execucao = datetime.utcnow()
                cfg.sia_sync_ultimo_status = "ERRO"
                cfg.sia_sync_ultimo_erro = str(e)[:500]
                db.add(cfg)
                db.commit()
        except Exception:
            pass
        return {"ok": False, "status": "ERRO", "mensagem": str(e)[:500]}
    finally:
        if is_pg_locked:
            try:
                db.execute(text(f"SELECT pg_advisory_unlock({ADVISORY_LOCK_SIA})"))
            except Exception:
                pass
        _SIA_RUNNING = False
        _SIA_LOCK.release()
