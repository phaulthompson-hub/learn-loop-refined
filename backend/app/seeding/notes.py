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

