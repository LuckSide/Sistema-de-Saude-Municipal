import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

import pytest
from fastapi import HTTPException
from sqlmodel import SQLModel, Session, create_engine, select

from app.api.v1.lab_fase6 import cancelar_solicitacao
from app.api.v1.tfd import (
    RecepcionarExameIn,
    add_passageiro,
    confirmar_presenca_viagem_publica,
    faturar_deslocamento,
    recepcionar_exame,
)
from app.models.apac import FaixaNumeracaoAPAC, SolicitacaoAPAC
from app.models.cadastros_saude import Medico, UnidadeSaude
from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import Laboratorio, SolicitacaoMestre, VagaLab
from app.models.tfd import Destino, ExameFila, Faturamento, Paciente, Veiculo, Viagem, ViagemPaciente
from app.models.user import User
from app.schemas.tfd import ViagemConfirmarIn, ViagemPacienteIn
from app.services.apac_service import autorizar_apac


@pytest.fixture
def db_engine():
    """Cria um banco SQLite em arquivo temporário com suporte a múltiplas threads/conexões."""
    tf = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    engine = create_engine(
        f"sqlite:///{tf.name}",
        connect_args={"check_same_thread": False, "timeout": 15},
    )
    SQLModel.metadata.create_all(engine)
    yield engine
    try:
        os.unlink(tf.name)
    except Exception:
        pass


@pytest.fixture
def mock_admin():
    return User(
        id=1,
        username="admin",
        nome="Administrador do Sistema",
        is_superuser=True,
        is_active=True,
        telas="tfd,lab,apac,usuarios",
    )


# ==============================================================================
# TESTE 1: Concorrência na Inclusão do Mesmo Passageiro na Viagem (Duplo Clique)
# ==============================================================================
def test_concorrencia_viagem_duplicidade_passageiro(db_engine, mock_admin):
    """Prova que 2 requisições paralelas inserindo o mesmo paciente na mesma viagem
    resultam em apenas 1 inserção bem-sucedida, rejeitando a duplicata com HTTP 400.
    """
    with Session(db_engine) as db:
        veic = Veiculo(placa="ABC1D23", modelo="Van Master", capacidade=15, ativo=True)
        db.add(veic)
        db.flush()
        viagem = Viagem(
            destino="Passos",
            data_viagem=date.today(),
            veiculo_id=veic.id,
            status="agendada",
        )
        pac = Paciente(nome="Carlos da Silva", cpf="12345678901")
        db.add(viagem)
        db.add(pac)
        db.commit()
        db.refresh(viagem)
        db.refresh(pac)
        vid, pid = viagem.id, pac.id

    def worker_adicionar(thread_id):
        with Session(db_engine) as db_thread:
            try:
                payload = ViagemPacienteIn(paciente_id=pid)
                add_passageiro(
                    vid=vid,
                    data=payload,
                    db=db_thread,
                    ator=mock_admin,
                )
                return ("SUCESSO", 201)
            except HTTPException as exc:
                return ("ERRO", exc.status_code)
            except Exception as e:
                return ("ERRO_INESPERADO", str(e))

    with ThreadPoolExecutor(max_workers=2) as executor:
        resultados = list(executor.map(worker_adicionar, [1, 2]))

    status_codes = [r[1] for r in resultados]
    # Uma requisição deve ter sucesso (201) e a concorrente deve ser rejeitada com 400
    assert 201 in status_codes
    assert 400 in status_codes

    # O banco deve conter estritamente 1 único passageiro
    with Session(db_engine) as db:
        passageiros = db.exec(
            select(ViagemPaciente).where(ViagemPaciente.viagem_id == vid, ViagemPaciente.paciente_id == pid)
        ).all()
        assert len(passageiros) == 1


# ==============================================================================
# TESTE 2: Faturamento Concorrente de Deslocamento de Viagem (Idempotência)
# ==============================================================================
def test_concorrencia_faturamento_deslocamento_idempotente(db_engine, mock_admin):
    """Prova que 2 requisições paralelas de 'gerar-faturamento-deslocamento'
    não duplicam faturas no banco de dados graças à constraint única e savepoints.
    """
    with Session(db_engine) as db:
        dest = Destino(
            nome_destino="Alfenas",
            codigo_desloc_pac="0802010040",
            qtd_desloc_pac=2,
            ativo=True,
        )
        viagem = Viagem(destino="Alfenas", data_viagem=date.today(), status="agendada")
        p1 = Paciente(nome="Paciente 1")
        p2 = Paciente(nome="Paciente 2")
        db.add(dest)
        db.add(viagem)
        db.add(p1)
        db.add(p2)
        db.commit()
        db.refresh(viagem)
        db.refresh(p1)
        db.refresh(p2)

        db.add(ViagemPaciente(viagem_id=viagem.id, paciente_id=p1.id))
        db.add(ViagemPaciente(viagem_id=viagem.id, paciente_id=p2.id))
        db.commit()
        vid = viagem.id

    def worker_faturar(thread_id):
        with Session(db_engine) as db_thread:
            try:
                res = faturar_deslocamento(vid=vid, db=db_thread, ator=mock_admin)
                return ("SUCESSO", res)
            except Exception as e:
                return ("ERRO", str(e))

    with ThreadPoolExecutor(max_workers=2) as executor:
        resultados = list(executor.map(worker_faturar, [1, 2]))

    for status, res in resultados:
        assert status == "SUCESSO"

    # Total de faturas no banco deve ser rigorosamente 2 (uma para cada paciente)
    with Session(db_engine) as db:
        faturas = db.exec(select(Faturamento).where(Faturamento.viagem_id == vid)).all()
        assert len(faturas) == 2


