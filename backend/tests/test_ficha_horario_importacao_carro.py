"""Testes unitários e de integração para:
1. Ficha de viagem (Ordem de Circulação): 1 pessoa por linha, acompanhante na linha abaixo com observação explícita.
2. Horário automático ao criar / sugerir / gerar viagem automaticamente.
3. Conversão JSON -> CSV e importação idempotente de viagens de carro TFD.
"""

from datetime import date, timedelta
from io import BytesIO
import json

import pytest
from docx import Document
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, select

from app.api.v1.tfd import (
    ViagemIn,
    criar_viagem,
    gerar_viagem_automatica,
    ordem_circulacao,
    sugestao_frota,
)
from app.models.tfd import Faturamento, Paciente, Veiculo, Viagem, ViagemFila, ViagemPaciente
from app.models.user import User
from app.services.importacao_viagens_carro import (
    converter_json_para_csv,
    ler_viagens_carro,
    processar_viagens_carro,
)
from app.services.ordem_circulacao import gerar_ordem


@pytest.fixture
def session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def _admin() -> User:
    return User(id=1, username="admin", nome="Administrador", is_superuser=True, permite_retroativo=True)


def test_ficha_viagem_uma_pessoa_por_linha_e_acompanhante_abaixo(session: Session):
    """Cada linha da ficha contém estritamente 1 pessoa; acompanhante desce para a linha abaixo com observação."""
    pac = Paciente(nome="Maria Oliveira", nascimento=date(1980, 5, 10), municipio="Guapé")
    acomp = Paciente(nome="João Oliveira", nascimento=date(1978, 3, 20), municipio="Guapé")
    pac2 = Paciente(nome="Carlos Souza", nascimento=date(1990, 1, 15), municipio="Guapé")
    session.add_all([pac, acomp, pac2])
    session.flush()

    viagem = Viagem(
        destino="PASSOS",
        data_viagem=date(2026, 12, 1),
        hora_saida="05:00",
        hora_retorno="14:00",
        status="agendada",
    )
    session.add(viagem)
    session.flush()

    session.add_all([
        ViagemPaciente(
            viagem_id=viagem.id,
            paciente_id=pac.id,
            acompanhante="João Oliveira",
            acompanhante_id=acomp.id,
            tratamento="Cardiologia",
            unidade="Hospital Passos",
            hora_consulta="08:00",
            observacoes="Levar exames",
            presente=True,
        ),
        ViagemPaciente(
            viagem_id=viagem.id,
            paciente_id=pac2.id,
            acompanhante="",
            tratamento="Oftalmologia",
            unidade="Clínica Olhos",
            hora_consulta="09:30",
            presente=True,
        ),
    ])
    session.commit()

    resp = ordem_circulacao(viagem.id, db=session, ator=_admin())
    assert resp.status_code == 200

    # Verifica também o gerador DOCX diretamente (mesma lista 1-pessoa-por-linha)
    blob_docx = gerar_ordem(
        veiculo_modelo="Spin",
        placa="ABC1234",
        destino="PASSOS",
        motorista="José",
        departamento="Saúde",
        data_saida="2026-12-01",
        hora_saida="05:00",
        km_inicial="100",
        data_retorno="",
        hora_retorno="14:00",
        km_final="",
        adiantamento="",
        passageiros=[
            {
                "paciente_nome": "Maria Oliveira",
                "paciente_nascimento": "1980-05-10",
                "tratamento": "Cardiologia",
                "observacoes": "Levar exames",
                "unidade": "Hospital Passos",
                "hora_consulta": "08:00",
            },
            {
                "paciente_nome": "João Oliveira",
                "paciente_nascimento": "1978-03-20",
                "tratamento": "Acompanhante",
                "observacoes": "Acompanhante de Maria Oliveira",
                "unidade": "Hospital Passos",
                "hora_consulta": "08:00",
            },
            {
                "paciente_nome": "Carlos Souza",
                "paciente_nascimento": "1990-01-15",
                "tratamento": "Oftalmologia",
                "observacoes": "",
                "unidade": "Clínica Olhos",
                "hora_consulta": "09:30",
            },
        ],
    )
    doc = Document(BytesIO(blob_docx))
    tbl_pax = doc.tables[-1]
    nomes = [r.cells[1].text.strip() for r in tbl_pax.rows[1:4]]
    trat_obs = [r.cells[3].text.strip() for r in tbl_pax.rows[1:4]]
    nasc = [r.cells[2].text.strip() for r in tbl_pax.rows[1:4]]

    assert nomes == ["Maria Oliveira", "João Oliveira", "Carlos Souza"]
    assert "Acompanhante de" not in nomes[1]
    assert "Acompanhante de Maria Oliveira" in trat_obs[1]
    assert nasc[1] == "20/03/1978"

    # E garante que o endpoint ODT/DOCX preenche igualmente cada linha com 1 pessoa só
    from zipfile import ZipFile

    if resp.body[:2] == b"PK":
        with ZipFile(BytesIO(resp.body)) as zf:
            if "content.xml" in zf.namelist():
                xml_txt = zf.read("content.xml").decode("utf-8", errors="ignore")
                assert "João Oliveira (Acompanhante de" not in xml_txt
                assert "Obs.: Acompanhante de Maria Oliveira" in xml_txt
            elif "word/document.xml" in zf.namelist():
                xml_txt = zf.read("word/document.xml").decode("utf-8", errors="ignore")
                assert "João Oliveira (Acompanhante de" not in xml_txt
                assert "Acompanhante de Maria Oliveira" in xml_txt


