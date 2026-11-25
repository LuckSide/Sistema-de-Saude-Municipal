"""Testes automatizados da Exportação Oficial do BPA (SIA/SUS) no formato .OUT e .CSV.

Garante 100% de paridade com o layout oficial do DATASUS:
- Header 01: exatamente 130 caracteres (+ CRLF)
- Registro 02 (BPA-C): exatamente 48 caracteres (+ CRLF)
- Registro 03 (BPA-I): exatamente 351 caracteres (+ CRLF)
- Presença de Exames Laboratoriais e Viagens/Transporte TFD (Grupo 08)
- Exclusão rigorosa de pacientes de teste
"""

from datetime import date
import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import ItemSolic, Laboratorio, SolicitacaoMestre
from app.models.tfd import Paciente, Viagem, ViagemPaciente
from app.services.bpa_export_service import (
    calcular_controle_bpa,
    eh_paciente_teste,
    formatar_header_01,
    formatar_registro_02,
    formatar_registro_03,
    gerar_bpa_completo_municipio,
    obter_quantidade_deslocamento,
)


@pytest.fixture
def db_session():
    """Banco em memória isolado para os testes do BPA."""
    engine = create_engine("sqlite:///:memory:", echo=False)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def test_formatar_header_01_comprimento_e_campos():
    """Valida tamanho e paridade do Header 01 (130 caracteres)."""
    header = formatar_header_01(
        competencia_aaaamm="202610",
        total_linhas_arquivo=3614,
        total_folhas_arquivo=181,
        controle_verificador=1785,
    )
    assert len(header) == 130
    assert header.startswith("01#BPA#2026100036140001811785SMS GUAPE")
    assert "312810" in header
    assert "18239616000185" in header
    assert "SECRETARIA MUNICIPAL DE SAUDE" in header


def test_formatar_registro_02_comprimento_e_campos():
    """Valida tamanho exato de 48 caracteres do Registro 02 (BPA-C)."""
    reg02 = formatar_registro_02(
        cnes="2146479",
        competencia_aaaamm="202610",
        cbo="223415",
        folha=1,
        linha_num=5,
        procedimento="0202010473",
        quantidade=96,
        idade=0,
    )
    assert len(reg02) == 48
    assert reg02.startswith("022146479202610223415001050202010473")
    assert reg02.endswith("000000096BPA")


def test_formatar_registro_03_comprimento_e_campos():
    """Valida tamanho exato de 351 caracteres do Registro 03 (BPA-I)."""
    reg03 = formatar_registro_03(
        cnes="2147092",
        competencia_aaaamm="202610",
        cns_profissional="703403201915616",
        cbo_profissional="225142",
        data_atendimento=date(2026, 10, 20),
        folha=118,
        linha_num=12,
        procedimento="0803010109",
        cns_paciente="700000000000000",
        sexo="M",
        codigo_ibge="312810",
        cid="",
        idade=75,
        quantidade=6,
        nome_paciente="PEDRO JOSE RODRIGUES",
        data_nascimento=date(1951, 4, 15),
        cep="37177000",
        tipo_logradouro="037",
        logradouro="PAINEIRAS",
        numero="28",
        bairro="ZONA RURAL",
        telefone="35999601967",
        cpf_paciente="89073908604",
    )
    assert len(reg03) == 351
    assert reg03.startswith("03214709220261070340320191561622514220261020118120803010109")
    assert "PEDRO JOSE RODRIGUES" in reg03
    assert reg03.endswith("89073908604NN")


def test_controle_checksum_datasus():
    """Valida que o algoritmo oficial ((sum_procs + sum_qtd) % 1111) + 1111 é respeitado."""
    itens_02 = [
        {"procedimento": "0202010473", "quantidade": 10},
        {"procedimento": "0202010317", "quantidade": 5},
    ]
    itens_03 = [
        {"procedimento": "0803010125", "quantidade": 6},
    ]
    # soma procs = 202010473 + 202010317 + 803010125 = 1207030915
    # soma qtds = 10 + 5 + 6 = 21
    # total = 1207030936
    # 1207030936 % 1111 = 931
    # controle = 931 + 1111 = 2042
    ctrl = calcular_controle_bpa(itens_02, itens_03)
    assert 1111 <= ctrl <= 2221
    esperado = ((1207030915 + 21) % 1111) + 1111
    assert ctrl == esperado


