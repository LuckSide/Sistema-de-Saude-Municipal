"""Importação em lote de viagens de carro TFD (CSV ou JSON extraído das ordens .doc).

Suporta simulação (dry-run), deduplicação por arquivo_sha1 / (data, hora, destino)
e (viagem_id, paciente_id), vinculação/cadastro opcional de pacientes,
classificação de acompanhantes (1 pessoa por linha) e geração idempotente
de lançamentos de deslocamento em tfd_faturamento.
"""

from __future__ import annotations

import csv
import io
import json
import re
import secrets
import unicodedata
from datetime import date, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.models.lab_exames import SigtapProcedimento
from app.models.tfd import (
    Destino,
    Faturamento,
    Paciente,
    ProcedimentoCatalogo,
    Viagem,
    ViagemPaciente,
)
from app.services.geradores import gerar_prontuario_aleatorio
from app.services.seed_deslocamento import DESLOCAMENTOS

MAX_BYTES_VIAGENS = 60 * 1024 * 1024
MAX_LINHAS_VIAGENS = 200_000
MAX_ERROS_VIAGENS = 25

COLUNAS_CSV_VIAGENS_CARRO = [
    "arquivo",
    "arquivo_sha1",
    "data",
    "hora",
    "destino",
    "tipo",
    "prontuario",
    "nome",
    "procedimento",
    "quantidade",
    "protocolo",
    "correcao_de",
    "em",
]

HEADER_ALIASES_CARRO = {
    "arquivo": "arquivo",
    "nome_arquivo": "arquivo",
    "arquivo_sha1": "arquivo_sha1",
    "sha1": "arquivo_sha1",
    "hash": "arquivo_sha1",
    "data": "data",
    "data_viagem": "data",
    "hora": "hora",
    "hora_saida": "hora",
    "horario": "hora",
    "destino": "destino",
    "cidade": "destino",
    "tipo": "tipo",
    "papel": "tipo",
    "categoria": "tipo",
    "prontuario": "prontuario",
    "codigo_prontuario": "prontuario",
    "nome": "nome",
    "paciente": "nome",
    "nome_paciente": "nome",
    "passageiro": "nome",
    "procedimento": "procedimento",
    "codigo_procedimento": "procedimento",
    "codigo_sigtap": "procedimento",
    "sigtap": "procedimento",
    "quantidade": "quantidade",
    "qtd": "quantidade",
    "protocolo": "protocolo",
    "correcao_de": "correcao_de",
    "em": "em",
    "enviado_em": "em",
}


def _sem_acento_upper(s: str) -> str:
    nfkd = unicodedata.normalize("NFKD", (s or "").strip())
    sem = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", sem).strip().upper()


def _parse_data_br_ou_iso(s: str) -> date | None:
    txt = (s or "").strip()
    if not txt:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S"):
        try:
            pedaco = txt[:10] if "%H" not in fmt else txt[:19]
            return datetime.strptime(pedaco, fmt).date()
        except ValueError:
            continue
    return None


def _normalizar_hora(s: str, default: str = "05:00") -> str:
    txt = (s or "").strip()
    m = re.match(r"^(\d{1,2}):(\d{2})", txt)
    if not m:
        return default
    h, mn = int(m.group(1)), int(m.group(2))
    if h > 23 or mn > 59:
        return default
    return f"{h:02d}:{mn:02d}"


def _somar_horas_hhmm(hhmm: str, horas: int = 9) -> str:
    m = re.match(r"^(\d{2}):(\d{2})$", (hhmm or "").strip())
    if not m:
        return ""
    total = (int(m.group(1)) * 60 + int(m.group(2)) + horas * 60) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


def _normalizar_header_csv(h: str) -> str:
    chave = _sem_acento_upper(h).lower().replace(" ", "_")
    return HEADER_ALIASES_CARRO.get(chave, chave)


