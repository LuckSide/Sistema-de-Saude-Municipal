-- ==============================================================================
-- Migration 002: Prevenção de Race Conditions e Proteção contra Duplicidade
-- ==============================================================================

-- 1. Impede o mesmo paciente cadastrado mais de uma vez na mesma viagem (veículo)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tfd_viagem_paciente 
ON tfd_viagem_pacientes (viagem_id, paciente_id);

-- 2. Impede faturamento duplicado de deslocamento para mesma viagem, paciente e código SIGTAP
CREATE UNIQUE INDEX IF NOT EXISTS uq_tfd_faturamento_viagem_pac_cod 
ON tfd_faturamento (viagem_id, paciente_id, codigo_sigtap)
WHERE viagem_id IS NOT NULL;

-- 3. Impede puxar o mesmo exame para a fila ativa de transporte mais de uma vez
CREATE UNIQUE INDEX IF NOT EXISTS uq_tfd_viagem_fila_exame_ativo 
ON tfd_viagem_fila (exame_fila_id) 
WHERE exame_fila_id IS NOT NULL AND status IN ('aguardando', 'alocado');

-- 4. Impede colisão de numeração oficial de APAC (SIA-SUS)
CREATE UNIQUE INDEX IF NOT EXISTS uq_apac_solicitacoes_numero_apac 
ON apac_solicitacoes (numero_apac) 
WHERE numero_apac IS NOT NULL AND numero_apac != '';

-- 5. Impede agendamento duplo do mesmo pedido da fila do PSF para laboratório
CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_solic_mestre_origem_fila_ativa 
ON lab_solic_mestre (origem_fila_id) 
WHERE origem_fila_id IS NOT NULL AND status != 'cancelado';
