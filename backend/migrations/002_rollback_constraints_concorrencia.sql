-- ==============================================================================
-- Rollback Migration 002: Remoção das Constraints de Concorrência
-- ==============================================================================

DROP INDEX IF EXISTS uq_tfd_viagem_paciente;
DROP INDEX IF EXISTS uq_tfd_faturamento_viagem_pac_cod;
DROP INDEX IF EXISTS uq_tfd_viagem_fila_exame_ativo;
DROP INDEX IF EXISTS uq_apac_solicitacoes_numero_apac;
DROP INDEX IF EXISTS uq_lab_solic_mestre_origem_fila_ativa;
