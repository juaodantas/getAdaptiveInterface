# Decisão — Defaults iniciais do cache compartilhado INSTANT

## O que foi decidido

- Usar `promptVersion` explícito como parte da chave lógica do cache.
- Usar TTL padrão de 24 horas.
- Usar TTL reduzido de 6 horas para perfis operacionais voláteis, como alerta crítico ou atraso relevante.
- Cachear somente recomendações com `confidence >= 0.7`.
- Não adicionar metadado público de cache hit na response do `INSTANT`; observabilidade deve ficar em métricas/logs internos.
- Não implementar limpeza física de documentos expirados nesta entrega; a implementação deve apenas gravar e respeitar `expiresAt`.

## Por que

- Esses valores seguem a spec e permitem uma primeira entrega segura sem bloquear por decisões operacionais refináveis.
- `promptVersion` na chave invalida versões antigas sem deleção imediata.
- TTL curto reduz risco de recomendação obsoleta em contexto compartilhado.
- Métricas internas evitam mudança desnecessária no contrato público do `INSTANT`.

## O que foi descartado

- Cache por `userId`, `sessionId` ou device id, por risco de PII e baixo compartilhamento.
- TTL físico/limpeza automática como parte da feature principal.
- Alterar a response pública para expor `cache: { hit: true }` sem contrato explícito.