def test_deteccao_paciente_teste():
    """Garante que registros de teste são detectados e filtrados."""
    p_normal = Paciente(nome="Maria de Fatima Oliveira", cpf="12345678900", eh_teste=False)
    p_teste1 = Paciente(nome="Paciente Teste de Sistema", cpf="99988877766", eh_teste=False)
    p_teste2 = Paciente(nome="Jose Carlos Testes", cpf="55544433322", eh_teste=False)
    p_teste3 = Paciente(nome="Carlos Silva", cpf="11122233344", eh_teste=True)
    p_teste4 = Paciente(nome="Ana Paula", cpf="00000000000", eh_teste=False)

    assert eh_paciente_teste(p_normal) is False
    assert eh_paciente_teste(p_teste1) is True
    assert eh_paciente_teste(p_teste2) is True
    assert eh_paciente_teste(p_teste3) is True
    assert eh_paciente_teste(p_teste4) is True


def test_geracao_bpa_completo_integrando_lab_e_tfd(db_session: Session):
    """Teste fim-a-fim da geração do BPA com laboratório (BPA-C e BPA-I) e viagens TFD."""
    # 1. Cadastro de Procedimentos SIGTAP
    proc_hemo = SigtapProcedimento(
        codigo="0202010473",
        descricao="DOSAGEM DE GLICOSE",
        instrumento="BPA-C",
        valor_sa=1.85,
    )
    proc_hiv = SigtapProcedimento(
        codigo="0202031209",
        descricao="TESTE RAPIDO PARA HIV",
        instrumento="BPA-I",
        valor_sa=12.50,
    )
    proc_tfd_usr = SigtapProcedimento(
        codigo="0803010125",
        descricao="DESLOCAMENTO DE USUARIO",
        instrumento="BPA-I",
        valor_sa=8.85,
    )
    proc_tfd_acomp = SigtapProcedimento(
        codigo="0803010109",
        descricao="DESLOCAMENTO DE ACOMPANHANTE",
        instrumento="BPA-I",
        valor_sa=8.85,
    )
    db_session.add_all([proc_hemo, proc_hiv, proc_tfd_usr, proc_tfd_acomp])
    db_session.commit()

    # 2. Cadastro de Pacientes Reais e de Teste e Laboratório
    lab = Laboratorio(nome="Laboratório Municipal de Guapé", ativo=True)
    db_session.add(lab)
    db_session.commit()

    pac_real1 = Paciente(
        nome="BENEDITA APARECIDA DA SILVA",
        cpf="11122233344",
        cns="700508575563459",
        nascimento=date(1975, 5, 20),
        sexo="F",
        endereco="RUA DAS FLORES",
        endereco_numero="120",
        bairro="CENTRO",
        cep="37177000",
        telefone="35999887766",
        eh_teste=False,
    )
    pac_real2 = Paciente(
        nome="ANTONIO MARCOS PEREIRA",
        cpf="22233344455",
        cns="701112223334445",
        nascimento=date(1960, 10, 10),
        sexo="M",
        endereco="AVENIDA BRASIL",
        endereco_numero="450",
        bairro="NOVA ERA",
        cep="37177000",
        telefone="35988776655",
        eh_teste=False,
    )
    pac_teste = Paciente(
        nome="TESTE DA SILVA SAUDE",
        cpf="99999999999",
        nascimento=date(1990, 1, 1),
        sexo="M",
        eh_teste=True,
    )
    db_session.add_all([pac_real1, pac_real2, pac_teste])
    db_session.commit()

    # 3. Cadastro de Exames Laboratoriais (Competência 2026-10)
    solic1 = SolicitacaoMestre(
        paciente_id=pac_real1.id,
        laboratorio_id=lab.id,
        data_agendada=date(2026, 10, 15),
        status="realizado",
    )
    solic_teste = SolicitacaoMestre(
        paciente_id=pac_teste.id,
        laboratorio_id=lab.id,
        data_agendada=date(2026, 10, 15),
        status="realizado",
    )
    db_session.add_all([solic1, solic_teste])
    db_session.commit()

    item_hemo = ItemSolic(solicitacao_id=solic1.id, sigtap_id=proc_hemo.id, quantidade=2)
    item_hiv = ItemSolic(solicitacao_id=solic1.id, sigtap_id=proc_hiv.id, quantidade=1)
    item_teste = ItemSolic(solicitacao_id=solic_teste.id, sigtap_id=proc_hemo.id, quantidade=10)
    db_session.add_all([item_hemo, item_hiv, item_teste])
    db_session.commit()

    # 4. Cadastro de Viagens TFD (Competência 2026-10)
    viagem1 = Viagem(
        destino="PASSOS",  # quantidade padrão 6
        data_viagem=date(2026, 10, 20),
        status="realizada",
    )
    viagem_cancelada = Viagem(
        destino="ALFENAS",
        data_viagem=date(2026, 10, 22),
        status="cancelada",  # Não deve ser faturada
    )
    db_session.add_all([viagem1, viagem_cancelada])
    db_session.commit()

    vp1 = ViagemPaciente(
        viagem_id=viagem1.id,
        paciente_id=pac_real2.id,
        acompanhante="MARIA PEREIRA ACOMPANHANTE",
        acompanhante_cpf="33344455566",
    )
    vp_cancelada = ViagemPaciente(
        viagem_id=viagem_cancelada.id,
        paciente_id=pac_real1.id,
    )
    db_session.add_all([vp1, vp_cancelada])
    db_session.commit()

    # 5. Geração do BPA Oficial
    resultado = gerar_bpa_completo_municipio(db_session, "2026-10")

    assert resultado["competencia"] == "2026-10"
    assert resultado["competencia_aaaamm"] == "202610"
    assert resultado["total_procedimentos_bpa_c"] == 1  # GLICOSE consolidada
    # BPA-I deve conter 1 HIV + 1 Deslocamento Usuário (Antonio) + 1 Deslocamento Acompanhante (Maria)
    assert resultado["total_procedimentos_bpa_i"] == 3
    assert resultado["total_exames"] == 3  # 2 glicoses + 1 HIV
    assert resultado["total_viagens_tfd"] == 2  # 1 paciente + 1 acompanhante

    # Validação rigorosa do arquivo binário/posicional (.OUT)
    conteudo_out = resultado["conteudo_out"]
    linhas = conteudo_out.split("\r\n")
    # A última linha vazia pós CRLF final é descartada
    if linhas[-1] == "":
        linhas = linhas[:-1]

    assert len(linhas) == resultado["total_linhas"]

    # Valida linha 01 (Header)
    header = linhas[0]
    assert len(header) == 130
    assert header.startswith("01#BPA#202610")

    # Valida linha 02 (BPA-C)
    linha_02 = linhas[1]
    assert len(linha_02) == 48
    assert linha_02.startswith("02")
    assert "0202010473" in linha_02
    assert linha_02.endswith("000002BPA")

    # Valida linhas 03 (BPA-I)
    for l03 in linhas[2:]:
        assert len(l03) == 351
        assert l03.startswith("03")
        assert l03.endswith("NN")

    # Garante presença dos códigos de TFD
    procs_no_arquivo = [l[49:59] for l in linhas if l.startswith("03")]
    assert "0803010125" in procs_no_arquivo  # Deslocamento Usuário
    assert "0803010109" in procs_no_arquivo  # Deslocamento Acompanhante
    assert "0202031209" in procs_no_arquivo  # HIV individualizado

    # Garante que paciente de teste NÃO está no arquivo
    for l in linhas:
        assert "TESTE DA SILVA" not in l
        assert "99999999999" not in l

    # Valida codificação latin-1 limpa
    bytes_out = resultado["conteudo_out_bytes"]
    assert isinstance(bytes_out, bytes)
    assert bytes_out.decode("iso-8859-1") == conteudo_out

    # Valida CSV de conferência
    csv_str = resultado["conteudo_csv"]
    assert "Tipo_Registro;Folha;Linha;CNES" in csv_str
    assert "0803010125" in csv_str
    assert "0803010109" in csv_str
    assert "0202010473" in csv_str
    assert "TESTE DA SILVA" not in csv_str
    assert "99999999999" not in csv_str


