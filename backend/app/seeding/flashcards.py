"""Decks, cards and spaced-repetition history.

Card content is written by hand to match the course material in `materials.py`. Review history
is not invented row by row: each learner's past sessions are replayed through the real scheduler
(`services.review_queue.apply_review`) on the days they studied, so every `CardState` is exactly
what the app would have produced. The plans below are tuned so that on the anchor day Alex has a
healthy pile of reviews due in Northwind, a few new cards left, and more reviews coming later in
the week.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import timedelta
from random import Random

from sqlalchemy import select

from .. import clock
from ..models import CardState, Concept, Deck, Flashcard, StudyLog
from ..services.events import record
from ..services.review_queue import apply_review, end_of_today
from ..services.scheduler import AGAIN, EASY, GOOD, HARD
from .context import SeedContext

# (front, back, hint, topic keyword used to link the card to the course concept that covers it)
Card = tuple[str, str, str, str | None]

DECKS: dict[str, tuple[str, str, tuple[Card, ...]]] = {
    "ml": (
        "ML Essentials",
        "Core vocabulary from the supervised learning unit: training, optimisation and evaluation.",
        (
            (
                "What is supervised learning?",
                "Learning a mapping from inputs to expected outputs using labeled examples.",
                "Think labels",
                "supervised learning",
            ),
            (
                "What is the difference between a feature and a label?",
                "A feature is a measurable input variable; the label is the value the model is trained to predict.",
                "",
                "label",
            ),
            (
                "What kind of value does linear regression predict?",
                "A continuous value, found by fitting parameters that minimise a loss function.",
                "",
                None,
            ),
            (
                "What does a loss function measure?",
                "The difference between the model's predictions and the correct values.",
                "",
                "loss function",
            ),
            (
                "What is gradient descent?",
                "An optimisation method that repeatedly adjusts parameters in the direction that reduces the loss.",
                "Downhill",
                "gradient descent",
            ),
            ("What does the learning rate control?", "The size of each gradient descent step.", "", "learning rate"),
            (
                "What happens when the learning rate is too large?",
                "Steps overshoot the minimum, so training oscillates or even diverges.",
                "",
                "learning rate",
            ),
            (
                "What happens when the learning rate is too small?",
                "Training still converges, but very slowly.",
                "",
                "learning rate",
            ),
            (
                "What is overfitting?",
                "The model memorises the training examples but performs poorly on unseen data.",
                "",
                "overfit",
            ),
            (
                "What is a validation set for?",
                "Estimating how well the model generalises while you tune it, using data it was not trained on.",
                "",
                "validation set",
            ),
            (
                "What does regularization do?",
                "Discourages excessive model complexity (e.g. by penalising large weights) to reduce overfitting.",
                "",
                "regularization",
            ),
            (
                "How does classification differ from regression?",
                "Classification predicts a discrete category; regression predicts a continuous number.",
                "",
                "classification",
            ),
            (
                "Define precision.",
                "Of everything predicted positive, the share that really is positive: TP / (TP + FP).",
                "Predicted positives",
                "precision",
            ),
            (
                "Define recall.",
                "Of all actual positives, the share the model found: TP / (TP + FN).",
                "Actual positives",
                "recall",
            ),
            ("What is the F1 score?", "The harmonic mean of precision and recall: 2PR / (P + R).", "", "f1"),
            (
                "What should responsible ML check besides accuracy?",
                "Data quality, bias, privacy, explainability and performance after deployment.",
                "",
                "responsible",
            ),
        ),
    ),
    "stats": (
        "Statistics Core Terms",
        "Descriptive statistics, distributions and inference, one idea per card.",
        (
            (
                "What is the sample mean?",
                "The arithmetic average of the observations: their sum divided by n.",
                "",
                "sample mean",
            ),
            (
                "Why does the median resist outliers better than the mean?",
                "It is the middle value after sorting, so a few extreme values barely move it; they drag the mean.",
                "",
                "median",
            ),
            (
                "What does the standard deviation measure?",
                "How far observations typically fall from the mean.",
                "",
                "standard deviation",
            ),
            (
                "What does a small standard deviation tell you?",
                "The values cluster tightly around the mean.",
                "",
                "standard deviation",
            ),
            (
                "What is a probability distribution?",
                "An assignment of a probability to every possible outcome of a random variable.",
                "",
                "probability distribution",
            ),
            (
                "Which two parameters describe a normal distribution?",
                "Its mean (the centre) and its standard deviation (the spread).",
                "",
                "normal distribution",
            ),
            (
                "Roughly what share of normally distributed data lies within one standard deviation of the mean?",
                "About 68% (about 95% within two and 99.7% within three).",
                "68-95-99.7",
                "normal distribution",
            ),
            (
                "State the central limit theorem.",
                "Sample means approach a normal distribution as samples grow, even if the population is not normal.",
                "",
                "central limit",
            ),
            (
                "What does a confidence interval give you?",
                "A range of plausible values for a population parameter.",
                "",
                "confidence interval",
            ),
            (
                "What does a wider confidence interval indicate?",
                "More uncertainty about the parameter, for example from a smaller sample or noisier data.",
                "",
                "confidence interval",
            ),
            (
                "Define the p-value.",
                "The probability of seeing data at least as extreme as observed if the null hypothesis were true.",
                "Assume the null",
                "p-value",
            ),
            (
                "What does a small p-value tell you?",
                "The data would be unusual if the null were true: evidence against it, never proof of the alternative.",
                "",
                "p-value",
            ),
            (
                "What does hypothesis testing compare?",
                "The observed data with what the null hypothesis predicts.",
                "",
                "hypothesis testing",
            ),
            (
                "Does a strong correlation establish causation?",
                "No. Correlation measures a linear relationship; a confounder or chance can produce it.",
                "",
                "correlation",
            ),
        ),
    ),
    "sql": (
        "SQL & Relational Basics",
        "Keys, joins, aggregation and transactions for the data engineering track.",
        (
            (
                "What is a primary key?",
                "A column or set of columns whose value uniquely identifies each row of a table.",
                "",
                "primary key",
            ),
            (
                "What is a foreign key?",
                "A column referring to another table's primary key, enforcing the relationship between the tables.",
                "",
                "foreign key",
            ),
            (
                "Which clause filters rows and which sorts the result?",
                "WHERE filters rows; ORDER BY sorts the result.",
                "",
                "where",
            ),
            (
                "What does a join do?",
                "Combines rows from two tables using a condition, usually matching a foreign key to a primary key.",
                "",
                "join",
            ),
            ("What does an INNER JOIN keep?", "Only the rows that have a match in both tables.", "", "inner join"),
            (
                "What does a LEFT JOIN keep?",
                "Every row from the left table; right-table columns are NULL where there is no match.",
                "",
                "left join",
            ),
            (
                "What does GROUP BY do?",
                "Groups rows that share values so aggregates such as COUNT, SUM and AVG summarise each group.",
                "",
                "group by",
            ),
            (
                "WHERE versus HAVING?",
                "WHERE filters rows before grouping; HAVING filters groups after aggregation.",
                "Before or after GROUP BY",
                "group by",
            ),
            (
                "What is the goal of database normalization?",
                "Reducing duplicated data by splitting repeated facts into separate tables linked by keys.",
                "",
                "normalization",
            ),
            (
                "What is the trade-off of adding an index?",
                "Faster lookups on the column, at the cost of extra storage and slower writes.",
                "",
                "index",
            ),
            (
                "What is a transaction?",
                "A group of statements that succeed or fail together.",
                "All or nothing",
                "transaction",
            ),
            ("What does ACID stand for?", "Atomicity, consistency, isolation and durability.", "", "acid"),
            (
                "What do isolation levels decide?",
                "How much concurrent transactions can see of each other's uncommitted changes.",
                "",
                "isolation",
            ),
        ),
    ),
    "cells": (
        "Cell Biology: Midterm 1",
        "Organelles, membranes, respiration and cell division for the first midterm.",
        (
            (
                "What is the basic unit of life?",
                "The cell. Every living organism is made of one or more cells.",
                "",
                "cell",
            ),
            (
                "What is the cell membrane made of, and what does it do?",
                "A phospholipid bilayer that controls what enters and leaves the cell.",
                "",
                "membrane",
            ),
            (
                "How do prokaryotic and eukaryotic cells differ?",
                "Prokaryotic cells lack a nucleus; eukaryotic cells keep their DNA inside a membrane-bound nucleus.",
                "",
                "prokaryotic",
            ),
            (
                "What does the nucleus do?",
                "Stores the genetic information and directs protein synthesis.",
                "",
                "nucleus",
            ),
            ("What do ribosomes do?", "Read messenger RNA and assemble amino acids into proteins.", "", "ribosomes"),
            (
                "What is the role of the endoplasmic reticulum?",
                "Folding and transporting proteins.",
                "",
                "endoplasmic reticulum",
            ),
            (
                "What does the Golgi apparatus do?",
                "Modifies, sorts and packages proteins for delivery.",
                "The cell's post office",
                "golgi",
            ),
            (
                "Why are mitochondria called the powerhouse of the cell?",
                "They produce most of the cell's ATP through cellular respiration.",
                "",
                "mitochondria",
            ),
            (
                "What goes in and what comes out of cellular respiration?",
                "Glucose and oxygen go in; carbon dioxide, water and energy (as ATP) come out.",
                "",
                "cellular respiration",
            ),
            (
                "Where does photosynthesis happen?",
                "In chloroplasts, which capture light energy to build glucose.",
                "",
                "photosynthesis",
            ),
            ("What does mitosis produce?", "Two genetically identical daughter cells.", "", "mitosis"),
            (
                "What does meiosis produce?",
                "Gametes with half the chromosome number of the parent cell.",
                "",
                "meiosis",
            ),
            (
                "Which structures do plant cells have that animal cells lack?",
                "Chloroplasts, a cell wall and a large central vacuole.",
                "",
                "chloroplasts",
            ),
            (
                "Which molecule carries the genetic code from the nucleus to the ribosome?",
                "Messenger RNA (mRNA).",
                "",
                "messenger rna",
            ),
        ),
    ),
    "genetics": (
        "Mendelian Genetics Drill",
        "Alleles, crosses and Mendel's laws for exam 2.",
        (
            ("What does genetics study?", "How traits pass from parents to offspring.", "", "traits"),
            ("What is a gene?", "A segment of DNA that encodes a protein or functional RNA.", "", "gene"),
            ("What are alleles?", "Different versions of the same gene.", "", "allele"),
            (
                "What does homozygous mean?",
                "Carrying two identical alleles of a gene, e.g. AA or aa.",
                "",
                "homozygous",
            ),
            ("What does heterozygous mean?", "Carrying two different alleles of a gene, e.g. Aa.", "", "heterozygous"),
            ("When does a dominant allele show its trait?", "Even when only one copy is present.", "", "dominant"),
            (
                "When does a recessive trait appear?",
                "Only when both copies of the gene are the recessive allele.",
                "",
                "recessive",
            ),
            (
                "Genotype versus phenotype?",
                "Genotype: the alleles an organism carries. Phenotype: the observable trait that results.",
                "",
                "genotype",
            ),
            (
                "What does a Punnett square predict?",
                "The probability of each offspring genotype from a cross between two parents.",
                "",
                "punnett",
            ),
            (
                "What ratios does an Aa x Aa cross give?",
                "Genotypes 1 AA : 2 Aa : 1 aa; phenotypes 3 dominant : 1 recessive.",
                "Draw the 2x2 square",
                "punnett",
            ),
            (
                "State Mendel's law of segregation.",
                "The two alleles of a gene separate during gamete formation, so each gamete carries one.",
                "",
                "segregation",
            ),
            (
                "State the law of independent assortment.",
                "Genes on different chromosomes are inherited independently of each other.",
                "",
                "independent assortment",
            ),
            (
                "What is a mutation?",
                "A change in the DNA sequence. It can be harmful, neutral or occasionally beneficial.",
                "",
                "mutation",
            ),
        ),
    ),
}


