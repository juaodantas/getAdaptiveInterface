# Design — Experimento contrabalanceado com autoatribuição

## Contexto

A versão anterior da spec previa atribuição manual ou em lote de participantes. Após refinamento do fluxo experimental, a abordagem recomendada passa a ser:

- Admin cria o experimento uma vez antes do teste.
- Novos usuários são autoatribuídos logo após o login pós-cadastro, antes de navegar para a Home.
- O admin pode corrigir grupo individualmente se necessário.
- Ao fim do primeiro período, o admin avança todos os participantes para o próximo período em lote.
- Alunos deslogam e logam novamente para carregar o novo modo; não há listener em tempo real.

Arquivos observados:

- Backend: `getAdaptiveInterface/index.js`
  - `adminAdaptiveMode` já gerencia `userAdaptiveConfig`.
  - `getAdaptiveInterface` já lê `userAdaptiveConfig` e resolve o modo.
- Frontend: `osi-solucoes`
  - `adaptive_admin_page.dart` já lista usuários/configs e configura modo individual.
  - `adaptive_admin_service.dart` já chama `adminAdaptiveMode`.
  - `home_store.dart` já busca `userAdaptiveConfig` antes de chamar a API.

## Objetivos e não objetivos

### Objetivos

- Representar o experimento completo em `experimentalGroups/{experimentId}`.
- Autoatribuir usuários novos com estratégia round-robin após login, validando o JWT emitido pela ISIS.
- Registrar metadados experimentais em `userAdaptiveConfig` e `sessionNavigations`.
- Permitir avanço de período em lote.
- Permitir correção manual de usuário/grupo.
- Gerar `participantId` único por experimento, sem reiniciar por grupo.
- Permitir encerramento administrativo do experimento.
- Evitar listener em tempo real no app do aluno.

### Não objetivos

- Não alterar recomendação `STATIC`/`INSTANT`.
- Não alterar BigQuery.
- Não criar exportação CSV.
- Não fazer randomização estatística avançada.
- Não forçar atualização em tempo real; logout/login é o fluxo operacional.

## Arquitetura proposta

```text
Admin Flutter
  └─ AdaptiveAdminService
      └─ adminAdaptiveMode HTTP
          ├─ create/update experiment
          ├─ autoAssignParticipant
          ├─ assignParticipantToGroup
          └─ advanceExperimentPeriod

Aluno Flutter
  └─ CadastroStore.cadastraUser()
      ├─ createUserAccount
      ├─ login(email, senha) → token ISIS
      ├─ autoAssignAdaptiveExperiment(userId, isisToken)
      └─ navega para Home já com userAdaptiveConfig criado
```

## Backend — `adminAdaptiveMode`

O endpoint continua sendo único, protegido por `ADMIN_KEY`. A extensão usa `collection` e `action`.

### Operações novas

| Operação | Entrada | Saída |
| --- | --- | --- |
| Criar experimento | `collection: experimentalGroups` | Documento em `experimentalGroups/{experimentId}` |
| Autoatribuir | callable `autoAssignAdaptiveExperiment` | Config criada em `userAdaptiveConfig/{userId}` após validação do token ISIS |
| Ajustar grupo | `action: assignParticipantToGroup` | Config do usuário atualizada |
| Avançar período | `action: advanceExperimentPeriod` | Todos os participantes atualizados |
| Encerrar experimento | `action: completeExperiment` | `status: completed`, `autoAssign: false` |

### Autoatribuição round-robin

Fluxo recomendado:

1. Verificar se `userAdaptiveConfig/{userId}` já existe.
   - Se existe, retornar config existente; não reatribuir.
2. Buscar experimento ativo:
   - `status == 'active'`
   - `autoAssign == true`
3. Executar transação Firestore:
   - Ler `assignmentIndex` atual.
   - Calcular `groupIndex = assignmentIndex % groups.length`.
   - Incrementar `assignmentIndex`.
   - Gerar `participantId = P{assignmentIndex + 1}` por experimento, não por grupo.
   - Selecionar condição do `currentPeriod`.
   - Criar `userAdaptiveConfig/{userId}`.
   - Atualizar array `participants` do experimento.
   - Se `mode == INSTANT`, criar `sessionNavigations/{sessionId}`.

Por exigir leitura + incremento + escrita consistente, esta operação deve usar `db.runTransaction`, não apenas `batch`.

### Avançar período

Fluxo:

1. Buscar `experimentalGroups/{experimentId}`.
2. Validar `currentPeriod < maxPeriods`.
3. `nextPeriod = currentPeriod + 1`.
4. Para cada participante registrado:
   - Buscar grupo do participante.
   - Buscar condição do grupo para `nextPeriod`.
   - Atualizar `userAdaptiveConfig/{userId}` com:
     - `period: nextPeriod`
     - `condition: condition.mode`
     - `mode: condition.mode`
     - novo `sessionId` se `INSTANT`; remover/limpar `sessionId` se `STATIC`
   - Criar `sessionNavigations/{sessionId}` para `INSTANT`.
5. Atualizar `experimentalGroups/{experimentId}.currentPeriod`.

Como o Firestore batch tem limite de 500 operações, a implementação deve:

