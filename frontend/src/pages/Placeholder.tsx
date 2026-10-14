import { Card } from "../components/ui/primitives";

export function Placeholder({ titulo }: { titulo: string }) {
  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold text-sus-950">{titulo}</h1>
      <Card className="mt-4 border-dashed p-6">
        <p className="text-sm text-ink/60">
          Módulo disponível em breve. Rota protegida por permissão de tela.
        </p>
      </Card>
    </div>
  );
}