def _decodificar_texto(conteudo: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return conteudo.decode(enc)
        except UnicodeDecodeError:
            continue
    return conteudo.decode("utf-8", errors="replace")


def converter_json_para_csv(conteudo_json: bytes) -> bytes:
    """Converte o JSON exportado de viagens de carro para CSV (UTF-8 com BOM, separador ';')."""
    texto = _decodificar_texto(conteudo_json)
    dados = json.loads(texto)
    if isinstance(dados, dict):
        for chave in ("viagens", "dados", "items", "registros"):
            if isinstance(dados.get(chave), list):
                dados = dados[chave]
                break
    if not isinstance(dados, list):
        raise ValueError("JSON inválido: esperado uma lista de registros de viagens de carro.")

    out = io.StringIO()
    writer = csv.DictWriter(
        out,
        fieldnames=COLUNAS_CSV_VIAGENS_CARRO,
        delimiter=";",
        extrasaction="ignore",
        lineterminator="\n",
    )
    writer.writeheader()
    for item in dados:
        if not isinstance(item, dict):
            continue
        row = {col: ("" if item.get(col) is None else str(item.get(col)).strip()) for col in COLUNAS_CSV_VIAGENS_CARRO}
        writer.writerow(row)
    return out.getvalue().encode("utf-8-sig")


def ler_viagens_carro(conteudo: bytes, ext: str) -> list[dict[str, Any]]:
    """Lê registros de viagens de carro a partir de .json ou .csv."""
    ext_l = (ext or "").strip().lower()
    raw_strip = conteudo.lstrip()
    if ext_l == "json" or raw_strip.startswith(b"[") or raw_strip.startswith(b"{"):
        try:
            dados = json.loads(_decodificar_texto(conteudo))
        except json.JSONDecodeError as e:
            raise ValueError(f"JSON inválido: {e}") from e
        if isinstance(dados, dict):
            for chave in ("viagens", "dados", "items", "registros"):
                if isinstance(dados.get(chave), list):
                    dados = dados[chave]
                    break
        if not isinstance(dados, list):
            raise ValueError("JSON deve conter uma lista de registros de viagens.")
        out = []
        for item in dados:
            if isinstance(item, dict):
                out.append({
                    _normalizar_header_csv(str(k)): ("" if v is None else str(v).strip())
                    for k, v in item.items()
                })
        return out

    if ext_l != "csv":
        raise ValueError("Envie um arquivo .csv ou .json de viagens de carro.")

    texto = _decodificar_texto(conteudo)
    linhas_amostra = "\n".join(texto.splitlines()[:10])
    delim = ";" if linhas_amostra.count(";") >= linhas_amostra.count(",") else ","
    reader = csv.DictReader(io.StringIO(texto), delimiter=delim)
    if not reader.fieldnames:
        raise ValueError("CSV sem cabeçalho.")
    out = []
    for raw_row in reader:
        if not raw_row:
            continue
        row = {
            _normalizar_header_csv(str(k)): ("" if v is None else str(v).strip())
            for k, v in raw_row.items()
            if k is not None
        }
        if any(row.values()):
            out.append(row)
    return out


def _mapa_destinos_canonicos(db: Session) -> dict[str, str]:
    mapa: dict[str, str] = {}
    for nome, *_ in DESLOCAMENTOS:
        mapa[_sem_acento_upper(nome)] = nome.strip().upper()
    for dest in db.exec(select(Destino)).all():
        if dest.nome_destino:
            mapa[_sem_acento_upper(dest.nome_destino)] = dest.nome_destino.strip().upper()
    return mapa


def _canon_destino(raw: str, mapa_destinos: dict[str, str]) -> str:
    txt = re.sub(r"\s+", " ", (raw or "").strip())
    if not txt:
        return ""
    chave = _sem_acento_upper(txt)
    if chave in mapa_destinos:
        return mapa_destinos[chave]
    return txt.upper()


def _resolver_nome_valor_proc(
    db: Session,
    codigo: str,
    proc_cache: dict[str, tuple[str, float]],
) -> tuple[str, float]:
    cod = (codigo or "").strip()
    if not cod:
        return "", 0.0
    if cod in proc_cache:
        return proc_cache[cod]
    proc = db.exec(select(ProcedimentoCatalogo).where(ProcedimentoCatalogo.codigo == cod)).first()
    sig = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == cod)).first()
    nome = (proc.nome if proc and proc.nome else (sig.descricao if sig and sig.descricao else "")) or ""
    valor = round(float((sig.valor_sa or 0) + (sig.valor_sp or 0) + (sig.valor_sh or 0)), 2) if sig else 0.0
    proc_cache[cod] = (nome, valor)
    return nome, valor


