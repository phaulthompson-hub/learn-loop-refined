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

