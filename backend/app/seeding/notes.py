"""Markdown study notes: Alex's knowledge base plus a few notes shared by Maya and Sam.

The notes link to each other with `[[wiki links]]` (one link is deliberately unresolved) and use
every markdown feature the editor renders: headings, lists, task boxes, code, tables and quotes.
"""

from dataclasses import dataclass

from .. import clock
from ..models import Note
from ..services.events import record
from .context import SeedContext


@dataclass(frozen=True)
class SeedNote:
    author: str
    workspace: str
    title: str
    course: str | None
    concept: str | None
    tags: tuple[str, ...]
    created: tuple[int, int]  # (days ago, hour)
    updated: tuple[int, int]
    body: str
    pinned: bool = False
    shared: bool = False
    archived: bool = False


GRADIENT = """# Gradient descent in one page

Gradient descent minimises a **loss function** by walking downhill: compute the gradient, step the
other way, repeat. See [[Loss functions compared]] for what we are minimising.

## The update rule

```python
for step in range(epochs):
    grad = compute_gradient(loss, weights)
    weights = weights - learning_rate * grad
```

## Choosing the learning rate

- Too **large**: the loss bounces around or explodes
- Too **small**: training crawls and can stall on plateaus
- Good default: start at `0.01`, then try 10x up and down
  - plot loss per epoch for each run
  - keep the fastest run that still decreases smoothly

> If the loss goes *up* after the first few steps, halve the learning rate before touching anything else.

## Variants

| Variant | Uses per step | Notes |
| --- | --- | --- |
| Batch | all examples | stable but slow on big data |
| Stochastic | one example | noisy, escapes shallow minima |
| Mini-batch | 32–256 examples | the practical default |

Related: [[Overfitting checklist]] · [[Backprop derivation notes]]
"""

LOSSES = """# Loss functions compared

A loss function turns "how wrong was the model" into one number that
[[Gradient descent cheat sheet|gradient descent]] can minimise.

| Loss | Task | Penalises | Watch out for |
| --- | --- | --- | --- |
| MSE | regression | large errors heavily | outliers dominate |
| MAE | regression | all errors equally | gradient is constant |
| Cross-entropy | classification | confident mistakes | needs probabilities |

## Rules of thumb

1. Regression with clean data: start with **MSE**
2. Regression with outliers: try **MAE** or Huber
3. Classification: **cross-entropy**, always with a softmax/sigmoid output

```python
mse = ((y_pred - y_true) ** 2).mean()
mae = (y_pred - y_true).abs().mean()
```

The loss you train on is not always the metric you report; see [[Precision vs recall]].
"""

OVERFITTING = """# Overfitting checklist

Run through this before blaming the model architecture.

- [x] Split data into train / validation / test **before** any preprocessing
- [x] Compare training loss with validation loss every epoch
- [ ] Add L2 regularisation and re-run with the same seed
- [ ] Try early stopping on validation loss (patience 5)
- [ ] Collect more data for the classes with the worst recall

## Symptoms

- training accuracy keeps rising while validation accuracy flattens
- the model is great on examples it has seen and ~~slightly~~ much worse on new ones

## Fixes, cheapest first

1. More data or data augmentation
2. Regularisation (L2, dropout)
3. A simpler model

Metrics to watch are in [[Precision vs recall]].
"""

PRECISION = """# Precision vs recall

**Precision**: of everything the model flagged, how much was right?
**Recall**: of everything that was actually positive, how much did we find?

| | Predicted positive | Predicted negative |
| --- | --- | --- |
| Actually positive | true positive (TP) | false negative (FN) |
| Actually negative | false positive (FP) | true negative (TN) |

- precision = TP / (TP + FP)
- recall = TP / (TP + FN)
- F1 = harmonic mean of the two

> Spam filter: favour **precision** (never lose a real email).
> Disease screening: favour **recall** (never miss a sick patient).

Back to [[Overfitting checklist]].
"""

