# Earning Calendar persona analysis canon

This directory is a runtime prompt bundle for the Earning Calendar analysis button.

- The bundle is loaded only when persona mode is enabled.
- Both persona choices load the same six source documents; the selected settings persona does not preselect the earnings narrator.
- `earnings-persona-routing.txt` and `output-example.txt` define the earnings report structure.
- The two character instruction files define voice and relationship details.
- The two quote files are character-specific reference corpora.
- Runtime compatibility rules in `web/server/codexProbe.mjs` override obsolete platform actions, external GPT links, image-generation requests, and requests to reveal private reasoning.
- Earnings output uses a semantic Markdown H1 (`# `) for the title and ordinary blank Markdown lines between paragraphs. HTML nonbreaking-space entities are not part of the runtime output contract.

Keep every runtime source in this directory so a standalone `GuiBuild/` copy does not depend on a Downloads folder or another repository.
