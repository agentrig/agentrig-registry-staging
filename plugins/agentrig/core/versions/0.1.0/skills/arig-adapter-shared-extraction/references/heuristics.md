# Extraction Heuristics

## Extract to shared when

- The pattern exists in at least two sibling files.
- The steps happen in the same order.
- The logic has the same reason to change.
- A shared context object improves readability.
- The helper name is clearer than the duplicated code.

## Keep local when

- The behavior is semantically different, not just syntactically different.
- The provider or backend owns its own manifest shape.
- The side effects differ.
- The abstraction would need boolean flags to explain itself.
- The shared layer would become larger than the local files.

## Preferred structure

- `shared` or orchestrator module for invariant flow
- one adapter file per provider or backend
- thin legacy aliases at the command layer

## Smells

- one giant shared file that knows too much about every provider
- generic helper names like `buildConfig` with hidden branching
- extracting after only one concrete implementation
- moving domain-specific constants into shared just for symmetry
