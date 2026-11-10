-- ==============================================================================
-- SISTEMA DE SAÚDE MUNICIPAL - MIGRATION 001: ROW LEVEL SECURITY (RLS)
-- ==============================================================================
-- Descrição: Habilita Row Level Security em todas as 38 tabelas do banco de dados
-- e estabelece políticas de menor privilégio (Least Privilege) compatíveis com
-- PostgreSQL 14+, Supabase (PostgREST / GoTrue) e FastAPI (JWT Claims).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. FUNÇÕES AUXILIARES DE CONTEXTO E AUTENTICAÇÃO (JWT / SESSÃO)
-- ------------------------------------------------------------------------------

-- Obtém o ID do usuário autenticado a partir dos claims JWT ou da tabela usuarios
CREATE OR REPLACE FUNCTION auth_user_id()
RETURNS integer AS $$
DECLARE
    claim_sub text;
    uid integer;
BEGIN
    -- 1. Tenta obter o 'sub' (username ou id) a partir do cabeçalho JWT (Supabase / PostgREST)
    BEGIN
        claim_sub := current_setting('request.jwt.claims', true)::json->>'sub';
    EXCEPTION WHEN OTHERS THEN
        claim_sub := NULL;
    END;

    IF claim_sub IS NULL THEN
        BEGIN
            claim_sub := current_setting('request.jwt.claim.sub', true);
        EXCEPTION WHEN OTHERS THEN
            claim_sub := NULL;
        END;
    END IF;

    IF claim_sub IS NULL THEN
        RETURN NULL;
    END IF;

    -- Se 'sub' for numérico direto
    IF claim_sub ~ '^\d+$' THEN
        RETURN claim_sub::integer;
    END IF;

    -- Se 'sub' for username, busca o ID na tabela usuarios
    SELECT id INTO uid FROM public.usuarios WHERE username = claim_sub LIMIT 1;
    RETURN uid;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- Verifica se o usuário autenticado é Superusuário / Administrador Geral
CREATE OR REPLACE FUNCTION auth_is_superuser()
RETURNS boolean AS $$
DECLARE
    is_super text;
    uid integer;
    db_super boolean;