def test_regra_documento_unico_paciente_datasus():
    """Valida Observação 2 do Layout DATASUS (ou CPF ou CNS, nunca ambos preenchidos simultaneamente)."""
    # Caso 1: Paciente com CPF informado -> CPF preenchido, CNS em branco
    reg_cpf = formatar_registro_03(
        cnes="2146479",
        competencia_aaaamm="202611",
        cns_profissional="700508575563459",
        cbo_profissional="223415",
        data_atendimento=date(2026, 11, 23),
        folha=1,
        linha_num=1,
        procedimento="0202010694",
        cns_paciente="700507958321651",
        sexo="F",
        codigo_ibge="312810",
        cid="",
        idade=51,
        quantidade=1,
        nome_paciente="ADRIANA MARIA GARCIA ALCANTARA",
        data_nascimento=date(1975, 6, 20),
        cpf_paciente="03154787640",
    )
    assert len(reg_cpf) == 351
    # CNS do paciente (pos 60-74, índice 59-74) deve estar em branco
    assert reg_cpf[59:74] == " " * 15
    # CPF do paciente (pos 339-349, índice 338-349) deve ter 11 dígitos
    assert reg_cpf[338:349] == "03154787640"

    # Caso 2: Paciente sem CPF -> CNS preenchido, CPF em branco
    reg_cns = formatar_registro_03(
        cnes="2146479",
        competencia_aaaamm="202611",
        cns_profissional="700508575563459",
        cbo_profissional="223415",
        data_atendimento=date(2026, 11, 23),
        folha=1,
        linha_num=2,
        procedimento="0202010694",
        cns_paciente="700507958321651",
        sexo="F",
        codigo_ibge="312810",
        cid="",
        idade=51,
        quantidade=1,
        nome_paciente="ADRIANA MARIA GARCIA ALCANTARA",
        data_nascimento=date(1975, 6, 20),
        cpf_paciente="",
    )
    assert len(reg_cns) == 351
    # CNS do paciente preenchido com 15 dígitos
    assert reg_cns[59:74] == "700507958321651"
    # CPF do paciente em branco
    assert reg_cns[338:349] == " " * 11


