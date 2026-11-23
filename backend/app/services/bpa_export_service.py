"""Serviço de Exportação Oficial do Boletim de Produção Ambulatorial (BPA/SIA-SUS).

Gera arquivo binário posicional oficial (.OUT) e CSV de conferência,
unificando a produção ambulatorial do município de Guapé (MG):
- Exames Laboratoriais (BPA-C e BPA-I)
- Viagens e Deslocamentos de Carro / TFD (Grupo 08: 0803010125 e 0803010109)
- Procedimentos Clínicos Ambulatoriais

Padrão DATASUS / SIA-SUS:
- Header 01: exatamente 130 caracteres (+ CRLF)
- Registro 02 (BPA-C: Consolidado): exatamente 48 caracteres (+ CRLF)
- Registro 03 (BPA-I: Individualizado): exatamente 351 caracteres (+ CRLF)
- Codificação: ISO-8859-1 (latin-1) com quebras de linha CRLF (\r\n)
- Algoritmo de controle do Header: ((sum(procs) + sum(qtds)) % 1111) + 1111
"""

import csv
import io
import re
import unicodedata
from calendar import monthrange
from datetime import date, datetime
from typing import Any

from sqlmodel import Session, select

from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import ItemSolic, SolicitacaoMestre
from app.models.tfd import Paciente, Viagem, ViagemPaciente

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
    # Normalização NFKD remove marcas de acentuação
    texto_nfkd = unicodedata.normalize("NFKD", str(texto).upper())
    sem_acento = "".join([c for c in texto_nfkd if not unicodedata.combining(c)])
    # Remove quebras de linha e caracteres de controle
    sem_acento = re.sub(r"[\r\n\t]+", " ", sem_acento)
    # Mantém apenas caracteres ASCII visíveis padrão
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
) -> str:
    """Gera o registro 03 (BPA-I: Individualizado) com exatamente 351 caracteres."""
    ident = "03"
    cnes_str = limpar_numeros(cnes)[:7].rjust(7, "0")
    comp_str = competencia_aaaamm[:6]
    cns_prof_str = limpar_numeros(cns_profissional)[:15].ljust(15)
    cbo_prof_str = limpar_numeros(cbo_profissional)[:6].rjust(6, "0")

    # Data de atendimento AAAAMMDD
    if isinstance(data_atendimento, (date, datetime)):
        dt_atend_str = data_atendimento.strftime("%Y%m%d")
    else:
        dt_atend_str = limpar_numeros(str(data_atendimento))[:8].rjust(8, "0")

    folha_str = f"{folha:03d}"
    linha_str = f"{linha_num:02d}"
    proc_str = limpar_numeros(procedimento)[:10].rjust(10, "0")

    cns_pac_str = limpar_numeros(cns_paciente)[:15].ljust(15)
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

    # Data nascimento AAAAMMDD
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

    # Endereço
    cep_limpo = limpar_numeros(cep) or "37177000"
    cep_str = cep_limpo[:8].ljust(8, "0")
    tipo_logr_str = (limpar_numeros(tipo_logradouro) or "081")[:3].rjust(3, "0")
    logr_str = remover_acentos(logradouro)[:30].ljust(30)
    compl_str = remover_acentos(complemento)[:10].ljust(10)
    num_str = remover_acentos(numero)[:5].ljust(5)
    bairro_str = remover_acentos(bairro)[:30].ljust(30)

    tel_limpo = limpar_numeros(telefone)
    tel_str = tel_limpo[:11].ljust(11)

    email_str = " " * 50

    cpf_limpo = limpar_numeros(cpf_paciente)
    if cpf_limpo:
        cpf_str = cpf_limpo[:11].rjust(11, "0")
    else:
        cpf_str = " " * 11

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