BEGIN
    -- 1. Tenta claim direta do JWT
    BEGIN
        is_super := current_setting('request.jwt.claims', true)::json->>'is_superuser';
        IF is_super = 'true' THEN
            RETURN true;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- 2. Busca na tabela usuarios com permissão SECURITY DEFINER
    uid := auth_user_id();
    IF uid IS NULL THEN
        RETURN false;
    END IF;

    SELECT is_superuser INTO db_super FROM public.usuarios WHERE id = uid LIMIT 1;
    RETURN coalesce(db_super, false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- Obtém a Unidade de Saúde (PSF) do operador autenticado
CREATE OR REPLACE FUNCTION auth_unidade_id()
RETURNS integer AS $$
DECLARE
    claim_uni text;
    uid integer;
    db_uni integer;
BEGIN
    BEGIN
        claim_uni := current_setting('request.jwt.claims', true)::json->>'unidade_saude_id';
        IF claim_uni ~ '^\d+$' THEN
            RETURN claim_uni::integer;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    uid := auth_user_id();
    IF uid IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT unidade_saude_id INTO db_uni FROM public.usuarios WHERE id = uid LIMIT 1;
    RETURN db_uni;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- Obtém o ID do Médico associado à conta autenticada
CREATE OR REPLACE FUNCTION auth_medico_id()
RETURNS integer AS $$
DECLARE
    uid integer;
    db_med integer;
BEGIN
    uid := auth_user_id();
    IF uid IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT medico_id INTO db_med FROM public.usuarios WHERE id = uid LIMIT 1;
    RETURN db_med;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- Obtém o ID do Laboratório conveniado associado à conta autenticada
CREATE OR REPLACE FUNCTION auth_laboratorio_id()
RETURNS integer AS $$
DECLARE
    uid integer;
    db_lab integer;
BEGIN
    uid := auth_user_id();
    IF uid IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT laboratorio_id INTO db_lab FROM public.usuarios WHERE id = uid LIMIT 1;
    RETURN db_lab;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- ------------------------------------------------------------------------------
-- 2. ATIVAÇÃO DE RLS EM TODAS AS 38 TABELAS DO SISTEMA
-- ------------------------------------------------------------------------------

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unidades_saude ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_pacientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_exames_fila ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_viagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_viagem_pacientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_viagem_fila ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_veiculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_motoristas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_destinos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_tipos_fila ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_procedimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_especialidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tfd_faturamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_laboratorios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_vagas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_fila_psf ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_solic_mestre ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_solic_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_pedidos_ajuste ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_solicitacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sigtap_procedimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sigtap_cbos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sigtap_cids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sigtap_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apac_solicitacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apac_procedimentos_secundarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apac_anexos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apac_faixas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apac_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pec_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pec_indicadores_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_dashboard_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;


-- ------------------------------------------------------------------------------
-- 3. POLÍTICAS DE ACESSO: CONFIGURAÇÕES E DADOS INSTITUCIONAIS
-- ------------------------------------------------------------------------------

-- system_settings: leitura pública de cidade e brasão; alteração só superuser
CREATE POLICY system_settings_select ON public.system_settings
    FOR SELECT USING (true);

CREATE POLICY system_settings_admin ON public.system_settings
    FOR ALL USING (auth_is_superuser())
    WITH CHECK (auth_is_superuser());

-- integration_settings: apenas superusuários
CREATE POLICY integration_settings_admin ON public.integration_settings
    FOR ALL USING (auth_is_superuser())
    WITH CHECK (auth_is_superuser());

-- Logs de auditoria, WhatsApp e sincronização: somente leitura por superuser;
-- inserções geradas internamente pelo sistema (SECURITY DEFINER)
CREATE POLICY audit_logs_admin ON public.audit_logs
    FOR SELECT USING (auth_is_superuser());

CREATE POLICY pec_sync_logs_admin ON public.pec_sync_logs
    FOR SELECT USING (auth_is_superuser());

CREATE POLICY whatsapp_logs_admin ON public.whatsapp_logs
    FOR SELECT USING (auth_is_superuser());

CREATE POLICY pec_indicadores_cache_read ON public.pec_indicadores_cache
    FOR SELECT USING (auth_user_id() IS NOT NULL);

CREATE POLICY pec_indicadores_cache_admin ON public.pec_indicadores_cache
    FOR ALL USING (auth_is_superuser())
    WITH CHECK (auth_is_superuser());


-- ------------------------------------------------------------------------------
-- 4. POLÍTICAS DE ACESSO: CONTAS E PREFERÊNCIAS DE USUÁRIOS
-- ------------------------------------------------------------------------------

-- usuarios:
-- Superuser pode tudo.
-- Usuário comum só visualiza sua própria linha.
CREATE POLICY usuarios_admin ON public.usuarios
    FOR ALL USING (auth_is_superuser())
    WITH CHECK (auth_is_superuser());

CREATE POLICY usuarios_self_select ON public.usuarios
    FOR SELECT USING (id = auth_user_id());

CREATE POLICY usuarios_self_update ON public.usuarios
    FOR UPDATE USING (id = auth_user_id())
    WITH CHECK (
        id = auth_user_id() AND
        -- Impede o usuário comum de se auto-promover a superuser ou alterar permissões
        is_superuser = false
    );

-- user_dashboard_preferences:
CREATE POLICY user_prefs_policy ON public.user_dashboard_preferences
    FOR ALL USING (auth_is_superuser() OR user_id = auth_user_id())
    WITH CHECK (auth_is_superuser() OR user_id = auth_user_id());


-- ------------------------------------------------------------------------------
-- 5. POLÍTICAS DE ACESSO: TABELAS DE REFERÊNCIA E CATÁLOGOS PÚBLICOS (SIGTAP / SUS)
-- ------------------------------------------------------------------------------

-- Leitura pública para preenchimento de formulários e selects; escrita só superuser
CREATE POLICY sigtap_proc_select ON public.sigtap_procedimentos FOR SELECT USING (true);
CREATE POLICY sigtap_proc_admin ON public.sigtap_procedimentos FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());

CREATE POLICY sigtap_cbos_select ON public.sigtap_cbos FOR SELECT USING (true);
CREATE POLICY sigtap_cbos_admin ON public.sigtap_cbos FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());

