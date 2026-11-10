-- ==============================================================================
-- SISTEMA DE SAÚDE MUNICIPAL - ROLLBACK MIGRATION 001: DESATIVAR RLS
-- ==============================================================================
-- Use este script caso precise reverter as políticas de Row Level Security
-- e retornar o banco de dados ao estado anterior (sem RLS).
-- ==============================================================================

BEGIN;

-- 1. Desativa RLS em todas as 38 tabelas
ALTER TABLE public.usuarios DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.unidades_saude DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_pacientes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_exames_fila DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_viagens DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_viagem_pacientes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_viagem_fila DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_veiculos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_motoristas DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_destinos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_tipos_fila DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_procedimentos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_especialidades DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_faturamento DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_laboratorios DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_vagas DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_fila_psf DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_solic_mestre DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_solic_itens DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_pedidos_ajuste DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_solicitacoes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sigtap_procedimentos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sigtap_cbos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sigtap_cids DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sigtap_versoes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.apac_solicitacoes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.apac_procedimentos_secundarios DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.apac_anexos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.apac_faixas DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.apac_lotes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.pec_sync_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.pec_indicadores_cache DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_dashboard_preferences DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs DISABLE ROW LEVEL SECURITY;

-- 2. Remove funções auxiliares criadas
DROP FUNCTION IF EXISTS auth_user_id() CASCADE;
DROP FUNCTION IF EXISTS auth_is_superuser() CASCADE;
DROP FUNCTION IF EXISTS auth_unidade_id() CASCADE;
DROP FUNCTION IF EXISTS auth_medico_id() CASCADE;
DROP FUNCTION IF EXISTS auth_laboratorio_id() CASCADE;

COMMIT;
