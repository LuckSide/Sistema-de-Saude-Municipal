"""Preenche o modelo original "Viagens padrão.odt" com os dados da viagem.

O arquivo é usado como template binário: só textos de valor são
inseridos (preservando estilos/tabelas/bordas do modelo). Segunda página
só aparece se houver mais de 15 passageiros (linhas extras clonadas).
"""

import copy
import io
import os
import re
import zipfile
from xml.etree import ElementTree as ET

TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
TABLE = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"

for prefixo, uri in (
    ("office", OFFICE),
    ("style", "urn:oasis:names:tc:opendocument:xmlns:style:1.0"),
    ("text", TEXT),
    ("table", TABLE),
    ("draw", "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"),
    ("fo", "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"),
    ("xlink", "http://www.w3.org/1999/xlink"),
):
    ET.register_namespace(prefixo, uri)

MODELO = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "assets", "Viagens padrão.odt"))


def _texto_celula(cel) -> str:
    return "".join("".join(p.itertext()) for p in cel.findall(f"{{{TEXT}}}p"))


def _definir_celula(cel, texto: str) -> None:
    """Troca o conteúdo mantendo o estilo do 1º parágrafo da célula."""
    pars = cel.findall(f"{{{TEXT}}}p")
    if not pars:
        return
    alvo = pars[0]
    estilo = alvo.attrib.get(f"{{{TEXT}}}style-name", "")
    for filho in list(alvo):
        alvo.remove(filho)
    alvo.text = None
    span = ET.SubElement(alvo, f"{{{TEXT}}}span")
    if estilo:
        span.set(f"{{{TEXT}}}style-name", estilo)
    span.text = texto or ""


def _anexar_rotulo(cel, valor: str, estilo_span: str = "T3") -> None:
    """Acrescenta o valor ao rótulo (VEICULO:, PLACA:, ...) com o estilo do modelo."""
    pars = cel.findall(f"{{{TEXT}}}p")
    if not pars:
        return
    textos = list(pars[0].itertext())
    juntos = "".join(textos)
    if valor and juntos and not juntos.endswith(" "):
        marcador = ET.SubElement(pars[0], f"{{{TEXT}}}s")
        marcador.set(f"{{{TEXT}}}c", "1")
    span = ET.SubElement(pars[0], f"{{{TEXT}}}span")
    span.set(f"{{{TEXT}}}style-name", estilo_span)
    span.text = valor or ""


def _data_br(iso: str) -> str:
    s = (iso or "")[:10]
    return f"{s[8:10]}/{s[5:7]}/{s[0:4]}" if len(s) == 10 and s[4] == "-" else (iso or "")


def preencher_ordem(dados: dict, passageiros: list[dict]) -> bytes:
    with zipfile.ZipFile(MODELO) as zin:
        membros = {n: zin.read(n) for n in zin.namelist()}
    root = ET.fromstring(membros["content.xml"])
    corpo = root.find(f".//{{{OFFICE}}}body")
    T, R, C = f"{{{TABLE}}}table", f"{{{TABLE}}}table-row", f"{{{TABLE}}}table-cell"
    tabelas = corpo.findall(f".//{T}")

    def tabela_por_cabeca(marcador: str):
        for t in tabelas:
            for r in t.findall(R):
                txts = [_texto_celula(c) for c in r.findall(C)]
                if any(marcador in (x or "") for x in txts):
                    return t
        return None

    # tabela0: VEICULO / PLACA / DESTINO
    t0 = tabelas[0]
    cels0 = t0.findall(R)[0].findall(C)
    _anexar_rotulo(cels0[0], dados.get("veiculo", ""))
    _anexar_rotulo(cels0[1], dados.get("placa", ""))
    _anexar_rotulo(cels0[2], dados.get("destino", ""))

    # tabela1: MOTORISTA/FAVORECIDO / DEPARTAMENTO
    t1 = tabelas[1]
    cels1 = t1.findall(R)[0].findall(C)
    _anexar_rotulo(cels1[0], dados.get("motorista", ""))
    _anexar_rotulo(cels1[1], dados.get("departamento", ""))

    # tabela2: rótulo | valor (3 pares por linha)
    t2 = tabelas[2]
    pares = [
        ("Data saída", _data_br(dados.get("data_saida", ""))),
        ("Hora saída", dados.get("hora_saida", "")),
        ("Km inicial", dados.get("km_inicial", "")),
        ("Data retorno", _data_br(dados.get("data_retorno", ""))),
        ("Hora retorno", dados.get("hora_retorno", "")),
        ("Km final", dados.get("km_final", "")),
        ("Adiantamento", dados.get("adiantamento", "")),
        ("Horas viagem", dados.get("horas_viagem", "")),
        ("Km rodados", dados.get("km_rodados", "")),
    ]
    vals = [c for r in t2.findall(R) for c in r.findall(C)[1::2]]
    for cel, (_rot, valor) in zip(vals, pares):
        if valor:  # vazio mantém o padrão do modelo (ex: 06:00)
            _definir_celula(cel, valor)

    # tabela4: passageiros (cabeçalho N|Passageiro|Data nasc.|...)
    t4 = tabela_por_cabeca("Data nasc.")
    if t4 is not None:
        linhas = t4.findall(R)
        cabeca, dados_linhas = linhas[0], linhas[1:]
        nums = []
        for r in dados_linhas:
            cels = r.findall(C)
            if cels and re.fullmatch(r"\d{1,3}", _texto_celula(cels[0]).strip()):
                nums.append(r)
        for i in range(len(passageiros) - len(nums)):
            clone = copy.deepcopy(nums[-1])
            t4.append(clone)
            nums.append(clone)
        for i, r in enumerate(nums):
            cels = r.findall(C)
            _definir_celula(cels[0], f"{i + 1:02d}")
            if i < len(passageiros):
                ps = passageiros[i]
                nasc = (ps.get("paciente_nascimento") or "")[:10]
                nasc = f"{nasc[8:10]}/{nasc[5:7]}/{nasc[0:4]}" if len(nasc) == 10 and nasc[4] == "-" else ""
                for j, v in enumerate(
                    [ps.get("paciente_nome", ""), nasc, ps.get("tratamento", ""),
                     ps.get("unidade", ""), ps.get("hora_consulta", ""),
                     dados.get("destino", "")],
                    start=1,
                ):
                    if j < len(cels):
                        _definir_celula(cels[j], v)
            else:
                for j in range(1, len(cels)):
                    _definir_celula(cels[j], "")

    membros["content.xml"] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zout:
        # mimetype primeiro e sem compressão (exigência ODF)
        zout.writestr("mimetype", membros.pop("mimetype"), compress_type=zipfile.ZIP_STORED)
        for nome, conteudo in membros.items():
            zout.writestr(nome, conteudo, compress_type=zipfile.ZIP_DEFLATED)
    return buf.getvalue()
