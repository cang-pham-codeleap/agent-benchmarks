# Data model

| Entity | Fields | Rules |
|--------|--------|-------|
| AugmentDefinition (file `augments/<id>.json`) | label, kind, description, sourceUrl, binary, recipes | id from file name `/^[a-z0-9][a-z0-9-]{0,63}$/`; kind ∈ shell-proxy, mcp, prompt-mode, harness-flag; recipe keys ∈ known harnesses; recipe fields typed as in `AugmentRecipe`; `from` resolves inside the augment dir or home |
| LoadedAugment | id, source, definition \| null, hash \| null, problem \| null | user overrides bundled by id; invalid file keeps id with problem |
| Augment snapshot (`manifest.provenance.augments[id]`) | source, hash, definition | written at run start for augments used; absent in older manifests → bundled fallback |
| EvalCombo (file `combos/<id>.json`) | label, setups, taskIds, trials, wallMs | id from file name, same id pattern; label 1..120 chars |
| EvalComboInfo | EvalCombo + id + problem | problem from shape parse or `validateInput` |
| AugmentPoolEntry | + recipeDrift | true when pooled runs saw more than one hash tuple for the pool's augments |
