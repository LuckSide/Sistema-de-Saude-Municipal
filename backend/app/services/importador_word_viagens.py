"""Serviço de importação de Ordens de Circulação de Veículos e Viagens em formato Word (.docx).

Extrai destinos, datas, horários, quilometragens, veículos/placas, motoristas e
a relação completa de passageiros (incluindo acompanhantes, prontuário, unidade e consulta).
"""

from __future__ import annotations

import io
import re
import secrets
from datetime import date, datetime
from typing import Any

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from sqlmodel import Session, func, select

from app.models.tfd import Motorista, Paciente, Veiculo, Viagem, ViagemPaciente
from app.models.user import User
from app.services.geradores import gerar_prontuario_aleatorio

KEYWORDS = (
    r"(?:VE[IÍ]CULO|PLACA|DESTINO|MOTORISTA|DEPARTAMENTO|"
    r"Data\s+sa[ií]da|Hora\s+sa[ií]da|Data\s+retorno|Hora\s+retorno|"
    r"Km\s+inicial|Km\s+final|Adiantamento|Horas\s+viagem|Km\s+rodados|Vistos|$)"
)


def _limpar_texto(val: str | None) -> str:
    if not val:
        return ""
    # Remove underlines contínuos (campos em branco para preenchimento manual) e travessões
    v = re.sub(r"[_—]+", "", str(val)).strip()
    return re.sub(r"\s+", " ", v)


def _parse_data(d_str: str | None) -> str:
    if not d_str:
        return ""
    s = d_str.strip()
    parts = re.split(r"[/.-]", s)
    if len(parts) == 3:
        d, m, y = parts
        if len(y) == 2:
            y = "20" + y
        try:
            dd = int(d)
            mm = int(m)
            yy = int(y)
            if 1 <= dd <= 31 and 1 <= mm <= 12 and 1900 <= yy <= 2100:
                return f"{yy:04d}-{mm:02d}-{dd:02d}"
        except ValueError:
            pass
    return ""


def _parse_hora(h_str: str | None) -> str:
    if not h_str:
        return ""
    h_clean = h_str.replace("h", ":").replace("H", ":").strip()
    m = re.match(r"^([0-9]{1,2}):([0-9]{2})$", h_clean)
    if m:
        hh, mm = m.groups()
        try:
            h_int = int(hh)
            m_int = int(mm)
            if 0 <= h_int <= 23 and 0 <= m_int <= 59:
                return f"{h_int:02d}:{m_int:02d}"
        except ValueError:
            pass
    return ""


def _parse_moeda(val: str | None) -> float:
    if not val:
        return 0.0
    num = re.sub(r"[^0-9,.]", "", str(val))
    if not num:
        return 0.0
    if "," in num:
        num = num.replace(".", "").replace(",", ".")
    try:
        return float(num)
    except Exception:
        return 0.0


def _extrair_campo(rotulo: str, texto: str) -> str:
    padrao = rf"{rotulo}\s*[:]\s*(.*?)(?={KEYWORDS}\s*[:]|\n|$)"
    m = re.search(padrao, texto, re.IGNORECASE)
    if m:
        return _limpar_texto(m.group(1))
    return ""


