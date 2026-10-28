export const OPCOES_PADRAO: (number | "Todos")[] = [10, 25, 50, 100, 250, "Todos"];

// Filtra as opções de exibição:
// 1. Só exibe números estritamente menores que o total de registros
// 2. Se nenhuma opção numérica for menor que o total (ex: total <= 10), o seletor não aparece
// 3. Não exibe números maiores que o total (ex: se total tem 26, não exibe 50, 100 ou 250, apenas 10, 25 e Todos)
export function calcularOpcoesPageSize(
  opcoes: (number | "Todos")[],
  total: number
): (number | "Todos")[] {
  const numericas = opcoes.filter(
    (op): op is number => typeof op === "number" && op < total
  );
  if (numericas.length === 0) {
    return [];
  }
  const temTodos = opcoes.includes("Todos");
  return temTodos ? [...numericas, "Todos" as const] : numericas;
}
