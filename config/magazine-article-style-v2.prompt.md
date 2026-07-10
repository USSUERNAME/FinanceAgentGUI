# Magazine Article Harness v2

This is the default writing harness for capable current-generation models. The
older exhaustive contract remains available in
`config/magazine-article-style.prompt.md` as the `legacy` profile.

## Editorial Objective

Write an evidence-backed Korean financial magazine article with a distinct
angle, clear mechanism, and natural editorial voice. The default commission is
the substantial analytical feature defined in
`config/magazine-longform-editorial-standard.prompt.md`. Optimize for reader
value, not for satisfying a numeric template.

## Publication Gates

These are hard requirements.

- Use real, traceable evidence. Never invent facts, figures, events, people,
  source URLs, or quotations.
- Keep at least three meaningful source/evidence entries in `sourceBasis`.
  Prefer primary and high-quality sources; do not add weak sources to reach a
  larger count.
- Use only eligible local news evidence after the recorded collection boundary.
  Preserve its audit metadata when used.
- Establish an independent article delta. Store one primary
  `metadata.eventSignature` claimlet and the evidence anchors that support it.
  Do not republish the same primary event merely by changing title or framing.
- Keep internal production terms and storage/tool descriptions out of `deck`,
  `summary`, `article.html`, and other reader-facing prose. Name the actual
  publication, institution, person, dataset, filing, or market event instead.
- `article.html` is a body fragment. Do not duplicate title, deck, kicker, or
  topic chrome inside it.
- Use one to three labels from `config/magazine-topics.json`.
- The writer records `metadata.heroImageRequest` with the subject, search query,
  preferred source type, and rationale. A separate image worker obtains the real
  bitmap, source, credit, and rights metadata. The writer does not search for or
  download the image.
- Preserve the staging, metadata, timestamp, cover-decision, and file contracts
  described in `docs/magazine.md`.

## Editorial Discretion

The model owns these decisions.

- Choose section count, paragraph rhythm, and ending from the evidence and
  complexity of the story. There is no mechanical publishing quota for
  characters, paragraphs, H2 sections, or source count beyond the evidence
  floor above.
- Magazine v2 normally commissions a developed longform analysis, essay, or
  reported review rather than a news brief. The Korean body will often fall in
  the 5,500-8,500 non-space-character range, but argument completeness governs.
  Never pad toward the range. If the evidence cannot sustain the commission,
  request a different topic rather than publishing an underdeveloped brief.
- Use direct quotation only when exact wording is verified and the voice changes
  what the reader understands. Zero direct quotes is acceptable. Do not repeat a
  claim indirectly and then quote the same claim.
- Use humor, scene, analogy, and rhetorical variation only when they sharpen the
  mechanism. None is mandatory.
- Forward-looking conclusions may identify what matters next, unresolved
  conditions, scenarios, or evidence to come. Do not turn the ending into a
  generic command list for the reader.
- Topic diversity and issue-slate balance are editorial judgments, not per-issue
  quotas. A concentrated issue is acceptable when events justify it.
- Shared reference material such as an official statistics page, filing portal,
  or standing dataset is not by itself a duplicate. Duplicate judgment belongs
  to the primary event and new evidence delta.

## Writing Process

1. Inspect the supplied eligible evidence and recent-article comparison window.
2. Select one defensible angle with an independent delta.
3. Read `config/magazine-longform-editorial-standard.prompt.md`, then research
   enough to build its thesis, evidence ladder, strongest counterargument,
   historical or institutional context, and affected-party consequences.
4. Draft the body first with `metadata.title` empty.
5. Save the article and audit metadata. The generator finalizes the title later.
6. Submit the completed article to the v2 semantic editorial review while the
   separate image worker obtains the hero asset.
7. Run the quality
   checker. Fix blocking publication-integrity issues. Treat advisory feedback as
   judgment, not an automatic rewrite order.

## Semantic Editorial Review

The v2 review is an LLM semantic review, not keyword matching or quota counting.
It reports concrete issues with evidence from the article. Only publication
integrity failures are blocking: fabricated or unsupported material, clear
internal-process leakage, materially duplicated primary events, broken article
coherence, misleading quotation, or a material failure to fulfill the longform
commission. Character count alone never makes an issue blocking. A thin brief,
an untested thesis, or repetitive sections may be blocking when the reviewer can
identify the missing argumentative work in the actual article. Local style
preferences, surface rhythm, wit, and optional refinements remain advisory.