def parse_word_ordem_viagens(file_bytes: bytes, filename: str = "") -> list[dict[str, Any]]:
    """Lê um arquivo .docx e extrai uma ou mais ordens de viagem."""
    # Valida cabeçalho zip do docx (PK\x03\x04)
    if not file_bytes.startswith(b"PK\x03\x04"):
        raise ValueError("O arquivo enviado não é um documento Word (.docx) válido.")

    try:
        doc = Document(io.BytesIO(file_bytes))
    except Exception as exc:
        raise ValueError(f"Não foi possível abrir o documento Word: {exc}") from exc

    blocos: list[dict[str, Any]] = []
    bloco_atual: dict[str, Any] = {"textos": [], "tabela_passageiros": None}

    for child in doc.element.body:
        tag = child.tag.split("}")[-1]
        if tag == "p":
            p = Paragraph(child, doc)
            txt = p.text.strip()
            if not txt:
                continue
            # Novo bloco se encontrar título da ordem e já tivermos iniciado um bloco com dados
            if re.search(r"ORDEM\s+DE\s+(?:CIRCULA[CÇ][AÃ]O|VIAGEM)", txt, re.IGNORECASE) and (
                bloco_atual["textos"] or bloco_atual["tabela_passageiros"] is not None
            ):
                if bloco_atual["tabela_passageiros"] is not None or any("DESTINO" in t.upper() for t in bloco_atual["textos"]):
                    blocos.append(bloco_atual)
                    bloco_atual = {"textos": [txt], "tabela_passageiros": None}
                    continue
            bloco_atual["textos"].append(txt)
        elif tag == "tbl":
            t = Table(child, doc)
            eh_pax = False
            for row in t.rows[:2]:
                cell_texts = [_limpar_texto(c.text).lower() for c in row.cells]
                if any("passageiro" in c or "paciente" in c for c in cell_texts):
                    eh_pax = True
                    break

            if eh_pax:
                if bloco_atual["tabela_passageiros"] is not None:
                    blocos.append(bloco_atual)
                    bloco_atual = {"textos": [], "tabela_passageiros": t}
                else:
                    bloco_atual["tabela_passageiros"] = t
            else:
                for row in t.rows:
                    row_cells = [_limpar_texto(c.text) for c in row.cells]
                    # Linhas chave/valor (ex: Campo / Valor em ordem_circulacao.py)
                    if len(row_cells) >= 2 and row_cells[0] and row_cells[1]:
                        bloco_atual["textos"].append(f"{row_cells[0]}: {row_cells[1]}")
                    else:
                        row_txt = " | ".join(c for c in row_cells if c)
                        if row_txt:
                            bloco_atual["textos"].append(row_txt)

    if bloco_atual["textos"] or bloco_atual["tabela_passageiros"] is not None:
        blocos.append(bloco_atual)

    viagens: list[dict[str, Any]] = []
    for b in blocos:
        txt_full = "\n".join(b["textos"])
        destino = _extrair_campo("DESTINO", txt_full)
        veiculo = _extrair_campo(r"VE[IÍ]CULO", txt_full)
        placa = _extrair_campo("PLACA", txt_full)
        motorista = _extrair_campo(r"MOTORISTA(?:/FAVORECIDO)?", txt_full)
        departamento = _extrair_campo("DEPARTAMENTO", txt_full)

        data_saida_raw = _extrair_campo(r"Data\s+sa[ií]da", txt_full)
        hora_saida_raw = _extrair_campo(r"Hora\s+sa[ií]da", txt_full)
        data_ret_raw = _extrair_campo(r"Data\s+retorno", txt_full)
        hora_ret_raw = _extrair_campo(r"Hora\s+retorno", txt_full)

        km_ini = _extrair_campo(r"Km\s+inicial", txt_full)
        km_fim = _extrair_campo(r"Km\s+final", txt_full)
        adiant = _extrair_campo("Adiantamento", txt_full)

        passageiros: list[dict[str, Any]] = []
        t = b["tabela_passageiros"]
        if t:
            hdr_idx = 0
            headers = [_limpar_texto(c.text).lower() for c in t.rows[0].cells]
            if not any("passageiro" in h or "paciente" in h for h in headers) and len(t.rows) > 1:
                hdr_idx = 1
                headers = [_limpar_texto(c.text).lower() for c in t.rows[1].cells]

            col_nome = next((i for i, h in enumerate(headers) if "passageiro" in h or "paciente" in h or "nome" in h), 1)
            col_pront_ou_nasc = next((i for i, h in enumerate(headers) if "pront" in h or "nasc" in h), None)
            col_trat = next(
                (i for i, h in enumerate(headers) if "tratamento" in h or "procedimento" in h or "obs" in h), None
            )
            col_unid = next((i for i, h in enumerate(headers) if "unidade" in h or "hospital" in h or "local" in h), None)
            col_hora = next((i for i, h in enumerate(headers) if "hor" in h), None)
            col_cid = next((i for i, h in enumerate(headers) if "cidade" in h or "destino" in h), None)

            for row in t.rows[hdr_idx + 1:]:
                cells = row.cells
                if col_nome >= len(cells):
                    continue
                nome_bruto = _limpar_texto(cells[col_nome].text)
                if not nome_bruto or len(nome_bruto) < 3:
                    continue
                if "passageiro" in nome_bruto.lower() or "paciente" in nome_bruto.lower():
                    continue

                # Remove numeração inicial caso presente (ex: "01 - Carlos", "1. Maria")
                nome = re.sub(r"^[0-9]{1,3}\s*[-–.]*\s*", "", nome_bruto).strip()
                if not nome or len(nome) < 2:
                    continue

                col3_val = (
                    _limpar_texto(cells[col_pront_ou_nasc].text)
                    if col_pront_ou_nasc is not None and col_pront_ou_nasc < len(cells)
                    else ""
                )
                prontuario = ""
                nascimento = ""
                if col3_val:
                    if re.match(r"^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}$", col3_val):
                        nascimento = _parse_data(col3_val)
                    else:
                        prontuario = col3_val

                trat = _limpar_texto(cells[col_trat].text) if col_trat is not None and col_trat < len(cells) else ""
                unid = _limpar_texto(cells[col_unid].text) if col_unid is not None and col_unid < len(cells) else ""
                hora = (
                    _parse_hora(_limpar_texto(cells[col_hora].text))
                    if col_hora is not None and col_hora < len(cells)
                    else ""
                )
                cid = _limpar_texto(cells[col_cid].text) if col_cid is not None and col_cid < len(cells) else ""

                is_acomp = "acompanhante" in trat.lower() or "acomp" in trat.lower() or "acompanhante" in nome.lower()
                passageiros.append({
                    "nome": nome,
                    "prontuario": prontuario,
                    "nascimento": nascimento,
                    "tratamento": trat,
                    "unidade": unid,
                    "hora_consulta": hora,
                    "cidade": cid or destino,
                    "is_acompanhante": is_acomp,
                    "paciente_id": None,
                    "cadastrado": False,
                })

        if destino or data_saida_raw or passageiros:
            avisos: list[str] = []
            if not veiculo and not placa:
                avisos.append("Veículo/placa não informados no documento.")
            if not motorista:
                avisos.append("Motorista não informado no documento.")
            if not destino:
                avisos.append("Destino não identificado no documento.")
            if not data_saida_raw:
                avisos.append("Data de saída não identificada.")

            data_viagem_parsed = _parse_data(data_saida_raw)
            hora_saida_parsed = _parse_hora(hora_saida_raw) or "07:00"

            viagens.append({
                "destino": destino or "NÃO INFORMADO",
                "veiculo": veiculo,
                "placa": placa,
                "veiculo_id": None,
                "motorista": motorista,
                "motorista_id": None,
                "departamento": departamento or "Saúde",
                "data_viagem": data_viagem_parsed,
                "hora_saida": hora_saida_parsed,
                "data_retorno": _parse_data(data_ret_raw) or None,
                "hora_retorno": _parse_hora(hora_ret_raw) or "",
                "km_inicial": int(km_ini) if km_ini.isdigit() else 0,
                "km_final": int(km_fim) if km_fim.isdigit() else 0,
                "adiantamento": _parse_moeda(adiant),
                "observacoes": "Importado via Ordem de Circulação Word",
                "passageiros": passageiros,
                "avisos": avisos,
                "viagem_existente_id": None,
            })

    if not viagens:
        raise ValueError(
            "Nenhuma ordem de viagem ou relação de passageiros foi reconhecida no documento Word. "
            "Certifique-se de que o arquivo contém o cabeçalho 'ORDEM DE CIRCULAÇÃO' e a tabela 'RELAÇÃO DE PASSAGEIROS'."
        )

    return viagens