def test_horario_automatico_ao_criar_e_gerar_viagem_automaticamente(session: Session):
    """Gerar viagem automaticamente e criar sem hora preenchem hora_saida e hora_retorno automaticamente."""
    pac = Paciente(nome="Ana Paula", municipio="Guapé")
    veic = Veiculo(placa="XYZ9876", modelo="Doblô", capacidade=5, tipo="carro", status="disponivel", ativo=True)
    session.add_all([pac, veic])
    session.flush()

    dt_amanha = date.today() + timedelta(days=2)
    fila = ViagemFila(
        paciente_id=pac.id,
        destino="PIUMHI",
        tratamento="Ortopedia",
        data_consulta=dt_amanha,
        hora_consulta="13:30",
        acompanhante=True,
        acompanhante_nome="Pedro Paula",
        status="aguardando",
    )
    session.add(fila)
    session.commit()

    ator = _admin()

    # 1. Sugestão já calcula hora_saida = 11:30 (-2h da consulta das 13:30) e retorno +9h = 20:30
    sug = sugestao_frota(data=dt_amanha.isoformat(), destino="PIUMHI", viagem_id=None, db=session, _=ator)
    assert sug["veiculo"]["id"] == veic.id
    assert sug["hora_saida"] == "11:30"
    assert sug["hora_retorno"] == "20:30"

    # 2. Gerar viagem automaticamente cria viagem com horário calculado, veículo e aloca paciente
    res_auto = gerar_viagem_automatica(
        {"data_viagem": dt_amanha.isoformat(), "destino": "PIUMHI", "alocar_fila": True},
        db=session,
        ator=ator,
    )
    assert res_auto["hora_saida"] == "11:30"
    assert res_auto["hora_retorno"] == "20:30"
    assert res_auto["veiculo_id"] == veic.id
    assert res_auto["alocados"] == 1

    # 3. Criar viagem manual sem hora_saida também preenche automaticamente (usando histórico ou padrão)
    dt_fut = date.today() + timedelta(days=4)
    v_sem_hora = criar_viagem(
        ViagemIn(destino="PIUMHI", data_viagem=dt_fut, hora_saida=""),
        db=session,
        ator=ator,
    )
    assert v_sem_hora.hora_saida == "11:30"
    assert v_sem_hora.hora_retorno == "20:30"


