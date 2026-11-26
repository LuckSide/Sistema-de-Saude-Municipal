-- =============================================================================
-- Migration 003: Índices Zero-Downtime, BIGINT PEC, token_version e Constraints
-- Executar diretamente via psql (CONCURRENTLY não pode rodar dentro de BEGIN/COMMIT).
-- Idempotente e seguro para execução repetida em produção.
-- =============================================================================

-- 1. Coluna de revogação de JWT em usuários e BIGINT para co_seq_cidadao_pec
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tfd_pacientes'
      AND column_name = 'co_seq_cidadao_pec'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE tfd_pacientes ALTER COLUMN co_seq_cidadao_pec TYPE BIGINT;
  END IF;
END $$;

-- 2. Índices individuais e compostos sem bloqueio de escrita (CONCURRENTLY)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tfd_pacientes_nascimento
  ON tfd_pacientes (nascimento);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tfd_pacientes_municipio
  ON tfd_pacientes (municipio);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tfd_veiculos_status_ativo
  ON tfd_veiculos (ativo, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tfd_viagens_veiculo_id
  ON tfd_viagens (veiculo_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tfd_viagens_motorista_id
  ON tfd_viagens (motorista_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tfd_viagem_pacientes_acompanhante_id
  ON tfd_viagem_pacientes (acompanhante_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tfd_viagem_fila_data_consulta
  ON tfd_viagem_fila (data_consulta);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tfd_viagem_fila_acompanhante_id
  ON tfd_viagem_fila (acompanhante_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tfd_exames_fila_data_agendada
  ON tfd_exames_fila (data_agendada);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tfd_exames_fila_ativo_status_pedido
  ON tfd_exames_fila (ativo, status, data_pedido);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tfd_faturamento_viagem_id
  ON tfd_faturamento (viagem_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_lab_solic_mestre_origem_fila_id
  ON lab_solic_mestre (origem_fila_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_lab_solic_mestre_medico_id
  ON lab_solic_mestre (medico_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_lab_solic_mestre_unidade_saude_id
  ON lab_solic_mestre (unidade_saude_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_lab_solic_mestre_lab_status_data
  ON lab_solic_mestre (laboratorio_id, status, data_agendada);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_farmacia_movimentacoes_created_at
  ON farmacia_movimentacoes (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_farmacia_movimentacoes_insumos_created_at
  ON farmacia_movimentacoes_insumos (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tickets_suporte_criado_em
  ON tickets_suporte (criado_em DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_audit_logs_entity_entity_id_ts
  ON audit_logs (entity, entity_id, timestamp);

-- 3. Constraints CHECK não-bloqueantes (NOT VALID bloqueia novos inválidos sem table lock longo)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_farmacia_med_estoque_nao_neg') THEN
    ALTER TABLE farmacia_medicamentos
      ADD CONSTRAINT chk_farmacia_med_estoque_nao_neg CHECK (estoque_atual >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_farmacia_ins_estoque_nao_neg') THEN
    ALTER TABLE farmacia_insumos
      ADD CONSTRAINT chk_farmacia_ins_estoque_nao_neg CHECK (estoque_atual >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_lab_vagas_ocupadas_nao_neg') THEN
    ALTER TABLE lab_vagas
      ADD CONSTRAINT chk_lab_vagas_ocupadas_nao_neg CHECK (vagas_ocupadas >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE farmacia_medicamentos VALIDATE CONSTRAINT chk_farmacia_med_estoque_nao_neg;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'Dados legados impediram VALIDATE em chk_farmacia_med_estoque_nao_neg; mantida NOT VALID para novos inserts.';
  END;
  BEGIN
    ALTER TABLE farmacia_insumos VALIDATE CONSTRAINT chk_farmacia_ins_estoque_nao_neg;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'Dados legados impediram VALIDATE em chk_farmacia_ins_estoque_nao_neg; mantida NOT VALID para novos inserts.';
  END;
  BEGIN
    ALTER TABLE lab_vagas VALIDATE CONSTRAINT chk_lab_vagas_ocupadas_nao_neg;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'Dados legados impediram VALIDATE em chk_lab_vagas_ocupadas_nao_neg; mantida NOT VALID para novos inserts.';
  END;
END $$;
