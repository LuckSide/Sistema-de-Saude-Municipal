"""Views SQL somente leitura p/ DW PEC e-SUS — Novo Cofinanciamento APS.

Base legal: Portarias GM/MS 3.493/2024 e 6.907/2025 + NT 3/2025-CGESCO.
15 indicadores em 3 blocos: Cuidado APS (7), Saúde Bucal (6), eMulti (2).

LGPD: só agregados (periodo, equipe, ubs_cnes, num, den, perc) + UUID ficha.
Sem nome/CPF/CNS/nascimento. Nenhum INSERT/UPDATE — só SELECT / VIEW.
"""

# Uber-view unificada: 1 linha por (periodo, indicador, equipe, UBS-CN ES).
# Cada SELECT lê o bruto do e-SUS (pec_*) e calcula num/den do indicador.
VW_PAINEL_APS_NOVO = """
CREATE OR REPLACE VIEW vw_painel_aps_novo AS
-- Bloco CUIDADO APS (eSF/eAP)
SELECT periodo, 'ACESSO' AS indicador, equipe_codigo, ubs_codigo AS ubs_cnes,
       COUNT(*) FILTER (WHERE acesso_ok) AS num, COUNT(*) AS den
FROM pec_atendimentos GROUP BY 1, 2, 3, 4
UNION ALL
SELECT periodo, 'INFANTIL', equipe_codigo, ubs_codigo,
       COUNT(*) FILTER (WHERE puericultura_ok) AS num, COUNT(*) AS den
FROM pec_criancas GROUP BY 1, 2, 3, 4
UNION ALL
SELECT periodo, 'GESTANTE', equipe_codigo, ubs_codigo,
       COUNT(*) FILTER (WHERE pre_natal_11acoes_ok) AS num, COUNT(*) AS den
FROM pec_gestantes GROUP BY 1, 2, 3, 4
UNION ALL
SELECT periodo, 'DIABETES', equipe_codigo, ubs_codigo,
       COUNT(*) FILTER (WHERE cuidado_dm_ok) AS num, COUNT(*) AS den
FROM pec_diabeticos GROUP BY 1, 2, 3, 4
UNION ALL
SELECT periodo, 'HIPERTENSAO', equipe_codigo, ubs_codigo,
       COUNT(*) FILTER (WHERE cuidado_has_ok) AS num, COUNT(*) AS den
FROM pec_hipertensos GROUP BY 1, 2, 3, 4
UNION ALL
SELECT periodo, 'IDOSO', equipe_codigo, ubs_codigo,
       COUNT(*) FILTER (WHERE cuidado_idoso_ok) AS num, COUNT(*) AS den
FROM pec_idosos GROUP BY 1, 2, 3, 4
UNION ALL
SELECT periodo, 'CANCER', equipe_codigo, ubs_codigo,
       COUNT(*) FILTER (WHERE rastreio_ok) AS num, COUNT(*) AS den
FROM pec_mulheres_rastreio GROUP BY 1, 2, 3, 4
-- Bloco SAÚDE BUCAL (eSB)
UNION ALL
SELECT periodo, 'SB_PRIM_CONS', equipe_codigo, ubs_codigo,
       COUNT(*) FILTER (WHERE primeira_consulta_ok) AS num, COUNT(*) AS den
FROM pec_odonto_usuarios GROUP BY 1, 2, 3, 4
UNION ALL
SELECT periodo, 'SB_TRAT_CONCL', equipe_codigo, ubs_codigo,
       COUNT(*) FILTER (WHERE tratamento_concluido_ok) AS num, COUNT(*) AS den
FROM pec_odonto_tratamentos GROUP BY 1, 2, 3, 4
UNION ALL
SELECT periodo, 'SB_EXODONTIA', equipe_codigo, ubs_codigo,
       COUNT(*) FILTER (WHERE exodontia) AS num, COUNT(*) AS den
FROM pec_odonto_procedimentos GROUP BY 1, 2, 3, 4
UNION ALL
SELECT periodo, 'SB_ESCOVACAO', equipe_codigo, ubs_codigo,
       COUNT(*) FILTER (WHERE escovacao_ok) AS num, COUNT(*) AS den
FROM pec_escolares GROUP BY 1, 2, 3, 4
UNION ALL
SELECT periodo, 'SB_PREVENTIVO', equipe_codigo, ubs_codigo,
       COUNT(*) FILTER (WHERE preventivo_ok) AS num, COUNT(*) AS den
FROM pec_odonto_procedimentos GROUP BY 1, 2, 3, 4
UNION ALL
SELECT periodo, 'SB_ART', equipe_codigo, ubs_codigo,
       COUNT(*) FILTER (WHERE art_ok) AS num, COUNT(*) AS den
FROM pec_odonto_procedimentos GROUP BY 1, 2, 3, 4
-- Bloco EMULTI
UNION ALL
SELECT periodo, 'EMULTI_MEDIA', equipe_codigo, ubs_codigo,
       COUNT(*) FILTER (WHERE atendimento_ok) AS num, COUNT(*) AS den
FROM pec_emulti_atendimentos GROUP BY 1, 2, 3, 4
UNION ALL
SELECT periodo, 'EMULTI_INTERPROF', equipe_codigo, ubs_codigo,
       COUNT(*) FILTER (WHERE interprof_ok) AS num, COUNT(*) AS den
FROM pec_emulti_acoes GROUP BY 1, 2, 3, 4;

-- Agregado por UBS (CNES) + equipe p/ filtros do painel. Sem PII.
CREATE OR REPLACE VIEW vw_ubs_equipes AS
SELECT ubs_codigo AS ubs_cnes, equipe_codigo,
       MAX(equipe_tipo) AS equipe_tipo,
       COUNT(*) FILTER (WHERE valido) AS cadastros_validos
FROM pec_cadastro_individual GROUP BY 1, 2;
"""