JOINS = """# SQL joins field guide

Every join is "match rows from two tables on a condition". The type decides what happens to rows
without a match.

## Inner join: only matches

```sql
SELECT o.id, c.name
FROM orders AS o
JOIN customers AS c ON c.id = o.customer_id;
```

## Left join: keep everything on the left

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers AS c
LEFT JOIN orders AS o ON o.customer_id = c.id
GROUP BY c.name;
```

Customers with no orders still appear, with `0` orders (`COUNT` ignores NULL).

## Common traps

- Filtering the right table in `WHERE` silently turns a left join into an inner join; move the
  condition into `ON` instead
- Joining on a non-unique column multiplies rows; check with `COUNT(*)` before and after
- Always alias tables once there are two or more

Next: [[Window functions scratchpad]] and [[Normalization in plain words]].
"""

NORMALIZATION = """# Normalization in plain words

Normalization = store each fact **once**, then join when you need it.

1. **1NF**: one value per cell, no repeating groups
2. **2NF**: every column depends on the *whole* primary key
3. **3NF**: no column depends on another non-key column

## Example

A single `orders` table holding customer name and email repeats them on every order. Split it:

```sql
CREATE TABLE customers (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL,
  email TEXT UNIQUE
);

CREATE TABLE orders (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  placed_at   TIMESTAMP
);
```

Now an email change is one `UPDATE`, not hundreds. Reading it back needs a join: [[SQL joins field guide]].

---

*When to denormalise:* reporting tables and caches, where reads vastly outnumber writes.
"""

WINDOWS = """# Window functions scratchpad

Window functions compute across related rows **without** collapsing them like `GROUP BY` does.

```sql
SELECT
  customer_id,
  placed_at,
  total,
  SUM(total) OVER (PARTITION BY customer_id ORDER BY placed_at) AS running_total,
  ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY placed_at DESC) AS recency_rank
FROM orders;
```

- `PARTITION BY` = the group, `ORDER BY` = the order inside it
- `ROW_NUMBER() = 1` with `ORDER BY placed_at DESC` gives each customer's latest order
- `LAG(total)` compares a row with the previous one

## Still to figure out

- [ ] Frame clauses (`ROWS BETWEEN 6 PRECEDING AND CURRENT ROW`) for 7-day averages
- [ ] Why the query plan for this is slow, see [[Query plans]]

Builds on [[SQL joins field guide]].
"""

CONFIDENCE = """# Confidence intervals, intuitively

A 95% confidence interval comes from a **procedure** that captures the true value in 95% of repeated
samples. It is *not* a 95% chance that this particular interval contains it.

- wider interval = more uncertainty
- bigger sample = narrower interval (width shrinks with the square root of n)
- mean ± 1.96 × standard error, for large samples

```python
from statistics import mean, stdev
se = stdev(sample) / len(sample) ** 0.5
low, high = mean(sample) - 1.96 * se, mean(sample) + 1.96 * se
```

If the interval for a difference excludes 0, the matching test gives p < 0.05: see
[[p-values without tears]].
"""

PVALUES = """# p-values without tears

> The p-value is the probability of data at least this extreme **if the null hypothesis were true**.

It is **not**:

- the probability that the null hypothesis is true
- the size or importance of an effect
- proof of anything; a hypothesis test can only reject or fail to reject

## Checklist before quoting a p-value

- [x] State the null hypothesis in words
- [x] Pick the significance level *before* looking at the data
- [ ] Report the effect size and a confidence interval too

See [[Confidence intervals, intuitively]].
"""

WEEK_PLAN = """# Weekly study plan: March

## This week

- [x] Finish the gradient descent quiz with 3 correct in a row
- [ ] Re-read [[Loss functions compared]] before the ML check-in
- [ ] SQL: write three window function queries from [[Window functions scratchpad]]
- [ ] Stats: explain [[p-values without tears|p-values]] to Sam without notes

## Next week

1. Neural networks module intro
2. Review flashcards daily (10 minutes, mornings)

Pinned references: [[Gradient descent cheat sheet]], [[SQL joins field guide]]
"""

