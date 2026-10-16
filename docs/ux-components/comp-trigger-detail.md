# Component — Trigger detail (`cp-trigger-detail`)

The right-side drawer loads the trigger and its recent runs. It has Runs and Test tabs; editing settings uses the wizard.

The run history separates admission (`pending`), execution (`running`) and the actual terminal flow result (`succeeded` or `failed`). Refresh reloads the last 50 entries.

Fire now tests the flow directly and does not validate the external sender's HMAC or replay protection. For webhook authentication and payload delivery, use the generated Bash/Node.js signing example against the displayed instance-scoped URL. Supply the shared secret securely through the shell environment; the example never embeds a stored value.

Secret controls are shown only when the detail API's permission decisions allow them:

- Reveal secret: read the current, non-revoked value; access is audited and rate-limited. This is repeatable, not a one-shot guarantee.
- Rotate: generate a fresh secret and independent storage reference, clear revocation and display the new value. Update the sending service to resume calls.
- Revoke secret: confirm invalidation of external calls. Re-enabling the trigger does not restore the old secret. Existing admitted flow runs continue.

Revealed values live only in component memory. Rotation and revocation are audited without plaintext. The drawer visibly reports revoked state. The backend enforces every permission independently of button visibility.

API: `getTrigger`, `listTriggerRuns`, `fireTrigger`, `revealTriggerSecret`, `rotateTriggerSecret`, `revokeTriggerSecret` in `ui/src/api.ts`.
