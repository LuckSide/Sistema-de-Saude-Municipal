"""Testes automatizados das Críticas Preventivas do CNES e Demonstrativo de Faturamento BPA.

Valida conformidade rigorosa com regras do SIA-SUS / DATASUS:
- Críticas de Profissionais (CNS módulo 11, CBO, Vínculo, CHS)
- Críticas de Unidades de Saúde (CNES 7 dígitos, Tipo Estabelecimento, IBGE, Resp. Técnico)
- Críticas de Procedimentos (BPA-I sem CNS, Faixa Etária SIGTAP, Sexo SIGTAP, Serviço Especializado)
- Bloqueio preventivo na exportação quando houver críticas bloqueantes e bypass com forcar=True
- Demonstrativo formal de faturamento ambulatorial consolidado e por CNES
"""

from datetime import date
import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.models.cadastros_saude import Medico, UnidadeSaude, UnidadeServicoEspecializado
from app.models.lab_exames import SigtapProcedimento
from app.models.producao_ambulatorial import ProducaoAmbulatorial
from app.models.tfd import Paciente
from app.services.bpa_export_service import (
    gerar_bpa_completo_municipio,
    obter_demonstrativo_faturamento,
)
from app.services.cnes_criticas_service import auditar_criticas_bpa_competencia


@pytest.fixture
def db():
    """Banco SQLite em memória com schemas criados."""
    engine = create_engine("sqlite:///:memory:", echo=False)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def test_criticas_unidade_saude(db: Session):
    """Testa detecção de CNES inválido, falta de tipo de estabelecimento e IBGE na Unidade."""
    uni_invalida = UnidadeSaude(
        nome="Posto de Saúde Incompleto",
        cnes="123",  # Menos de 7 dígitos
        tipo_estabelecimento="",  # Ausente
        codigo_ibge="",  # Ausente
        responsavel_tecnico_cns="",  # Ausente
        ativo=True,
    )
    db.add(uni_invalida)
    db.commit()

    resultado = auditar_criticas_bpa_competencia(db, "2026-11", unidade_saude_id=uni_invalida.id)

    modulos = [c["modulo"] for c in resultado["criticas"]]
    tipos = [c["tipo"] for c in resultado["criticas"]]

    assert "UNIDADE" in modulos
    assert "BLOQUEANTE" in tipos
    assert resultado["total_bloqueantes"] >= 3
    assert resultado["bloqueia_exportacao"] is True


def test_criticas_profissional_cns_cbo_chs(db: Session):
    """Testa profissional sem CNS, com CNS inválido no módulo 11, sem CBO e com CHS zerada."""
    uni = UnidadeSaude(
        nome="UBS Centro Guapé",
        cnes="2146479",
        tipo_estabelecimento="02",
        codigo_ibge="312810",
        responsavel_tecnico_cns="700508575563459",
        ativo=True,
    )
    db.add(uni)
    db.commit()

    med_invalido = Medico(
        nome="Dr. Inconsistente",
        cns="123456789012345",  # Dígito verificador inválido
        cbo_codigo="",  # Sem CBO
        chs_total=0,  # CHS zerada
        unidades_ids="",  # Sem vínculo
        ativo=True,
    )
    db.add(med_invalido)
    db.commit()

    proc = SigtapProcedimento(
        codigo="0301010072",
        descricao="CONSULTA MEDICA EM ATENCAO BASICA",
        instrumento="BPA-C",
        valor_sa=10.00,
    )
    db.add(proc)
    db.commit()

    producao = ProducaoAmbulatorial(
        unidade_saude_id=uni.id,
        medico_id=med_invalido.id,
        procedimento_id=proc.id,
        procedimento_codigo=proc.codigo,
        procedimento_nome=proc.descricao,
        cbo_codigo="",
        competencia="202611",
        data_atendimento=date(2026, 11, 10),
        instrumento_registro="BPA-C",
        quantidade=1,
    )
    db.add(producao)
    db.commit()

    resultado = auditar_criticas_bpa_competencia(db, "2026-11", unidade_saude_id=uni.id)

    mensagens = " ".join([c["mensagem"] for c in resultado["criticas"]])
    assert "dígito verificador inválido" in mensagens or "sem Cartão Nacional de Saúde" in mensagens
    assert "CBO" in mensagens
    assert resultado["total_bloqueantes"] > 0
    assert resultado["bloqueia_exportacao"] is True


