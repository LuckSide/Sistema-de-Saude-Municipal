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