def test_converter_json_para_csv_e_importar_viagens_carro_idempotente(session: Session):
    """Converte JSON de viagens de carro para CSV, simula, grava 1 pessoa por linha e garante idempotência."""
    amostra_json = [
        {
            "arquivo": "Viagens numero 50.doc",
            "arquivo_sha1": "ccd8af76d2d9e35e7408b7f8d53725f0dad30e0d",
            "data": "17/09/2026",
            "hora": "07:00",
            "destino": "piumhi",
            "tipo": "PACIENTE",
            "prontuario": "151820",
            "nome": "Lucimar Aparecida Silva Dutra",
            "procedimento": "9999900116",
            "quantidade": "2",
            "protocolo": "2190473",
            "em": "17/09/2026 12:05:27",
        },
        {
            "arquivo": "Viagens numero 50.doc",
            "arquivo_sha1": "ccd8af76d2d9e35e7408b7f8d53725f0dad30e0d",
            "data": "17/09/2026",
            "hora": "07:00",
            "destino": "piumhi",
            "tipo": "ACOMPANHANTE",
            "prontuario": "154020",
            "nome": "Nyller Gustavo Silva Dutra",
            "procedimento": "9999900117",
            "quantidade": "2",
            "protocolo": "2190474",
            "em": "17/09/2026 12:05:28",
        },
        {
            "arquivo": "Viagens 9 de 01.doc",
            "arquivo_sha1": "aaa1112223334445556667778889990001112223",
            "data": "18/09/2026",
            "hora": "8:00",
            "destino": "Ilicinea",
            "tipo": "PACIENTE",
            "prontuario": "160001",
            "nome": "José da Silva",
            "procedimento": "9999900129",
            "quantidade": "1",
            "protocolo": "2190500",
            "em": "18/09/2026 09:00:00",
        },
    ]

    csv_bytes = converter_json_para_csv(json.dumps(amostra_json).encode("utf-8"))
    linhas_csv = ler_viagens_carro(csv_bytes, "csv")
    assert len(linhas_csv) == 3

    # 1. Simulação (dry-run com rollback)
    res_sim = processar_viagens_carro(
        linhas_csv, session, simular=True, criar_pacientes_novos=True, gerar_faturamento=True, ator_nome="Tester"
    )
    assert res_sim["viagens_identificadas"] == 2
    assert res_sim["viagens_novas"] == 2
    assert res_sim["passageiros_novos"] == 2
    assert res_sim["acompanhantes_novos"] == 1
    session.rollback()
    assert len(list(session.exec(select(Viagem)).all())) == 0

    # 2. Gravação real a partir do CSV convertido
    res_imp = processar_viagens_carro(
        linhas_csv, session, simular=False, criar_pacientes_novos=True, gerar_faturamento=True, ator_nome="Tester"
    )
    session.commit()
    assert res_imp["viagens_novas"] == 2
    assert res_imp["passageiros_novos"] == 2
    assert res_imp["acompanhantes_novos"] == 1
    assert res_imp["faturamentos_novos"] == 3

    viagens = list(session.exec(select(Viagem).order_by(Viagem.data_viagem)).all())
    assert len(viagens) == 2
    assert viagens[0].destino == "PIUMHI"
    assert viagens[0].hora_saida == "07:00"
    assert viagens[1].destino == "ILICÍNEA"
    assert viagens[1].hora_saida == "08:00"  # "8:00" normalizado

    vps_piumhi = list(
        session.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id == viagens[0].id).order_by(ViagemPaciente.id)).all()
    )
    assert len(vps_piumhi) == 2  # 1 pessoa por linha
    assert vps_piumhi[1].tratamento == "Acompanhante"
    assert "Acompanhante" in vps_piumhi[1].observacoes
    assert vps_piumhi[1].acompanhante == ""

    fats = list(session.exec(select(Faturamento)).all())
    assert len(fats) == 3

    # 3. Reimportação direta do JSON: 100% idempotente
    linhas_json = ler_viagens_carro(json.dumps(amostra_json).encode("utf-8"), "json")
    res_reimp = processar_viagens_carro(
        linhas_json, session, simular=False, criar_pacientes_novos=True, gerar_faturamento=True, ator_nome="Tester"
    )
    session.commit()
    assert res_reimp["viagens_novas"] == 0
    assert res_reimp["viagens_existentes"] == 2
    assert res_reimp["passageiros_duplicados"] == 3
    assert res_reimp["faturamentos_novos"] == 0