def test_criticas_procedimento_bpai_sem_cns_faixa_etaria_sexo(db: Session):
    """Testa produção BPA-I sem CNS, idade fora da faixa SIGTAP e sexo incompatível."""
    uni = UnidadeSaude(
        nome="Centro de Especialidades",
        cnes="2146479",
        tipo_estabelecimento="04",
        codigo_ibge="312810",
        responsavel_tecnico_cns="700508575563459",
        ativo=True,
    )
    med = Medico(
        nome="Dra. Valida",
        cns="700508575563459",
        cbo_codigo="225142",
        chs_total=40,
        unidades_ids=str(uni.id),
        ativo=True,
    )
    db.add_all([uni, med])
    db.commit()

    # Procedimento exclusivo Feminino, idade mínima 15 e máxima 60
    proc_fem = SigtapProcedimento(
        codigo="0204030030",
        descricao="MAMOGRAFIA BILATERAL PARA RASTREAMENTO",
        instrumento="BPA-I",
        sexo="F",
        idade_min=40,
        idade_max=69,
        valor_sa=45.00,
    )
    db.add(proc_fem)
    db.commit()

    # Paciente Masculino de 10 anos sem CNS
    paciente_incompativel = Paciente(
        nome="MENINO JOAO",
        cns="",  # Sem CNS em BPA-I
        sexo="M",  # Sexo incompatível com mamografia
        nascimento=date(2016, 5, 10),  # 10 anos na data (abaixo de 40)
    )
    db.add(paciente_incompativel)
    db.commit()

    prod_bpai = ProducaoAmbulatorial(
        unidade_saude_id=uni.id,
        medico_id=med.id,
        procedimento_id=proc_fem.id,
        procedimento_codigo=proc_fem.codigo,
        procedimento_nome=proc_fem.descricao,
        cbo_codigo=med.cbo_codigo,
        competencia="202611",
        data_atendimento=date(2026, 11, 15),
        instrumento_registro="BPA-I",
        quantidade=1,
        paciente_id=paciente_incompativel.id,
        paciente_nome=paciente_incompativel.nome,
        paciente_cns=paciente_incompativel.cns,
        paciente_sexo=paciente_incompativel.sexo,
        paciente_data_nascimento=paciente_incompativel.nascimento,
    )
    db.add(prod_bpai)
    db.commit()

    resultado = auditar_criticas_bpa_competencia(db, "2026-11", unidade_saude_id=uni.id)

    mensagens = " ".join([c["mensagem"] for c in resultado["criticas"]])
    assert "sem Cartão SUS (CNS)" in mensagens or "sem CNS" in mensagens
    assert "abaixo da idade mínima permitida" in mensagens
    assert "exclusivo para o sexo Feminino" in mensagens
    assert resultado["total_bloqueantes"] >= 3


def test_bloqueio_exportacao_e_bypass_com_forcar(db: Session):
    """Verifica que críticas bloqueantes impedem a exportação com forcar=False e liberam com forcar=True."""
    uni = UnidadeSaude(nome="Unidade Sem CNES", cnes="000", tipo_estabelecimento="", ativo=True)
    db.add(uni)
    db.commit()

    # Com verificar_criticas=True e forcar=False: deve lançar ValueError
    with pytest.raises(ValueError) as excinfo:
        gerar_bpa_completo_municipio(
            db,
            "2026-11",
            unidade_saude_id=uni.id,
            forcar=False,
            verificar_criticas=True,
        )
    assert "Exportação BPA bloqueada" in str(excinfo.value)

    # Com forcar=True: deve gerar o arquivo sem erros
    res_forcado = gerar_bpa_completo_municipio(
        db,
        "2026-11",
        unidade_saude_id=uni.id,
        forcar=True,
        verificar_criticas=True,
    )
    assert res_forcado["total_linhas"] >= 1
    assert "PA312810" in res_forcado["arquivo_nome_out"]


def test_demonstrativo_faturamento_por_cnes_e_geral(db: Session):
    """Verifica agregação do Demonstrativo de Faturamento ambulatorial e por CNES."""
    uni1 = UnidadeSaude(nome="UBS Centro", cnes="2146479", ativo=True)
    uni2 = UnidadeSaude(nome="ESF Rural", cnes="2146487", ativo=True)
    db.add_all([uni1, uni2])
    db.commit()

    proc1 = SigtapProcedimento(
        codigo="0301010072",
        descricao="CONSULTA MEDICA EM ATENCAO BASICA",
        instrumento="BPA-C",
        valor_sa=10.00,
        valor_sh=0.0,
    )
    proc2 = SigtapProcedimento(
        codigo="0301060061",
        descricao="ATENDIMENTO DE URGENCIA COM OBSERVACAO",
        instrumento="BPA-C",
        valor_sa=25.50,
        valor_sh=5.0,
    )
    db.add_all([proc1, proc2])
    db.commit()

    p1 = ProducaoAmbulatorial(
        unidade_saude_id=uni1.id,
        medico_id=1,
        procedimento_id=proc1.id,
        procedimento_codigo=proc1.codigo,
        procedimento_nome=proc1.descricao,
        cbo_codigo="225142",
        competencia="202611",
        data_atendimento=date(2026, 11, 5),
        instrumento_registro="BPA-C",
        quantidade=10,
        valor_unitario=10.00,
        valor_total=100.00,
    )
    p2 = ProducaoAmbulatorial(
        unidade_saude_id=uni2.id,
        medico_id=1,
        procedimento_id=proc2.id,
        procedimento_codigo=proc2.codigo,
        procedimento_nome=proc2.descricao,
        cbo_codigo="225142",
        competencia="202611",
        data_atendimento=date(2026, 11, 8),
        instrumento_registro="BPA-C",
        quantidade=4,
        valor_unitario=25.50,
        valor_total=102.00,
    )
    db.add_all([p1, p2])
    db.commit()

    demonstrativo = obter_demonstrativo_faturamento(db, "2026-11")

    assert demonstrativo["competencia"] == "2026-11"
    assert demonstrativo["quantidade_total_geral"] == 14
    assert demonstrativo["valor_total_ambulatorial"] == 202.00
    assert len(demonstrativo["por_cnes"]) == 2

    # Testando filtro de unidade específica
    dem_uni1 = obter_demonstrativo_faturamento(db, "2026-11", unidade_saude_id=uni1.id)
    assert dem_uni1["quantidade_total_geral"] == 10
    assert dem_uni1["valor_total_ambulatorial"] == 100.00
