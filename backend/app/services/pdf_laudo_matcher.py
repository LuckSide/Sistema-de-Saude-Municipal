"""Motor de Processamento de PDF e Match Automatizado de Laudos Laboratoriais.

Subagente 1: Engenharia de Extração de PDF e Cruzamento Clínico.
Implementa:
- Extração de texto de PDFs via Poppler pdftotext (com fallbacks);
- Match determinístico e probabilístico dos dados do paciente (CPF, CNS, Nome);
- Conferência cruzada entre exames solicitados no pedido e termos técnicos no laudo;
- Detecção de exames faltantes e exames adicionais/particulares misturados.
"""

from __future__ import annotations

import logging
import re
import subprocess
import unicodedata
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from app.models.lab_exames import SigtapProcedimento
    from app.models.lab_fase6 import ItemSolic
    from app.models.tfd import Paciente

logger = logging.getLogger("pdf_laudo_matcher")


# ==============================================================================
# 1. EXTRAÇÃO DE TEXTO DO PDF
# ==============================================================================

def extrair_texto_pdf(pdf_bytes: bytes) -> str:
    """Extrai o conteúdo textual de um binário PDF com fallback transparente."""
    if not pdf_bytes:
        return ""

    # Estratégia Primária: pdftotext nativo do sistema (rápido, preserva layout e UTF-8)
    try:
        proc = subprocess.run(
            ["pdftotext", "-layout", "-enc", "UTF-8", "-", "-"],
            input=pdf_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=12,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout:
            texto = proc.stdout.decode("utf-8", errors="replace").strip()
            if len(texto) > 20:
                logger.debug("Texto extraído com sucesso via pdftotext (%d caracteres).", len(texto))
                return texto
    except Exception as e:
        logger.warning("Falha ao invocar pdftotext: %s. Tentando fallback...", e)

    # Estratégia Secundária: pypdf (caso esteja instalado)
    try:
        import io
        import pypdf

        leitor = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        paginas = [p.extract_text() or "" for p in leitor.pages]
        texto = "\n".join(paginas).strip()
        if len(texto) > 20:
            return texto
    except ImportError:
        pass
    except Exception as e:
        logger.warning("Falha no fallback pypdf: %s", e)

    # Estratégia Terciária: Parser simples de streams PDF em Python puro
    try:
        import zlib

        texto_blocos = []
        # Encontra blocos de stream descompactados
        for m in re.finditer(rb"stream[\r\n]+(.*?)[\r\n]+endstream", pdf_bytes, re.DOTALL):
            stream_data = m.group(1)
            try:
                decomp = zlib.decompress(stream_data)
                # Extrai texto dentro de operadores Tj e TJ
                strings = re.findall(rb"\((.*?)\)\s*Tj", decomp)
                for s in strings:
                    texto_blocos.append(s.decode("latin1", errors="ignore"))
            except Exception:
                continue
        texto = "\n".join(texto_blocos).strip()
        if len(texto) > 10:
            return texto
    except Exception as e:
        logger.warning("Falha no parser interno de stream: %s", e)

    return ""


def normalizar_texto(texto: str) -> str:
    """Remove acentuações, caracteres de controle e padroniza para maiúsculas."""
    if not texto:
        return ""
    nfkd = unicodedata.normalize("NFKD", texto)
    sem_acento = "".join(c for c in nfkd if not unicodedata.combining(c))
    sem_pontuacao = re.sub(r"[^\w\s\-\.\/]", " ", sem_acento)
    return re.sub(r"\s+", " ", sem_pontuacao).strip().upper()


# ==============================================================================
# 2. MATCH DO PACIENTE (CPF, CNS, NOME)
# ==============================================================================

def verificar_match_paciente(texto_pdf: str, paciente: Paciente) -> tuple[bool, str, dict[str, Any]]:
    """Verifica se o laudo pertence ao paciente informado por CPF, CNS ou Nome Completo.
    
    Retorna:
    - match_ok (bool): True se confirmado pertencer ao paciente.
    - criterio (str): Explicação do critério que validou o match.
    - dados_encontrados (dict): Detalhes dos identificadores localizados no PDF.
    """
    texto_norm = normalizar_texto(texto_pdf)
    somente_numeros_pdf = "".join(c for c in texto_pdf if c.isdigit())

    dados_encontrados: dict[str, Any] = {
        "cpf_encontrado": False,
        "cns_encontrado": False,
        "nome_score": 0.0,
    }

    # 1. Match de CPF
    cpf_limpo = re.sub(r"\D", "", paciente.cpf or "")
    if len(cpf_limpo) == 11:
        cpf_fmt = f"{cpf_limpo[:3]}.{cpf_limpo[3:6]}.{cpf_limpo[6:9]}-{cpf_limpo[9:]}"
        cpf_semi = f"{cpf_limpo[:3]}{cpf_limpo[3:6]}{cpf_limpo[6:9]}-{cpf_limpo[9:]}"
        if (
            cpf_limpo in somente_numeros_pdf
            or cpf_fmt in texto_pdf
            or cpf_semi in texto_pdf
            or cpf_limpo in texto_pdf
        ):
            dados_encontrados["cpf_encontrado"] = True
            dados_encontrados["cpf_valor"] = cpf_fmt
            return True, f"Identificação biométrica/cadastral confirmada via CPF ({cpf_fmt})", dados_encontrados

    # 2. Match de CNS (Cartão SUS - 15 dígitos)
    cns_limpo = re.sub(r"\D", "", paciente.cns or "")
    if len(cns_limpo) == 15 and cns_limpo in somente_numeros_pdf:
        dados_encontrados["cns_encontrado"] = True
        dados_encontrados["cns_valor"] = cns_limpo
        return True, f"Identificação confirmada via Cartão Nacional de Saúde / CNS ({cns_limpo})", dados_encontrados

    # 3. Match de Nome Completo
    nome_pac_norm = normalizar_texto(paciente.nome or "")
    if nome_pac_norm and len(nome_pac_norm) >= 4:
        if nome_pac_norm in texto_norm:
            dados_encontrados["nome_score"] = 100.0
            dados_encontrados["nome_encontrado"] = paciente.nome
            return True, f"Nome completo do paciente localizado no cabeçalho do laudo ({paciente.nome})", dados_encontrados

        # Match aproximado por tokens do nome (elimina preposições comuns)
        stop_words = {"DE", "DA", "DO", "DOS", "DAS", "E"}
        tokens_paciente = [t for t in nome_pac_norm.split() if t not in stop_words and len(t) > 1]
        if tokens_paciente:
            tokens_achados = sum(1 for t in tokens_paciente if t in texto_norm)
            score = (tokens_achados / len(tokens_paciente)) * 100.0
            dados_encontrados["nome_score"] = round(score, 1)

            # Primeiro e último nome devem obrigatoriamente estar presentes + score >= 75%
            primeiro_nome = tokens_paciente[0]
            ultimo_nome = tokens_paciente[-1]
            if primeiro_nome in texto_norm and ultimo_nome in texto_norm and score >= 75.0:
                dados_encontrados["nome_encontrado"] = f"{primeiro_nome} ... {ultimo_nome}"
                return (
                    True,
                    f"Identificação por tokens nominais confirmada ({primeiro_nome} {ultimo_nome} - {score:.0f}% de correspondência)",
                    dados_encontrados,
                )

    return False, "Dados do paciente (CPF, CNS ou Nome) NÃO foram identificados no arquivo enviado", dados_encontrados


# ==============================================================================
# 3. CONFERÊNCIA DE EXAMES (SOLICITADOS VS LAUDO)
# ==============================================================================

# Dicionário de sinônimos e palavras-chave clínicas para exames laboratoriais frequentes
SINONIMOS_EXAMES_LAB: dict[str, list[str]] = {
    # Hematologia
    "HEMOGRAMA": ["HEMOGRAMA", "ERITROGRAMA", "LEUCOGRAMA", "PLAQUETAS", "GLOBULOS VERMELHOS", "GLOBULOS BRANCOS", "SERIE VERMELHA", "SERIE BRANCA"],
    "PLAQUETAS": ["PLAQUETAS", "CONTAGEM DE PLAQUETAS", "TROMBOCITOS"],
    "VHS": ["VHS", "VELOCIDADE DE HEMOSSEDIMENTACAO", "VELOCIDADE DE SEDIMENTACAO"],
    "COAGULOGRAMA": ["COAGULOGRAMA", "TEMPO DE PROTROMBINA", "TAP", "TTPA", "INR", "TEMPO DE TROMBOPLASTINA"],
    "GRUPO SANGUINEO": ["GRUPO SANGUINEO", "FATOR RH", "TIPAGEM SANGUINEA", "ABO"],

    # Bioquímica Básica
    "GLICOSE": ["GLICOSE", "GLICEMIA", "GLICOSE DE JEJUM", "GLICEMIA DE JEJUM", "GLICOSE BASAL", "DOSAGEM DE GLICOSE"],
    "HEMOGLOBINA GLICADA": ["HEMOGLOBINA GLICADA", "HB A1C", "HBA1C", "GLICO-HEMOGLOBINA", "A1C"],
    "UREIA": ["UREIA", "DOSAGEM DE UREIA", "UREIA SERICA"],
    "CREATININA": ["CREATININA", "DOSAGEM DE CREATININA", "CREATININA SERICA", "CLEARANCE DE CREATININA"],
    "ACIDO URICO": ["ACIDO URICO", "URICEMIA", "DOSAGEM DE ACIDO URICO"],
    "COLESTEROL TOTAL": ["COLESTEROL TOTAL", "COLESTEROL - TOTAL", "DOSAGEM DE COLESTEROL TOTAL"],
    "COLESTEROL HDL": ["HDL", "COLESTEROL HDL", "HDL COLESTEROL", "LIPOPROTEINA DE ALTA DENSIDADE"],
    "COLESTEROL LDL": ["LDL", "COLESTEROL LDL", "LDL COLESTEROL", "LIPOPROTEINA DE BAIXA DENSIDADE"],
    "TRIGLICERIDEOS": ["TRIGLICERIDEOS", "TRIGLICERIDES", "TRIGLICERIDIOS", "DOSAGEM DE TRIGLICERIDEOS"],
    "LIPIDOGRAMA": ["LIPIDOGRAMA", "PERFIL LIPIDICO", "COLESTEROL TOTAL", "TRIGLICERIDEOS", "HDL", "LDL"],

    # Hepático / Enzimas
    "TGO": ["TGO", "AST", "TRANSAMINASE GLUTAMICO OXALACETICA", "ASPARTATO AMINOTRANSFERASE"],
    "TGP": ["TGP", "ALT", "TRANSAMINASE GLUTAMICO PIRUVICA", "ALANINA AMINOTRANSFERASE"],
    "GAMA GT": ["GAMA GT", "GGT", "GAMA-GLUTAMILTRANSFERASE", "GAMA GLUTAMIL"],
    "FOSFATASE ALCALINA": ["FOSFATASE ALCALINA", "FA"],
    "BILIRRUBINAS": ["BILIRRUBINAS", "BILIRRUBINA TOTAL", "BILIRRUBINA DIRETA", "BILIRRUBINA INDIRETA"],

    # Urina e Fezes
    "URINA": ["URINA", "EAS", "URINA TIPO 1", "URINA I", "SUMARIO DE URINA", "ELEMENTOS ANORMAIS", "SEDIMENTOSCOPIA"],
    "UROCULTURA": ["UROCULTURA", "CULTURA DE URINA", "ANTIBIOGRAMA"],
    "PARASITOLOGICO": ["PARASITOLOGICO", "EPF", "EXAME PARASITOLOGICO DE FEZES", "PESQUISA DE PARASITAS"],
    "SANGUE OCULTO": ["SANGUE OCULTO", "PESQUISA DE SANGUE OCULTO"],

    # Hormônios e Imunologia
    "TSH": ["TSH", "HORMONIO TIREOESTIMULANTE", "TIREOTROFINA", "TIREOTROPINA"],
    "T4 LIVRE": ["T4 LIVRE", "TIROXINA LIVRE"],
    "PSA": ["PSA", "ANTIGENO PROSTATICO ESPECIFICO", "PSA TOTAL", "PSA LIVRE"],
    "VITAMINA D": ["VITAMINA D", "25-HIDROXIVITAMINA D", "25 OH VITAMINA D", "CALCIDIOL"],
    "VITAMINA B12": ["VITAMINA B12", "CIANOCOBALAMINA", "COBALAMINA"],
    "FERRITINA": ["FERRITINA", "FERRITINA SERICA"],
    "FERRO SERICO": ["FERRO SERICO", "DOSAGEM DE FERRO"],
    "SOROLOGIA": ["SOROLOGIA", "HIV", "VDRL", "SIFILIS", "HEPATITE B", "HEPATITE C", "HBSAG", "ANTI-HCV", "TOXOPLASMOSE"],
}

# Lista de exames de rastreio de adição/particular não solicitados
CATALOGO_EXAMES_RASTREIO: dict[str, str] = {
    "VITAMINA D": "DOSAGEM DE VITAMINA D / 25-OH",
    "VITAMINA B12": "DOSAGEM DE VITAMINA B12",
    "FERRITINA": "DOSAGEM DE FERRITINA",
    "PSA": "DOSAGEM DE ANTÍGENO PROSTÁTICO ESPECÍFICO (PSA)",
    "HEMOGLOBINA GLICADA": "DOSAGEM DE HEMOGLOBINA GLICADA (HBA1C)",
    "ACIDO URICO": "DOSAGEM DE ÁCIDO ÚRICO",
    "TGO": "TRANSAMINASE TGO / AST",
    "TGP": "TRANSAMINASE TGP / ALT",
    "GAMA GT": "GAMA GLUTAMILTRANSFERASE (GGT)",
    "TSH": "DOSAGEM DE TSH",
    "T4 LIVRE": "DOSAGEM DE T4 LIVRE",
    "COAGULOGRAMA": "COAGULOGRAMA COMPLETO",
    "HIV": "SOROLOGIA HIV",
    "VDRL": "TESTE NÃO TREPONÊMICO VDRL",
}


def _encontrar_sinonimos_para_descricao(descricao: str) -> list[str]:
    desc_norm = normalizar_texto(descricao)
    termos = [desc_norm]

    # Quebra palavras principais
    for chave, variantes in SINONIMOS_EXAMES_LAB.items():
        if chave in desc_norm:
            termos.extend(variantes)

    # Limpeza de prefixos "DOSAGEM DE", "DETERMINACAO DE", etc.
    limpo = re.sub(r"^(DOSAGEM DE|DETERMINACAO DE|PESQUISA DE|TESTE DE|EXAME DE)\s+", "", desc_norm)
    if limpo and limpo != desc_norm:
        termos.append(limpo)

    return list(dict.fromkeys(termos))


def verificar_procedimentos_laudo(
    texto_pdf: str,
    itens_solicitados: list[Any],
    procs_map: dict[int, Any],
) -> dict[str, Any]:
    """Cruza os exames do pedido com os procedimentos contidos no corpo do laudo."""
    texto_norm = normalizar_texto(texto_pdf)

    exames_solicitados_match: list[dict[str, Any]] = []
    exames_encontrados: list[str] = []
    exames_faltantes: list[str] = []
    chaves_solicitadas_detectadas: set[str] = set()

    for item in itens_solicitados:
        proc = procs_map.get(item.sigtap_id)
        desc = proc.descricao if proc else f"Procedimento #{item.sigtap_id}"
        cod = proc.codigo if proc else ""

        candidatos = _encontrar_sinonimos_para_descricao(desc)
        encontrado = False
        termo_achado = None

        for c in candidatos:
            # Procura o termo como palavra/frase delimitada
            padrao = r"\b" + re.escape(c) + r"\b"
            if re.search(padrao, texto_norm):
                encontrado = True
                termo_achado = c
                break

        # Tenta também pelo código SIGTAP explícito (ex: 02.02.01.012-0 ou 0202010120)
        if not encontrado and cod:
            cod_limpo = re.sub(r"\D", "", cod)
            if cod_limpo and cod_limpo in texto_norm:
                encontrado = True
                termo_achado = cod

        if encontrado:
            exames_encontrados.append(desc)
            # Guarda chaves conhecidas para não marcar falsos exames adicionais
            for chave in SINONIMOS_EXAMES_LAB:
                if chave in normalizar_texto(desc):
                    chaves_solicitadas_detectadas.add(chave)
        else:
            exames_faltantes.append(desc)

        exames_solicitados_match.append({
            "codigo": cod,
            "descricao": desc,
            "encontrado": encontrado,
            "termo_identificado": termo_achado,
        })

    # Detecção de exames adicionais / procedimentos particulares misturados
    exames_adicionais: list[str] = []
    for chave, rotulo in CATALOGO_EXAMES_RASTREIO.items():
        if chave in chaves_solicitadas_detectadas:
            continue
        # Se nenhuma variante do exame foi solicitada, mas aparece no PDF como título de exame
        variantes = SINONIMOS_EXAMES_LAB.get(chave, [chave])
        presente_no_laudo = False
        for v in variantes:
            padrao = r"\b" + re.escape(v) + r"\b"
            # Exige que apareça associado a palavras típicas de resultado (ex: resultado, valor de referencia, metodo)
            if re.search(padrao, texto_norm):
                # Checagem de contexto para evitar falso positivo em notas de rodapé
                idx = texto_norm.find(v)
                contexto = texto_norm[max(0, idx - 50) : min(len(texto_norm), idx + 250)]
                if any(ind in contexto for ind in ["RESULTADO", "VALOR DE REFERENCIA", "METODO", "VR:", "CONCENTRACAO"]):
                    presente_no_laudo = True
                    break

        if presente_no_laudo:
            exames_adicionais.append(rotulo)

    total_solic = len(itens_solicitados)
    total_enc = len(exames_encontrados)
    score = (total_enc / total_solic * 100.0) if total_solic > 0 else 0.0

    return {
        "exames_solicitados_match": exames_solicitados_match,
        "exames_encontrados": exames_encontrados,
        "exames_faltantes": exames_faltantes,
        "exames_adicionais": exames_adicionais,
        "total_solicitados": total_solic,
        "total_encontrados": total_enc,
        "total_faltantes": len(exames_faltantes),
        "total_adicionais": len(exames_adicionais),
        "score_confianca": round(score, 1),
    }


def executar_conferencia_completa(
    pdf_bytes: bytes,
    paciente: Any,
    itens_solicitados: list[Any],
    procs_map: dict[int, Any],
) -> dict[str, Any]:
    """Executa a esteira completa: extração, match do paciente e cruzamento de exames."""
    texto_pdf = extrair_texto_pdf(pdf_bytes)

    if not texto_pdf or len(texto_pdf.strip()) < 15:
        return {
            "texto_extraido": "",
            "match_paciente_ok": False,
            "paciente_criterio_match": "Arquivo PDF ilegível, escaneado como imagem pura sem OCR ou corrompido.",
            "dados_paciente_encontrados": {},
            "exames_solicitados_match": [],
            "exames_encontrados": [],
            "exames_faltantes": [procs_map.get(i.sigtap_id).descricao for i in itens_solicitados if procs_map.get(i.sigtap_id)],
            "exames_adicionais": [],
            "total_solicitados": len(itens_solicitados),
            "total_encontrados": 0,
            "total_faltantes": len(itens_solicitados),
            "total_adicionais": 0,
            "score_confianca": 0.0,
            "status_conferencia": "inconsistente",
            "conferencia_limpa": False,
            "requer_justificativa": True,
            "mensagem": "O PDF enviado não contém texto digitalizável. Verifique o arquivo do laudo.",
        }

    match_paciente, criterio_pac, dados_pac = verificar_match_paciente(texto_pdf, paciente)
    conf_exames = verificar_procedimentos_laudo(texto_pdf, itens_solicitados, procs_map)

    faltantes = conf_exames["exames_faltantes"]
    adicionais = conf_exames["exames_adicionais"]

    # Critério de Aprovação Automática Limpa:
    # 1. Match do paciente confirmado (CPF, CNS ou Nome)
    # 2. Nenhum exame faltante (todos os solicitados presentes)
    # 3. Nenhum exame adicional/particular misturado detectado
    conferencia_limpa = bool(match_paciente and len(faltantes) == 0 and len(adicionais) == 0)

    if conferencia_limpa:
        status_conf = "aprovado_automatico"
        mensagem = "Conferência 100% aprovada: paciente e todos os exames conferidos com sucesso no PDF."
    elif not match_paciente:
        status_conf = "inconsistente"
        mensagem = "Divergência Crítica de Paciente: O laudo anexado não aparenta pertencer ao cidadão informado."
    else:
        status_conf = "inconsistente"
        partes = []
        if faltantes:
            partes.append(f"{len(faltantes)} exame(s) faltante(s)")
        if adicionais:
            partes.append(f"{len(adicionais)} exame(s) adicional(is) não previsto(s)")
        mensagem = f"Inconsistências identificadas no laudo: {', '.join(partes)}. Justificativa técnica obrigatória."

    return {
        "texto_extraido": texto_pdf,
        "match_paciente_ok": match_paciente,
        "paciente_criterio_match": criterio_pac,
        "dados_paciente_encontrados": dados_pac,
        "exames_solicitados_match": conf_exames["exames_solicitados_match"],
        "exames_encontrados": conf_exames["exames_encontrados"],
        "exames_faltantes": faltantes,
        "exames_adicionais": adicionais,
        "total_solicitados": conf_exames["total_solicitados"],
        "total_encontrados": conf_exames["total_encontrados"],
        "total_faltantes": len(faltantes),
        "total_adicionais": len(adicionais),
        "score_confianca": conf_exames["score_confianca"],
        "status_conferencia": status_conf,
        "conferencia_limpa": conferencia_limpa,
        "requer_justificativa": not conferencia_limpa,
        "mensagem": mensagem,
    }