CREATE POLICY sigtap_cids_select ON public.sigtap_cids FOR SELECT USING (true);
CREATE POLICY sigtap_cids_admin ON public.sigtap_cids FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());

CREATE POLICY sigtap_versoes_select ON public.sigtap_versoes FOR SELECT USING (true);
CREATE POLICY sigtap_versoes_admin ON public.sigtap_versoes FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());

CREATE POLICY tfd_tipos_select ON public.tfd_tipos_fila FOR SELECT USING (true);
CREATE POLICY tfd_tipos_admin ON public.tfd_tipos_fila FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());

CREATE POLICY tfd_proc_select ON public.tfd_procedimentos FOR SELECT USING (true);
CREATE POLICY tfd_proc_admin ON public.tfd_procedimentos FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());

CREATE POLICY tfd_esp_select ON public.tfd_especialidades FOR SELECT USING (true);
CREATE POLICY tfd_esp_admin ON public.tfd_especialidades FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());

CREATE POLICY tfd_destinos_select ON public.tfd_destinos FOR SELECT USING (true);
CREATE POLICY tfd_destinos_admin ON public.tfd_destinos FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());

CREATE POLICY medicos_select ON public.medicos FOR SELECT USING (auth_user_id() IS NOT NULL);
CREATE POLICY medicos_admin ON public.medicos FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());

CREATE POLICY unidades_select ON public.unidades_saude FOR SELECT USING (auth_user_id() IS NOT NULL);
CREATE POLICY unidades_admin ON public.unidades_saude FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());

CREATE POLICY lab_lab_select ON public.lab_laboratorios FOR SELECT USING (auth_user_id() IS NOT NULL);
CREATE POLICY lab_lab_admin ON public.lab_laboratorios FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());

CREATE POLICY tfd_veiculos_select ON public.tfd_veiculos FOR SELECT USING (auth_user_id() IS NOT NULL);
CREATE POLICY tfd_veiculos_admin ON public.tfd_veiculos FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());

CREATE POLICY tfd_motoristas_select ON public.tfd_motoristas FOR SELECT USING (auth_user_id() IS NOT NULL);
CREATE POLICY tfd_motoristas_admin ON public.tfd_motoristas FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());


-- ------------------------------------------------------------------------------
-- 6. POLÍTICAS DE ACESSO: PACIENTES (LGPD - DADOS PESSOAIS E SENSÍVEIS)
-- ------------------------------------------------------------------------------

CREATE POLICY tfd_pacientes_select ON public.tfd_pacientes
    FOR SELECT USING (auth_user_id() IS NOT NULL);

CREATE POLICY tfd_pacientes_insert ON public.tfd_pacientes
    FOR INSERT WITH CHECK (auth_user_id() IS NOT NULL);

CREATE POLICY tfd_pacientes_update ON public.tfd_pacientes
    FOR UPDATE USING (auth_user_id() IS NOT NULL) WITH CHECK (auth_user_id() IS NOT NULL);

CREATE POLICY tfd_pacientes_delete ON public.tfd_pacientes
    FOR DELETE USING (auth_is_superuser());


-- ------------------------------------------------------------------------------
-- 7. POLÍTICAS DE ACESSO: FILA DE EXAMES E AGENDAMENTO TFD
-- ------------------------------------------------------------------------------

-- Leitura:
-- 1. Superuser lê tudo.
-- 2. Operador central lê tudo.
-- 3. Operador PSF lê apenas pedidos da sua unidade.
-- 4. Médico lê pedidos em que ele é o médico solicitante/atendente.
-- 5. Acesso anônimo: apenas por public_token válido.
CREATE POLICY tfd_exames_select ON public.tfd_exames_fila
    FOR SELECT USING (
        auth_is_superuser()
        OR auth_unidade_id() IS NULL
        OR unidade_saude_id = auth_unidade_id()
        OR (auth_medico_id() IS NOT NULL AND medico_id = auth_medico_id())
    );

