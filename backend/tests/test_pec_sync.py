from datetime import date, datetime
from unittest.mock import MagicMock, patch
import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.cadastros_saude import UnidadeSaude
from app.models.integracoes import IntegrationSettings, PecSyncLog
from app.models.tfd import Paciente
from app.services.pec_sync import (
    calcular_completude_endereco,
    comparar_nomes_mae,
    limpar_cns,
    limpar_cpf,
    normalizar_nome,
    sincronizar_pacientes_pec,
)


@pytest.fixture
def sqlite_session():
    test_engine = create_engine("sqlite:///:memory:", echo=False)
    SQLModel.metadata.create_all(test_engine)
    with Session(test_engine) as session:
        cfg = IntegrationSettings(
            id=1,
            pec_fonte="postgres",
            pec_ssh_habilitado=True,
            pec_ssh_host="192.168.1.1",
            pec_database_url="postgresql://user:pass@127.0.0.1:5433/esus",
            pec_sync_automatica=True,
            pec_sync_intervalo_horas=6,
        )
        session.add(cfg)
        session.commit()
        yield session


def test_helpers_limpeza():
    assert limpar_cpf("123.456.789-01") == "12345678901"
    assert limpar_cpf("111.111.111-11") == ""  # Todos iguais
    assert limpar_cpf("123") == ""
    assert limpar_cpf(None) == ""

    assert limpar_cns("700000000000001") == "700000000000001"
    assert limpar_cns("700.0000.0000.0001") == "700000000000001"
    assert limpar_cns("123") == ""
    assert limpar_cns(None) == ""

    assert normalizar_nome("  João   de  Alencar ") == "JOAO DE ALENCAR"
    assert normalizar_nome("Érica Conceição") == "ERICA CONCEICAO"


def test_comparar_nomes_mae():
    assert comparar_nomes_mae("", "Maria da Silva") is True
    assert comparar_nomes_mae("Maria", "") is True
    assert comparar_nomes_mae("Maria da Silva", "MARIA DA SILVA") is True
    assert comparar_nomes_mae("Maria da Silva", "Maria de Souza") is True  # Mesmo primeiro nome
    assert comparar_nomes_mae("Ana Paula", "Maria da Silva") is False


def test_sincronizacao_desduplicacao_mesmo_cidadao(sqlite_session: Session):
    """Testa que prontuários duplicados no e-SUS PEC (um com CNS e outro com CPF)
    são unificados em um único paciente no sistema local.
    """
    mock_rows = [
        {
            "co_seq_cidadao": 101,
            "no_cidadao": "Maria Aparecida da Silva",
            "no_social": "",
            "nu_cpf": "",
            "nu_cns": "700000000000001",
            "dt_nascimento": date(1975, 4, 12),
            "no_sexo": "FEMININO",
            "no_mae": "Benedita da Silva",
            "nu_telefone_celular": "35999991111",
            "nu_telefone_contato": "",
            "nu_telefone_residencial": "",
            "ds_logradouro": "Rua das Flores",
            "nu_numero": "120",
            "ds_complemento": "Casa",
            "no_bairro": "Centro",
            "ds_cep": "37177000",
            "ds_ponto_referencia": "Perto da Igreja",
            "nu_micro_area": "02",
            "dt_atualizado": datetime(2026, 1, 10, 10, 0),
            "st_ativo": 1,
            "nu_cnes": "2134567",
            "no_unidade_saude": "PSF Centro",
            "nu_ine": "0001234567",
            "no_equipe": "Equipe 1",
        },
        # Segunda ficha no PEC da mesma pessoa: cadastrada com CPF, sem CNS
        {
            "co_seq_cidadao": 102,
            "no_cidadao": "MARIA APARECIDA DA SILVA",
            "no_social": "",
            "nu_cpf": "12345678901",
            "nu_cns": "",
            "dt_nascimento": date(1975, 4, 12),
            "no_sexo": "FEMININO",
            "no_mae": "BENEDITA DA SILVA",
            "nu_telefone_celular": "35999991111",
            "nu_telefone_contato": "",
            "nu_telefone_residencial": "",
            "ds_logradouro": "Rua das Flores",
            "nu_numero": "120",
            "ds_complemento": "Casa",
            "no_bairro": "Centro",
            "ds_cep": "37177000",
            "ds_ponto_referencia": "Perto da Igreja",
            "nu_micro_area": "02",
            "dt_atualizado": datetime(2026, 1, 15, 14, 0),
            "st_ativo": 1,
            "nu_cnes": "2134567",
            "no_unidade_saude": "PSF Centro",
            "nu_ine": "0001234567",
            "no_equipe": "Equipe 1",
        },
    ]

    mock_result = MagicMock()
    mock_result.mappings.return_value = mock_rows

    mock_conn = MagicMock()
    mock_conn.execute.return_value = mock_result
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.__exit__.return_value = None

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn

    with patch("app.services.pec_sync.garantir_tunel_db", return_value=(True, "postgresql://mock")):
        with patch("sqlalchemy.create_engine", return_value=mock_engine):
            log = sincronizar_pacientes_pec(sqlite_session, origem="teste")

            assert log.status == "SUCESSO"
            assert log.total_lidos == 2
            assert log.total_inseridos == 1
            assert log.total_duplicados_mesclados == 1

            # Verifica que no banco local há apenas 1 paciente
            pacientes = sqlite_session.exec(select(Paciente)).all()
            assert len(pacientes) == 1

            pac = pacientes[0]
            assert pac.nome == "Maria Aparecida da Silva"
            # Os dois identificadores foram consolidados!
            assert pac.cpf == "12345678901"
            assert pac.cns == "700000000000001"
            assert pac.unidade_cnes == "2134567"
            assert pac.microarea == "02"


