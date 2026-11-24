"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function TenantError({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState
      title="Não foi possível carregar esta tela"
      body="Tente de novo. Se continuar, avise o suporte da Visus."
      action={<Button onClick={reset}>Tentar de novo</Button>}
    />
  );
}
