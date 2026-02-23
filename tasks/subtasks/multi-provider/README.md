# Multi-Provider Support

Objective: Replace the hardcoded Anthropic-only credential system with a flexible multi-provider
system supporting Anthropic, OpenAI, OpenRouter, Gemini, Mistral, and OpenCode.

Status legend: [ ] todo, [~] in-progress, [x] done

## Tasks

- [ ] 01 — config-generator refactor → `01-config-generator-refactor.md`
- [ ] 02 — provisioner reuse-logic refactor → `02-provisioner-reuse-refactor.md`
- [ ] 03 — GET /api/providers endpoint → `03-api-providers-endpoint.md`
- [ ] 04 — POST /api/instances handler update → `04-post-instances-handler.md`
- [ ] 05 — UI types + api.ts update → `05-ui-types-api.md`
- [ ] 06 — create-dialog.ts refactor → `06-create-dialog-refactor.md`
- [ ] 07 — Tests → `07-tests.md`

## Dependencies

- 02 depends on 01 (provisioner calls generateEnv/generateConfig with new WizardAnswers shape)
- 03 depends on 01 (server reads openclaw.json; provider list is defined in config-generator)
- 04 depends on 01, 02 (handler builds WizardAnswers and calls provisioner)
- 05 depends on 01 (ProviderInfo type mirrors server response; CreateInstanceRequest mirrors WizardAnswers)
- 06 depends on 03, 05 (dialog calls fetchProviders() and sends new request shape)
- 07 depends on 01, 02 (tests cover the refactored modules)

## Exit criteria

- The feature is complete when:
  - `WizardAnswers.anthropicApiKey` no longer exists anywhere in the codebase
  - `GET /api/providers` returns a valid JSON response with at least 6 providers
  - `POST /api/instances` accepts `{ provider, apiKey }` and rejects `{ anthropicApiKey }`
  - The create-dialog shows a provider dropdown and conditionally shows the API key field
  - All existing tests pass; new provisioner-providers tests pass
  - `pnpm typecheck` exits 0
  - `pnpm test:run` exits 0