def enriquecer_preview_com_banco(db: Session, viagens: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Cruza os dados extraídos do Word com o banco (veículos, motoristas, viagens e pacientes existentes)."""
    todos_veiculos = list(db.exec(select(Veiculo).where(Veiculo.ativo == True)).all())  # noqa: E712
    todos_motoristas = list(db.exec(select(Motorista).where(Motorista.ativo == True)).all())  # noqa: E712

    for v in viagens:
        # Tentar casar veículo por placa
        if v["placa"]:
            placa_limpa = re.sub(r"[^A-Za-z0-9]", "", v["placa"]).upper()
            match_v = next(
                (veh for veh in todos_veiculos if re.sub(r"[^A-Za-z0-9]", "", veh.placa).upper() == placa_limpa),
                None,
            )
            if match_v:
                v["veiculo_id"] = match_v.id
                v["veiculo"] = f"{match_v.modelo} ({match_v.placa})"
        elif v["veiculo"]:
            v_norm = v["veiculo"].lower().strip()
            match_v = next((veh for veh in todos_veiculos if v_norm in veh.modelo.lower()), None)
            if match_v:
                v["veiculo_id"] = match_v.id

        # Tentar casar motorista por nome
        if v["motorista"]:
            m_norm = v["motorista"].lower().strip()
            match_m = next((mot for mot in todos_motoristas if m_norm in mot.nome.lower()), None)
            if match_m:
                v["motorista_id"] = match_m.id
                v["motorista"] = match_m.nome

        # Verificar se viagem já existe no mesmo dia, destino e horário
        if v["data_viagem"] and v["destino"]:
            try:
                dt_obj = date.fromisoformat(v["data_viagem"])
                v_exist = db.exec(
                    select(Viagem).where(
                        Viagem.data_viagem == dt_obj,
                        func.lower(Viagem.destino) == v["destino"].strip().lower(),
                        Viagem.hora_saida == v["hora_saida"],
                    )
                ).first()
                if v_exist:
                    v["viagem_existente_id"] = v_exist.id
                    v["avisos"].append(f"Viagem existente encontrada (ID #{v_exist.id}) — passageiros serão agregados.")
            except Exception:
                pass

        # Verificar pacientes existentes no sistema
        for p in v["passageiros"]:
            nome_p = p["nome"].strip().lower()
            pac = db.exec(select(Paciente).where(func.lower(Paciente.nome) == nome_p)).first()
            if not pac and p.get("prontuario"):
                pac = db.exec(select(Paciente).where(Paciente.codigo_prontuario == p["prontuario"].strip())).first()
            if pac:
                p["paciente_id"] = pac.id
                p["cadastrado"] = True
                if not p["prontuario"] and pac.codigo_prontuario:
                    p["prontuario"] = pac.codigo_prontuario
            else:
                p["paciente_id"] = None
                p["cadastrado"] = False

    return viagens


def executar_importacao_viagens(
    db: Session, viagens_data: list[dict[str, Any]], ator: User
) -> dict[str, Any]:
    """Persiste no banco as viagens e passageiros confirmados pelo usuário."""
    viagens_criadas = 0
    passageiros_vinculados = 0
    pacientes_cadastrados = 0
    detalhes: list[dict[str, Any]] = []

    for idx, v_dict in enumerate(viagens_data, 1):
        data_v_str = v_dict.get("data_viagem")
        if not data_v_str:
            raise ValueError(f"Viagem #{idx} sem data válida.")
        dt_viagem = date.fromisoformat(data_v_str)

    # Validação de regras e permissão de retroativo
        from app.api.v1.tfd import exige_permissao_viagem_passada

        exige_permissao_viagem_passada(ator, dt_viagem)

        destino = (v_dict.get("destino") or "NÃO INFORMADO").strip().upper()
        hora_saida = v_dict.get("hora_saida") or "07:00"

        # Reaproveita viagem existente ou cria nova
        viagem_id = v_dict.get("viagem_existente_id")
        viagem = db.get(Viagem, viagem_id) if viagem_id else None

        if not viagem:
            dt_retorno = None
            if v_dict.get("data_retorno"):
                try:
                    dt_retorno = date.fromisoformat(v_dict["data_retorno"])
                except Exception:
                    dt_retorno = None

            viagem = Viagem(
                destino=destino,
                unidade=v_dict.get("unidade") or "",
                data_viagem=dt_viagem,
                hora_saida=hora_saida,
                veiculo_id=v_dict.get("veiculo_id"),
                motorista=v_dict.get("motorista") or "",
                motorista_id=v_dict.get("motorista_id"),
                departamento=v_dict.get("departamento") or "Saúde",
                data_retorno=dt_retorno,
                hora_retorno=v_dict.get("hora_retorno") or "",
                km_inicial=int(v_dict.get("km_inicial") or 0),
                km_final=int(v_dict.get("km_final") or 0),
                adiantamento=float(v_dict.get("adiantamento") or 0.0),
                status="agendada",
                finalidade="consulta",
                observacoes=v_dict.get("observacoes") or "Importado via Ordem de Circulação Word",
                criado_por=ator.nome or ator.username,
            )
            db.add(viagem)
            db.flush()
            viagens_criadas += 1

        pax_adicionados_nesta = 0
        for p_dict in v_dict.get("passageiros", []):
            nome_p = p_dict.get("nome", "").strip()
            if not nome_p:
                continue

            # Buscar ou criar paciente
            paciente_id = p_dict.get("paciente_id")
            paciente = db.get(Paciente, paciente_id) if paciente_id else None

            if not paciente:
                paciente = db.exec(
                    select(Paciente).where(func.lower(Paciente.nome) == nome_p.lower())
                ).first()

            if not paciente and p_dict.get("prontuario"):
                paciente = db.exec(
                    select(Paciente).where(Paciente.codigo_prontuario == p_dict["prontuario"].strip())
                ).first()

            if not paciente:
                # Cria novo paciente
                dt_nasc = None
                if p_dict.get("nascimento"):
                    try:
                        dt_nasc = date.fromisoformat(p_dict["nascimento"])
                    except Exception:
                        dt_nasc = None

                paciente = Paciente(
                    nome=nome_p,
                    codigo_prontuario=p_dict.get("prontuario") or gerar_prontuario_aleatorio(db),
                    nascimento=dt_nasc,
                    municipio=p_dict.get("cidade") or "Guapé",
                    situacao_cadastral="ativo",
                    observacoes="Cadastrado automaticamente via importação Word TFD",
                )
                db.add(paciente)
                db.flush()
                pacientes_cadastrados += 1

            # Evita duplicidade de passageiro na mesma viagem
            dup_pax = db.exec(
                select(ViagemPaciente).where(
                    ViagemPaciente.viagem_id == viagem.id,
                    ViagemPaciente.paciente_id == paciente.id,
                )
            ).first()

            if not dup_pax:
                is_acomp = p_dict.get("is_acompanhante", False)
                tratamento = p_dict.get("tratamento") or ("Acompanhante" if is_acomp else "")
                vp = ViagemPaciente(
                    viagem_id=viagem.id,
                    paciente_id=paciente.id,
                    acompanhante="Sim" if is_acomp else "",
                    tratamento=tratamento,
                    unidade=p_dict.get("unidade") or "",
                    hora_consulta=p_dict.get("hora_consulta") or "",
                    observacoes="Importado via Word",
                    status_confirmacao="pendente",
                    token_confirmacao=secrets.token_urlsafe(24),
                    presente=True,
                )
                db.add(vp)
                passageiros_vinculados += 1
                pax_adicionados_nesta += 1

        detalhes.append({
            "viagem_id": viagem.id,
            "destino": viagem.destino,
            "data_viagem": viagem.data_viagem.isoformat(),
            "hora_saida": viagem.hora_saida,
            "passageiros_adicionados": pax_adicionados_nesta,
        })

    db.commit()

    return {
        "sucesso": True,
        "mensagem": f"Importação concluída: {viagens_criadas} viagem(ns) e {passageiros_vinculados} passageiro(s) registrados.",
        "viagens_criadas": viagens_criadas,
        "passageiros_vinculados": passageiros_vinculados,
        "pacientes_cadastrados": pacientes_cadastrados,
        "detalhes": detalhes,
    }