def test_sincronizacao_nao_mescla_pessoas_distintas(sqlite_session: Session):
    """Garante que homônimos com datas de nascimento distintas ou mães distintas
    não são indevidamente agrupados.
    """
    mock_rows = [
        {
            "co_seq_cidadao": 201,
            "no_cidadao": "Jose da Silva",
            "no_social": "",
            "nu_cpf": "11122233344",
            "nu_cns": "700000000000010",
            "dt_nascimento": date(1960, 1, 1),
            "no_sexo": "MASCULINO",
            "no_mae": "Maria Silva",
            "nu_telefone_celular": "",
            "nu_telefone_contato": "",
            "nu_telefone_residencial": "",
            "ds_logradouro": "Rua 1",
            "nu_numero": "10",
            "ds_complemento": "",
            "no_bairro": "Centro",
            "ds_cep": "",
            "ds_ponto_referencia": "",
            "nu_micro_area": "01",
            "dt_atualizado": None,
            "st_ativo": 1,
            "nu_cnes": "",
            "no_unidade_saude": "",
            "nu_ine": "",
            "no_equipe": "",
        },
        # Filho com mesmo nome ou homônimo nascido em data diferente
        {
            "co_seq_cidadao": 202,
            "no_cidadao": "Jose da Silva",
            "no_social": "",
            "nu_cpf": "55566677788",
            "nu_cns": "700000000000020",
            "dt_nascimento": date(1990, 5, 20),
            "no_sexo": "MASCULINO",
            "no_mae": "Ana Souza",
            "nu_telefone_celular": "",
            "nu_telefone_contato": "",
            "nu_telefone_residencial": "",
            "ds_logradouro": "Rua 2",
            "nu_numero": "20",
            "ds_complemento": "",
            "no_bairro": "Bela Vista",
            "ds_cep": "",
            "ds_ponto_referencia": "",
            "nu_micro_area": "03",
            "dt_atualizado": None,
            "st_ativo": 1,
            "nu_cnes": "",
            "no_unidade_saude": "",
            "nu_ine": "",
            "no_equipe": "",
        },
    ]

    mock_result = MagicMock()
    mock_result.mappings.return_value = mock_rows

    mock_conn = MagicMock()
    mock_conn.execute.return_value = mock_result
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.__exit__.return_value = None

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn

    with patch("app.services.pec_sync.garantir_tunel_db", return_value=(True, "postgresql://mock")):
        with patch("sqlalchemy.create_engine", return_value=mock_engine):
            log = sincronizar_pacientes_pec(sqlite_session, origem="teste")

            assert log.status == "SUCESSO"
            assert log.total_lidos == 2
            assert log.total_inseridos == 2
            assert log.total_duplicados_mesclados == 0

            pacientes = sqlite_session.exec(select(Paciente)).all()
            assert len(pacientes) == 2


def test_calcular_completude_endereco():
    # Endereço vazio -> 0
    assert calcular_completude_endereco("", "", "", "", "") == 0
    # Apenas logradouro genérico
    score_fraco = calcular_completude_endereco("Rua", "S/N", "", "", "")
    # Endereço com número e bairro
    score_bom = calcular_completude_endereco("Rua das Palmeiras", "105", "", "Centro", "")
    assert score_bom > score_fraco
    # Endereço completo com CEP e complemento
    score_completo = calcular_completude_endereco("Rua das Palmeiras", "105", "Apto 201", "Centro", "37177-000")
    assert score_completo > score_bom


