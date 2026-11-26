from datetime import date
from pathlib import Path

from sqlalchemy import BigInteger
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.api.v1.tfd import (
    _candidatos_puxar,
    _conflitos_viagem,
    _filtrar_exames_lista,
    _relatorio_frota,
    disponibilidade_frota,
    listar_viagens,
    sugestao_frota,
)
from app.db.pec_views import FN_CADSUS
from app.models.tfd import ExameFila, Paciente, Veiculo, Viagem, ViagemFila
from app.models.user import User


def test_modelos_fase4_sem_duplicidade_e_bigint_pec():
    col_pec = Paciente.__table__.columns["co_seq_cidadao_pec"]
    assert isinstance(col_pec.type, BigInteger)
    assert ExameFila.__table__.columns["data_agendada"].index is True
    assert ViagemFila.__table__.columns["data_consulta"].index is True


def test_queries_sargaveis_tfd_compativeis_sqlite():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    ator = User(id=1, username="admin", is_superuser=True, must_change_password=False)

    with Session(engine) as db:
        pac = Paciente(nome="Paciente Sargavel", cpf="11122233344", cns="703403201915616")
        db.add(pac)
        veh = Veiculo(placa="ABC1D23", modelo="Van", capacidade=15, tipo="van", status="disponivel", ativo=True)
        db.add(veh)
        db.commit()
        db.refresh(pac)
        db.refresh(veh)

        viag = Viagem(
            destino="Varginha",
            data_viagem=date(2026, 11, 20),
            hora_saida="06:00",
            veiculo_id=veh.id,
            status="agendada",
        )
        ex = ExameFila(
            paciente_id=pac.id,
            exame="ULTRASSOM",
            data_pedido=date(2026, 11, 10),
            data_agendada=date(2026, 11, 20),
            status="agendado",
            ativo=True,
        )
        vf = ViagemFila(
            paciente_id=pac.id,
            destino="Varginha",
            data_consulta=date(2026, 11, 20),
            status="aguardando",
        )
        db.add_all([viag, ex, vf])
        db.commit()

        res_v = listar_viagens(status_=None, mes="2026-11", ano=None, page=1, limit=50, db=db, _=ator)
        assert res_v["total"] == 1

        ex_lista = _filtrar_exames_lista(
            db, ator, "agendado", "", None, "", "", "", "", "", "2026-11-01", "2026-11-30", "2026-11-20", False, None, ""
        )
        assert len(ex_lista) == 1

        cands = _candidatos_puxar(db, "2026-11-20")
        assert len(cands) == 1

        conf_v, _ = _conflitos_viagem(db, date(2026, 11, 20), "07:00", "12:00", veh.id, None, "")
        assert conf_v is not None

        sug = sugestao_frota(destino="Varginha", data="2026-11-20", viagem_id=None, db=db, _=ator)
        assert sug["demanda"] == 1

        frota_rel = _relatorio_frota(db, "2026-11-01", "2026-11-30")
        assert frota_rel["total_viagens"] == 1

        disp = disponibilidade_frota(data="2026-11-20", saida="07:00", retorno="11:00", ignorar_id=None, db=db, _=ator)
        assert "veiculos" in disp


def test_cadsus_cns_valido_e_migration_003():
    assert "RETURN (soma % 11) = 0;" in FN_CADSUS
    mig = Path(__file__).resolve().parent.parent / "migrations" / "003_indices_e_constraints_seguros.sql"
    txt = mig.read_text(encoding="utf-8")
    assert "CREATE INDEX CONCURRENTLY IF NOT EXISTS" in txt
    assert "NOT VALID" in txt