# ==============================================================================
# TESTE 3: Concorrência na Autorização APAC com Faixa de Apenas 1 Número
# ==============================================================================
def test_concorrencia_apac_alocacao_faixa_esgotada(db_engine):
    """Prova que se 2 médicos tentarem autorizar APACs simultaneamente e a faixa
    tiver apenas 1 número disponível, uma sucede e a outra falha sem colisão.
    """
    with Session(db_engine) as db:
        # Faixa com exatamente 1 número restante (numero_inicial == numero_final)
        faixa = FaixaNumeracaoAPAC(
            ano=2026,
            uf="MG",
            serie="01",
            numero_inicial=3126100000001,
            numero_final=3126100000001,
            proximo_numero=3126100000001,
            tipo_procedimento="TODOS",
            ativo=True,
        )
        med_solic = Medico(nome="Dr. Solicitante", crm="11111", ativo=True)
        med_aut = Medico(nome="Dr. Autorizador", crm="22222", ativo=True)
        pac = Paciente(nome="Paciente APAC")
        db.add(faixa)
        db.add(med_solic)
        db.add(med_aut)
        db.add(pac)
        db.commit()
        db.refresh(med_solic)
        db.refresh(med_aut)
        db.refresh(pac)

        sol1 = SolicitacaoAPAC(
            paciente_id=pac.id,
            paciente_nome=pac.nome,
            medico_solicitante_id=med_solic.id,
            medico_solicitante_nome=med_solic.nome,
            procedimento_principal_codigo="0301010010",
            procedimento_principal_nome="Procedimento Teste",
            cid_principal_codigo="C50",
            data_solicitacao=date.today(),
            status="SOLICITADO",
        )
        sol2 = SolicitacaoAPAC(
            paciente_id=pac.id,
            paciente_nome=pac.nome,
            medico_solicitante_id=med_solic.id,
            medico_solicitante_nome=med_solic.nome,
            procedimento_principal_codigo="0301010010",
            procedimento_principal_nome="Procedimento Teste",
            cid_principal_codigo="C50",
            data_solicitacao=date.today(),
            status="SOLICITADO",
        )
        db.add(sol1)
        db.add(sol2)
        db.commit()
        db.refresh(sol1)
        db.refresh(sol2)
        s1_id, s2_id = sol1.id, sol2.id
        med_aut_id = med_aut.id

    def worker_autorizar(sol_id):
        with Session(db_engine) as db_thread:
            try:
                autorizar_apac(
                    db=db_thread,
                    solicitacao_id=sol_id,
                    medico_autorizador_id=med_aut_id,
                    parecer="Autorizado tecnicamente",
                    usuario_ator="Dr. Autorizador",
                )
                return ("SUCESSO", 200)
            except HTTPException as e:
                return ("ERRO", e.status_code)
            except Exception as e:
                return ("ERRO_INESPERADO", str(e))

    with ThreadPoolExecutor(max_workers=2) as executor:
        resultados = list(executor.map(worker_autorizar, [s1_id, s2_id]))

    status_codes = [r[1] for r in resultados]
    # Uma autorização ganha o último número da faixa, a outra recebe 400 (faixa esgotada)
    assert 200 in status_codes
    assert 400 in status_codes

    # Valida integridade do banco: exatamente 1 solicitação autorizada com o número
    with Session(db_engine) as db:
        solicitacoes_autorizadas = db.exec(
            select(SolicitacaoAPAC).where(SolicitacaoAPAC.status == "AUTORIZADO")
        ).all()
        assert len(solicitacoes_autorizadas) == 1
        assert solicitacoes_autorizadas[0].numero_apac == "3126100000001"