# Mantidas p/ compat: views antigas Previne viram alias do novo modelo.
VW_PAINEIS = VW_PAINEL_APS_NOVO + """
CREATE OR REPLACE VIEW vw_painel_previne AS
SELECT periodo, equipe_codigo, ubs_codigo, SUM(num) AS num_painel,
       SUM(den) AS den_painel,
       ROUND(100.0 * SUM(num) / NULLIF(SUM(den), 0), 1) AS perc
FROM vw_painel_aps_novo GROUP BY 1, 2, 3;
"""

VW_GRAFICOS = """
CREATE OR REPLACE VIEW vw_graficos_serie AS
SELECT periodo, indicador, SUM(num) AS num, SUM(den) AS den,
       ROUND(100.0 * SUM(num) / NULLIF(SUM(den), 0), 1) AS perc
FROM vw_painel_aps_novo GROUP BY 1, 2 ORDER BY 1, 2;

CREATE OR REPLACE VIEW vw_graficos_funil_cadastro AS
SELECT etapa, total FROM (
  SELECT 'captados' AS etapa, COUNT(*) AS total FROM pec_cadastro_individual
  UNION ALL
  SELECT 'validos', COUNT(*) FROM pec_cadastro_individual WHERE valido
  UNION ALL
  SELECT 'ativos', COUNT(*) FROM pec_cadastro_individual WHERE valido AND ativo
) f;

CREATE OR REPLACE VIEW vw_graficos_fichas_inconsistentes AS
SELECT ficha_uuid, motivo FROM pec_fichas WHERE inconsistente LIMIT 500;
"""

FN_CADSUS = """
CREATE OR REPLACE FUNCTION cadsus_cns_valido(cns TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE soma INT := 0; i INT; dv INT; resto INT;
BEGIN
  IF cns IS NULL OR cns !~ '^\\d{15}$' THEN RETURN FALSE; END IF;
  FOR i IN 1..15 LOOP soma := soma + (SUBSTRING(cns, i, 1)::INT * (16 - i)); END LOOP;
  resto := soma % 11;
  dv := CASE WHEN resto = 0 THEN 0 ELSE 11 - resto END;
  RETURN dv = 10;
END $$;

CREATE OR REPLACE FUNCTION cadsus_cpf_valido(cpf TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE soma INT; resto INT; i INT; d1 INT; d2 INT;
BEGIN
  IF cpf IS NULL OR cpf !~ '^\\d{11}$' THEN RETURN FALSE; END IF;
  IF cpf ~ '^(\\d)\\1{10}$' THEN RETURN FALSE; END IF;
  soma := 0;
  FOR i IN 1..9 LOOP soma := soma + SUBSTRING(cpf, i, 1)::INT * (10 - i); END LOOP;
  resto := (soma * 10) % 11; d1 := CASE WHEN resto = 10 THEN 0 ELSE resto END;
  soma := 0;
  FOR i IN 1..10 LOOP
    soma := soma + (CASE WHEN i < 10 THEN SUBSTRING(cpf, i, 1)::INT ELSE d1 END * (11 - i));
  END LOOP;
  resto := (soma * 10) % 11; d2 := CASE WHEN resto = 10 THEN 0 ELSE resto END;
  RETURN d1 = SUBSTRING(cpf, 10, 1)::INT AND d2 = SUBSTRING(cpf, 11, 1)::INT;
END $$;
"""
