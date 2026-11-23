"""Testes unitários e de integração da importação de Ordens de Circulação de Veículos e Viagens via Word (.docx)."""

import io
from datetime import date
import pytest
from docx import Document
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.tfd import Destino, Motorista, Paciente, Veiculo, Viagem, ViagemPaciente
from app.models.user import User
from app.services.importador_word_viagens import (
    enriquecer_preview_com_banco,
    executar_importacao_viagens,
    parse_word_ordem_viagens,
)


@pytest.fixture
def db():
    test_engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(test_engine)
    with Session(test_engine) as session:
        yield session


def _criar_docx_exemplo_bytes() -> bytes:
    doc = Document()
    doc.add_heading("ORDEM DE CIRCULAÇÃO DE VEÍCULOS E PRESTAÇÃO DE CONTAS DE VIAGEM", level=1)
    doc.add_paragraph("VEICULO: __________________  PLACA: __________________  DESTINO: Passos")
    doc.add_paragraph("MOTORISTA/FAVORECIDO: __________________  DEPARTAMENTO: Saúde")
    doc.add_paragraph("Data saída: 12/11/2026   Hora saída: 12:30   Km inicial: _________")
    doc.add_paragraph("Data retorno: _________   Hora retorno: _________  Km final: _________")
    doc.add_paragraph("Adiantamento: _________   Horas viagem: _________  Km rodados: _________")

    doc.add_paragraph("RELAÇÃO DE PASSAGEIROS:")
    table = doc.add_table(rows=1, cols=7)
    hdr = table.rows[0].cells
    hdr[0].text = "N"
    hdr[1].text = "Passageiro"
    hdr[2].text = "Pront."
    hdr[3].text = "Tratamento"
    hdr[4].text = "Unidade"
    hdr[5].text = "Horário consulta"
    hdr[6].text = "Cidade"

    paxes = [
        ("01", "Jairo Rodrigues Costa", "", "", "", "", ""),
        ("02", "Edna Fernandes", "", "Acompanhante", "", "", ""),
        ("03", "Carlos Roberto Castilho", "12345", "Cardiologia", "Santa Casa", "14:00", "Passos"),
        ("04", "Ana Maria Fernandes", "", "", "", "", ""),
        ("05", "Francilene Candido", "", "Acompanhante", "", "", ""),
        ("06", "__________________", "", "", "", "", ""),
    ]
    for p in paxes:
        row = table.add_row().cells
        for idx, val in enumerate(p):
            row[idx].text = val

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_parse_word_ordem_viagens_extrai_dados_corretamente():
    docx_bytes = _criar_docx_exemplo_bytes()
    viagens = parse_word_ordem_viagens(docx_bytes, "ordem_passos.docx")

    assert len(viagens) == 1
    v = viagens[0]
    assert v["destino"] == "Passos"
    assert v["data_viagem"] == "2026-11-12"
    assert v["hora_saida"] == "12:30"
    assert v["veiculo"] == ""
    assert v["motorista"] == ""
    assert len(v["avisos"]) > 0

    # Passageiros: 5 válidos (a linha 06 de traços deve ser ignorada)
    assert len(v["passageiros"]) == 5
    p1 = v["passageiros"][0]
    assert p1["nome"] == "Jairo Rodrigues Costa"
    assert p1["is_acompanhante"] is False

    p2 = v["passageiros"][1]
    assert p2["nome"] == "Edna Fernandes"
    assert p2["is_acompanhante"] is True

    p3 = v["passageiros"][2]
    assert p3["nome"] == "Carlos Roberto Castilho"
    assert p3["prontuario"] == "12345"
    assert p3["tratamento"] == "Cardiologia"
    assert p3["unidade"] == "Santa Casa"
    assert p3["hora_consulta"] == "14:00"


def test_enriquecer_preview_com_banco_identifica_paciente_existente(db: Session):
    # Cadastra paciente existente com prontuário
    pac = Paciente(nome="Carlos Roberto Castilho", codigo_prontuario="12345", municipio="Guapé")
    db.add(pac)
    db.commit()

    docx_bytes = _criar_docx_exemplo_bytes()
    viagens = parse_word_ordem_viagens(docx_bytes, "ordem_passos.docx")
    viagens_enr = enriquecer_preview_com_banco(db, viagens)

    pax3 = next(p for p in viagens_enr[0]["passageiros"] if p["nome"] == "Carlos Roberto Castilho")
    assert pax3["cadastrado"] is True
    assert pax3["paciente_id"] == pac.id

    pax1 = next(p for p in viagens_enr[0]["passageiros"] if p["nome"] == "Jairo Rodrigues Costa")
    assert pax1["cadastrado"] is False
    assert pax1["paciente_id"] is None


def test_executar_importacao_viagens_salva_no_banco_com_sucesso(db: Session):
    ator = User(id=1, username="admin", nome="Administrador do Sistema", role="admin", is_superuser=True)

    docx_bytes = _criar_docx_exemplo_bytes()
    viagens = parse_word_ordem_viagens(docx_bytes, "ordem_passos.docx")
    viagens_enr = enriquecer_preview_com_banco(db, viagens)

    resultado = executar_importacao_viagens(db, viagens_enr, ator)
    assert resultado["sucesso"] is True
    assert resultado["viagens_criadas"] == 1
    assert resultado["passageiros_vinculados"] == 5
    assert resultado["pacientes_cadastrados"] == 5

    # Verifica no banco
    viagens_banco = list(db.exec(select(Viagem)).all())
    assert len(viagens_banco) == 1
    v = viagens_banco[0]
    assert v.destino == "PASSOS"
    assert v.data_viagem == date(2026, 11, 12)
    assert v.hora_saida == "12:30"
    assert v.veiculo_id is None
    assert v.motorista == ""

    # Verifica passageiros vinculados
    vps = list(db.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id == v.id)).all())
    assert len(vps) == 5

    # Verifica que Edna Fernandes é acompanhante
    edna_p = db.exec(select(Paciente).where(Paciente.nome == "Edna Fernandes")).first()
    assert edna_p is not None
    edna_vp = next(vp for vp in vps if vp.paciente_id == edna_p.id)
    assert edna_vp.acompanhante == "Sim"


def test_preview_rejeita_arquivo_invalido():
    with pytest.raises(ValueError, match="não é um documento Word"):
        parse_word_ordem_viagens(b"arquivo texto qualquer", "documento.txt")