OLD_READING = """# ML reading list (old)

Replaced by the course material, kept for reference.

- *Pattern Recognition and Machine Learning*, chapters 1–3
- Andrew Ng's lecture notes on linear regression
- ~~Blog post series on decision trees~~ (link is dead)
"""

ORGANELLES = """# Cell organelles at a glance

| Organelle | Job | Remember it as |
| --- | --- | --- |
| Nucleus | stores DNA, directs protein synthesis | the head office |
| Ribosome | builds proteins from mRNA | the assembly line |
| Endoplasmic reticulum | folds and transports proteins | the corridors |
| Golgi apparatus | modifies and packages proteins | the post room |
| Mitochondria | makes ATP by cellular respiration | the power station |
| Chloroplast (plants) | photosynthesis | the solar panel |

## Exam 1 must-knows

- Prokaryotes have **no nucleus**; eukaryotes do
- Cellular respiration: glucose + oxygen → carbon dioxide + water + ATP
- Mitosis gives two identical cells, meiosis gives gametes with half the chromosomes

See also [[Punnett square walkthrough]] for exam 2.
"""

PUNNETT = """# Punnett square walkthrough

Cross two heterozygous parents (**Bb × Bb**), where B (brown) is dominant over b (blue).

```text
        B      b
   +------+------+
 B |  BB  |  Bb  |
   +------+------+
 b |  Bb  |  bb  |
   +------+------+
```

1. Genotypes: 1 BB : 2 Bb : 1 bb
2. Phenotypes: 3 brown : 1 blue
3. Probability of a blue-eyed child: **1/4**

> Homozygous = two identical alleles (BB or bb). Heterozygous = two different alleles (Bb).

Background on where the alleles live: [[Cell organelles at a glance]].
"""

SQL_MISTAKES = """# Common SQL mistakes (instructor notes)

Patterns I see in almost every cohort's first assignment:

1. `SELECT *` in production queries: name the columns
2. Comparing with `= NULL` instead of `IS NULL`
3. Aggregating without grouping by every non-aggregated column
4. Filtering a left-joined table in `WHERE` (see [[SQL joins field guide]], Alex's write-up is great)

```sql
-- wrong: returns nothing, NULL is never equal to anything
SELECT * FROM orders WHERE shipped_at = NULL;
-- right
SELECT id FROM orders WHERE shipped_at IS NULL;
```

Office hours on Thursdays; bring the query *and* the result you expected.
"""

BACKPROP = """# Backprop derivation notes

Backpropagation is the chain rule applied layer by layer, from the loss back to each weight.

For one neuron with activation `a = σ(z)` and `z = w·x + b`:

- ∂L/∂w = ∂L/∂a · σ'(z) · x
- ∂L/∂b = ∂L/∂a · σ'(z)

## Why gradients vanish

- sigmoid' is at most 0.25, so ten sigmoid layers shrink the gradient by 0.25¹⁰
- ReLU keeps a gradient of 1 for positive inputs, which is why it is the default

Pairs with the [[Gradient descent cheat sheet]] that Alex shared.
"""

INDEXES = """# Index tuning notes

- An index speeds up reads on a column and slows down every write to the table
- Composite index `(customer_id, placed_at)` serves filters on `customer_id` alone, not on `placed_at` alone
- Check with `EXPLAIN QUERY PLAN` before and after

```sql
CREATE INDEX idx_orders_customer_date ON orders (customer_id, placed_at);
```

- [x] Add the composite index to the orders table
- [ ] Measure the insert slowdown on the nightly load
"""

INTERVIEW = """# Interview prep

Private scratch notes.

- Explain ACID with a bank transfer example
- Difference between inner and left join, with a diagram
- [ ] Practise one window function question per day
"""

