"""Serviço de Críticas Preventivas do CNES e Faturamento BPA (SIA-SUS).

Realiza auditoria preventiva abrangente nas produções da competência antes da exportação:
- Críticas de Profissionais (CNS módulo 11, CBO, Vínculo CNES, CHS)
- Críticas de Unidades de Saúde (CNES 7 dígitos, Tipo de Estabelecimento, Código IBGE, Responsável Técnico)
- Críticas de Procedimentos / Produção (BPA-I sem CNS, Faixa Etária SIGTAP, Sexo SIGTAP, Serviço Especializado)

Permite identificar previamente qualquer incompatibilidade que causaria rejeição
pelo SIA-SUS no DATASUS, garantindo conformidade total e faturamento 100% aprovado.
"""

from __future__ import annotations

import re
from calendar import monthrange
from datetime import date, datetime
from typing import Any

from sqlmodel import Session, select

from app.core.validators import so_digitos, valida_cnes, valida_cns
from app.models.cadastros_saude import (
    EquipeProfissional,
    EquipeSaude,
    Medico,
    UnidadeSaude,
    UnidadeServicoEspecializado,
)
from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import ItemSolic, SolicitacaoMestre
from app.models.producao_ambulatorial import ProducaoAmbulatorial
from app.models.tfd import Paciente, Viagem, ViagemPaciente


def normalizar_competencia(competencia_in: str) -> tuple[str, str, date, date]:
    """Recebe competência em formato 'YYYY-MM' ou 'YYYYMM' e retorna:

    (aaaamm, yyyy_mm, data_inicio, data_fim)
    """
    comp_limpa = so_digitos(competencia_in)
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


def calcular_idade_em_anos(data_nascimento: date | str | None, data_referencia: date | None) -> int:
    """Calcula a idade em anos completos na data de referência."""
    if not data_nascimento:
        return 0
    if isinstance(data_nascimento, str):
        try:
            data_nascimento = date.fromisoformat(data_nascimento[:10])
        except (ValueError, TypeError):
            return 0
    ref = data_referencia or date.today()
    anos = ref.year - data_nascimento.year
    if (ref.month, ref.day) < (data_nascimento.month, data_nascimento.day):
        anos -= 1
    return max(0, min(anos, 999))


def eh_paciente_teste(paciente: Paciente | None) -> bool:
    """Detecta se o paciente é um registro de teste que deve ser ignorado."""
    if not paciente:
        return False
    if getattr(paciente, "eh_teste", False):
        return True
    nome = (paciente.nome or "").strip().lower()
    if "teste" in nome or "testes" in nome or nome.startswith("paciente teste"):
        return True
    cpf = so_digitos(paciente.cpf)
    if cpf in ("00000000000", "11111111111", "12345678909"):
        return True
    return False