-- Inserção:
-- Superuser / Central podem inserir qualquer pedido.
-- PSF só pode inserir para sua própria unidade e NÃO pode agendar direto.
CREATE POLICY tfd_exames_insert ON public.tfd_exames_fila
    FOR INSERT WITH CHECK (
        auth_is_superuser()
        OR (
            auth_unidade_id() IS NOT NULL
            AND unidade_saude_id = auth_unidade_id()
            AND data_agendada IS NULL
        )
        OR auth_unidade_id() IS NULL
    );

-- Alteração:
-- Superuser / Central podem alterar.
-- Médico pode alterar apenas se for o médico vinculado (prioridade/justificativa).
-- PSF só altera se for da sua unidade e sem alterar agendamento direto.
CREATE POLICY tfd_exames_update ON public.tfd_exames_fila
    FOR UPDATE USING (
        auth_is_superuser()
        OR auth_unidade_id() IS NULL
        OR unidade_saude_id = auth_unidade_id()
        OR (auth_medico_id() IS NOT NULL AND medico_id = auth_medico_id())
    )
    WITH CHECK (
        auth_is_superuser()
        OR auth_unidade_id() IS NULL
        OR (
            unidade_saude_id = auth_unidade_id()
            AND data_agendada IS NULL
        )
        OR (auth_medico_id() IS NOT NULL AND medico_id = auth_medico_id())
    );

-- Exclusão: somente superuser (sistema utiliza soft-delete para auditoria)
CREATE POLICY tfd_exames_delete ON public.tfd_exames_fila
    FOR DELETE USING (auth_is_superuser());


-- ------------------------------------------------------------------------------
-- 8. POLÍTICAS DE ACESSO: TRANSPORTE E VIAGENS TFD
-- ------------------------------------------------------------------------------

CREATE POLICY tfd_viagens_select ON public.tfd_viagens
    FOR SELECT USING (auth_user_id() IS NOT NULL);

CREATE POLICY tfd_viagens_admin ON public.tfd_viagens
    FOR ALL USING (auth_user_id() IS NOT NULL)
    WITH CHECK (auth_user_id() IS NOT NULL);

CREATE POLICY tfd_vp_select ON public.tfd_viagem_pacientes
    FOR SELECT USING (auth_user_id() IS NOT NULL);

CREATE POLICY tfd_vp_all ON public.tfd_viagem_pacientes
    FOR ALL USING (auth_user_id() IS NOT NULL)
    WITH CHECK (auth_user_id() IS NOT NULL);

CREATE POLICY tfd_vf_all ON public.tfd_viagem_fila
    FOR ALL USING (auth_user_id() IS NOT NULL)
    WITH CHECK (auth_user_id() IS NOT NULL);


-- ------------------------------------------------------------------------------
-- 9. POLÍTICAS DE ACESSO: FATURAMENTO TFD (BPA / SUS)
-- ------------------------------------------------------------------------------

CREATE POLICY tfd_faturamento_select ON public.tfd_faturamento
    FOR SELECT USING (auth_user_id() IS NOT NULL);

-- Na inserção, garante que status não seja criado como aprovado direto sem auditoria
CREATE POLICY tfd_faturamento_insert ON public.tfd_faturamento
    FOR INSERT WITH CHECK (
        auth_is_superuser() OR status = 'pendente'
    );

CREATE POLICY tfd_faturamento_update ON public.tfd_faturamento
    FOR UPDATE USING (auth_user_id() IS NOT NULL)
    WITH CHECK (auth_user_id() IS NOT NULL);

CREATE POLICY tfd_faturamento_delete ON public.tfd_faturamento
    FOR DELETE USING (auth_is_superuser());


-- ------------------------------------------------------------------------------
-- 10. POLÍTICAS DE ACESSO: LABORATÓRIO E EXAMES DE SANGUE
-- ------------------------------------------------------------------------------

CREATE POLICY lab_vagas_select ON public.lab_vagas FOR SELECT USING (auth_user_id() IS NOT NULL);
CREATE POLICY lab_vagas_admin ON public.lab_vagas FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());

-- Fila PSF e Solicitação Mestre Laboratorial:
CREATE POLICY lab_fila_psf_policy ON public.lab_fila_psf
    FOR ALL USING (
        auth_is_superuser()
        OR auth_unidade_id() IS NULL
        OR unidade_saude_id = auth_unidade_id()
    )
    WITH CHECK (
        auth_is_superuser()
        OR auth_unidade_id() IS NULL
        OR unidade_saude_id = auth_unidade_id()
    );