NOTES: tuple[SeedNote, ...] = (
    SeedNote("alex", "northwind", "Gradient descent cheat sheet", "ml", "Gradient Descent",
             ("ml", "optimisation", "cheat-sheet"), (19, 20), (2, 19), GRADIENT, pinned=True, shared=True),
    SeedNote("alex", "northwind", "Loss functions compared", "ml", "Loss Function",
             ("ml", "cheat-sheet"), (17, 19), (6, 20), LOSSES),
    SeedNote("alex", "northwind", "Overfitting checklist", "ml", "Model",
             ("ml", "checklist"), (14, 18), (4, 19), OVERFITTING),
    SeedNote("alex", "northwind", "Precision vs recall", "ml", None,
             ("ml", "metrics"), (12, 18), (12, 19), PRECISION, shared=True),
    SeedNote("alex", "northwind", "SQL joins field guide", "sql", "Join Keeps",
             ("sql", "joins", "cheat-sheet"), (8, 21), (3, 21), JOINS, pinned=True, shared=True),
    SeedNote("alex", "northwind", "Normalization in plain words", "sql", "Database Normalization",
             ("sql", "design"), (7, 20), (7, 21), NORMALIZATION),
    SeedNote("alex", "northwind", "Window functions scratchpad", "sql", None,
             ("sql", "draft"), (3, 21), (1, 22), WINDOWS),
    SeedNote("alex", "northwind", "Confidence intervals, intuitively", "stats", "Confidence Interval",
             ("statistics",), (10, 13), (5, 13), CONFIDENCE),
    SeedNote("alex", "northwind", "p-values without tears", "stats", "Null Hypothesis",
             ("statistics", "exam"), (5, 13), (1, 13), PVALUES),
    SeedNote("alex", "northwind", "Weekly study plan: March", None, None,
             ("planning",), (7, 8), (0, 8), WEEK_PLAN),
    SeedNote("alex", "northwind", "ML reading list (old)", "ml", None,
             ("ml", "reading"), (40, 12), (30, 12), OLD_READING, archived=True),
    SeedNote("alex", "biology", "Cell organelles at a glance", "cells", "Mitochondria",
             ("exam-1", "cheat-sheet"), (11, 17), (2, 17), ORGANELLES, pinned=True),
    SeedNote("alex", "biology", "Punnett square walkthrough", "genetics", "Alleles",
             ("exam-2",), (6, 17), (6, 18), PUNNETT, shared=True),
    SeedNote("maya", "northwind", "Common SQL mistakes (instructor notes)", "sql", None,
             ("sql", "teaching"), (9, 10), (2, 10), SQL_MISTAKES, shared=True),
    SeedNote("maya", "northwind", "Backprop derivation notes", "nn", "Activation Function",
             ("deep-learning", "math"), (13, 11), (8, 11), BACKPROP, shared=True),
    SeedNote("sam", "northwind", "Index tuning notes", "sql", None,
             ("sql", "performance"), (6, 21), (1, 21), INDEXES, shared=True),
    SeedNote("sam", "northwind", "Interview prep", None, None,
             ("career",), (4, 22), (4, 22), INTERVIEW),
)  # fmt: skip


def concept_id(ctx: SeedContext, course_key: str | None, name: str | None) -> int | None:
    """Concepts are extracted from course text, so look them up by name and tolerate a missing one."""
    if course_key is None or name is None:
        return None
    return next((c.id for c in ctx.courses[course_key].concepts if c.name == name), None)


def seed(ctx: SeedContext) -> None:
    for spec in NOTES:
        created, updated = ctx.at(*spec.created), ctx.at(*spec.updated)
        note = Note(
            workspace_id=ctx.workspaces[spec.workspace].id,
            user_id=ctx.users[spec.author].id,
            course_id=ctx.courses[spec.course].id if spec.course else None,
            concept_id=concept_id(ctx, spec.course, spec.concept),
            title=spec.title,
            body=spec.body.strip() + "\n",
            tags=",".join(spec.tags),
            pinned=spec.pinned,
            shared=spec.shared,
            archived=spec.archived,
            created_at=created,
            updated_at=updated,
        )
        ctx.db.add(note)
        ctx.db.flush()
        if spec.shared:
            with clock.travel(created):
                record(
                    ctx.db,
                    workspace_id=note.workspace_id,
                    actor_id=note.user_id,
                    verb="note.shared",
                    object_type="note",
                    object_id=note.id,
                    summary=f"shared the note {note.title}",
                    link=f"/notes/{note.id}",
                )