def gerar_bpa_completo_municipio(db: Session, competencia: str) -> dict[str, Any]:
    """Gera o lote completo do BPA SIA-SUS (Laboratório + Viagens TFD + Ambulatório).

    Segrega produção em BPA-C (Consolidado) e BPA-I (Individualizado),
    montando rigorosamente os arquivos .OUT e .CSV.
    """
    aaaamm, yyyy_mm, dt_inicio, dt_fim = normalizar_competencia(competencia)

    # 1. Coleta Exames Laboratoriais no período
    solicitacoes = list(
        db.exec(
            select(SolicitacaoMestre).where(
                SolicitacaoMestre.status.in_(["coletado", "realizado"]),
                SolicitacaoMestre.data_agendada >= dt_inicio,
                SolicitacaoMestre.data_agendada <= dt_fim,
            )
        ).all()
    )

    # Cache de pacientes e procedimentos para desempenho
    paciente_cache: dict[int, Paciente | None] = {}
    proc_cache: dict[int, SigtapProcedimento | None] = {}

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

    raw_bpac_lab: dict[tuple[str, str, str], dict] = {}
    raw_bpai_lab: list[dict] = []
    total_exames_count = 0

    for solic in solicitacoes:
        pac = get_paciente(solic.paciente_id)
        if eh_paciente_teste(pac):
            continue

        itens = list(db.exec(select(ItemSolic).where(ItemSolic.solicitacao_id == solic.id)).all())
        for it in itens:
            proc = get_procedimento(it.sigtap_id)
            if not proc:
                continue

            qtd = it.quantidade or 1
            total_exames_count += qtd
            instrumento = (getattr(proc, "instrumento", "") or "BPA-C").upper()
            codigo_proc = proc.codigo.strip()

            vl_unit = float(
                getattr(proc, "valor_combinado", 0.0)
                or getattr(proc, "valor_sa", 0.0)
                or getattr(proc, "vl_sa", 0.0)
                or getattr(proc, "valor_ambulatorial", 0.0)
                or 0.0
            )

            if instrumento == "BPA-I":
                # Registro individualizado
                raw_bpai_lab.append({
                    "origem_tipo": "Laboratório (BPA-I)",
                    "cnes": CNES_SMS_PADRAO,
                    "cns_profissional": CNS_PROFISSIONAL_LAB_PADRAO,
                    "cbo_profissional": CBO_PROFISSIONAL_LAB_PADRAO,
                    "data_atendimento": solic.data_agendada,
                    "procedimento": codigo_proc,
                    "descricao_procedimento": proc.descricao,
                    "paciente": pac,
                    "quantidade": qtd,
                    "valor_unitario": vl_unit,
                    "valor_total": round(qtd * vl_unit, 2),
                })
            else:
                # Registro consolidado (agrupa por CNES + CBO + Procedimento)
                cnes = CNES_SMS_PADRAO
                cbo = CBO_PROFISSIONAL_LAB_PADRAO
                chave = (cnes, cbo, codigo_proc)
                if chave not in raw_bpac_lab:
                    raw_bpac_lab[chave] = {
                        "origem_tipo": "Laboratório (BPA-C)",
                        "cnes": cnes,
                        "cbo": cbo,
                        "procedimento": codigo_proc,
                        "descricao_procedimento": proc.descricao,
                        "quantidade": 0,
                        "idade": 0,
                        "valor_unitario": vl_unit,
                        "valor_total": 0.0,
                    }
                raw_bpac_lab[chave]["quantidade"] += qtd
                raw_bpac_lab[chave]["valor_total"] = round(raw_bpac_lab[chave]["quantidade"] * vl_unit, 2)

    # 2. Coleta Viagens TFD no período
    viagens = list(
        db.exec(
            select(Viagem).where(
                Viagem.status == "realizada",
                Viagem.data_viagem >= dt_inicio,
                Viagem.data_viagem <= dt_fim,
            )
        ).all()
    )

    raw_bpai_tfd: list[dict] = []
    total_viagens_passageiros = 0

    # Valor padrão SUS da fração de deslocamento TFD (se não cadastrado no SIGTAP)
    # Tabela SIGTAP 0803010125 / 0803010109: vl_sa ~ R$ 8.85
    proc_tfd_user = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == "0803010125")).first()
    vl_tfd_user = float(getattr(proc_tfd_user, "vl_sa", 0.0) or getattr(proc_tfd_user, "valor_sa", 0.0) or 8.85)

    proc_tfd_acomp = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == "0803010109")).first()
    vl_tfd_acomp = float(getattr(proc_tfd_acomp, "vl_sa", 0.0) or getattr(proc_tfd_acomp, "valor_sa", 0.0) or 8.85)

    for v in viagens:
        passageiros = list(db.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id == v.id)).all())
        qtd_destino = obter_quantidade_deslocamento(v.destino)

        for vp in passageiros:
            # 2.1 Passageiro Paciente Principal
            pac = get_paciente(vp.paciente_id)
            if pac and not eh_paciente_teste(pac):
                raw_bpai_tfd.append({
                    "origem_tipo": "TFD - Deslocamento Usuário",
                    "cnes": CNES_TFD_PADRAO,
                    "cns_profissional": CNS_PROFISSIONAL_TFD_PADRAO,
                    "cbo_profissional": CBO_PROFISSIONAL_TFD_PADRAO,
                    "data_atendimento": v.data_viagem,
                    "procedimento": "0803010125",
                    "descricao_procedimento": "DESLOCAMENTO DE USUARIO",
                    "paciente": pac,
                    "quantidade": qtd_destino,
                    "valor_unitario": vl_tfd_user,
                    "valor_total": round(qtd_destino * vl_tfd_user, 2),
                })
                total_viagens_passageiros += 1

            # 2.2 Passageiro Acompanhante
            tem_acomp = bool(vp.acompanhante or vp.acompanhante_id or vp.acompanhante_cpf)
            if tem_acomp:
                pac_acomp = get_paciente(vp.acompanhante_id) if vp.acompanhante_id else None
                if pac_acomp and eh_paciente_teste(pac_acomp):
                    continue

                # Cria representação do acompanhante caso não tenha cadastro completo
                if not pac_acomp:
                    pac_acomp = Paciente(
                        nome=remover_acentos(vp.acompanhante or (pac.nome + " ACOMPANHANTE" if pac else "ACOMPANHANTE")),
                        cpf=limpar_numeros(vp.acompanhante_cpf),
                        cns="",
                        nascimento=date(1980, 1, 1),
                        sexo="M",
                        endereco=pac.endereco if pac else "",
                        bairro=pac.bairro if pac else "",
                        cep=pac.cep if pac else "37177000",
                        telefone=pac.telefone if pac else "",
                    )

                raw_bpai_tfd.append({
                    "origem_tipo": "TFD - Deslocamento Acompanhante",
                    "cnes": CNES_TFD_PADRAO,
                    "cns_profissional": CNS_PROFISSIONAL_TFD_PADRAO,
                    "cbo_profissional": CBO_PROFISSIONAL_TFD_PADRAO,
                    "data_atendimento": v.data_viagem,
                    "procedimento": "0803010109",
                    "descricao_procedimento": "DESLOCAMENTO DE ACOMPANHANTE",
                    "paciente": pac_acomp,
                    "quantidade": qtd_destino,
                    "valor_unitario": vl_tfd_acomp,
                    "valor_total": round(qtd_destino * vl_tfd_acomp, 2),
                })
                total_viagens_passageiros += 1

    # 3. Paginação e Formatação de Folhas e Linhas
    # Limite oficial DATASUS: até 20 linhas por folha
    LINHAS_POR_FOLHA = 20

    folha_atual = 1
    linha_atual = 1

    registros_02_formatados: list[str] = []
    lista_itens_bpac_resumo: list[dict] = []

    # Ordena BPA-C por procedimento para consistência
    itens_02_sorted = sorted(raw_bpac_lab.values(), key=lambda x: x["procedimento"])
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

    # Inicia BPA-I na próxima folha se já usamos a folha atual
    if linha_atual > 1:
        folha_atual += 1
        linha_atual = 1

    registros_03_formatados: list[str] = []
    lista_itens_bpai_resumo: list[dict] = []

    # Junta e ordena BPA-I por data de atendimento e procedimento
    todos_bpai = raw_bpai_lab + raw_bpai_tfd
    todos_bpai_sorted = sorted(
        todos_bpai,
        key=lambda x: (str(x["data_atendimento"]), x["procedimento"], getattr(x["paciente"], "nome", "")),
    )

    for item in todos_bpai_sorted:
        if linha_atual > LINHAS_POR_FOLHA:
            folha_atual += 1
            linha_atual = 1

        p: Paciente = item["paciente"]
        dt_atend = item["data_atendimento"]
        idade = calcular_idade_em_anos(getattr(p, "nascimento", None), dt_atend)

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
            codigo_ibge=getattr(p, "municipio", None),
            cid=None,
            idade=idade,
            quantidade=item["quantidade"],
            nome_paciente=getattr(p, "nome", ""),
            data_nascimento=getattr(p, "nascimento", None),
            cep=getattr(p, "cep", None),
            logradouro=getattr(p, "endereco", ""),
            complemento=getattr(p, "complemento", ""),
            numero=getattr(p, "endereco_numero", ""),
            bairro=getattr(p, "bairro", ""),
            telefone=getattr(p, "telefone", None),
            cpf_paciente=getattr(p, "cpf", None),
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
    # Total de linhas no arquivo = 1 (Header 01) + Total 02 + Total 03
    total_linhas_arquivo = 1 + len(registros_02_formatados) + len(registros_03_formatados)

    # 4. Cálculo do Controle Oficial DATASUS
    controle_verificador = calcular_controle_bpa(lista_itens_bpac_resumo, lista_itens_bpai_resumo)

    # 5. Monta o Header 01
    header_str = formatar_header_01(
        competencia_aaaamm=aaaamm,
        total_linhas_arquivo=total_linhas_arquivo,
        total_folhas_arquivo=total_folhas_final,
        controle_verificador=controle_verificador,
    )

    # 6. Monta Conteúdo Completo .OUT com CRLF
    todas_linhas = [header_str] + registros_02_formatados + registros_03_formatados
    conteudo_out_str = "\r\n".join(todas_linhas) + "\r\n"
    conteudo_out_bytes = conteudo_out_str.encode("iso-8859-1")

    # 7. Monta Planilha CSV de Conferência
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

    return {
        "competencia": yyyy_mm,
        "competencia_aaaamm": aaaamm,
        "total_linhas": total_linhas_arquivo,
        "total_folhas": total_folhas_final,
        "controle_verificador": controle_verificador,
        "total_procedimentos_bpa_c": len(registros_02_formatados),
        "total_procedimentos_bpa_i": len(registros_03_formatados),
        "total_exames": total_exames_count,
        "total_viagens_tfd": total_viagens_passageiros,
        "total_geral_itens": len(registros_02_formatados) + len(registros_03_formatados),
        "valor_total_estimado": valor_total_estimado,
        "itens_bpa_c": lista_itens_bpac_resumo,
        "itens_bpa_i": lista_itens_bpai_resumo,
        "conteudo_out": conteudo_out_str,
        "conteudo_out_bytes": conteudo_out_bytes,
        "conteudo_csv": conteudo_csv_str,
        "conteudo_csv_bytes": conteudo_csv_bytes,
        "arquivo_nome_out": f"PA312810_{aaaamm}.OUT",
        "arquivo_nome_csv": f"bpa_conferencia_{aaaamm}.csv",
    }
