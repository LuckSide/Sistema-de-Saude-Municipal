# Análise de UI/UX e Sugestões de Melhoria

Após analisar a estrutura e os componentes de interface (UI) deste projeto, as seguintes observações e oportunidades de melhorias foram identificadas com o objetivo de elevar a usabilidade, acessibilidade (A11y) e consistência da base de código.

## 1. Consistência Visual e Reutilização (DRY)
**Problema:** Atualmente, as páginas do sistema, como `Configuracoes.tsx`, `Auditoria.tsx`, `FilaExames.tsx` e `Agendamentos.tsx`, não utilizam integralmente os componentes primitivos (`Input`, `Select`, etc.). Em vez disso, classes grandes e repetitivas do Tailwind CSS (como `"w-full rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-sus-700..."`) estão espalhadas pelos arquivos.
**Impacto:** Dificuldade de manutenção caso o estilo global precise ser modificado, redundância de código e risco de pequenos desvios de design entre as páginas.
**Sugestão:**
- Centralizar o estilo de seleção em um novo primitivo `<Select>` dentro de `frontend/src/components/ui/primitives.tsx`.
- Substituir o uso repetitivo de tags nativas `<input>` e `<select>` com longas strings de classe pelos primitivos `<Input>` e `<Select>`.

## 2. Acessibilidade de Foco (A11y e Focus-Visible)
**Problema:** A grande maioria dos inputs e botões no sistema usa a pseudo-classe `focus` com `outline-none` e alteração da cor da borda ou `focus:ring`.
- **O problema do `focus:` genérico:** Se um usuário com deficiência motora estiver navegando via teclado (`Tab`), o destaque por cor de borda muitas vezes não é forte o suficiente. Ao mesmo tempo, se um usuário clica em um botão com o mouse, um anel forte de foco (`ring`) muitas vezes aparece, causando poluição visual, já que quem navega por mouse já sabe onde clicou.
**Impacto:** Experiência confusa para quem usa mouse, e navegação não-intuitiva ou de baixo contraste para quem navega por teclado.
**Sugestão:**
- Implementar o padrão moderno do `focus-visible`.
- Manter o `outline-none` nativo para cliques de mouse, mas aplicar um anel visível de alto contraste e distanciado *apenas* quando o componente receber foco por teclado, ex: `focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal focus-visible:outline-none`.

## 3. Usabilidade de Teclado em Dropdowns
**Problema:** O componente atual `Combobox` (`frontend/src/components/ui/combobox.tsx`) permite busca via texto, mas não permite navegar entre os resultados usando as setas do teclado (`ArrowUp`, `ArrowDown`). Ele responde apenas ao clique ou ao "Enter" na primeira opção.
**Impacto:** Reduz significativamente a usabilidade e velocidade para power-users ou pessoas que dependem de teclado e leitores de tela.
**Sugestão:**
- Refatorar o `Combobox` para suportar navegação via setas do teclado manipulando ativamente o foco (ou virtualmente usando um índice `activeIndex`).
- **Alternativa robusta:** A longo prazo, aconselha-se o uso de uma biblioteca focada em acessibilidade "headless", como **Radix UI** ou **Headless UI**, que trata navegação em listas, captura de foco (`focus trap`) e eventos ARIA perfeitamente.

## 4. Contraste de Cores (WCAG AA/AAA)
**Problema:** Vários textos de placeholders ou labels de baixa ênfase usam cores transparentes que oferecem um rácio de contraste baixo contra o fundo branco. Por exemplo, `placeholder:text-ink/35` ou `text-sus-900/70`.
**Impacto:** Usuários com problemas de visão, deficiências na percepção de cores (daltonismo) ou uso de telas de baixa qualidade terão dificuldades em ler esses textos.
**Sugestão:**
- Ajustar os tons claros para garantir um *Contrast Ratio* de no mínimo 4.5:1 (conforme normas da WCAG Nível AA). Em vez de `text-ink/35`, usar `text-ink/60` ou uma cor sólida da paleta (ex: um cinza/grafite médio projetado especificamente).