# ==============================================================================
# TESTE 4: Cancelamento Simultâneo de Exame Laboratorial (Sem decremento duplo)
# ==============================================================================
def test_concorrencia_cancelar_solicitacao_laboratorio(db_engine, mock_admin):
    """Prova que 2 requisições de cancelamento do mesmo exame ao mesmo tempo
    decrementam a cota de vagas do laboratório exatamente 1 vez (evita vagas extras/negativas).
    """
    hoje = date.today()
    with Session(db_engine) as db:
        lab = Laboratorio(nome="Lab Teste", ativo=True)
        db.add(lab)
        db.commit()
        db.refresh(lab)

        vaga = VagaLab(laboratorio_id=lab.id, data=hoje, vagas_totais=10, vagas_ocupadas=1)
        pac = Paciente(nome="Paciente Lab")
        db.add(vaga)
        db.add(pac)
        db.commit()
        db.refresh(pac)

        solic = SolicitacaoMestre(
            paciente_id=pac.id,
            laboratorio_id=lab.id,
            data_agendada=hoje,
            status="agendado",
        )
        db.add(solic)
        db.commit()
        db.refresh(solic)
        mid = solic.id
        lid = lab.id

    def worker_cancelar(thread_id):
        with Session(db_engine) as db_thread:
            try:
                cancelar_solicitacao(mid=mid, db=db_thread, user=mock_admin)
                return ("SUCESSO", 204)
            except HTTPException as e:
                return ("ERRO", e.status_code)
            except Exception as e:
                return ("ERRO_INESPERADO", str(e))

    with ThreadPoolExecutor(max_workers=2) as executor:
        resultados = list(executor.map(worker_cancelar, [1, 2]))

    # Ambas terminam com sucesso/idempotente
    for status, code in resultados:
        assert status == "SUCESSO"
        assert code == 204

    # No banco: status = cancelado e vagas_ocupadas decrementada exatamente 1x (de 1 para 0)
    with Session(db_engine) as db:
        m_final = db.get(SolicitacaoMestre, mid)
        assert m_final.status == "cancelado"
        v_final = db.exec(select(VagaLab).where(VagaLab.laboratorio_id == lid, VagaLab.data == hoje)).first()
        assert v_final.vagas_ocupadas == 0


# ==============================================================================
# TESTE 5: Recepção Simultânea de Exame na Fila TFD (Lock Pessimista)
# ==============================================================================
def test_concorrencia_recepcao_exame_fila(db_engine, mock_admin):
    """Prova que duas tentativas de recepção concorrentes preservam a consistência
    do status e não corrompem o status anterior.
    """
    with Session(db_engine) as db:
        pac = Paciente(nome="Paciente Exame")
        db.add(pac)
        db.commit()
        db.refresh(pac)

        exame = ExameFila(
            paciente_id=pac.id,
            exame="Ultrassonografia",
            data_pedido=date.today(),
            data_agendada=date.today(),
            status="agendado",
            cid_codigo="R10",
            ativo=True,
        )
        db.add(exame)
        db.commit()
        db.refresh(exame)
        eid = exame.id

    def worker_recepcionar(thread_id):
        with Session(db_engine) as db_thread:
            try:
                recepcionar_exame(
                    eid=eid,
                    data=RecepcionarExameIn(cid_codigo="R10"),
                    db=db_thread,
                    ator=mock_admin,
                )
                return ("SUCESSO", 200)
            except HTTPException as e:
                return ("ERRO", e.status_code)
            except Exception as e:
                return ("ERRO_INESPERADO", str(e))

    with ThreadPoolExecutor(max_workers=2) as executor:
        resultados = list(executor.map(worker_recepcionar, [1, 2]))

    status_codes = [r[1] for r in resultados]
    # Pelo menos uma conclui a recepção e a concorrente recebe 400 informando que já não está agendado
    assert 200 in status_codes

    with Session(db_engine) as db:
        e_final = db.get(ExameFila, eid)
        assert e_final.status == "recepcionado"
        assert e_final.status_anterior == "agendado"


# ==============================================================================
# TESTE 6: Confirmação Pública Simultânea pelo Paciente (Idempotência de Cliques)
# ==============================================================================
def test_concorrencia_confirmar_presenca_viagem_publica(db_engine):
    """Prova que dois cliques rápidos no link público de confirmação (celular/WhatsApp)
    são idempotentes e preservam o carimbo de confirmação sem duplicação de dados.
    """
    with Session(db_engine) as db:
        v = Viagem(destino="Varginha", data_viagem=date.today(), status="agendada")
        p = Paciente(nome="Dona Maria")
        db.add(v)
        db.add(p)
        db.commit()
        db.refresh(v)
        db.refresh(p)

        vp = ViagemPaciente(
            viagem_id=v.id,
            paciente_id=p.id,
            token_confirmacao="token_seguro_concorrencia_123",
            status_confirmacao="pendente",
        )
        db.add(vp)
        db.commit()

    def worker_confirmar(thread_id):
        with Session(db_engine) as db_thread:
            try:
                res = confirmar_presenca_viagem_publica(
                    token="token_seguro_concorrencia_123",
                    data=ViagemConfirmarIn(acao="confirmar"),
                    db=db_thread,
                )
                return ("SUCESSO", res.status_confirmacao)
            except Exception as e:
                return ("ERRO", str(e))

    with ThreadPoolExecutor(max_workers=2) as executor:
        resultados = list(executor.map(worker_confirmar, [1, 2]))

    for status, conf_status in resultados:
        assert status == "SUCESSO"
        assert conf_status == "confirmado"

    with Session(db_engine) as db:
        vp_final = db.exec(
            select(ViagemPaciente).where(ViagemPaciente.token_confirmacao == "token_seguro_concorrencia_123")
        ).first()
        assert vp_final.status_confirmacao == "confirmado"
        assert vp_final.presente is True
        assert vp_final.confirmado_em is not None