def processar_viagens_carro(
    linhas: list[dict[str, Any]],
    db: Session,
    *,
    simular: bool = False,
    criar_pacientes_novos: bool = True,
    gerar_faturamento: bool = True,
    ator_nome: str = "",
) -> dict[str, Any]:
    """Processa linhas de viagens de carro (CSV/JSON) de forma idempotente."""
    _ = simular  # Caller controla commit/rollback para que simulação valide tudo sem persistir
    if not linhas:
        raise ValueError("Nenhuma linha encontrada no arquivo.")

    mapa_destinos = _mapa_destinos_canonicos(db)
    erros: list[dict[str, Any]] = []
    avisos_pacientes_novos: list[dict[str, Any]] = []

    grupos_ordem: list[str] = []
    grupos: dict[str, list[tuple[int, dict[str, Any]]]] = {}

    for idx, row in enumerate(linhas, start=1):
        nome = re.sub(r"\s+", " ", (row.get("nome") or "").strip())
        dt = _parse_data_br_ou_iso(row.get("data") or "")
        dest_raw = row.get("destino") or ""
        dest = _canon_destino(dest_raw, mapa_destinos)

        if not dt:
            if len(erros) < MAX_ERROS_VIAGENS:
                erros.append({"linha": idx, "motivo": "Data ausente ou inválida."})
            continue
        if not dest:
            if len(erros) < MAX_ERROS_VIAGENS:
                erros.append({"linha": idx, "motivo": "Destino não informado."})
            continue
        if not nome:
            if len(erros) < MAX_ERROS_VIAGENS:
                erros.append({"linha": idx, "motivo": "Nome do passageiro/acompanhante ausente."})
            continue

        hora = _normalizar_hora(row.get("hora") or "", default="05:00")
        sha1 = (row.get("arquivo_sha1") or "").strip().lower()
        arquivo = (row.get("arquivo") or "").strip()
        chave_grupo = sha1 or f"{arquivo}|{dt.isoformat()}|{hora}|{dest}"

        if chave_grupo not in grupos:
            grupos[chave_grupo] = []
            grupos_ordem.append(chave_grupo)
        grupos[chave_grupo].append((
            idx,
            {
                "arquivo": arquivo,
                "sha1": sha1,
                "data": dt,
                "hora": hora,
                "destino": dest,
                "tipo": (row.get("tipo") or "PACIENTE").strip().upper(),
                "prontuario": (row.get("prontuario") or "").strip(),
                "nome": nome,
                "procedimento": (row.get("procedimento") or "").strip(),
                "quantidade": max(1, int(re.sub(r"\D", "", str(row.get("quantidade") or "1")) or "1")),
                "protocolo": (row.get("protocolo") or "").strip(),
                "em": (row.get("em") or "").strip(),
            },
        ))

    if not grupos_ordem:
        raise ValueError("Nenhuma viagem válida encontrada no arquivo (verifique colunas data, destino e nome).")

    # Pré-carregar pacientes em memória por prontuário e nome para importação O(1)
    pac_by_pront: dict[str, Paciente] = {}
    pac_by_nome_lower: dict[str, Paciente] = {}
    pac_by_nome_norm: dict[str, Paciente] = {}
    prontuarios_usados: set[str] = set()
    for p in db.exec(select(Paciente)).all():
        pront = (p.codigo_prontuario or "").strip()
        if pront:
            prontuarios_usados.add(pront)
            pac_by_pront.setdefault(pront, p)
        if p.nome:
            pac_by_nome_lower.setdefault(p.nome.strip().lower(), p)
            pac_by_nome_norm.setdefault(_sem_acento_upper(p.nome), p)

    proc_cache: dict[str, tuple[str, float]] = {}

    # Carregar viagens nas datas envolvidas para deduplicação eficiente
    datas_unicas = sorted({grupos[k][0][1]["data"] for k in grupos_ordem})
    viagens_existentes = list(
        db.exec(select(Viagem).where(Viagem.data_viagem.in_(datas_unicas))).all()  # type: ignore[attr-defined]
    )
    viagem_by_sha1: dict[str, Viagem] = {}
    viagem_by_chave: dict[tuple[date, str, str], Viagem] = {}
    for v_ex in viagens_existentes:
        obs_ex = v_ex.observacoes or ""
        m_sha = re.search(r"\[sha1:([a-f0-9]{8,64})\]", obs_ex, re.IGNORECASE)
        if m_sha:
            viagem_by_sha1[m_sha.group(1).lower()] = v_ex
        viagem_by_chave.setdefault(
            (v_ex.data_viagem, (v_ex.destino or "").strip().upper(), (v_ex.hora_saida or "").strip()),
            v_ex,
        )

    hoje = date.today()
    viagens_novas = 0
    viagens_existentes_qtd = 0
    passageiros_novos = 0
    acompanhantes_novos = 0
    passageiros_duplicados = 0
    pacientes_vinculados = 0
    pacientes_novos = 0
    pacientes_nao_encontrados_ignorados = 0
    faturamentos_novos = 0

    for chave_grupo in grupos_ordem:
        itens = grupos[chave_grupo]
        first = itens[0][1]
        dt_viagem: date = first["data"]
        hora_saida: str = first["hora"]
        hora_retorno: str = _somar_horas_hhmm(hora_saida, 9)
        dest_norm: str = first["destino"]
        sha1: str = first["sha1"]
        arquivo: str = first["arquivo"]

        viagem = viagem_by_sha1.get(sha1) if sha1 else None
        if not viagem and not sha1:
            viagem = viagem_by_chave.get((dt_viagem, dest_norm, hora_saida))

        if viagem:
            viagens_existentes_qtd += 1
        else:
            tag_sha = f" [sha1:{sha1}]" if sha1 else ""
            base_obs = f"Viagem de carro importada ({arquivo or 'CSV/JSON'})"
            obs_final = f"{base_obs}{tag_sha}"[:500]
            viagem = Viagem(
                destino=dest_norm,
                unidade="",
                data_viagem=dt_viagem,
                hora_saida=hora_saida,
                hora_retorno=hora_retorno,
                departamento="Saúde",
                status="concluida" if dt_viagem < hoje else "agendada",
                finalidade="consulta",
                observacoes=obs_final,
                criado_por=ator_nome or "Importação Viagens de Carro",
            )
            db.add(viagem)
            db.flush()
            viagens_novas += 1
            if sha1:
                viagem_by_sha1[sha1] = viagem
            viagem_by_chave.setdefault((dt_viagem, dest_norm, hora_saida), viagem)

        pax_existentes = {
            vp.paciente_id
            for vp in db.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id == viagem.id)).all()
        }
        fat_existentes = {
            (f.paciente_id, f.codigo_sigtap)
            for f in db.exec(select(Faturamento).where(Faturamento.viagem_id == viagem.id)).all()
        }

        for linha_num, item in itens:
            pront = item["prontuario"]
            nome = item["nome"]
            pac = pac_by_pront.get(pront) if pront else None
            if not pac:
                pac = pac_by_nome_lower.get(nome.lower())
            if not pac:
                pac = pac_by_nome_norm.get(_sem_acento_upper(nome))

            if pac:
                pacientes_vinculados += 1
            else:
                if not criar_pacientes_novos:
                    pacientes_nao_encontrados_ignorados += 1
                    if len(avisos_pacientes_novos) < 250:
                        avisos_pacientes_novos.append({
                            "linha": linha_num,
                            "nome": nome,
                            "prontuario": pront,
                            "acao": "ignorado",
                            "motivo": "Paciente não encontrado no cadastro local.",
                        })
                    continue

                cod_pront = pront
                if not cod_pront or cod_pront in prontuarios_usados:
                    cod_pront = pront if (pront and pront not in prontuarios_usados) else gerar_prontuario_aleatorio(db)
                    while cod_pront in prontuarios_usados:
                        cod_pront = gerar_prontuario_aleatorio(db)
                prontuarios_usados.add(cod_pront)

                pac = Paciente(
                    nome=nome[:150],
                    codigo_prontuario=cod_pront[:20],
                    municipio="Guapé",
                    situacao_cadastral="ativo",
                    observacoes="Cadastrado automaticamente via importação de viagens de carro",
                )
                db.add(pac)
                db.flush()
                pacientes_novos += 1
                pac_by_pront.setdefault(cod_pront, pac)
                pac_by_nome_lower.setdefault(nome.lower(), pac)
                pac_by_nome_norm.setdefault(_sem_acento_upper(nome), pac)
                if len(avisos_pacientes_novos) < 250:
                    avisos_pacientes_novos.append({
                        "linha": linha_num,
                        "nome": pac.nome,
                        "prontuario": pac.codigo_prontuario,
                        "acao": "criado_sem_pec",
                        "motivo": "Novo cadastro criado durante importação de viagens de carro.",
                    })

            if pac.id in pax_existentes:
                passageiros_duplicados += 1
                continue

            eh_acomp = "ACOMPANHANTE" in item["tipo"]
            proc_cod = item["procedimento"]
            qtd = item["quantidade"]
            proto = item["protocolo"]
            proc_nome, proc_valor = _resolver_nome_valor_proc(db, proc_cod, proc_cache)

            partes_obs = []
            if eh_acomp:
                partes_obs.append("Acompanhante")
            if proto:
                partes_obs.append(f"Protocolo {proto}")
            if proc_cod:
                partes_obs.append(f"Proc. {proc_cod} x{qtd}")
            obs_pax = " · ".join(partes_obs)[:500]

            tratamento = (
                "Acompanhante"
                if eh_acomp
                else (proc_nome or f"Deslocamento {dest_norm.title()}")[:150]
            )

            vp = ViagemPaciente(
                viagem_id=viagem.id,
                paciente_id=pac.id,
                acompanhante="",  # 1 pessoa por linha (acompanhantes entram como linha própria marcada como Acompanhante)
                presente=True,
                tratamento=tratamento,
                unidade="",
                hora_consulta="",
                observacoes=obs_pax,
                status_confirmacao="confirmado" if dt_viagem < hoje else "pendente",
                token_confirmacao=secrets.token_urlsafe(24),
            )
            db.add(vp)
            pax_existentes.add(pac.id)
            if eh_acomp:
                acompanhantes_novos += 1
            else:
                passageiros_novos += 1

            if gerar_faturamento and proc_cod and (pac.id, proc_cod) not in fat_existentes:
                comp = dt_viagem.strftime("%Y-%m")
                desc_fat = (proc_nome or f"DESLOCAMENTO {dest_norm}")[:150]
                try:
                    with db.begin_nested():
                        db.add(
                            Faturamento(
                                viagem_id=viagem.id,
                                paciente_id=pac.id,
                                procedimento=desc_fat,
                                codigo_sigtap=proc_cod[:20],
                                competencia=comp,
                                quantidade=qtd,
                                valor=proc_valor,
                                tipo="BPA",
                                status="pendente",
                                observacoes=(f"Importado viagem de carro ({qtd}x)" + (f" · Prot. {proto}" if proto else ""))[:500],
                                criado_por=ator_nome or "Importação Viagens de Carro",
                            )
                        )
                        db.flush()
                    fat_existentes.add((pac.id, proc_cod))
                    faturamentos_novos += 1
                except IntegrityError:
                    pass

    db.flush()

    aviso_pac = ""
    if pacientes_novos > 0:
        aviso_pac = f"{pacientes_novos} paciente(s) novo(s) foram cadastrados por não existirem no banco local."
    elif pacientes_nao_encontrados_ignorados > 0:
        aviso_pac = f"{pacientes_nao_encontrados_ignorados} linha(s) ignoradas porque o paciente não existe no cadastro local."

    return {
        "lidas": len(linhas),
        "viagens_identificadas": len(grupos_ordem),
        "viagens_novas": viagens_novas,
        "viagens_existentes": viagens_existentes_qtd,
        "passageiros_novos": passageiros_novos,
        "acompanhantes_novos": acompanhantes_novos,
        "passageiros_duplicados": passageiros_duplicados,
        "faturamentos_novos": faturamentos_novos,
        "pacientes_vinculados": pacientes_vinculados,
        "pacientes_novos": pacientes_novos,
        "pacientes_nao_encontrados_ignorados": pacientes_nao_encontrados_ignorados,
        "aviso_criacao_pacientes": aviso_pac,
        "avisos_pacientes_novos": avisos_pacientes_novos,
        "erros": erros,
    }
