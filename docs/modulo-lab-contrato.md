# Módulo Exames Laboratoriais + Faturamento BPA

Objetivo: gestão de solicitações de exames laboratoriais vinculadas ao paciente e ao procedimento SIGTAP, com faturamento em lote BPA consolidação. Separado do TFD.

## Tabelas

- `sigtap_procedimentos`: codigo único, descricao, complexidade (AB|MC|AC), instrumento (BPA-C|BPA-I|BPA-F).
- `lab_solicitacoes`: paciente_id FK tfd_pacientes, sigtap_id FK, data_solicitacao, laboratorio, status (Solicitado|Agendado|Realizado|Cancelado), faturado bool, competencia AAAA-MM, observacoes.

## Endpoints (`/api/lab`, JWT + tela `lab`)

- `GET /resumo?competencia=AAAA-MM` — contadores por status.
- `GET /sigtap?q=&instrumento=` — consulta rápida.
- `POST /sigtap` — cadastro (superuser ou tela lab).
- CRUD `/solicitacoes` — filtros status, laboratorio, de, ate, competencia.
- `GET /prontos-faturar?competencia=` — Realizado + faturado=false.
- `POST /marcar-faturado {ids:[...]}` — marca lote.
- `GET /lote?competencia=` — JSON agrupado por código.
- `GET /exportar-lote?competencia=` — CSV `codigo,qtd`.

## Formato lote BPA (consolidação — só BPA-C)

CSV `codigo,qtd` só com instrumento BPA-C. BPA-I (ex HIV) exige lote individualizado com CNS, fora deste export.
```
codigo,qtd
0202020380,12
0202010473,20
0202010317,8
0202010694,8
0202060250,5
```

## Telas (`/lab`, Guard tela `lab`)

- `/lab` e `/lab/marcacao` — tabela + filtros competência/status/laboratório + modal nova (busca paciente + SIGTAP).
- `/lab/faturamento` — prontos com checkbox, Marcar como Faturado, Exportar Lote.
- `/lab/sigtap` — busca rápida código/descrição + filtro instrumento.

## Segurança

- JWT Bearer em todas as rotas, check tela `lab` ou superuser.
- Sem segredo no repo, sem CPF/CNS em log.
- Amostra: seed 10 procedimentos em `app/data/sigtap_lab_seed.json`; boot insere se tabela vazia.

## Pendências

- Confirmar CNES unidade Guapé para lote oficial SIA.
- Validar códigos contra SIGTAP vigente (ex: hemograma 0202020380).
- Decidir BPA-C vs BPA-I por exame (HIV usa BPA-I).
- Dar tela `lab` aos usuários existentes via Contas.
