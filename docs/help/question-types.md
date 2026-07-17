# Question Types and Compatibility

CREATE currently exposes 15 question types. Availability depends on both the teaching purpose used by AI planning and the selected delivery target/format. Manual selection still cannot bypass format compatibility.

## Question type catalogue

| Type | Best used for |
| --- | --- |
| Multiple Choice | One or several defensible correct options with distractors |
| True/False | A focused claim that is clearly verifiable |
| Flashcard | Recall, terminology, and low-stakes practice |
| Summary | Selecting or assembling the key statements in a concept |
| Discussion | Reflection or facilitated open response |
| Matching | Pairing related concepts, examples, or definitions |
| Ordering | Putting steps, events, or priorities into sequence |
| Fill in the Blank | Completing precise terms or short statements |
| Mark the Words | Identifying target words or phrases in context |
| Single Choice Set | A sequence of single-answer choice prompts |
| Essay | Extended constructed response |
| Sort Paragraphs | Reordering paragraph-level content |
| Crossword | Vocabulary practice through clues |
| Branching Scenario | Decisions that lead through a scenario path |
| Documentation Tool | Structured reflection or documentation prompts |

## Delivery target compatibility

| Target and format | Supported types |
| --- | --- |
| H5P Package — Column | Multiple Choice, True/False, Fill in the Blank, Mark the Words, Ordering, Matching, Single Choice Set, Essay, Flashcard, Summary, Discussion, Documentation Tool |
| H5P Package — Interactive Book | The same mixed-content types as Column |
| H5P Package — Question Set | Multiple Choice, True/False, Fill in the Blank, Mark the Words, Essay |
| H5P Package — Standalone | Branching Scenario, Crossword, Sort Paragraphs |
| Canvas LTI — Mixed Activity | All 15 CREATE question types |

Standalone is intentionally narrow: it represents one complex H5P activity rather than a mixed list. Column and Interactive Book are the broadest downloadable H5P choices. Mixed Activity is rendered by CREATE's Canvas LTI player and is not equivalent to a standard mixed H5P package.

## Teaching-purpose defaults

| Teaching purpose | Types AI draws from by default |
| --- | --- |
| Support Learning | Flashcard, Summary, Mark the Words |
| Assess Understanding | Multiple Choice, True/False, Single Choice Set, Essay |
| Gamify Learning | Matching, Ordering, Fill in the Blank, Discussion, Crossword, Sort Paragraphs, Mark the Words |

The final usable set is the intersection of teaching-purpose defaults and target-format compatibility. If that intersection is too narrow for your design, choose a different format or edit the Blueprint with another compatible type.

## Choosing a type

Start with the learning objective, not visual variety. Recall objectives suit flashcards or precise selection tasks; procedural objectives suit ordering; relationship knowledge suits matching; higher-order judgment often needs a scenario, essay, or carefully written multiple-choice question. Use interactive types only when the interaction itself supports the learning outcome.

## Changing target or format

CREATE checks existing plan rows and questions when the target or format changes. Unsupported types are identified before the change is applied. Confirming can remove incompatible content, so export or record anything you need before accepting the warning.

## Compatibility source of truth

The interface derives compatibility from `src/constants/questionTypeCapabilities.ts`. CREATE Guide also reads that registry directly for compatibility questions. If this page and the selector ever disagree, trust the selector for the current build and report the documentation mismatch.
