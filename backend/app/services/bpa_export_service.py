"""Serviço de Exportação Oficial do Boletim de Produção Ambulatorial (BPA/SIA-SUS).

Gera arquivo binário posicional oficial (.OUT) e CSV de conferência,
unificando a produção ambulatorial do município de Guapé (MG):
- Produções Ambulatoriais Clínicas (BPA-C e BPA-I)
- Exames Laboratoriais (BPA-C e BPA-I)
- Viagens e Deslocamentos de Carro / TFD (Grupo 08: 0803010125 e 0803010109)

Padrão DATASUS / SIA-SUS:
- Header 01: exatamente 130 caracteres (+ CRLF)
- Registro 02 (BPA-C: Consolidado): exatamente 48 caracteres (+ CRLF)
- Registro 03 (BPA-I: Individualizado): exatamente 351 caracteres (+ CRLF)
- Codificação: ISO-8859-1 (latin-1) com quebras de linha CRLF (\r\n)
- Algoritmo de controle do Header: ((sum(procs) + sum(qtds)) % 1111) + 1111
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
from calendar import monthrange
from datetime import date, datetime
from typing import Any

from sqlmodel import Session, select

from app.models.cadastros_saude import EquipeSaude, Medico, UnidadeSaude
from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import ItemSolic, SolicitacaoMestre
from app.models.producao_ambulatorial import ProducaoAmbulatorial
from app.models.settings import SystemSettings
from app.models.tfd import Paciente, Viagem, ViagemPaciente
from app.services.cnes_criticas_service import auditar_criticas_bpa_competencia

# CNES e dados institucionais oficiais de Guapé / SMS
CNES_SMS_PADRAO = "2146479"
CNES_TFD_PADRAO = "2147092"
IBGE_GUAPE = "312810"
CNPJ_SMS_GUAPE = "18239616000185"
NOME_SMS_GUAPE = "SMS GUAPE"
NOME_DESTINO_PADRAO = "SECRETARIA MUNICIPAL DE SAUDE"
CNS_PROFISSIONAL_TFD_PADRAO = "703403201915616"
CBO_PROFISSIONAL_TFD_PADRAO = "225142"  # Médico Clínico / Regulador TFD
CNS_PROFISSIONAL_LAB_PADRAO = "700508575563459"
CBO_PROFISSIONAL_LAB_PADRAO = "223415"  # Farmacêutico-Bioquímico

# Mapeamento preventivo de códigos municipais legados (ex: Vivver) com equivalência exata no SIGTAP oficial
MAPEAMENTO_PROCEDIMENTOS_LEGADOS: dict[str, str] = {
    "9999900270": "0202010473",  # DOSAGEM DE GLICOSE POS PRANDIAL -> DOSAGEM DE GLICOSE (02.02.01.047-3)
    "9999900230": "0202060217",  # HCG QUANTITATIVO -> DOSAGEM DE GONADOTROFINA CORIONICA HUMANA (02.02.06.021-7)
    "9999900217": "0202031411",  # TESTE FTA-ABS IGG -> TESTE FTA-ABS TOTAL PARA DIAGNOSTICO DA SIFILIS (02.02.03.141-1)
    "9999900216": "0202031411",  # TESTE FTA-ABS IGM -> TESTE FTA-ABS TOTAL PARA DIAGNOSTICO DA SIFILIS (02.02.03.141-1)
}


def _carregar_parametros_institucionais_bpa(db: Session) -> dict[str, str]:
    """Carrega os parâmetros institucionais do município/gestor salvos em Configurações Gerais."""
    s = db.exec(select(SystemSettings).where(SystemSettings.id == 1)).first()
    if not s:
        return {
            "cidade": "Guapé",
            "uf": "MG",
            "ibge": IBGE_GUAPE,
            "cep_padrao": "37177000",
            "cnpj": CNPJ_SMS_GUAPE,
            "nome_orgao": NOME_SMS_GUAPE,
            "sigla_orgao": IBGE_GUAPE,
            "nome_destino": NOME_DESTINO_PADRAO,
            "tipo_destino": "M",
            "cnes_sms": CNES_SMS_PADRAO,
            "cnes_tfd": CNES_TFD_PADRAO,
            "cns_tfd": CNS_PROFISSIONAL_TFD_PADRAO,
            "cbo_tfd": CBO_PROFISSIONAL_TFD_PADRAO,
            "cns_lab": CNS_PROFISSIONAL_LAB_PADRAO,
            "cbo_lab": CBO_PROFISSIONAL_LAB_PADRAO,
        }
    ibge_val = limpar_numeros(getattr(s, "codigo_ibge", None)) or IBGE_GUAPE
    return {
        "cidade": getattr(s, "cidade", None) or "Guapé",
        "uf": getattr(s, "uf", None) or "MG",
        "ibge": ibge_val,
        "cep_padrao": limpar_numeros(getattr(s, "cep_padrao", None)) or "37177000",
        "cnpj": limpar_numeros(getattr(s, "cnpj_orgao_gestor", None)) or CNPJ_SMS_GUAPE,
        "nome_orgao": getattr(s, "nome_orgao_gestor", None) or NOME_SMS_GUAPE,
        "sigla_orgao": (getattr(s, "sigla_orgao_gestor", None) or ibge_val)[:6],
        "nome_destino": getattr(s, "nome_orgao_destino", None) or NOME_DESTINO_PADRAO,
        "tipo_destino": getattr(s, "tipo_orgao_destino", None) or "M",
        "cnes_sms": limpar_numeros(getattr(s, "cnes_sms_padrao", None)) or CNES_SMS_PADRAO,
        "cnes_tfd": limpar_numeros(getattr(s, "cnes_tfd_padrao", None)) or CNES_TFD_PADRAO,
        "cns_tfd": limpar_numeros(getattr(s, "cns_responsavel_tfd", None)) or CNS_PROFISSIONAL_TFD_PADRAO,
        "cbo_tfd": limpar_numeros(getattr(s, "cbo_responsavel_tfd", None)) or CBO_PROFISSIONAL_TFD_PADRAO,
        "cns_lab": limpar_numeros(getattr(s, "cns_responsavel_lab", None)) or CNS_PROFISSIONAL_LAB_PADRAO,
        "cbo_lab": limpar_numeros(getattr(s, "cbo_responsavel_lab", None)) or CBO_PROFISSIONAL_LAB_PADRAO,
    }

# Tabela de frações de 50km por destino TFD (conforme portarias do SUS e sistema legado de Guapé)
DESTINOS_TFD_QTD = {
    "ALFENAS": 6,
    "PASSOS": 6,
    "POÇOS DE CALDAS": 10,
    "POCOS DE CALDAS": 10,
    "SÃO SEBASTIÃO DO PARAÍSO": 8,
    "SAO SEBASTIAO DO PARAISO": 8,
    "BELO HORIZONTE": 12,
    "BAURU": 20,
    "SÃO PAULO": 18,
    "SAO PAULO": 18,
    "RIBEIRÃO PRETO": 13,
    "RIBEIRAO PRETO": 13,
    "PIUMHI": 2,
    "VARGINHA": 6,
    "CAMPINAS": 17,
    "PIMENTA": 1,
    "TRÊS PONTAS": 2,
    "TRES PONTAS": 2,
    "SOROCABA": 9,
    "ILICÍNEA": 1,
    "ILICINEA": 1,
    "CAMPO BELO": 2,
    "NEPOMUCENO": 2,
    "CÁSSIA": 3,
    "CASSIA": 3,
    "CARMO DO RIO CLARO": 1,
    "POÇO FUNDO": 4,
    "POCO FUNDO": 4,
    "MUZAMBINHO": 4,
    "CONCEIÇÃO DA APARECIDA": 2,
    "CONCEICAO DA APARECIDA": 2,
    "UBERLÂNDIA": 8,
    "UBERLANDIA": 8,
    "SERRANA": 6,
    "LAVRAS": 4,
    "DIVINÓPOLIS": 7,
    "DIVINOPOLIS": 7,
    "AREADO": 5,
    "CABO VERDE": 8,
    "DORESÓPOLIS": 4,
    "DORESOPOLIS": 4,
    "PARAGUAÇU": 7,
    "PARAGUACU": 7,
    "BARRETOS": 15,
}


def remover_acentos(texto: str | None) -> str:
    """Converte texto para maiúsculas e remove caracteres acentuados ou especiais."""
    if not texto:
        return ""
    texto_nfkd = unicodedata.normalize("NFKD", str(texto).upper())
    sem_acento = "".join([c for c in texto_nfkd if not unicodedata.combining(c)])
    sem_acento = re.sub(r"[\r\n\t]+", " ", sem_acento)
    return "".join(c if (32 <= ord(c) <= 126) else " " for c in sem_acento).strip()


def limpar_numeros(valor: str | None) -> str:
    """Extrai somente algarismos de uma string (CPF, CNS, CEP, Telefone)."""
    if not valor:
        return ""
    return re.sub(r"\D", "", str(valor))


def calcular_idade_em_anos(data_nascimento: date | None, data_referencia: date | None) -> int:
    """Calcula a idade em anos completos na data de referência."""
    if not data_nascimento:
        return 0
    ref = data_referencia or date.today()
    anos = ref.year - data_nascimento.year
    if (ref.month, ref.day) < (data_nascimento.month, data_nascimento.day):
        anos -= 1
    return max(0, min(anos, 999))


def eh_paciente_teste(paciente: Paciente | None) -> bool:
    """Detecta se o paciente é um registro de teste que deve ser excluído da exportação oficial."""
    if not paciente:
        return False
    if getattr(paciente, "eh_teste", False):
        return True
    nome = (paciente.nome or "").strip().lower()
    if "teste" in nome or "testes" in nome or nome.startswith("paciente teste"):
        return True
    cpf = limpar_numeros(paciente.cpf)
    if cpf in ("00000000000", "11111111111", "12345678909"):
        return True
    return False


def obter_quantidade_deslocamento(destino_nome: str | None) -> int:
    """Retorna a quantidade de frações de 50km para o destino TFD."""
    if not destino_nome:
        return 6
    nome_norm = remover_acentos(destino_nome)
    for d_chave, qtd in DESTINOS_TFD_QTD.items():
        if remover_acentos(d_chave) in nome_norm or nome_norm in remover_acentos(d_chave):
            return qtd
    return 6


def formatar_header_01(
    competencia_aaaamm: str,
    total_linhas_arquivo: int,
    total_folhas_arquivo: int,
    controle_verificador: int,
    cnes_sms: str = CNES_SMS_PADRAO,
    ibge: str = IBGE_GUAPE,
    cnpj: str = CNPJ_SMS_GUAPE,
    nome_sms: str = NOME_SMS_GUAPE,
    destino: str = NOME_DESTINO_PADRAO,
    tipo_prestador: str = "M",
) -> str:
    """Gera a linha 01 (Header) com exatamente 130 caracteres."""
    parte_fixa = f"01#BPA#{competencia_aaaamm[:6]}"
    linhas_str = f"{total_linhas_arquivo:06d}"
    folhas_str = f"{total_folhas_arquivo:06d}"
    controle_str = f"{controle_verificador:04d}"
    nome_sms_str = remover_acentos(nome_sms)[:30].ljust(30)
    ibge_str = ibge[:6].rjust(6, "0")
    cnpj_str = limpar_numeros(cnpj)[:14].rjust(14, "0")
    destino_str = remover_acentos(destino)[:40].ljust(40)
    tipo_str = (tipo_prestador or "M")[:1].upper()
    reservado = " " * 10

    linha = (
        f"{parte_fixa}"
        f"{linhas_str}"
        f"{folhas_str}"
        f"{controle_str}"
        f"{nome_sms_str}"
        f"{ibge_str}"
        f"{cnpj_str}"
        f"{destino_str}"
        f"{tipo_str}"
        f"{reservado}"
    )
    if len(linha) != 130:
        raise ValueError(f"Header BPA inválido: esperava 130 caracteres, obteve {len(linha)}")
    return linha


def formatar_registro_02(
    cnes: str,
    competencia_aaaamm: str,
    cbo: str,
    folha: int,
    linha_num: int,
    procedimento: str,
    quantidade: int,
    idade: int = 0,
    origem: str = "BPA",
) -> str:
    """Gera o registro 02 (BPA-C: Consolidado) com exatamente 48 caracteres."""
    ident = "02"
    cnes_str = limpar_numeros(cnes)[:7].rjust(7, "0")
    comp_str = competencia_aaaamm[:6]
    cbo_str = limpar_numeros(cbo)[:6].rjust(6, "0")
    folha_str = f"{folha:03d}"
    linha_str = f"{linha_num:02d}"
    proc_str = limpar_numeros(procedimento)[:10].rjust(10, "0")
    idade_str = f"{min(idade, 999):03d}"
    qtd_str = f"{min(quantidade, 999999):06d}"
    origem_str = (origem or "BPA")[:3].ljust(3)

    registro = (
        f"{ident}"
        f"{cnes_str}"
        f"{comp_str}"
        f"{cbo_str}"
        f"{folha_str}"
        f"{linha_str}"
        f"{proc_str}"
        f"{idade_str}"
        f"{qtd_str}"
        f"{origem_str}"
    )
    if len(registro) != 48:
        raise ValueError(f"Registro 02 BPA-C inválido: esperava 48 caracteres, obteve {len(registro)}")
    return registro


def formatar_registro_03(
    cnes: str,
    competencia_aaaamm: str,
    cns_profissional: str,
    cbo_profissional: str,
    data_atendimento: date | datetime | str,
    folha: int,
    linha_num: int,
    procedimento: str,
    cns_paciente: str | None,
    sexo: str | None,
    codigo_ibge: str | None,
    cid: str | None,
    idade: int,
    quantidade: int,
    carater_atendimento: str = "01",
    numero_autorizacao: str = "",
    nome_paciente: str = "",
    data_nascimento: date | datetime | str | None = None,
    raca_cor: str = "01",
    etnia_indigena: str = "",
    nacionalidade: str = "010",
    servico_classificacao: str = "",
    cep: str | None = None,
    tipo_logradouro: str = "081",
    logradouro: str = "",
    complemento: str = "",
    numero: str = "",
    bairro: str = "",
    telefone: str | None = None,
    email: str = "",
    cpf_paciente: str | None = None,
    ine: str = "",
    sem_cpf: bool = False,
) -> str:
    """Gera o registro 03 (BPA-I: Individualizado) com exatamente 351 caracteres."""
    ident = "03"
    cnes_str = limpar_numeros(cnes)[:7].rjust(7, "0")
    comp_str = competencia_aaaamm[:6]
    cns_prof_str = limpar_numeros(cns_profissional)[:15].ljust(15)
    cbo_prof_str = limpar_numeros(cbo_profissional)[:6].rjust(6, "0")

    if isinstance(data_atendimento, (date, datetime)):
        dt_atend_str = data_atendimento.strftime("%Y%m%d")
    else:
        dt_atend_str = limpar_numeros(str(data_atendimento))[:8].rjust(8, "0")

    folha_str = f"{folha:03d}"
    linha_str = f"{linha_num:02d}"
    proc_str = limpar_numeros(procedimento)[:10].rjust(10, "0")

    # Regra oficial DATASUS Layout v05.00 Obs 2:
    # "Deve-se identificar o paciente por apenas um documento: ou o CPF ou o CNS.
    # Sendo assim, se informado o CPF, não informar o CNS e vice-versa."
    cpf_limpo = "" if sem_cpf else limpar_numeros(cpf_paciente)
    cns_limpo = limpar_numeros(cns_paciente)
    if cpf_limpo and len(cpf_limpo) == 11:
        cpf_str = cpf_limpo.rjust(11, "0")
        cns_pac_str = " " * 15
    elif cns_limpo:
        cpf_str = " " * 11
        cns_pac_str = cns_limpo[:15].ljust(15)
    else:
        cpf_str = " " * 11
        cns_pac_str = " " * 15

    sexo_str = (sexo or "I")[:1].upper()
    if sexo_str not in ("M", "F"):
        sexo_str = "M"

    ibge_str = (limpar_numeros(codigo_ibge) or IBGE_GUAPE)[:6].rjust(6, "0")
    cid_limpo = remover_acentos(limpar_numeros(cid) if cid else "")[:4].ljust(4)
    idade_str = f"{min(idade, 999):03d}"
    qtd_str = f"{min(quantidade, 999999):06d}"
    carater_str = (carater_atendimento or "01")[:2].rjust(2, "0")
    num_aut_str = (numero_autorizacao or "").strip()[:13].ljust(13)
    origem_str = "BPA"

    nome_pac_str = remover_acentos(nome_paciente)[:30].ljust(30)

    if isinstance(data_nascimento, (date, datetime)):
        dt_nasc_str = data_nascimento.strftime("%Y%m%d")
    elif data_nascimento:
        dt_nasc_str = limpar_numeros(str(data_nascimento))[:8].rjust(8, "0")
    else:
        dt_nasc_str = "00000000"

    raca_str = (limpar_numeros(raca_cor) or "01")[:2].rjust(2, "0")
    etnia_str = (etnia_indigena or "").strip()[:4].ljust(4)
    nacio_str = (limpar_numeros(nacionalidade) or "010")[:3].rjust(3, "0")
    serv_str = (servico_classificacao or "").strip()[:15].ljust(15)
    res_17 = " " * 17

    cep_limpo = limpar_numeros(cep) or "37177000"
    cep_str = cep_limpo[:8].ljust(8, "0")
    tipo_logr_str = (limpar_numeros(tipo_logradouro) or "081")[:3].rjust(3, "0")
    logr_str = remover_acentos(logradouro)[:30].ljust(30)
    compl_str = remover_acentos(complemento)[:10].ljust(10)
    num_str = remover_acentos(numero)[:5].ljust(5)
    bairro_str = remover_acentos(bairro)[:30].ljust(30)

    tel_limpo = limpar_numeros(telefone)
    tel_str = tel_limpo[:11].ljust(11)
    email_str = remover_acentos(email)[:40].ljust(40)
    ine_limpo = limpar_numeros(ine) if ine else ""
    ine_str = ine_limpo[:10].rjust(10, "0") if ine_limpo else " " * 10

    fim_registro = "NN"

    registro = (
        f"{ident}"
        f"{cnes_str}"
        f"{comp_str}"
        f"{cns_prof_str}"
        f"{cbo_prof_str}"
        f"{dt_atend_str}"
        f"{folha_str}"
        f"{linha_str}"
        f"{proc_str}"
        f"{cns_pac_str}"
        f"{sexo_str}"
        f"{ibge_str}"
        f"{cid_limpo}"
        f"{idade_str}"
        f"{qtd_str}"
        f"{carater_str}"
        f"{num_aut_str}"
        f"{origem_str}"
        f"{nome_pac_str}"
        f"{dt_nasc_str}"
        f"{raca_str}"
        f"{etnia_str}"
        f"{nacio_str}"
        f"{serv_str}"
        f"{res_17}"
        f"{cep_str}"
        f"{tipo_logr_str}"
        f"{logr_str}"
        f"{compl_str}"
        f"{num_str}"
        f"{bairro_str}"
        f"{tel_str}"
        f"{email_str}"
        f"{ine_str}"
        f"{cpf_str}"
        f"{fim_registro}"
    )

    if len(registro) != 351:
        raise ValueError(f"Registro 03 BPA-I inválido: esperava 351 caracteres, obteve {len(registro)}")
    return registro


def calcular_controle_bpa(itens_02: list[dict], itens_03: list[dict]) -> int:
    """Calcula o campo cbc-smt-vrf segundo algoritmo oficial do SIA-SUS / DATASUS.

    Fórmula: ((sum(codigos_procedimento) + sum(quantidades)) % 1111) + 1111
    """
    sum_procs = 0
    sum_qtd = 0

    for it in itens_02:
        try:
            sum_procs += int(limpar_numeros(it["procedimento"]))
            sum_qtd += int(it["quantidade"])
        except (ValueError, TypeError):
            continue

    for it in itens_03:
        try:
            sum_procs += int(limpar_numeros(it["procedimento"]))
            sum_qtd += int(it["quantidade"])
        except (ValueError, TypeError):
            continue

    if sum_procs == 0 and sum_qtd == 0:
        return 1111

    return ((sum_procs + sum_qtd) % 1111) + 1111


def normalizar_competencia(competencia_in: str) -> tuple[str, str, date, date]:
    """Recebe competência em formato 'YYYY-MM' ou 'YYYYMM' e retorna:

    (aaaamm, yyyy_mm, data_inicio, data_fim)
    """
    comp_limpa = limpar_numeros(competencia_in)
    if len(comp_limpa) == 6:
        ano = int(comp_limpa[:4])
        mes = int(comp_limpa[4:6])
    elif "-" in competencia_in:
        partes = competencia_in.strip().split("-")
        ano = int(partes[0])
        mes = int(partes[1])
    else:
        hoje = date.today()
        ano = hoje.year
        mes = hoje.month

    _, ultimo_dia = monthrange(ano, mes)
    de = date(ano, mes, 1)
    ate = date(ano, mes, ultimo_dia)
    aaaamm = f"{ano:04d}{mes:02d}"
    yyyy_mm = f"{ano:04d}-{mes:02d}"
    return aaaamm, yyyy_mm, de, ate


def gerar_bpa_completo_municipio(
    db: Session,
    competencia: str,
    unidade_saude_id: int | None = None,
    cnes: str | None = None,
    forcar: bool = True,
    verificar_criticas: bool = False,
) -> dict[str, Any]:
    """Gera o lote completo do BPA SIA-SUS (Laboratório + Viagens TFD + Produção Ambulatorial).

    Segrega produção em BPA-C (Consolidado) e BPA-I (Individualizado),
    montando rigorosamente os arquivos .OUT e .CSV segundo o layout oficial DATASUS.

    Parâmetros:
    - db: Sessão do banco
    - competencia: Competência no formato YYYY-MM ou YYYYMM
    - unidade_saude_id: Filtro opcional por Unidade de Saúde específica
    - cnes: Filtro opcional por código CNES
    - forcar: Se True, não interrompe a geração mesmo com inconsistências de cadastro
    - verificar_criticas: Se True e forcar=False, bloqueia se houver críticas bloqueantes
    """
    aaaamm, yyyy_mm, dt_inicio, dt_fim = normalizar_competencia(competencia)
    cfg = _carregar_parametros_institucionais_bpa(db)

    # 0. Verificação Prévia de Críticas Preventivas (Bloqueantes no SIA-SUS)
    if verificar_criticas and not forcar:
        auditoria_criticas = auditar_criticas_bpa_competencia(
            db, competencia, unidade_saude_id=unidade_saude_id
        )
        if auditoria_criticas.get("bloqueia_exportacao", False):
            msgs_bloq = [
                c["mensagem"]
                for c in auditoria_criticas.get("criticas", [])
                if c.get("tipo") == "BLOQUEANTE"
            ][:4]
            detalhe = " | ".join(msgs_bloq)
            raise ValueError(
                f"Exportação BPA bloqueada por {auditoria_criticas['total_bloqueantes']} inconsistência(s) crítica(s): {detalhe}. "
                "Corrija os dados ou marque 'Forçar Geração' para modo auditoria."
            )

    # Caches auxiliares para desempenho
    paciente_cache: dict[int, Paciente | None] = {}
    proc_cache: dict[int, SigtapProcedimento | None] = {}
    proc_cod_cache: dict[str, SigtapProcedimento | None] = {}
    unidade_cache: dict[int, UnidadeSaude | None] = {}
    medico_cache: dict[int, Medico | None] = {}

    def get_paciente(pid: int | None) -> Paciente | None:
        if not pid:
            return None
        if pid not in paciente_cache:
            paciente_cache[pid] = db.get(Paciente, pid)
        return paciente_cache[pid]

    def get_procedimento(sid: int | None) -> SigtapProcedimento | None:
        if not sid:
            return None
        if sid not in proc_cache:
            proc_cache[sid] = db.get(SigtapProcedimento, sid)
        return proc_cache[sid]

    def get_procedimento_por_codigo(cod: str | None) -> SigtapProcedimento | None:
        if not cod:
            return None
        c_limpo = limpar_numeros(cod).zfill(10)
        if c_limpo not in proc_cod_cache:
            proc = db.exec(
                select(SigtapProcedimento).where(SigtapProcedimento.codigo == c_limpo)
            ).first()
            if not proc:
                proc = db.exec(
                    select(SigtapProcedimento).where(SigtapProcedimento.codigo == cod.strip())
                ).first()
            proc_cod_cache[c_limpo] = proc
        return proc_cod_cache[c_limpo]

    def get_unidade(uid: int | None) -> UnidadeSaude | None:
        if not uid:
            return None
        if uid not in unidade_cache:
            unidade_cache[uid] = db.get(UnidadeSaude, uid)
        return unidade_cache[uid]

    def get_medico(mid: int | None) -> Medico | None:
        if not mid:
            return None
        if mid not in medico_cache:
            medico_cache[mid] = db.get(Medico, mid)
        return medico_cache[mid]

    equipe_cache: dict[int, EquipeSaude | None] = {}

    def get_equipe(eid: int | None) -> EquipeSaude | None:
        if not eid:
            return None
        if eid not in equipe_cache:
            equipe_cache[eid] = db.get(EquipeSaude, eid)
        return equipe_cache[eid]

    unidade_selecionada = get_unidade(unidade_saude_id) if unidade_saude_id else None
    cnes_filtro = (
        limpar_numeros(unidade_selecionada.cnes)
        if (unidade_selecionada and unidade_selecionada.cnes)
        else (limpar_numeros(cnes) if cnes else None)
    )

    # Dicionários de consolidação
    raw_bpac: dict[tuple[Any, ...], dict] = {}
    raw_bpai: list[dict] = []

    total_exames_count = 0
    total_viagens_passageiros = 0
    total_ambulatorial_count = 0

    # =========================================================================
    # 1. COLETA PRODUÇÃO AMBULATORIAL (ProducaoAmbulatorial)
    # =========================================================================
    query_prod = select(ProducaoAmbulatorial).where(
        ProducaoAmbulatorial.competencia.in_([aaaamm, yyyy_mm])
        | (
            (ProducaoAmbulatorial.data_atendimento >= dt_inicio)
            & (ProducaoAmbulatorial.data_atendimento <= dt_fim)
        )
    )
    if unidade_saude_id:
        query_prod = query_prod.where(ProducaoAmbulatorial.unidade_saude_id == unidade_saude_id)
    elif cnes_filtro:
        unis_cnes = db.exec(select(UnidadeSaude).where(UnidadeSaude.cnes == cnes_filtro)).all()
        u_ids = [u.id for u in unis_cnes if u.id]
        if u_ids:
            query_prod = query_prod.where(ProducaoAmbulatorial.unidade_saude_id.in_(u_ids))

    try:
        producoes_amb = list(db.exec(query_prod).all())
    except Exception:
        producoes_amb = []

    for p_amb in producoes_amb:
        pac = get_paciente(p_amb.paciente_id)
        if eh_paciente_teste(pac):
            continue

        if not pac and p_amb.paciente_nome:
            pac = Paciente(
                nome=p_amb.paciente_nome,
                cpf=getattr(p_amb, "paciente_cpf", "") or "",
                cns=p_amb.paciente_cns or "",
                nascimento=p_amb.paciente_data_nascimento or date(1980, 1, 1),
                sexo=p_amb.paciente_sexo or "M",
                municipio=p_amb.paciente_municipio_ibge or cfg["ibge"],
                cep=getattr(p_amb, "paciente_cep", "") or cfg["cep_padrao"],
                endereco=getattr(p_amb, "paciente_logradouro", "") or "",
                endereco_numero=getattr(p_amb, "paciente_numero", "") or "",
                complemento=getattr(p_amb, "paciente_complemento", "") or "",
                bairro=getattr(p_amb, "paciente_bairro", "") or "",
                telefone=getattr(p_amb, "paciente_telefone", "") or "",
            )

        med = get_medico(p_amb.medico_id) if p_amb.medico_id else None
        u_exec = get_unidade(p_amb.unidade_saude_id) if p_amb.unidade_saude_id else None
        eq_exec = get_equipe(p_amb.equipe_id) if p_amb.equipe_id else None

        cnes_exec = (
            limpar_numeros(getattr(u_exec, "cnes", ""))
            or cnes_filtro
            or cfg["cnes_sms"]
        )
        cns_prof = (
            limpar_numeros(getattr(med, "cns", ""))
            or cfg["cns_lab"]
        )
        cbo_prof = (
            limpar_numeros(p_amb.cbo_codigo)
            or limpar_numeros(getattr(med, "cbo_codigo", ""))
            or "225142"
        )

        proc = get_procedimento_por_codigo(p_amb.procedimento_codigo)
        if not proc and getattr(p_amb, "procedimento_id", None):
            proc = get_procedimento(p_amb.procedimento_id)

        cod_proc = limpar_numeros(p_amb.procedimento_codigo).rjust(10, "0")
        if cod_proc in MAPEAMENTO_PROCEDIMENTOS_LEGADOS:
            cod_proc = MAPEAMENTO_PROCEDIMENTOS_LEGADOS[cod_proc]
        if cod_proc.startswith("99999"):
            # Procedimento extra-tabela SUS sem código SIGTAP válido não pode constar no arquivo BPA
            continue
        desc_proc = p_amb.procedimento_nome or (proc.descricao if proc else f"PROCEDIMENTO {cod_proc}")
        qtd = p_amb.quantidade or 1
        total_ambulatorial_count += qtd

        vl_unit = float(
            p_amb.valor_unitario
            or (getattr(proc, "valor_sa", 0.0) if proc else 0.0)
            or (getattr(proc, "valor_combinado", 0.0) if proc else 0.0)
            or 0.0
        )
        vl_tot = round(p_amb.valor_total or (qtd * vl_unit), 2)

        instru = (p_amb.instrumento_registro or (proc.instrumento if proc else "BPA-C") or "BPA-C").upper()

        if instru == "BPA-I":
            serv_classif = ""
            if p_amb.servico_codigo:
                serv_classif = f"{p_amb.servico_codigo}{p_amb.classificacao_codigo or ''}"

            sem_cpf_flag = (getattr(p_amb, "paciente_sem_cpf", "N") or "N").strip().upper() == "S"
            cpf_eff = "" if sem_cpf_flag else (getattr(p_amb, "paciente_cpf", "") or getattr(pac, "cpf", ""))

            raw_bpai.append({
                "origem_tipo": "Ambulatório Clínico (BPA-I)",
                "cnes": cnes_exec,
                "cns_profissional": cns_prof,
                "cbo_profissional": cbo_prof,
                "data_atendimento": p_amb.data_atendimento,
                "procedimento": cod_proc,
                "descricao_procedimento": desc_proc,
                "paciente": pac,
                "quantidade": qtd,
                "valor_unitario": vl_unit,
                "valor_total": vl_tot,
                "cid": p_amb.cid10 or "",
                "numero_autorizacao": p_amb.numero_autorizacao or "",
                "servico_classificacao": serv_classif,
                "carater_atendimento": getattr(p_amb, "carater_atendimento", "01") or "01",
                "raca_cor": getattr(p_amb, "paciente_raca_cor", "01") or "01",
                "etnia_indigena": getattr(p_amb, "paciente_etnia", "") or "",
                "nacionalidade": getattr(p_amb, "paciente_nacionalidade", "010") or "010",
                "ine": getattr(eq_exec, "ine", "") or "",
                "cpf_override": cpf_eff,
                "sem_cpf": sem_cpf_flag,
                "cep": getattr(p_amb, "paciente_cep", "") or getattr(pac, "cep", None) or cfg["cep_padrao"],
                "logradouro": getattr(p_amb, "paciente_logradouro", "") or getattr(pac, "endereco", ""),
                "complemento": getattr(p_amb, "paciente_complemento", "") or getattr(pac, "complemento", ""),
                "numero": getattr(p_amb, "paciente_numero", "") or getattr(pac, "endereco_numero", ""),
                "bairro": getattr(p_amb, "paciente_bairro", "") or getattr(pac, "bairro", ""),
                "telefone": getattr(p_amb, "paciente_telefone", "") or getattr(pac, "telefone", None),
            })
        else:
            idade_bpac = int(getattr(p_amb, "idade_paciente_informada", None) or 0)
            chave = (cnes_exec, cbo_prof, cod_proc, idade_bpac)
            if chave not in raw_bpac:
                raw_bpac[chave] = {
                    "origem_tipo": "Ambulatório Clínico (BPA-C)",
                    "cnes": cnes_exec,
                    "cbo": cbo_prof,
                    "procedimento": cod_proc,
                    "descricao_procedimento": desc_proc,
                    "quantidade": 0,
                    "idade": idade_bpac,
                    "valor_unitario": vl_unit,
                    "valor_total": 0.0,
                }
            raw_bpac[chave]["quantidade"] += qtd
            raw_bpac[chave]["valor_total"] = round(raw_bpac[chave]["quantidade"] * vl_unit, 2)

    # =========================================================================
    # 2. COLETA EXAMES LABORATORIAIS (SolicitacaoMestre + ItemSolic)
    # =========================================================================
    query_lab = select(SolicitacaoMestre).where(
        SolicitacaoMestre.status.in_(["coletado", "realizado"]),
        SolicitacaoMestre.data_agendada >= dt_inicio,
        SolicitacaoMestre.data_agendada <= dt_fim,
    )
    if unidade_saude_id:
        query_lab = query_lab.where(SolicitacaoMestre.unidade_saude_id == unidade_saude_id)

    solicitacoes = list(db.exec(query_lab).all())

    for solic in solicitacoes:
        pac = get_paciente(solic.paciente_id)
        if eh_paciente_teste(pac):
            continue

        u_solic = get_unidade(solic.unidade_saude_id) if solic.unidade_saude_id else None
        cnes_lab = (
            limpar_numeros(getattr(u_solic, "cnes", ""))
            or cnes_filtro
            or cfg["cnes_sms"]
        )

        itens = list(db.exec(select(ItemSolic).where(ItemSolic.solicitacao_id == solic.id)).all())
        for it in itens:
            proc = get_procedimento(it.sigtap_id)
            if not proc:
                continue

            qtd = it.quantidade or 1
            instrumento = (getattr(proc, "instrumento", "") or "BPA-C").upper()
            codigo_proc = proc.codigo.strip()
            if codigo_proc in MAPEAMENTO_PROCEDIMENTOS_LEGADOS:
                codigo_proc = MAPEAMENTO_PROCEDIMENTOS_LEGADOS[codigo_proc]
            if codigo_proc.startswith("99999"):
                # Exame extra-tabela SUS (ex: CA 15-3, D-Dímero) sem código SIGTAP não vai ao BPA/SIA
                continue
            total_exames_count += qtd

            vl_unit = float(
                getattr(proc, "valor_combinado", 0.0)
                or getattr(proc, "valor_sa", 0.0)
                or getattr(proc, "vl_sa", 0.0)
                or getattr(proc, "valor_ambulatorial", 0.0)
                or 0.0
            )

            if instrumento == "BPA-I":
                raw_bpai.append({
                    "origem_tipo": "Laboratório (BPA-I)",
                    "cnes": cnes_lab,
                    "cns_profissional": cfg["cns_lab"],
                    "cbo_profissional": cfg["cbo_lab"],
                    "data_atendimento": solic.data_agendada,
                    "procedimento": codigo_proc,
                    "descricao_procedimento": proc.descricao,
                    "paciente": pac,
                    "quantidade": qtd,
                    "valor_unitario": vl_unit,
                    "valor_total": round(qtd * vl_unit, 2),
                    "cid": "",
                    "numero_autorizacao": "",
                    "servico_classificacao": "",
                })
            else:
                cbo = cfg["cbo_lab"]
                chave = (cnes_lab, cbo, codigo_proc)
                if chave not in raw_bpac:
                    raw_bpac[chave] = {
                        "origem_tipo": "Laboratório (BPA-C)",
                        "cnes": cnes_lab,
                        "cbo": cbo,
                        "procedimento": codigo_proc,
                        "descricao_procedimento": proc.descricao,
                        "quantidade": 0,
                        "idade": 0,
                        "valor_unitario": vl_unit,
                        "valor_total": 0.0,
                    }
                raw_bpac[chave]["quantidade"] += qtd
                raw_bpac[chave]["valor_total"] = round(raw_bpac[chave]["quantidade"] * vl_unit, 2)

    # =========================================================================
    # 3. COLETA VIAGENS TFD (Grupo 08)
    # =========================================================================
    deve_incluir_tfd = True
    if unidade_saude_id:
        if cnes_filtro not in (cfg["cnes_tfd"], cfg["cnes_sms"]):
            deve_incluir_tfd = False

    if deve_incluir_tfd:
        viagens = list(
            db.exec(
                select(Viagem).where(
                    Viagem.status == "realizada",
                    Viagem.data_viagem >= dt_inicio,
                    Viagem.data_viagem <= dt_fim,
                )
            ).all()
        )

        proc_tfd_user = db.exec(
            select(SigtapProcedimento).where(SigtapProcedimento.codigo == "0803010125")
        ).first()
        vl_tfd_user = float(getattr(proc_tfd_user, "vl_sa", 0.0) or getattr(proc_tfd_user, "valor_sa", 0.0) or 8.85)

        proc_tfd_acomp = db.exec(
            select(SigtapProcedimento).where(SigtapProcedimento.codigo == "0803010109")
        ).first()
        vl_tfd_acomp = float(getattr(proc_tfd_acomp, "vl_sa", 0.0) or getattr(proc_tfd_acomp, "valor_sa", 0.0) or 8.85)

        for v in viagens:
            passageiros = list(db.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id == v.id)).all())
            qtd_destino = obter_quantidade_deslocamento(v.destino)

            for vp in passageiros:
                pac = get_paciente(vp.paciente_id)
                if pac and not eh_paciente_teste(pac):
                    raw_bpai.append({
                        "origem_tipo": "TFD - Deslocamento Usuário",
                        "cnes": cfg["cnes_tfd"],
                        "cns_profissional": cfg["cns_tfd"],
                        "cbo_profissional": cfg["cbo_tfd"],
                        "data_atendimento": v.data_viagem,
                        "procedimento": "0803010125",
                        "descricao_procedimento": "DESLOCAMENTO DE USUARIO",
                        "paciente": pac,
                        "quantidade": qtd_destino,
                        "valor_unitario": vl_tfd_user,
                        "valor_total": round(qtd_destino * vl_tfd_user, 2),
                        "cid": "",
                        "numero_autorizacao": "",
                        "servico_classificacao": "",
                    })
                    total_viagens_passageiros += 1

                tem_acomp = bool(vp.acompanhante or vp.acompanhante_id or vp.acompanhante_cpf)
                if tem_acomp:
                    pac_acomp = get_paciente(vp.acompanhante_id) if vp.acompanhante_id else None
                    if pac_acomp and eh_paciente_teste(pac_acomp):
                        continue

                    if not pac_acomp:
                        pac_acomp = Paciente(
                            nome=remover_acentos(vp.acompanhante or (pac.nome + " ACOMPANHANTE" if pac else "ACOMPANHANTE")),
                            cpf=limpar_numeros(vp.acompanhante_cpf),
                            cns="",
                            nascimento=date(1980, 1, 1),
                            sexo="M",
                            endereco=pac.endereco if pac else "",
                            bairro=pac.bairro if pac else "",
                            cep=pac.cep if pac else cfg["cep_padrao"],
                            telefone=pac.telefone if pac else "",
                        )

                    raw_bpai.append({
                        "origem_tipo": "TFD - Deslocamento Acompanhante",
                        "cnes": cfg["cnes_tfd"],
                        "cns_profissional": cfg["cns_tfd"],
                        "cbo_profissional": cfg["cbo_tfd"],
                        "data_atendimento": v.data_viagem,
                        "procedimento": "0803010109",
                        "descricao_procedimento": "DESLOCAMENTO DE ACOMPANHANTE",
                        "paciente": pac_acomp,
                        "quantidade": qtd_destino,
                        "valor_unitario": vl_tfd_acomp,
                        "valor_total": round(qtd_destino * vl_tfd_acomp, 2),
                        "cid": "",
                        "numero_autorizacao": "",
                        "servico_classificacao": "",
                    })
                    total_viagens_passageiros += 1

    # =========================================================================
    # 4. PAGINAÇÃO E FORMATAÇÃO (Até 20 linhas por folha - DATASUS)
    # =========================================================================
    LINHAS_POR_FOLHA = 20
    folha_atual = 1
    linha_atual = 1

    registros_02_formatados: list[str] = []
    lista_itens_bpac_resumo: list[dict] = []

    itens_02_sorted = sorted(raw_bpac.values(), key=lambda x: (x["cnes"], x["procedimento"]))
    for item in itens_02_sorted:
        if linha_atual > LINHAS_POR_FOLHA:
            folha_atual += 1
            linha_atual = 1

        reg_str = formatar_registro_02(
            cnes=item["cnes"],
            competencia_aaaamm=aaaamm,
            cbo=item["cbo"],
            folha=folha_atual,
            linha_num=linha_atual,
            procedimento=item["procedimento"],
            quantidade=item["quantidade"],
            idade=item.get("idade", 0),
        )
        registros_02_formatados.append(reg_str)

        lista_itens_bpac_resumo.append({
            "folha": folha_atual,
            "linha": linha_atual,
            "cnes": item["cnes"],
            "cbo": item["cbo"],
            "procedimento": item["procedimento"],
            "descricao": item["descricao_procedimento"],
            "quantidade": item["quantidade"],
            "valor_unitario": item["valor_unitario"],
            "valor_total": item["valor_total"],
            "origem": item["origem_tipo"],
        })
        linha_atual += 1

    if linha_atual > 1:
        folha_atual += 1
        linha_atual = 1

    registros_03_formatados: list[str] = []
    lista_itens_bpai_resumo: list[dict] = []

    todos_bpai_sorted = sorted(
        raw_bpai,
        key=lambda x: (x["cnes"], str(x["data_atendimento"]), x["procedimento"], getattr(x["paciente"], "nome", "")),
    )

    for item in todos_bpai_sorted:
        if linha_atual > LINHAS_POR_FOLHA:
            folha_atual += 1
            linha_atual = 1

        p: Paciente = item["paciente"]
        dt_atend = item["data_atendimento"]
        idade = calcular_idade_em_anos(getattr(p, "nascimento", None), dt_atend)

        cpf_eff = item.get("cpf_override") if "cpf_override" in item else getattr(p, "cpf", None)
        reg_str = formatar_registro_03(
            cnes=item["cnes"],
            competencia_aaaamm=aaaamm,
            cns_profissional=item["cns_profissional"],
            cbo_profissional=item["cbo_profissional"],
            data_atendimento=dt_atend,
            folha=folha_atual,
            linha_num=linha_atual,
            procedimento=item["procedimento"],
            cns_paciente=getattr(p, "cns", None),
            sexo=getattr(p, "sexo", "M"),
            codigo_ibge=getattr(p, "municipio", None) or cfg["ibge"],
            cid=item.get("cid"),
            idade=idade,
            quantidade=item["quantidade"],
            carater_atendimento=item.get("carater_atendimento", "01"),
            numero_autorizacao=item.get("numero_autorizacao", ""),
            nome_paciente=getattr(p, "nome", ""),
            data_nascimento=getattr(p, "nascimento", None),
            raca_cor=item.get("raca_cor", "01"),
            etnia_indigena=item.get("etnia_indigena", ""),
            nacionalidade=item.get("nacionalidade", "010"),
            servico_classificacao=item.get("servico_classificacao", ""),
            cep=item.get("cep") or getattr(p, "cep", None) or cfg["cep_padrao"],
            logradouro=item.get("logradouro") or getattr(p, "endereco", ""),
            complemento=item.get("complemento") or getattr(p, "complemento", ""),
            numero=item.get("numero") or getattr(p, "endereco_numero", ""),
            bairro=item.get("bairro") or getattr(p, "bairro", ""),
            telefone=item.get("telefone") or getattr(p, "telefone", None),
            cpf_paciente=cpf_eff,
            ine=item.get("ine", ""),
            sem_cpf=bool(item.get("sem_cpf", False)),
        )
        registros_03_formatados.append(reg_str)

        lista_itens_bpai_resumo.append({
            "folha": folha_atual,
            "linha": linha_atual,
            "cnes": item["cnes"],
            "cbo": item["cbo_profissional"],
            "data_atendimento": dt_atend.strftime("%Y-%m-%d") if isinstance(dt_atend, date) else str(dt_atend),
            "procedimento": item["procedimento"],
            "descricao": item["descricao_procedimento"],
            "paciente_nome": getattr(p, "nome", ""),
            "paciente_cpf": getattr(p, "cpf", ""),
            "paciente_cns": getattr(p, "cns", ""),
            "quantidade": item["quantidade"],
            "valor_unitario": item["valor_unitario"],
            "valor_total": item["valor_total"],
            "origem": item["origem_tipo"],
        })
        linha_atual += 1

    total_folhas_final = folha_atual
    total_linhas_arquivo = 1 + len(registros_02_formatados) + len(registros_03_formatados)

    # 5. Cálculo do Controle Oficial DATASUS
    controle_verificador = calcular_controle_bpa(lista_itens_bpac_resumo, lista_itens_bpai_resumo)

    # 6. Header 01 Oficial
    cnes_header = cnes_filtro or cfg["cnes_sms"]
    nome_header = (
        remover_acentos(unidade_selecionada.nome)[:30]
        if (unidade_selecionada and unidade_selecionada.nome)
        else cfg["nome_orgao"]
    )

    header_str = formatar_header_01(
        competencia_aaaamm=aaaamm,
        total_linhas_arquivo=total_linhas_arquivo,
        total_folhas_arquivo=total_folhas_final,
        controle_verificador=controle_verificador,
        cnes_sms=cnes_header,
        ibge=cfg["sigla_orgao"],
        cnpj=cfg["cnpj"],
        nome_sms=nome_header,
        destino=cfg["nome_destino"],
        tipo_prestador=cfg["tipo_destino"],
    )

    todas_linhas = [header_str] + registros_02_formatados + registros_03_formatados
    conteudo_out_str = "\r\n".join(todas_linhas) + "\r\n"
    conteudo_out_bytes = conteudo_out_str.encode("iso-8859-1")

    # 7. Planilha CSV de Conferência
    csv_buffer = io.StringIO()
    csv_writer = csv.writer(csv_buffer, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    csv_writer.writerow([
        "Tipo_Registro",
        "Folha",
        "Linha",
        "CNES",
        "Competencia",
        "CBO",
        "Codigo_Procedimento",
        "Descricao_Procedimento",
        "Instrumento",
        "Origem",
        "Data_Atendimento",
        "Paciente_Nome",
        "Paciente_CPF",
        "Paciente_CNS",
        "Quantidade",
        "Valor_Unitario_SUS",
        "Valor_Total_SUS",
    ])

    for it in lista_itens_bpac_resumo:
        csv_writer.writerow([
            "02 - BPA-C",
            it["folha"],
            it["linha"],
            it["cnes"],
            yyyy_mm,
            it["cbo"],
            it["procedimento"],
            it["descricao"],
            "BPA-C",
            it["origem"],
            f"{yyyy_mm}-01",
            "PRODUCAO CONSOLIDADA",
            "",
            "",
            it["quantidade"],
            f"{it['valor_unitario']:.2f}".replace(".", ","),
            f"{it['valor_total']:.2f}".replace(".", ","),
        ])

    for it in lista_itens_bpai_resumo:
        csv_writer.writerow([
            "03 - BPA-I",
            it["folha"],
            it["linha"],
            it["cnes"],
            yyyy_mm,
            it["cbo"],
            it["procedimento"],
            it["descricao"],
            "BPA-I",
            it["origem"],
            it["data_atendimento"],
            it["paciente_nome"],
            it["paciente_cpf"],
            it["paciente_cns"],
            it["quantidade"],
            f"{it['valor_unitario']:.2f}".replace(".", ","),
            f"{it['valor_total']:.2f}".replace(".", ","),
        ])

    conteudo_csv_str = csv_buffer.getvalue()
    conteudo_csv_bytes = conteudo_csv_str.encode("utf-8-sig")

    valor_total_estimado = round(
        sum(it["valor_total"] for it in lista_itens_bpac_resumo)
        + sum(it["valor_total"] for it in lista_itens_bpai_resumo),
        2,
    )

    sufixo_arq = f"_{cnes_header}" if unidade_saude_id else ""

    return {
        "competencia": yyyy_mm,
        "competencia_aaaamm": aaaamm,
        "unidade_saude_id": unidade_saude_id,
        "cnes_exportado": cnes_header,
        "total_linhas": total_linhas_arquivo,
        "total_folhas": total_folhas_final,
        "controle_verificador": controle_verificador,
        "total_procedimentos_bpa_c": len(registros_02_formatados),
        "total_procedimentos_bpa_i": len(registros_03_formatados),
        "total_exames": total_exames_count,
        "total_viagens_tfd": total_viagens_passageiros,
        "total_ambulatorial": total_ambulatorial_count,
        "total_geral_itens": len(registros_02_formatados) + len(registros_03_formatados),
        "valor_total_estimado": valor_total_estimado,
        "itens_bpa_c": lista_itens_bpac_resumo,
        "itens_bpa_i": lista_itens_bpai_resumo,
        "conteudo_out": conteudo_out_str,
        "conteudo_out_bytes": conteudo_out_bytes,
        "conteudo_csv": conteudo_csv_str,
        "conteudo_csv_bytes": conteudo_csv_bytes,
        "arquivo_nome_out": f"PA{cfg['ibge'][:6]}{sufixo_arq}.OUT",
        "arquivo_nome_csv": f"bpa_conferencia_{aaaamm}{sufixo_arq}.csv",
    }


def obter_demonstrativo_faturamento(
    db: Session,
    competencia: str,
    unidade_saude_id: int | None = None,
) -> dict[str, Any]:
    """Retorna o demonstrativo formal de faturamento ambulatorial BPA por CNES e Geral.

    Lista todos os procedimentos com código SIGTAP, descrição, quantidade realizada,
    valor unitário ambulatorial (SA), valor hospitalar (SH), total em BRL,
    separados por Unidade/CNES e consolidado geral municipal.
    """
    aaaamm, yyyy_mm, dt_inicio, dt_fim = normalizar_competencia(competencia)
    cfg = _carregar_parametros_institucionais_bpa(db)

    unidade_selecionada = db.get(UnidadeSaude, unidade_saude_id) if unidade_saude_id else None
    cnes_filtro = limpar_numeros(unidade_selecionada.cnes) if unidade_selecionada and unidade_selecionada.cnes else None

    # Mapeamento de unidades
    todas_unidades = db.exec(select(UnidadeSaude)).all()
    unidades_map = {u.id: u for u in todas_unidades if u.id}
    unidades_por_cnes = {limpar_numeros(u.cnes): u.nome for u in todas_unidades if u.cnes}

    # Estruturas de agregação
    # chave: (cnes, codigo_procedimento)
    agregado: dict[tuple[str, str], dict[str, Any]] = {}

    def get_nome_unidade(cnes_code: str) -> str:
        cnes_limpo = limpar_numeros(cnes_code)
        if cnes_limpo in unidades_por_cnes:
            return unidades_por_cnes[cnes_limpo]
        if cnes_limpo == cfg["cnes_sms"]:
            return f"SECRETARIA MUNICIPAL DE SAUDE DE {remover_acentos(cfg['cidade'])}"
        if cnes_limpo == cfg["cnes_tfd"]:
            return "CENTRAL DE REGULACAO E TRANSPORTE TFD"
        return f"UNIDADE CNES {cnes_code}"

    # Cache de procedimento SIGTAP
    sigtap_cache: dict[str, SigtapProcedimento | None] = {}

    def get_sigtap(cod: str) -> SigtapProcedimento | None:
        c_limpo = limpar_numeros(cod).zfill(10)
        if c_limpo not in sigtap_cache:
            proc = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == c_limpo)).first()
            if not proc:
                proc = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == cod.strip())).first()
            sigtap_cache[c_limpo] = proc
        return sigtap_cache[c_limpo]

    # 1. Produções Ambulatoriais Clínicas
    query_prod = select(ProducaoAmbulatorial).where(
        ProducaoAmbulatorial.competencia.in_([aaaamm, yyyy_mm])
        | (
            (ProducaoAmbulatorial.data_atendimento >= dt_inicio)
            & (ProducaoAmbulatorial.data_atendimento <= dt_fim)
        )
    )
    if unidade_saude_id:
        query_prod = query_prod.where(ProducaoAmbulatorial.unidade_saude_id == unidade_saude_id)

    try:
        prods_amb = list(db.exec(query_prod).all())
    except Exception:
        prods_amb = []

    for p in prods_amb:
        u = unidades_map.get(p.unidade_saude_id) if p.unidade_saude_id else None
        cnes_u = limpar_numeros(getattr(u, "cnes", "")) or cnes_filtro or cfg["cnes_sms"]
        cod = limpar_numeros(p.procedimento_codigo).zfill(10)
        if cod in MAPEAMENTO_PROCEDIMENTOS_LEGADOS:
            cod = MAPEAMENTO_PROCEDIMENTOS_LEGADOS[cod]
        proc = get_sigtap(cod)

        vl_sa = float(
            p.valor_unitario
            or (getattr(proc, "valor_sa", 0.0) if proc else 0.0)
            or (getattr(proc, "valor_combinado", 0.0) if proc else 0.0)
            or 0.0
        )
        vl_sh = float(getattr(proc, "valor_sh", 0.0) if proc else 0.0)

        chave = (cnes_u, cod)
        if chave not in agregado:
            agregado[chave] = {
                "cnes": cnes_u,
                "unidade_nome": get_nome_unidade(cnes_u),
                "codigo": cod,
                "descricao": p.procedimento_nome or (proc.descricao if proc else f"PROCEDIMENTO {cod}"),
                "instrumento": (p.instrumento_registro or (proc.instrumento if proc else "BPA-C") or "BPA-C").upper(),
                "quantidade": 0,
                "valor_ambulatorial": vl_sa,
                "valor_hospitalar": vl_sh,
                "valor_total": 0.0,
                "origem": "Ambulatório",
            }
        agregado[chave]["quantidade"] += p.quantidade or 1
        agregado[chave]["valor_total"] = round(agregado[chave]["quantidade"] * vl_sa, 2)

    # 2. Exames Laboratoriais
    query_lab = select(SolicitacaoMestre).where(
        SolicitacaoMestre.status.in_(["coletado", "realizado"]),
        SolicitacaoMestre.data_agendada >= dt_inicio,
        SolicitacaoMestre.data_agendada <= dt_fim,
    )
    if unidade_saude_id:
        query_lab = query_lab.where(SolicitacaoMestre.unidade_saude_id == unidade_saude_id)

    solics_lab = list(db.exec(query_lab).all())
    for s in solics_lab:
        u = unidades_map.get(s.unidade_saude_id) if s.unidade_saude_id else None
        cnes_u = limpar_numeros(getattr(u, "cnes", "")) or cnes_filtro or cfg["cnes_sms"]

        itens = list(db.exec(select(ItemSolic).where(ItemSolic.solicitacao_id == s.id)).all())
        for it in itens:
            proc = db.get(SigtapProcedimento, it.sigtap_id)
            if not proc:
                continue

            cod = limpar_numeros(proc.codigo).zfill(10)
            if cod in MAPEAMENTO_PROCEDIMENTOS_LEGADOS:
                cod = MAPEAMENTO_PROCEDIMENTOS_LEGADOS[cod]
            vl_sa = float(
                getattr(proc, "valor_combinado", 0.0)
                or getattr(proc, "valor_sa", 0.0)
                or getattr(proc, "vl_sa", 0.0)
                or 0.0
            )
            vl_sh = float(getattr(proc, "valor_sh", 0.0) or 0.0)

            chave = (cnes_u, cod)
            if chave not in agregado:
                agregado[chave] = {
                    "cnes": cnes_u,
                    "unidade_nome": get_nome_unidade(cnes_u),
                    "codigo": cod,
                    "descricao": proc.descricao,
                    "instrumento": (getattr(proc, "instrumento", "") or "BPA-C").upper(),
                    "quantidade": 0,
                    "valor_ambulatorial": vl_sa,
                    "valor_hospitalar": vl_sh,
                    "valor_total": 0.0,
                    "origem": "Laboratório",
                }
            agregado[chave]["quantidade"] += it.quantidade or 1
            agregado[chave]["valor_total"] = round(agregado[chave]["quantidade"] * vl_sa, 2)

    # 3. Viagens TFD
    deve_incluir_tfd = True
    if unidade_saude_id:
        if cnes_filtro not in (cfg["cnes_tfd"], cfg["cnes_sms"]):
            deve_incluir_tfd = False

    if deve_incluir_tfd:
        viagens = list(
            db.exec(
                select(Viagem).where(
                    Viagem.status == "realizada",
                    Viagem.data_viagem >= dt_inicio,
                    Viagem.data_viagem <= dt_fim,
                )
            ).all()
        )

        proc_tfd_user = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == "0803010125")).first()
        vl_user = float(getattr(proc_tfd_user, "vl_sa", 0.0) or getattr(proc_tfd_user, "valor_sa", 0.0) or 8.85)

        proc_tfd_acomp = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == "0803010109")).first()
        vl_acomp = float(getattr(proc_tfd_acomp, "vl_sa", 0.0) or getattr(proc_tfd_acomp, "valor_sa", 0.0) or 8.85)

        for v in viagens:
            qtd_destino = obter_quantidade_deslocamento(v.destino)
            passageiros = list(db.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id == v.id)).all())

            for vp in passageiros:
                # Paciente
                chave_user = (cfg["cnes_tfd"], "0803010125")
                if chave_user not in agregado:
                    agregado[chave_user] = {
                        "cnes": cfg["cnes_tfd"],
                        "unidade_nome": get_nome_unidade(cfg["cnes_tfd"]),
                        "codigo": "0803010125",
                        "descricao": "DESLOCAMENTO DE USUARIO (TFD)",
                        "instrumento": "BPA-I",
                        "quantidade": 0,
                        "valor_ambulatorial": vl_user,
                        "valor_hospitalar": 0.0,
                        "valor_total": 0.0,
                        "origem": "TFD / Transporte",
                    }
                agregado[chave_user]["quantidade"] += qtd_destino
                agregado[chave_user]["valor_total"] = round(agregado[chave_user]["quantidade"] * vl_user, 2)

                # Acompanhante
                if vp.acompanhante or vp.acompanhante_id or vp.acompanhante_cpf:
                    chave_acomp = (cfg["cnes_tfd"], "0803010109")
                    if chave_acomp not in agregado:
                        agregado[chave_acomp] = {
                            "cnes": cfg["cnes_tfd"],
                            "unidade_nome": get_nome_unidade(cfg["cnes_tfd"]),
                            "codigo": "0803010109",
                            "descricao": "DESLOCAMENTO DE ACOMPANHANTE (TFD)",
                            "instrumento": "BPA-I",
                            "quantidade": 0,
                            "valor_ambulatorial": vl_acomp,
                            "valor_hospitalar": 0.0,
                            "valor_total": 0.0,
                            "origem": "TFD / Transporte",
                        }
                    agregado[chave_acomp]["quantidade"] += qtd_destino
                    agregado[chave_acomp]["valor_total"] = round(agregado[chave_acomp]["quantidade"] * vl_acomp, 2)

    # 4. Agrupamento por CNES e Consolidação
    itens_lista = sorted(agregado.values(), key=lambda x: (x["cnes"], x["codigo"]))

    grupos_por_cnes_dict: dict[str, dict[str, Any]] = {}
    for item in itens_lista:
        cnes_k = item["cnes"]
        if cnes_k not in grupos_por_cnes_dict:
            # Encontra id da unidade se houver
            uid_found = None
            for u in todas_unidades:
                if limpar_numeros(u.cnes) == cnes_k:
                    uid_found = u.id
                    break

            grupos_por_cnes_dict[cnes_k] = {
                "cnes": cnes_k,
                "unidade_id": uid_found,
                "unidade_nome": item["unidade_nome"],
                "total_procedimentos": 0,
                "quantidade_total": 0,
                "valor_total": 0.0,
                "procedimentos": [],
            }
        grupos_por_cnes_dict[cnes_k]["procedimentos"].append(item)
        grupos_por_cnes_dict[cnes_k]["total_procedimentos"] += 1
        grupos_por_cnes_dict[cnes_k]["quantidade_total"] += item["quantidade"]
        grupos_por_cnes_dict[cnes_k]["valor_total"] = round(
            grupos_por_cnes_dict[cnes_k]["valor_total"] + item["valor_total"], 2
        )

    por_cnes_lista = sorted(grupos_por_cnes_dict.values(), key=lambda x: x["cnes"])

    total_procs_distintos = len({it["codigo"] for it in itens_lista})
    qtd_total_geral = sum(it["quantidade"] for it in itens_lista)
    valor_total_amb = round(sum(it["valor_total"] for it in itens_lista), 2)
    valor_total_hosp = round(sum(it["quantidade"] * it["valor_hospitalar"] for it in itens_lista), 2)
    valor_total_geral = round(valor_total_amb + valor_total_hosp, 2)

    return {
        "competencia": yyyy_mm,
        "competencia_aaaamm": aaaamm,
        "unidade_saude_id": unidade_saude_id,
        "unidade_nome": unidade_selecionada.nome if unidade_selecionada else "Todas as Unidades (Geral do Município)",
        "cnes_filtro": cnes_filtro or cfg["cnes_sms"],
        "municipio": cfg["cidade"],
        "uf": cfg["uf"],
        "ibge": cfg["ibge"],
        "data_emissao": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
        "total_procedimentos_distintos": total_procs_distintos,
        "total_linhas_demonstrativo": len(itens_lista),
        "quantidade_total_geral": qtd_total_geral,
        "valor_total_ambulatorial": valor_total_amb,
        "valor_total_hospitalar": valor_total_hosp,
        "valor_total_geral": valor_total_geral,
        "itens": itens_lista,
        "por_cnes": por_cnes_lista,
    }