def auditar_criticas_bpa_competencia(
    db: Session,
    competencia: str,
    unidade_saude_id: int | None = None,
) -> dict[str, Any]:
    """Varre todas as produções da competência e retorna lista estruturada de críticas.

    Verifica consistência de:
    - Profissionais (CNS módulo 11, CBO, Vínculo, CHS)
    - Unidades (CNES 7 dígitos, Tipo de Estabelecimento, Código IBGE, Resp. Técnico)
    - Procedimentos e Pacientes (BPA-I sem CNS, Faixa Etária, Sexo, Serviços Especializados)
    """
    aaaamm, yyyy_mm, dt_inicio, dt_fim = normalizar_competencia(competencia)

    criticas: list[dict[str, Any]] = []
    critica_counter = 0

    def add_critica(
        tipo: str,  # 'BLOQUEANTE' ou 'AVISO'
        modulo: str,  # 'PROFISSIONAL', 'UNIDADE', 'PROCEDIMENTO', 'PACIENTE'
        mensagem: str,
        registro_id: int | None = None,
        registro_identificador: str = "",
        sugestao_correcao: str = "",
        link_correcao: str = "",
    ):
        nonlocal critica_counter
        critica_counter += 1
        criticas.append({
            "id": f"crit_{critica_counter}",
            "tipo": tipo.upper(),
            "modulo": modulo.upper(),
            "mensagem": mensagem,
            "registro_id": registro_id,
            "registro_identificador": registro_identificador,
            "sugestao_correcao": sugestao_correcao,
            "link_correcao": link_correcao,
        })

    # Caches auxiliares
    unidades_cache: dict[int, UnidadeSaude | None] = {}
    medicos_cache: dict[int, Medico | None] = {}
    sigtap_cache: dict[str, SigtapProcedimento | None] = {}
    pacientes_cache: dict[int, Paciente | None] = {}
    servicos_unidade_cache: dict[int, set[str]] = {}

    def get_unidade(uid: int | None) -> UnidadeSaude | None:
        if not uid:
            return None
        if uid not in unidades_cache:
            unidades_cache[uid] = db.get(UnidadeSaude, uid)
        return unidades_cache[uid]

    def get_medico(mid: int | None) -> Medico | None:
        if not mid:
            return None
        if mid not in medicos_cache:
            medicos_cache[mid] = db.get(Medico, mid)
        return medicos_cache[mid]

    def get_paciente(pid: int | None) -> Paciente | None:
        if not pid:
            return None
        if pid not in pacientes_cache:
            pacientes_cache[pid] = db.get(Paciente, pid)
        return pacientes_cache[pid]

    def get_sigtap(codigo: str | None) -> SigtapProcedimento | None:
        if not codigo:
            return None
        cod = so_digitos(codigo).zfill(10)
        if cod not in sigtap_cache:
            proc = db.exec(
                select(SigtapProcedimento).where(SigtapProcedimento.codigo == cod)
            ).first()
            if not proc:
                # Tenta sem zfill caso o código original seja menor ou formatado
                proc = db.exec(
                    select(SigtapProcedimento).where(SigtapProcedimento.codigo == codigo.strip())
                ).first()
            sigtap_cache[cod] = proc
        return sigtap_cache[cod]

    def get_servicos_unidade(uid: int | None) -> set[str]:
        if not uid:
            return set()
        if uid not in servicos_unidade_cache:
            servicos = db.exec(
                select(UnidadeServicoEspecializado).where(
                    UnidadeServicoEspecializado.unidade_saude_id == uid,
                    UnidadeServicoEspecializado.ativo == True,  # noqa: E712
                )
            ).all()
            # Formatos suportados: '122' ou '122-001' ou '122001'
            chaves = set()
            for s in servicos:
                cod_s = so_digitos(s.servico_codigo)
                cod_c = so_digitos(s.classificacao_codigo)
                chaves.add(cod_s)
                chaves.add(f"{cod_s}-{cod_c}")
                chaves.add(f"{cod_s}{cod_c}")
            servicos_unidade_cache[uid] = chaves
        return servicos_unidade_cache[uid]

    # -------------------------------------------------------------
    # 1. COLETA DAS PRODUÇÕES DA COMPETÊNCIA
    # -------------------------------------------------------------
    # 1.1 Produções Ambulatoriais (ProducaoAmbulatorial)
    query_prod = select(ProducaoAmbulatorial).where(
        ProducaoAmbulatorial.competencia.in_([aaaamm, yyyy_mm])
        | (
            (ProducaoAmbulatorial.data_atendimento >= dt_inicio)
            & (ProducaoAmbulatorial.data_atendimento <= dt_fim)
        )
    )
    if unidade_saude_id:
        query_prod = query_prod.where(ProducaoAmbulatorial.unidade_saude_id == unidade_saude_id)

    producoes_amb = list(db.exec(query_prod).all())

    # 1.2 Exames Laboratoriais (SolicitacaoMestre + ItemSolic)
    query_lab = select(SolicitacaoMestre).where(
        SolicitacaoMestre.status.in_(["coletado", "realizado"]),
        SolicitacaoMestre.data_agendada >= dt_inicio,
        SolicitacaoMestre.data_agendada <= dt_fim,
    )
    if unidade_saude_id:
        query_lab = query_lab.where(SolicitacaoMestre.unidade_saude_id == unidade_saude_id)

    solicitacoes_lab = list(db.exec(query_lab).all())

    # 1.3 Viagens TFD (Viagem + ViagemPaciente)
    viagens_tfd: list[Viagem] = []
    # Viagens entram se for o faturamento geral do município (sem unidade específica)
    # ou se a unidade_saude_id for a unidade de TFD ou SMS
    deve_incluir_tfd = True
    if unidade_saude_id:
        u_sel = get_unidade(unidade_saude_id)
        if u_sel and so_digitos(u_sel.cnes) not in ("2147092", "2146479"):
            deve_incluir_tfd = False

    if deve_incluir_tfd:
        viagens_tfd = list(
            db.exec(
                select(Viagem).where(
                    Viagem.status == "realizada",
                    Viagem.data_viagem >= dt_inicio,
                    Viagem.data_viagem <= dt_fim,
                )
            ).all()
        )

    # -------------------------------------------------------------
    # 2. IDENTIFICAÇÃO E AUDITORIA DE UNIDADES DE SAÚDE
    # -------------------------------------------------------------
    unidades_auditadas_ids: set[int] = set()
    if unidade_saude_id:
        unidades_auditadas_ids.add(unidade_saude_id)

    for p_amb in producoes_amb:
        if p_amb.unidade_saude_id:
            unidades_auditadas_ids.add(p_amb.unidade_saude_id)

    for s_lab in solicitacoes_lab:
        if s_lab.unidade_saude_id:
            unidades_auditadas_ids.add(s_lab.unidade_saude_id)

    # Se não houver produções mas foi solicitada uma unidade, audita a unidade selecionada
    # Se não foi selecionada nenhuma unidade e não há produções, audita as unidades ativas
    if not unidades_auditadas_ids:
        unidades_ativas = db.exec(select(UnidadeSaude).where(UnidadeSaude.ativo == True)).all()  # noqa: E712
        for u in unidades_ativas:
            if u.id:
                unidades_auditadas_ids.add(u.id)

    for uid in unidades_auditadas_ids:
        u = get_unidade(uid)
        if not u:
            add_critica(
                tipo="BLOQUEANTE",
                modulo="UNIDADE",
                mensagem=f"Unidade de Saúde com ID {uid} referenciada na produção não foi encontrada no banco de dados.",
                registro_id=uid,
                registro_identificador=f"Unidade ID #{uid}",
                sugestao_correcao="Vincule as produções a uma Unidade de Saúde válida existente.",
                link_correcao="/cadastros/unidades",
            )
            continue

        nome_uni = u.nome or f"Unidade #{u.id}"
        cnes_limpo = so_digitos(u.cnes)

        # Crítica Unidade: CNES válido com 7 dígitos numéricos (Bloqueante)
        if not cnes_limpo or len(cnes_limpo) != 7:
            add_critica(
                tipo="BLOQUEANTE",
                modulo="UNIDADE",
                mensagem=(
                    f"A unidade '{nome_uni}' possui CNES ausente ou com tamanho inválido ('{u.cnes or ''}'). "
                    f"O CNES oficial DATASUS deve ter exatamente 7 dígitos numéricos."
                ),
                registro_id=u.id,
                registro_identificador=f"Unidade: {nome_uni}",
                sugestao_correcao="Acesse Cadastros > Unidades de Saúde e informe um CNES válido com 7 dígitos.",
                link_correcao=f"/cadastros/unidades?id={u.id}",
            )

        # Crítica Unidade: Tipo de Estabelecimento cadastrado (Bloqueante)
        tipo_est = (getattr(u, "tipo_estabelecimento", "") or "").strip()
        if not tipo_est:
            add_critica(
                tipo="BLOQUEANTE",
                modulo="UNIDADE",
                mensagem=(
                    f"A unidade '{nome_uni}' está sem o Tipo de Estabelecimento cadastrado. "
                    f"O CNES exige a tipologia do estabelecimento (ex: 01 Posto de Saúde, 02 Centro de Saúde/UBS, 04 Policlínica)."
                ),
                registro_id=u.id,
                registro_identificador=f"Unidade: {nome_uni}",
                sugestao_correcao="Cadastre o Tipo de Estabelecimento na Unidade de Saúde.",
                link_correcao=f"/cadastros/unidades?id={u.id}",
            )

        # Crítica Unidade: Código IBGE cadastrado (Bloqueante)
        ibge_uni = so_digitos(getattr(u, "codigo_ibge", "") or getattr(u, "municipio", ""))
        if not ibge_uni or len(ibge_uni) not in (6, 7):
            add_critica(
                tipo="BLOQUEANTE",
                modulo="UNIDADE",
                mensagem=(
                    f"A unidade '{nome_uni}' está sem o Código IBGE do Município regular "
                    f"(informado: '{getattr(u, 'codigo_ibge', '')}'). O SIA-SUS exige 6 dígitos (ex: 312810 para Guapé/MG)."
                ),
                registro_id=u.id,
                registro_identificador=f"Unidade: {nome_uni}",
                sugestao_correcao="Cadastre o Código IBGE oficial do Município (312810) na Unidade.",
                link_correcao=f"/cadastros/unidades?id={u.id}",
            )

        # Crítica Unidade: Responsável Técnico com CNS cadastrado (Aviso)
        resp_cns = so_digitos(getattr(u, "responsavel_tecnico_cns", ""))
        if not resp_cns:
            add_critica(
                tipo="AVISO",
                modulo="UNIDADE",
                mensagem=(
                    f"A unidade '{nome_uni}' não possui Responsável Técnico com Cartão SUS (CNS) informado."
                ),
                registro_id=u.id,
                registro_identificador=f"Unidade: {nome_uni}",
                sugestao_correcao="Vincule o Responsável Técnico e seu CNS no cadastro da Unidade de Saúde.",
                link_correcao=f"/cadastros/unidades?id={u.id}",
            )
        else:
            valido_cns_resp, motivo_resp = valida_cns(resp_cns)
            if not valido_cns_resp:
                add_critica(
                    tipo="AVISO",
                    modulo="UNIDADE",
                    mensagem=(
                        f"O CNS do Responsável Técnico da unidade '{nome_uni}' é inválido: {motivo_resp} ({resp_cns})."
                    ),
                    registro_id=u.id,
                    registro_identificador=f"Unidade: {nome_uni}",
                    sugestao_correcao="Atualize o CNS do Responsável Técnico para um número regular no padrão SUS.",
                    link_correcao=f"/cadastros/unidades?id={u.id}",
                )

    # -------------------------------------------------------------
    # 3. IDENTIFICAÇÃO E AUDITORIA DE PROFISSIONAIS
    # -------------------------------------------------------------
    profissionais_auditados_ids: set[int] = set()

    for p_amb in producoes_amb:
        if p_amb.medico_id:
            profissionais_auditados_ids.add(p_amb.medico_id)

    for s_lab in solicitacoes_lab:
        if s_lab.medico_id:
            profissionais_auditados_ids.add(s_lab.medico_id)

    # Profissionais fixos de TFD e Laboratório se houver produção correspondente
    # Checagem dos profissionais cadastrados:
    for mid in profissionais_auditados_ids:
        m = get_medico(mid)
        if not m:
            add_critica(
                tipo="BLOQUEANTE",
                modulo="PROFISSIONAL",
                mensagem=f"Profissional com ID #{mid} referenciado na produção ambulatorial não foi encontrado no cadastro.",
                registro_id=mid,
                registro_identificador=f"Profissional ID #{mid}",
                sugestao_correcao="Vincule a produção a um profissional médico ou da equipe existente.",
                link_correcao="/cadastros/medicos",
            )
            continue

        nome_prof = m.nome or f"Profissional #{m.id}"
        cns_prof = so_digitos(getattr(m, "cns", ""))

        # Crítica Profissional: CNS ou algoritmo módulo 11 inválido (Fatal/Bloqueante no SIA)
        if not cns_prof:
            add_critica(
                tipo="BLOQUEANTE",
                modulo="PROFISSIONAL",
                mensagem=(
                    f"Profissional '{nome_prof}' está sem Cartão Nacional de Saúde (CNS) cadastrado. "
                    f"O SIA-SUS rejeita fatalmente registros sem CNS do profissional executante."
                ),
                registro_id=m.id,
                registro_identificador=f"Profissional: {nome_prof}",
                sugestao_correcao="Acesse Cadastros > Profissionais de Saúde e informe um CNS de 15 dígitos.",
                link_correcao=f"/cadastros/medicos?id={m.id}",
            )
        else:
            valido_cns_p, motivo_cns_p = valida_cns(cns_prof)
            if not valido_cns_p:
                add_critica(
                    tipo="BLOQUEANTE",
                    modulo="PROFISSIONAL",
                    mensagem=(
                        f"Profissional '{nome_prof}' possui CNS com dígito verificador inválido ({cns_prof}): {motivo_cns_p} "
                        f"O algoritmo módulo 11 do DATASUS rejeita esse registro."
                    ),
                    registro_id=m.id,
                    registro_identificador=f"Profissional: {nome_prof}",
                    sugestao_correcao="Corrija o CNS do profissional para um número válido emitido pelo Ministério da Saúde.",
                    link_correcao=f"/cadastros/medicos?id={m.id}",
                )

        # Crítica Profissional: Sem CBO cadastrado (Bloqueante)
        cbo_prof = so_digitos(m.cbo_codigo)
        if not cbo_prof or len(cbo_prof) < 4:
            add_critica(
                tipo="BLOQUEANTE",
                modulo="PROFISSIONAL",
                mensagem=(
                    f"Profissional '{nome_prof}' não possui CBO (Ocupação SUS) cadastrado. "
                    f"A CBO de 6 dígitos é obrigatória no BPA-C e BPA-I."
                ),
                registro_id=m.id,
                registro_identificador=f"Profissional: {nome_prof}",
                sugestao_correcao="Cadastre o código CBO (ex: 225142 Médico Clínico) no cadastro do profissional.",
                link_correcao=f"/cadastros/medicos?id={m.id}",
            )

        # Crítica Profissional: Sem vínculo CNES cadastrado (Aviso)
        tem_vinculo = False
        if getattr(m, "unidades_ids", None):
            tem_vinculo = True
        if getattr(m, "unidade_saude_id", None):
            tem_vinculo = True
        # Verifica se está em alguma equipe
        equipe_vinculo = db.exec(
            select(EquipeProfissional).where(EquipeProfissional.medico_id == m.id)
        ).first()
        if equipe_vinculo:
            tem_vinculo = True

        if not tem_vinculo:
            add_critica(
                tipo="AVISO",
                modulo="PROFISSIONAL",
                mensagem=(
                    f"Profissional '{nome_prof}' não possui vínculo cadastrado a nenhuma Unidade de Saúde (CNES)."
                ),
                registro_id=m.id,
                registro_identificador=f"Profissional: {nome_prof}",
                sugestao_correcao="Vincule as Unidades de Saúde onde o profissional atua em seu cadastro.",
                link_correcao=f"/cadastros/medicos?id={m.id}",
            )

        # Crítica Profissional: Carga Horária Semanal (CHS) zerada ou inconsistente (Aviso)
        chs_val = (
            getattr(m, "chs_total", None)
            or getattr(m, "chs_ambulatorial", None)
            or getattr(m, "carga_horaria_semanal", None)
        )
        if chs_val is None or chs_val <= 0 or chs_val > 60:
            add_critica(
                tipo="AVISO",
                modulo="PROFISSIONAL",
                mensagem=(
                    f"Profissional '{nome_prof}' possui Carga Horária Semanal (CHS) inconsistente ({chs_val or 0}h). "
                    f"Cargas zeradas ou superiores a 60h semanais podem ser glosadas pelo CNES/SIA."
                ),
                registro_id=m.id,
                registro_identificador=f"Profissional: {nome_prof}",
                sugestao_correcao="Ajuste a Carga Horária Semanal (1 a 60h) no cadastro do profissional.",
                link_correcao=f"/cadastros/medicos?id={m.id}",
            )

    # -------------------------------------------------------------
    # 4. AUDITORIA DE PROCEDIMENTOS E PRODUÇÃO AMBULATORIAL
    # -------------------------------------------------------------
    for p_amb in producoes_amb:
        proc = get_sigtap(p_amb.procedimento_codigo)
        nome_proc = p_amb.procedimento_nome or (proc.descricao if proc else p_amb.procedimento_codigo)
        cod_proc = p_amb.procedimento_codigo
        instru = (p_amb.instrumento_registro or "BPA-C").upper()

        pac: Paciente | None = None
        if p_amb.paciente_id:
            pac = get_paciente(p_amb.paciente_id)
        if eh_paciente_teste(pac):
            continue

        nome_pac = p_amb.paciente_nome or (pac.nome if pac else "Paciente Não Identificado")

        # 4.1 BPA-I sem CNS do paciente (Bloqueante)
        if instru == "BPA-I":
            cns_pac = so_digitos(p_amb.paciente_cns or (pac.cns if pac else ""))
            if not cns_pac:
                add_critica(
                    tipo="BLOQUEANTE",
                    modulo="PACIENTE",
                    mensagem=(
                        f"Procedimento individualizado (BPA-I) '{cod_proc} - {nome_proc}' para o paciente '{nome_pac}' "
                        f"está sem Cartão SUS (CNS). Registros BPA-I exigem obrigatoriamente CNS válido."
                    ),
                    registro_id=p_amb.id,
                    registro_identificador=f"Produção #{p_amb.id} - Paciente: {nome_pac}",
                    sugestao_correcao="Informe o número do Cartão SUS (CNS) do paciente.",
                    link_correcao=f"/cadastros/pacientes?id={p_amb.paciente_id}" if p_amb.paciente_id else "/faturamento/bpa",
                )
            else:
                valido_cns_pac, mot_cns_pac = valida_cns(cns_pac)
                if not valido_cns_pac:
                    add_critica(
                        tipo="BLOQUEANTE",
                        modulo="PACIENTE",
                        mensagem=(
                            f"Procedimento individualizado (BPA-I) com CNS do paciente inválido ({cns_pac}): {mot_cns_pac} "
                            f"(Paciente: '{nome_pac}', Proc: {cod_proc})."
                        ),
                        registro_id=p_amb.id,
                        registro_identificador=f"Produção #{p_amb.id} - Paciente: {nome_pac}",
                        sugestao_correcao="Atualize o cadastro do paciente com o CNS regular.",
                        link_correcao=f"/cadastros/pacientes?id={p_amb.paciente_id}" if p_amb.paciente_id else "/faturamento/bpa",
                    )

        # 4.2 Faixa Etária Mínima/Máxima do SIGTAP (Bloqueante)
        dt_nasc = p_amb.paciente_data_nascimento or (pac.nascimento if pac else None)
        idade = calcular_idade_em_anos(dt_nasc, p_amb.data_atendimento)
        if proc:
            if proc.idade_min and proc.idade_min > 0 and idade < proc.idade_min:
                add_critica(
                    tipo="BLOQUEANTE",
                    modulo="PROCEDIMENTO",
                    mensagem=(
                        f"Paciente '{nome_pac}' possui {idade} ano(s), abaixo da idade mínima permitida "
                        f"({proc.idade_min} anos) para o procedimento '{cod_proc} - {nome_proc}'."
                    ),
                    registro_id=p_amb.id,
                    registro_identificador=f"Produção #{p_amb.id} - Proc: {cod_proc}",
                    sugestao_correcao="Verifique a data de nascimento do paciente ou utilize o procedimento pediátrico adequado.",
                    link_correcao="/faturamento/bpa",
                )
            if proc.idade_max and proc.idade_max > 0 and idade > proc.idade_max:
                add_critica(
                    tipo="BLOQUEANTE",
                    modulo="PROCEDIMENTO",
                    mensagem=(
                        f"Paciente '{nome_pac}' possui {idade} ano(s), acima da idade máxima permitida "
                        f"({proc.idade_max} anos) para o procedimento '{cod_proc} - {nome_proc}'."
                    ),
                    registro_id=p_amb.id,
                    registro_identificador=f"Produção #{p_amb.id} - Proc: {cod_proc}",
                    sugestao_correcao="Verifique a data de nascimento do paciente ou utilize o procedimento correspondente.",
                    link_correcao="/faturamento/bpa",
                )

        # 4.3 Sexo do paciente incompatível com regra do SIGTAP (Bloqueante)
        sexo_pac = (p_amb.paciente_sexo or (pac.sexo if pac else "") or "").strip().upper()[:1]
        if proc and proc.sexo:
            sexo_sigtap = proc.sexo.strip().upper()[:1]
            if sexo_sigtap in ("M", "F") and sexo_pac in ("M", "F") and sexo_sigtap != sexo_pac:
                desc_esperado = "Masculino" if sexo_sigtap == "M" else "Feminino"
                desc_atual = "Masculino" if sexo_pac == "M" else "Feminino"
                add_critica(
                    tipo="BLOQUEANTE",
                    modulo="PROCEDIMENTO",
                    mensagem=(
                        f"Procedimento '{cod_proc} - {nome_proc}' é exclusivo para o sexo {desc_esperado}, "
                        f"incompatível com o cadastro de '{nome_pac}' ({desc_atual})."
                    ),
                    registro_id=p_amb.id,
                    registro_identificador=f"Produção #{p_amb.id} - Proc: {cod_proc}",
                    sugestao_correcao="Revise o procedimento solicitado ou corrija o sexo no cadastro do paciente.",
                    link_correcao=f"/cadastros/pacientes?id={p_amb.paciente_id}" if p_amb.paciente_id else "/faturamento/bpa",
                )

        # 4.4 Exigência de Serviço Especializado / Classificação na regra do SIGTAP (Bloqueante/Aviso)
        serv_exigido = (p_amb.servico_codigo or "").strip()
        classif_exigida = (p_amb.classificacao_codigo or "").strip()
        if serv_exigido and p_amb.unidade_saude_id:
            servs_da_unidade = get_servicos_unidade(p_amb.unidade_saude_id)
            serv_cod_limpo = so_digitos(serv_exigido)
            classif_limpo = so_digitos(classif_exigida)
            chave_completa = f"{serv_cod_limpo}-{classif_limpo}" if classif_limpo else serv_cod_limpo

            if serv_cod_limpo not in servs_da_unidade and chave_completa not in servs_da_unidade:
                u_exec = get_unidade(p_amb.unidade_saude_id)
                nome_u_exec = u_exec.nome if u_exec else f"Unidade #{p_amb.unidade_saude_id}"
                add_critica(
                    tipo="AVISO",
                    modulo="UNIDADE",
                    mensagem=(
                        f"O procedimento '{cod_proc}' exige Serviço Especializado '{serv_exigido}/{classif_exigida or '001'}', "
                        f"que não consta cadastrado na Unidade executante '{nome_u_exec}'."
                    ),
                    registro_id=p_amb.id,
                    registro_identificador=f"Produção #{p_amb.id} - Serv: {serv_exigido}",
                    sugestao_correcao="Habilite o Serviço Especializado e Classificação na Unidade de Saúde em Cadastros.",
                    link_correcao=f"/cadastros/unidades?id={p_amb.unidade_saude_id}",
                )

    # -------------------------------------------------------------
    # 5. AUDITORIA DE EXAMES LABORATORIAIS
    # -------------------------------------------------------------
    for s_lab in solicitacoes_lab:
        pac = get_paciente(s_lab.paciente_id)
        if eh_paciente_teste(pac):
            continue

        nome_pac = pac.nome if pac else f"Paciente #{s_lab.paciente_id}"
        itens = list(db.exec(select(ItemSolic).where(ItemSolic.solicitacao_id == s_lab.id)).all())

        for it in itens:
            proc = db.get(SigtapProcedimento, it.sigtap_id)
            if not proc:
                continue

            cod_proc = proc.codigo.strip()
            nome_proc = proc.descricao
            instru = (getattr(proc, "instrumento", "") or "BPA-C").upper()

            # Checagem BPA-I
            if instru == "BPA-I":
                cns_pac = so_digitos(pac.cns if pac else "")
                if not cns_pac:
                    add_critica(
                        tipo="BLOQUEANTE",
                        modulo="PACIENTE",
                        mensagem=(
                            f"Exame individualizado (BPA-I) '{cod_proc} - {nome_proc}' para o paciente '{nome_pac}' "
                            f"está sem Cartão SUS (CNS)."
                        ),
                        registro_id=s_lab.id,
                        registro_identificador=f"Exame Solicitação #{s_lab.codigo_solicitacao or s_lab.id}",
                        sugestao_correcao="Informe o CNS no cadastro do paciente.",
                        link_correcao=f"/cadastros/pacientes?id={s_lab.paciente_id}",
                    )
                else:
                    valido_cns_pac, mot_cns_pac = valida_cns(cns_pac)
                    if not valido_cns_pac:
                        add_critica(
                            tipo="BLOQUEANTE",
                            modulo="PACIENTE",
                            mensagem=(
                                f"Exame BPA-I com CNS do paciente inválido ({cns_pac}): {mot_cns_pac} "
                                f"(Paciente: '{nome_pac}', Exame: {cod_proc})."
                            ),
                            registro_id=s_lab.id,
                            registro_identificador=f"Exame Solicitação #{s_lab.codigo_solicitacao or s_lab.id}",
                            sugestao_correcao="Corrija o CNS do paciente no cadastro geral.",
                            link_correcao=f"/cadastros/pacientes?id={s_lab.paciente_id}",
                        )

            # Faixa Etária Exame
            idade = calcular_idade_em_anos(pac.nascimento if pac else None, s_lab.data_agendada)
            if proc.idade_min and proc.idade_min > 0 and idade < proc.idade_min:
                add_critica(
                    tipo="BLOQUEANTE",
                    modulo="PROCEDIMENTO",
                    mensagem=(
                        f"Paciente '{nome_pac}' possui {idade} ano(s), abaixo da idade mínima permitida "
                        f"({proc.idade_min} anos) para o exame '{cod_proc} - {nome_proc}'."
                    ),
                    registro_id=s_lab.id,
                    registro_identificador=f"Exame Solicitação #{s_lab.codigo_solicitacao or s_lab.id}",
                    sugestao_correcao="Verifique a data de nascimento do paciente ou selecione o exame apropriado.",
                    link_correcao="/laboratorio/gestao-lotes",
                )
            if proc.idade_max and proc.idade_max > 0 and idade > proc.idade_max:
                add_critica(
                    tipo="BLOQUEANTE",
                    modulo="PROCEDIMENTO",
                    mensagem=(
                        f"Paciente '{nome_pac}' possui {idade} ano(s), acima da idade máxima permitida "
                        f"({proc.idade_max} anos) para o exame '{cod_proc} - {nome_proc}'."
                    ),
                    registro_id=s_lab.id,
                    registro_identificador=f"Exame Solicitação #{s_lab.codigo_solicitacao or s_lab.id}",
                    sugestao_correcao="Verifique a data de nascimento do paciente.",
                    link_correcao="/laboratorio/gestao-lotes",
                )

            # Sexo Exame
            sexo_pac = (pac.sexo if pac else "")[:1].upper()
            if proc.sexo:
                sexo_sigtap = proc.sexo.strip().upper()[:1]
                if sexo_sigtap in ("M", "F") and sexo_pac in ("M", "F") and sexo_sigtap != sexo_pac:
                    desc_esperado = "Masculino" if sexo_sigtap == "M" else "Feminino"
                    desc_atual = "Masculino" if sexo_pac == "M" else "Feminino"
                    add_critica(
                        tipo="BLOQUEANTE",
                        modulo="PROCEDIMENTO",
                        mensagem=(
                            f"Exame '{cod_proc} - {nome_proc}' é exclusivo para o sexo {desc_esperado}, "
                            f"incompatível com o cadastro de '{nome_pac}' ({desc_atual})."
                        ),
                        registro_id=s_lab.id,
                        registro_identificador=f"Exame Solicitação #{s_lab.codigo_solicitacao or s_lab.id}",
                        sugestao_correcao="Revise a solicitação do exame ou o sexo cadastrado no paciente.",
                        link_correcao=f"/cadastros/pacientes?id={s_lab.paciente_id}",
                    )

    # -------------------------------------------------------------
    # 6. AUDITORIA DE VIAGENS TFD
    # -------------------------------------------------------------
    for v in viagens_tfd:
        passageiros = list(db.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id == v.id)).all())
        for vp in passageiros:
            pac = get_paciente(vp.paciente_id)
            if eh_paciente_teste(pac):
                continue

            nome_pac = pac.nome if pac else f"Paciente #{vp.paciente_id}"
            cns_pac = so_digitos(pac.cns if pac else "")

            # Deslocamento TFD sempre gera BPA-I
            if not cns_pac:
                add_critica(
                    tipo="BLOQUEANTE",
                    modulo="PACIENTE",
                    mensagem=(
                        f"Viagem TFD #{v.id} para {v.destino}: o paciente passageiro '{nome_pac}' está sem Cartão SUS (CNS). "
                        f"O procedimento 0803010125 (Deslocamento de Usuário) exige BPA-I com CNS."
                    ),
                    registro_id=v.id,
                    registro_identificador=f"Viagem TFD #{v.id} - Paciente: {nome_pac}",
                    sugestao_correcao="Informe o CNS no cadastro do paciente para faturamento do TFD.",
                    link_correcao=f"/cadastros/pacientes?id={vp.paciente_id}",
                )
            else:
                valido_cns_pac, mot_cns_pac = valida_cns(cns_pac)
                if not valido_cns_pac:
                    add_critica(
                        tipo="BLOQUEANTE",
                        modulo="PACIENTE",
                        mensagem=(
                            f"Viagem TFD #{v.id} com CNS do passageiro '{nome_pac}' inválido: {mot_cns_pac} ({cns_pac})."
                        ),
                        registro_id=v.id,
                        registro_identificador=f"Viagem TFD #{v.id} - Paciente: {nome_pac}",
                        sugestao_correcao="Atualize o CNS no cadastro do paciente.",
                        link_correcao=f"/cadastros/pacientes?id={vp.paciente_id}",
                    )

    # Contadores e Consolidação Final
    total_bloqueantes = sum(1 for c in criticas if c["tipo"] == "BLOQUEANTE")
    total_avisos = sum(1 for c in criticas if c["tipo"] == "AVISO")

    return {
        "competencia": yyyy_mm,
        "competencia_aaaamm": aaaamm,
        "unidade_saude_id": unidade_saude_id,
        "total_criticas": len(criticas),
        "total_bloqueantes": total_bloqueantes,
        "total_avisos": total_avisos,
        "bloqueia_exportacao": (total_bloqueantes > 0),
        "pode_exportar": (total_bloqueantes == 0),
        "total_producoes_ambulatoriais": len(producoes_amb),
        "total_solicitacoes_lab": len(solicitacoes_lab),
        "total_viagens_tfd": len(viagens_tfd),
        "criticas": criticas,
    }