- Usar batch se número de participantes for pequeno.
- Preparar helper de chunking se houver risco de mais de ~200 participantes.

Para o teste com alunos, batch único deve ser suficiente.

### Voltar período

Na primeira versão, não haverá ação simples de voltar período. O avanço é unidirecional para proteger a integridade das sessões e evitar reclassificação acidental de dados já coletados. Se houver erro operacional, a correção deve ser feita com ajuste manual por usuário (`assignParticipantToGroup`) ou por intervenção administrativa explícita fora do fluxo normal.

### Encerrar experimento

Ao final do teste, o admin deve poder executar `completeExperiment`:

1. Buscar `experimentalGroups/{experimentId}`.
2. Atualizar:
   - `status: 'completed'`
   - `autoAssign: false`
   - `completedAt: serverTimestamp()`
   - `updatedAt: serverTimestamp()`
3. Não apagar `participants`, `userAdaptiveConfig` ou `sessionNavigations`.

Com isso, novos usuários deixam de ser autoatribuídos ao experimento encerrado, mas todos os dados históricos permanecem disponíveis para análise.

## Frontend — cadastro/login do aluno

### Sem listener

Não haverá `snapshots()` permanente. O fluxo depende de logout/login para recarregar config após mudança de período.

### Alteração necessária

O app já executa o fluxo `createUserAccount → login → Home`. A integração passa a ser:

1. `createUserAccount` cria o usuário na ISIS.
2. `login(email, senha)` retorna `Authentication(usuario, token)`.
3. Antes de retornar sucesso/navegar para a Home, o app chama `autoAssignAdaptiveExperiment` com:
   - `userId = usuario.id`
   - `isisToken = token`
4. A Cloud Function valida o JWT da ISIS com `ISIS_JWT_SECRET`.
5. Se o token pertence ao usuário e há experimento ativo, a config é criada.
6. Home carrega normalmente, lendo `userAdaptiveConfig` já existente.

O app do aluno não deve usar `AdaptiveAdminService` nem `ADMIN_KEY`.

### Função segura `autoAssignAdaptiveExperiment`

Contrato:

```json
{
  "userId": "101",
  "isisToken": "<jwt-da-isis>"
}
```

Validação:

- `isisToken` obrigatório.
- `ISIS_JWT_SECRET` obrigatório no ambiente da Cloud Function.
- `jwt.verify(isisToken, ISIS_JWT_SECRET)`.
- `String(payload.id) === String(userId)`.
- Se falhar, rejeitar a chamada.
- Se `userAdaptiveConfig/{userId}` já existir, retornar config existente sem mudar grupo.

## Frontend — tela admin

### Criar experimento

Adicionar seção/visão "Experimentos" à tela admin:

- Criar experimento.
- Definir grupos internos A/B.
- Definir condições por período.
- Ativar/desativar `autoAssign`.

### Avançar período

Card do experimento ativo deve exibir:

- `currentPeriod`
- contagem de participantes
- grupos e condições
- botão `Avançar para Período 2`

Ao clicar:

- Exibir confirmação forte.
- Chamar `advanceExperimentPeriod`.
- Mostrar resumo: quantos participantes foram atualizados para `STATIC` e `INSTANT`.

### Ajuste manual

Na lista de usuários:

- Mostrar `experimentId`, `testGroup`, `participantId`, `period`, `condition`.
- Ação "Trocar grupo" ou "Ajustar experimento".
- Chamar `assignParticipantToGroup`.

## Firestore

### `experimentalGroups/{experimentId}`

Documento central do experimento. Apesar do nome da collection, o documento representa o experimento completo e contém grupos internos.

### `userAdaptiveConfig/{userId}`

Config efetiva usada pela Home e por `getAdaptiveInterface`.

### `sessionNavigations/{sessionId}`

Sessões `INSTANT` com metadados experimentais para análise.

## Riscos e mitigação

- **Race condition no cadastro simultâneo:** usar transação para `assignmentIndex`.
- **App do aluno usando ADMIN_KEY:** não usar `AdaptiveAdminService` para autoatribuição; criar callable `autoAssignAdaptiveExperiment` validando token ISIS.
- **Token ISIS inválido ou de outro usuário:** negar autoatribuição.
- **Usuário já atribuído:** autoatribuição deve ser idempotente e retornar config existente.
- **Avanço de período acidental:** exigir confirmação com nome do experimento e período destino.
- **Necessidade de voltar período:** não oferecer botão simples; corrigir por usuário para evitar corromper interpretação das sessões.
- **Cadastro após fim do teste:** ação `completeExperiment` deve desativar `autoAssign`.
- **Aluno não desloga:** admin deve orientar logout/login; sem listener, mudança não será refletida até recarregar Home.

## Validação planejada

- Criar experimento ativo.
- Simular quatro novos usuários: distribuição A/B/A/B.
- Conferir `userAdaptiveConfig` de cada usuário.
- Conferir criação de `sessionNavigations` apenas para `INSTANT`.
- Avançar período e verificar troca de modos.
- Reabrir app/logar novamente e confirmar Home no novo modo.
- `node -c index.js`.
- `flutter analyze` nos arquivos alterados.
