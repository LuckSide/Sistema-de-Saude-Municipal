-- =============================================================================
-- Rollback Migration 003
-- =============================================================================

ALTER TABLE farmacia_medicamentos DROP CONSTRAINT IF EXISTS chk_farmacia_med_estoque_nao_neg;
ALTER TABLE farmacia_insumos DROP CONSTRAINT IF EXISTS chk_farmacia_ins_estoque_nao_neg;
ALTER TABLE lab_vagas DROP CONSTRAINT IF EXISTS chk_lab_vagas_ocupadas_nao_neg;

DROP INDEX CONCURRENTLY IF EXISTS ix_tfd_pacientes_nascimento;
DROP INDEX CONCURRENTLY IF EXISTS ix_tfd_pacientes_municipio;
DROP INDEX CONCURRENTLY IF EXISTS ix_tfd_veiculos_status_ativo;
DROP INDEX CONCURRENTLY IF EXISTS ix_tfd_viagens_veiculo_id;
DROP INDEX CONCURRENTLY IF EXISTS ix_tfd_viagens_motorista_id;
DROP INDEX CONCURRENTLY IF EXISTS ix_tfd_viagem_pacientes_acompanhante_id;
DROP INDEX CONCURRENTLY IF EXISTS ix_tfd_viagem_fila_data_consulta;
DROP INDEX CONCURRENTLY IF EXISTS ix_tfd_viagem_fila_acompanhante_id;
DROP INDEX CONCURRENTLY IF EXISTS ix_tfd_exames_fila_data_agendada;
DROP INDEX CONCURRENTLY IF EXISTS ix_tfd_exames_fila_ativo_status_pedido;
DROP INDEX CONCURRENTLY IF EXISTS ix_tfd_faturamento_viagem_id;
DROP INDEX CONCURRENTLY IF EXISTS ix_lab_solic_mestre_origem_fila_id;
DROP INDEX CONCURRENTLY IF EXISTS ix_lab_solic_mestre_medico_id;
DROP INDEX CONCURRENTLY IF EXISTS ix_lab_solic_mestre_unidade_saude_id;
DROP INDEX CONCURRENTLY IF EXISTS ix_lab_solic_mestre_lab_status_data;
DROP INDEX CONCURRENTLY IF EXISTS ix_farmacia_movimentacoes_created_at;
DROP INDEX CONCURRENTLY IF EXISTS ix_farmacia_movimentacoes_insumos_created_at;
DROP INDEX CONCURRENTLY IF EXISTS ix_tickets_suporte_criado_em;
DROP INDEX CONCURRENTLY IF EXISTS ix_audit_logs_entity_entity_id_ts;