def test_sincronizacao_preserva_endereco_mais_completo(sqlite_session: Session):
    """Garante que ao mesclar registros da mesma pessoa (duplicidade PEC), o endereço
    mais completo e detalhado é preservado e não sobrescrito por um endereço vazio/incompleto.
    """
    mock_rows = [
        # Ficha 1: Endereço completo
        {
            "co_seq_cidadao": 301,
            "no_cidadao": "Carlos Eduardo de Lima",
            "no_social": "",
            "nu_cpf": "99887766554",
            "nu_cns": "700000000000030",
            "dt_nascimento": date(1982, 3, 15),
            "no_sexo": "MASCULINO",
            "no_mae": "Sonia de Lima",
            "nu_telefone_celular": "35988880001",
            "nu_telefone_contato": "",
            "nu_telefone_residencial": "",
            "ds_logradouro": "Avenida Brasil",
            "nu_numero": "500",
            "ds_complemento": "Bloco B Apt 12",
            "no_bairro": "São Cristóvão",
            "ds_cep": "37177000",
            "ds_ponto_referencia": "Ao lado do mercado",
            "nu_micro_area": "04",
            "dt_atualizado": datetime(2026, 1, 1, 10, 0),
            "st_ativo": 1,
            "nu_cnes": "2134567",
            "no_unidade_saude": "PSF Centro",
            "nu_ine": "",
            "no_equipe": "",
        },
        # Ficha 2: Mesmo CPF, mas endereço quase vazio (ex: cadastrado rápido no posto)
        {
            "co_seq_cidadao": 302,
            "no_cidadao": "CARLOS EDUARDO DE LIMA",
            "no_social": "",
            "nu_cpf": "99887766554",
            "nu_cns": "",
            "dt_nascimento": date(1982, 3, 15),
            "no_sexo": "MASCULINO",
            "no_mae": "SONIA DE LIMA",
            "nu_telefone_celular": "",
            "nu_telefone_contato": "",
            "nu_telefone_residencial": "",
            "ds_logradouro": "",
            "nu_numero": "",
            "ds_complemento": "",
            "no_bairro": "",
            "ds_cep": "",
            "ds_ponto_referencia": "",
            "nu_micro_area": "",
            "dt_atualizado": datetime(2026, 2, 1, 10, 0),
            "st_ativo": 1,
            "nu_cnes": "2134567",
            "no_unidade_saude": "PSF Centro",
            "nu_ine": "",
            "no_equipe": "",
        },
    ]

    mock_result = MagicMock()
    mock_result.mappings.return_value = mock_rows

    mock_conn = MagicMock()
    mock_conn.execute.return_value = mock_result
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.__exit__.return_value = None

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn

    with patch("app.services.pec_sync.garantir_tunel_db", return_value=(True, "postgresql://mock")):
        with patch("sqlalchemy.create_engine", return_value=mock_engine):
            log = sincronizar_pacientes_pec(sqlite_session, origem="teste")

            assert log.status == "SUCESSO"
            assert log.total_lidos == 2
            assert log.total_inseridos == 1
            assert log.total_duplicados_mesclados == 1

            pacientes = sqlite_session.exec(select(Paciente).where(Paciente.cpf == "99887766554")).all()
            assert len(pacientes) == 1
            pac = pacientes[0]

            # Garante que o endereço completo foi mantido e não apagado!
            assert pac.endereco == "Avenida Brasil"
            assert pac.endereco_numero == "500"
            assert pac.complemento == "Bloco B Apt 12"
            assert pac.bairro == "São Cristóvão"
            assert pac.cep == "37177000"


