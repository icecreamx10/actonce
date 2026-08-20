# ActOnce Skills

This package contains the published ActOnce agent skills:

- `record-device-use`: capture AI-driven macOS or iOS device sessions as correlated traces.
- `synthesize-device-replay`: agent-author immutable recordings into checkpoint-gated deterministic replay plans.

Install the package from ByteDance's BNPM registry:

```bash
npm install @byted/actonce-skills --registry=http://bnpm.byted.org
```

The npm installation is a distribution archive; it does not automatically register skills with an agent. Copy or link `record-device-use` and/or `synthesize-device-replay` from the installed package into the skill directory supported by the target agent, preserving each directory intact. Each skill starts at its `SKILL.md` file.

The bundled verification, summarization, and extraction scripts are self-contained and use Node.js built-ins. Live recording and replay execution require the external ActOnce CLI/platform runtime and the macOS or iOS prerequisites documented in the corresponding `SKILL.md`; those binaries and device toolchains are not bundled here. The repository-internal benchmark skill is intentionally excluded from this package.