def test_mapeamento_preventivo_codigos_legados(db_session):
    """Garante que códigos legados com equivalência SIGTAP são convertidos e extra-SUS (99999...) são omitidos do .OUT."""
    from app.models.cadastros_saude import UnidadeSaude

    u = UnidadeSaude(nome="LABORATORIO MUNICIPAL", cnes="2147009", tipo="LABORATORIO")
    lab = Laboratorio(nome="LABORATORIO CENTRAL", cnpj="18239616000185")
    p = Paciente(nome="ADRIANA MARIA GARCIA ALCANTARA", cpf="03154787640", cns="700507958321651", nascimento=date(1975, 6, 20), eh_teste=False)
    proc_mapeavel = SigtapProcedimento(codigo="9999900217", descricao="TESTE FTA-ABS IGG", instrumento="BPA-I")
    proc_extra_sus = SigtapProcedimento(codigo="9999900275", descricao="DOSAGEM DO ANTÍGENO CA 15-3", instrumento="BPA-I")
    db_session.add_all([u, lab, p, proc_mapeavel, proc_extra_sus])
    db_session.commit()

    solic = SolicitacaoMestre(paciente_id=p.id, laboratorio_id=lab.id, unidade_saude_id=u.id, data_agendada=date(2026, 11, 23), status="realizado")
    db_session.add(solic)
    db_session.commit()

    item1 = ItemSolic(solicitacao_id=solic.id, sigtap_id=proc_mapeavel.id, quantidade=1)
    item2 = ItemSolic(solicitacao_id=solic.id, sigtap_id=proc_extra_sus.id, quantidade=1)
    db_session.add_all([item1, item2])
    db_session.commit()

    resultado = gerar_bpa_completo_municipio(db_session, "2026-11")
    linhas = [l for l in resultado["conteudo_out"].split("\r\n") if l.startswith("03")]
    assert len(linhas) == 1
    procs = [l[49:59] for l in linhas]
    # 9999900217 deve ser convertido para 0202031411 (FTA-ABS oficial)
    assert "0202031411" in procs
    # 9999900275 (CA 15-3 extra-tabela SUS) não deve vazar para o arquivo BPA oficial
    assert "9999900275" not in procs


def test_bpa_usa_configuracoes_institucionais_dinamicas(db_session):
    """Garante que o cabeçalho BPA e o nome do arquivo respeitam os campos de SystemSettings."""
    from app.models.settings import SystemSettings

    cfg = SystemSettings(
        id=1,
        cidade="Capitolio",
        uf="MG",
        codigo_ibge="311280",
        cnpj_orgao_gestor="11222333000144",
        nome_orgao_gestor="SMS CAPITOLIO",
        sigla_orgao_gestor="311280",
        nome_orgao_destino="SECRETARIA DE SAUDE CAPITOLIO",
        tipo_orgao_destino="M",
        cnes_sms_padrao="2223334",
        cnes_tfd_padrao="2223335",
    )
    db_session.add(cfg)
    db_session.commit()

    resultado = gerar_bpa_completo_municipio(db_session, "2026-11")
    header = resultado["conteudo_out"].split("\r\n")[0]
    assert len(header) == 130
    assert "SMS CAPITOLIO" in header
    assert "31128011222333000144" in header
    assert "SECRETARIA DE SAUDE CAPITOLIO" in header
    assert resultado["arquivo_nome_out"] == "PA311280.OUT"


def test_auto_update_web_desabilitado():
    """Garante que a execução de auto-update via endpoint web está desabilitada (apenas via script)."""
    from fastapi import HTTPException
    from app.api.v1.update import executar_update

    with pytest.raises(HTTPException) as exc:
        executar_update(admin=None, _=None)
    assert exc.value.status_code == 403
    assert "desabilitada" in exc.value.detail.lower()