def test_sincronizacao_nao_importa_obito_mudanca_inativo_e_outra_cidade(sqlite_session: Session):
    """Garante que apenas cidadãos ativos e residentes no município sejam importados,
    ignorando óbitos, mudanças de município, visitantes de outras cidades, inativos e sem identificação.
    """
    from app.services.pec_sync import classificar_situacao_pec

    assert classificar_situacao_pec({"st_faleceu": 1})[0] == "obito"
    assert classificar_situacao_pec({"st_mudanca": 1}, "Guapé")[0] == "mudanca_municipio"
    assert classificar_situacao_pec({"no_municipio_raw": "Boa Esperança"}, "Guapé")[0] == "mudanca_municipio"
    assert classificar_situacao_pec({"st_ativo": 0}, "Guapé")[0] == "inativo"
    assert classificar_situacao_pec({"st_ativo_para_exibicao": 0}, "Guapé")[0] == "inativo"
    assert classificar_situacao_pec({"st_ativo": 1, "no_municipio_raw": "Guapé"}, "Guapé")[0] == "ativo"

    mock_rows = [
        # 1. Cidadão elegível ativo de Guapé -> deve ser importado
        {
            "co_seq_cidadao": 401,
            "no_cidadao": "Ana Paula Ferreira",
            "nu_cpf": "32165498700",
            "nu_cns": "700000000000401",
            "dt_nascimento": date(1988, 7, 14),
            "no_mae": "Lucia Ferreira",
            "no_municipio_raw": "Guapé",
            "st_ativo": 1,
        },
        # 2. Óbito no PEC -> NÃO importar
        {
            "co_seq_cidadao": 402,
            "no_cidadao": "Antônio Falecido",
            "nu_cpf": "32165498701",
            "dt_nascimento": date(1940, 1, 1),
            "st_faleceu_pec": 1,
            "st_ativo": 1,
        },
        # 3. Mudança de município -> NÃO importar
        {
            "co_seq_cidadao": 403,
            "no_cidadao": "Mariana Mudou",
            "nu_cpf": "32165498702",
            "dt_nascimento": date(1992, 2, 10),
            "no_municipio_raw": "Belo Horizonte",
            "st_ativo": 1,
        },
        # 4. Inativo / unificado no PEC -> NÃO importar
        {
            "co_seq_cidadao": 404,
            "no_cidadao": "Registro Desativado",
            "nu_cpf": "32165498703",
            "dt_nascimento": date(1970, 3, 5),
            "st_ativo": 0,
        },
        # 5. Registro genérico / incompleto sem CPF/CNS/Nascimento -> NÃO importar
        {
            "co_seq_cidadao": 405,
            "no_cidadao": "NAO IDENTIFICADO",
            "nu_cpf": "",
            "nu_cns": "",
            "dt_nascimento": None,
            "st_ativo": 1,
        },
    ]

    mock_result = MagicMock()
    mock_result.mappings.return_value = mock_rows
    mock_conn = MagicMock()
    mock_conn.execute.return_value = mock_result
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.__exit__.return_value = None
    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn

    with patch("app.services.pec_sync.garantir_tunel_db", return_value=(True, "postgresql://mock")):
        with patch("sqlalchemy.create_engine", return_value=mock_engine):
            log = sincronizar_pacientes_pec(sqlite_session, origem="teste")

    assert log.status == "SUCESSO"
    assert log.total_lidos == 5
    assert log.total_inseridos == 1
    assert log.total_ignorados_pec == 4

    pacs = sqlite_session.exec(select(Paciente)).all()
    assert len(pacs) == 1
    assert pacs[0].nome == "Ana Paula Ferreira"