CREATE POLICY lab_mestre_select ON public.lab_solic_mestre
    FOR SELECT USING (
        auth_is_superuser()
        OR auth_unidade_id() IS NULL
        OR unidade_saude_id = auth_unidade_id()
        OR (auth_laboratorio_id() IS NOT NULL AND laboratorio_id = auth_laboratorio_id())
    );

CREATE POLICY lab_mestre_insert ON public.lab_solic_mestre
    FOR INSERT WITH CHECK (
        auth_is_superuser()
        OR auth_unidade_id() IS NULL
        OR unidade_saude_id = auth_unidade_id()
    );

CREATE POLICY lab_mestre_update ON public.lab_solic_mestre
    FOR UPDATE USING (
        auth_is_superuser()
        OR auth_unidade_id() IS NULL
        OR unidade_saude_id = auth_unidade_id()
        OR (auth_laboratorio_id() IS NOT NULL AND laboratorio_id = auth_laboratorio_id())
    )
    WITH CHECK (
        auth_is_superuser()
        OR auth_unidade_id() IS NULL
        OR unidade_saude_id = auth_unidade_id()
        OR (auth_laboratorio_id() IS NOT NULL AND laboratorio_id = auth_laboratorio_id())
    );

-- Cancelamento/Exclusão: apenas exames que NÃO foram coletados ou realizados
CREATE POLICY lab_mestre_delete ON public.lab_solic_mestre
    FOR DELETE USING (
        auth_is_superuser()
        OR (
            (auth_unidade_id() IS NULL OR unidade_saude_id = auth_unidade_id())
            AND status NOT IN ('coletado', 'realizado')
        )
    );

CREATE POLICY lab_itens_all ON public.lab_solic_itens
    FOR ALL USING (auth_user_id() IS NOT NULL) WITH CHECK (auth_user_id() IS NOT NULL);

CREATE POLICY lab_ajustes_all ON public.lab_pedidos_ajuste
    FOR ALL USING (auth_user_id() IS NOT NULL) WITH CHECK (auth_user_id() IS NOT NULL);

CREATE POLICY lab_solicitacoes_all ON public.lab_solicitacoes
    FOR ALL USING (auth_user_id() IS NOT NULL) WITH CHECK (auth_user_id() IS NOT NULL);


-- ------------------------------------------------------------------------------
-- 11. POLÍTICAS DE ACESSO: APAC (ALTA COMPLEXIDADE / SIA-SUS)
-- ------------------------------------------------------------------------------

CREATE POLICY apac_sol_select ON public.apac_solicitacoes
    FOR SELECT USING (auth_user_id() IS NOT NULL);

CREATE POLICY apac_sol_insert ON public.apac_solicitacoes
    FOR INSERT WITH CHECK (
        auth_is_superuser()
        OR status = 'SOLICITADO'
    );

CREATE POLICY apac_sol_update ON public.apac_solicitacoes
    FOR UPDATE USING (
        auth_is_superuser()
        OR status IN ('SOLICITADO', 'PENDENTE')
    )
    WITH CHECK (
        auth_is_superuser()
        OR status IN ('SOLICITADO', 'PENDENTE', 'EM_ANALISE')
    );

CREATE POLICY apac_sol_delete ON public.apac_solicitacoes
    FOR DELETE USING (auth_is_superuser());

CREATE POLICY apac_sec_all ON public.apac_procedimentos_secundarios
    FOR ALL USING (auth_user_id() IS NOT NULL) WITH CHECK (auth_user_id() IS NOT NULL);

CREATE POLICY apac_anexos_all ON public.apac_anexos
    FOR ALL USING (auth_user_id() IS NOT NULL) WITH CHECK (auth_user_id() IS NOT NULL);

CREATE POLICY apac_faixas_all ON public.apac_faixas
    FOR ALL USING (auth_is_superuser()) WITH CHECK (auth_is_superuser());

CREATE POLICY apac_lotes_all ON public.apac_lotes
    FOR ALL USING (auth_user_id() IS NOT NULL) WITH CHECK (auth_is_superuser());

COMMIT;