def test_consolidar_pacientes_duplicados_e_pruning_fantasmas(sqlite_session: Session):
    """Unifica duplicatas pré-existentes (preservando vínculos e gêmeos distintos)
    e remove fantasmas PEC inelegíveis sem histórico assistencial.
    """
    from app.models.tfd import ExameFila, ViagemFila
    from app.services.pec_sync import consolidar_pacientes_duplicados

    # 1. Legado sem nascimento/CPF com vínculo na fila + cadastro completo + sobrenome casado
    p_leg = Paciente(nome="MARIA APARECIDA SILVA", cpf="", cns="", nascimento=None, nome_mae="NAO INFORMADO")
    p_comp = Paciente(
        nome="Maria Aparecida da Silva",
        cpf="12345678909",
        cns="700000000000999",
        nascimento=date(1975, 4, 12),
        nome_mae="BENEDITA SILVA",
        endereco="Rua Principal",
        endereco_numero="42",
        bairro="Centro",
        cep="37177000",
        co_seq_cidadao_pec=801,
    )
    p_casado = Paciente(
        nome="Maria Aparecida da Silva Oliveira",
        cpf="12345678909",
        nascimento=date(1975, 4, 12),
        nome_mae="Benedita da Silva",
    )
    # 2. Fantasma PEC em óbito sem vínculo clínico -> deve ser podado
    p_ghost = Paciente(
        nome="Fantasma Obito",
        cpf="98765432100",
        nascimento=date(1930, 1, 1),
        co_seq_cidadao_pec=9001,
        situacao_cadastral="obito",
    )
    # 3. Cidadão em óbito COM histórico assistencial -> deve ser preservado
    p_hist = Paciente(
        nome="Paciente Historico Obito",
        cpf="98765432101",
        nascimento=date(1945, 5, 5),
        co_seq_cidadao_pec=9002,
        situacao_cadastral="obito",
    )
    # 4. Gêmeos com mesma mãe e data de nascimento -> NÃO devem ser mesclados
    g1 = Paciente(nome="MARIA CLARA SILVA", cpf="11100011101", nascimento=date(2010, 3, 1), nome_mae="ANA SILVA")
    g2 = Paciente(nome="MARIA PAULA SILVA", cpf="11100011102", nascimento=date(2010, 3, 1), nome_mae="ANA SILVA")

    sqlite_session.add_all([p_leg, p_comp, p_casado, p_ghost, p_hist, g1, g2])
    sqlite_session.commit()
    for p in (p_leg, p_comp, p_casado, p_ghost, p_hist):
        sqlite_session.refresh(p)

    ex_leg = ExameFila(paciente_id=p_leg.id, exame="ULTRASSOM", data_pedido=date(2026, 1, 10))
    vf_leg = ViagemFila(paciente_id=p_leg.id, destino="Alfenas")
    ex_hist = ExameFila(paciente_id=p_hist.id, exame="ECOCARDIOGRAMA", status="realizado", data_pedido=date(2025, 8, 1))
    sqlite_session.add_all([ex_leg, vf_leg, ex_hist])
    sqlite_session.commit()

    res = consolidar_pacientes_duplicados(sqlite_session, remover_inelegiveis_sem_vinculo=True)
    assert res["duplicados_mesclados"] == 2
    assert res["inelegiveis_removidos"] == 1
    assert res["total_depois"] == 4  # Maria unificada + Historico Obito + 2 gêmeos

    marias = [
        p for p in sqlite_session.exec(select(Paciente)).all()
        if "APARECIDA" in p.nome.upper()
    ]
    assert len(marias) == 1
    assert marias[0].cpf == "12345678909"
    assert marias[0].cns == "700000000000999"
    # Referências migradas para a Maria sobrevivente
    ex_migrado = sqlite_session.get(ExameFila, ex_leg.id)
    assert ex_migrado is not None and ex_migrado.paciente_id == marias[0].id
    # Fantasma removido, histórico preservado, gêmeos intactos
    assert sqlite_session.get(Paciente, p_ghost.id) is None
    assert sqlite_session.get(Paciente, p_hist.id) is not None


def test_nao_duplica_com_mae_placeholder_e_bloqueia_manual(sqlite_session: Session):
    """Placeholders em nome_mae ('NAO INFORMADO') não bloqueiam dedup, fichas inativas não
    desativam cidadão ativo e criação manual impede duplicidade."""
    from fastapi import HTTPException
    from app.api.v1.tfd import criar_paciente
    from app.schemas.tfd import PacienteIn

    mock_rows = [
        {
            "co_seq_cidadao": 501,
            "no_cidadao": "Carlos Souza",
            "nu_cpf": "22233344455",
            "nu_cns": "",
            "dt_nascimento": date(1980, 5, 5),
            "no_mae": "NAO INFORMADO",
            "st_ativo": 1,
        },
        {
            "co_seq_cidadao": 502,
            "no_cidadao": "Carlos de Souza",
            "nu_cpf": "",
            "nu_cns": "700000000000502",
            "dt_nascimento": date(1980, 5, 5),
            "no_mae": "JOANA SOUZA",
            "st_ativo": 0,
        },
    ]

    mock_result = MagicMock()
    mock_result.mappings.return_value = mock_rows
    mock_conn = MagicMock()
    mock_conn.execute.return_value = mock_result
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.__exit__.return_value = None
    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn

    with patch("app.services.pec_sync.garantir_tunel_db", return_value=(True, "postgresql://mock")):
        with patch("sqlalchemy.create_engine", return_value=mock_engine):
            log = sincronizar_pacientes_pec(sqlite_session, origem="teste")

    assert log.status == "SUCESSO"
    pacs = sqlite_session.exec(select(Paciente)).all()
    assert len(pacs) == 1
    assert pacs[0].cpf == "22233344455"
    assert pacs[0].cns == "700000000000502"
    assert pacs[0].situacao_cadastral == "ativo"

    # Tentativa de criação manual com mesmo CPF formatado deve falhar (bloqueio de duplicidade)
    with pytest.raises(HTTPException) as exc:
        criar_paciente(
            PacienteIn(nome="CARLOS SOUZA", cpf="222.333.444-55"),
            db=sqlite_session,
        )
    assert exc.value.status_code == 400

