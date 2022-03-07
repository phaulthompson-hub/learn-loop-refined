"""Original study material used by the demo workspaces.

Each entry becomes a course. Concept extraction runs on this text exactly as it does
for uploaded material, so the demo exercises the real pipeline.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Material:
    key: str
    title: str
    subject: str
    difficulty: str
    tags: tuple[str, ...]
    description: str
    source_name: str
    text: str
    status: str = "active"


ML_TEXT = """Machine learning is the study of algorithms that improve their performance through experience and data. Supervised learning uses labeled examples to learn a mapping from inputs to expected outputs. A feature is a measurable input variable, while a label is the value the model is trained to predict. Linear regression predicts a continuous value by fitting parameters that minimize a loss function. The loss function measures the difference between predictions and correct values. Gradient descent is an optimization method that repeatedly adjusts parameters in the direction that reduces loss. The learning rate controls the size of each gradient descent step: too large can overshoot, while too small makes training slow. A model can overfit when it memorizes training examples but performs poorly on unseen data. A validation set estimates generalization during development, and regularization discourages excessive model complexity. Classification predicts discrete categories and can be evaluated with precision, recall, and an F1 score. Precision measures how many predicted positives are correct; recall measures how many actual positives were found. Responsible machine learning also requires checking data quality, bias, privacy, explainability, and performance after deployment."""  # noqa: E501

STATS_TEXT = """Descriptive statistics summarise a data set with a few numbers. The sample mean is the arithmetic average of the observations, and the sample mean is sensitive to extreme values. The median is the middle observation after sorting, so the median resists outliers better than the sample mean. Standard deviation measures how far observations typically fall from the mean; a small standard deviation means the values cluster tightly. A probability distribution assigns a probability to every possible outcome of a random variable. The normal distribution is a symmetric bell-shaped probability distribution described by its mean and standard deviation. The central limit theorem states that the distribution of sample means approaches a normal distribution as the sample size grows, even when the population is not normal. A confidence interval gives a range of plausible values for a population parameter, and a wider confidence interval reflects more uncertainty. Hypothesis testing compares observed data with what a null hypothesis predicts. The p-value is the probability of seeing data at least this extreme if the null hypothesis were true. A small p-value is evidence against the null hypothesis, but hypothesis testing never proves that a hypothesis is true. Correlation measures the strength of a linear relationship between two variables, and correlation alone does not establish causation."""  # noqa: E501

SQL_TEXT = """A relational database stores data in tables made of rows and columns. Every table should have a primary key, a column or set of columns whose value uniquely identifies each row. A foreign key is a column that refers to the primary key of another table, and each foreign key enforces a relationship between the two tables. SQL queries read data with SELECT, filter rows with WHERE, and sort results with ORDER BY. A join combines rows from two tables using a condition, usually matching a foreign key to a primary key. An inner join keeps only matching rows, while a left join keeps every row from the left table and fills missing matches with NULL. Aggregate functions such as COUNT, SUM and AVG summarise groups of rows created by GROUP BY. Database normalization organises tables to reduce duplicated data; database normalization splits repeated facts into separate tables linked by keys. An index is a data structure that speeds up lookups on a column at the cost of extra storage and slower writes. A transaction groups several statements so they succeed or fail together. Transactions follow the ACID properties: atomicity, consistency, isolation and durability. Isolation levels decide how much concurrent transactions can see of each other's uncommitted changes."""  # noqa: E501

NN_TEXT = """A neural network is a function built from layers of simple units called neurons. Each neuron computes a weighted sum of its inputs, adds a bias, and passes the result through an activation function. The activation function introduces non-linearity; common choices are ReLU, sigmoid and tanh. A feedforward network passes information from the input layer through hidden layers to the output layer. Training adjusts weights to minimise a loss function over the training data. Backpropagation computes the gradient of the loss with respect to every weight by applying the chain rule layer by layer. The gradient tells each weight which direction increases the loss, so the optimiser moves weights the opposite way. Deep networks can suffer from vanishing gradients, where the gradient becomes too small to update early layers. Batch normalization rescales activations inside the network and often makes training faster and more stable. Dropout randomly disables neurons during training, which reduces overfitting by preventing units from relying on each other. A convolutional network shares weights across positions of an image, and a convolutional network is therefore efficient at detecting local patterns such as edges."""  # noqa: E501

VIZ_TEXT = """Data visualization turns numbers into shapes that the eye can compare. Position along a common scale is the most accurate visual encoding, followed by length, angle and area. A bar chart compares quantities across categories, and a bar chart should start its value axis at zero. A line chart shows how a value changes over an ordered dimension such as time. A scatter plot reveals the relationship between two numeric variables and makes outliers easy to spot. Colour should encode meaning deliberately: a sequential palette shows ordered values, while a categorical palette separates unrelated groups. Too many colours make a chart harder to read than a table. Direct labels near the data are easier to read than a separate legend. Small multiples repeat the same chart for each group so readers compare shapes instead of decoding overlapping lines. Every chart should answer a specific question, and the title should state the answer rather than just the topic."""  # noqa: E501

CELL_TEXT = """The cell is the basic unit of life, and every living organism is made of one or more cells. The cell membrane is a phospholipid bilayer that controls what enters and leaves the cell. Prokaryotic cells lack a nucleus, while eukaryotic cells keep their DNA inside a membrane-bound nucleus. The nucleus stores genetic information and directs protein synthesis. Ribosomes read messenger RNA and assemble amino acids into proteins. The endoplasmic reticulum folds and transports proteins, and the Golgi apparatus modifies and packages them for delivery. Mitochondria produce most of the cell's ATP through cellular respiration, which is why mitochondria are called the powerhouse of the cell. Cellular respiration breaks down glucose using oxygen and releases carbon dioxide and water. Plant cells also contain chloroplasts, where photosynthesis captures light energy to build glucose. Cell division by mitosis produces two identical daughter cells, while meiosis produces gametes with half the chromosome number."""  # noqa: E501

GENETICS_TEXT = """Genetics studies how traits pass from parents to offspring. A gene is a segment of DNA that encodes a protein or functional RNA. Different versions of the same gene are called alleles. An organism with two identical alleles is homozygous, and one with two different alleles is heterozygous. A dominant allele shows its trait even when only one copy is present, while a recessive allele is hidden unless both copies are recessive. The genotype is the set of alleles an organism carries; the phenotype is the observable trait that results. A Punnett square predicts the probability of offspring genotypes from a cross between two parents. Mendel's law of segregation states that the two alleles of a gene separate during gamete formation. The law of independent assortment states that genes on different chromosomes are inherited independently. A mutation is a change in the DNA sequence, and a mutation can be harmful, neutral or occasionally beneficial."""  # noqa: E501

NORTHWIND_MATERIALS: tuple[Material, ...] = (
    Material(
        "ml",
        "Introduction to Machine Learning",
        "Machine Learning",
        "intro",
        ("ml", "foundations"),
        "Supervised learning from features and labels to gradient descent and model evaluation.",
        "ml-foundations.txt",
        ML_TEXT,
    ),
    Material(
        "stats",
        "Statistics Fundamentals",
        "Statistics",
        "intro",
        ("statistics", "foundations"),
        "Descriptive statistics, distributions, confidence intervals and hypothesis testing.",
        "statistics-notes.md",
        STATS_TEXT,
    ),
    Material(
        "sql",
        "Relational Databases & SQL",
        "Data Engineering",
        "intermediate",
        ("sql", "databases"),
        "Keys, joins, aggregation, normalization, indexes and transactions.",
        "sql-handbook.md",
        SQL_TEXT,
    ),
    Material(
        "nn",
        "Neural Networks in Practice",
        "Machine Learning",
        "advanced",
        ("ml", "deep-learning"),
        "How neurons, activations and backpropagation fit together, and how to train deep networks reliably.",
        "neural-networks.txt",
        NN_TEXT,
    ),
    Material(
        "viz",
        "Data Visualization Principles",
        "Communication",
        "intro",
        ("visualization", "design"),
        "Choosing encodings, charts and colour so a figure answers one question clearly.",
        "dataviz-guide.md",
        VIZ_TEXT,
        status="draft",
    ),
)

BIOLOGY_MATERIALS: tuple[Material, ...] = (
    Material(
        "cells",
        "Cell Biology",
        "Biology",
        "intro",
        ("biology", "exam-1"),
        "Membranes, organelles, respiration and cell division for the first midterm.",
        "cell-biology.txt",
        CELL_TEXT,
    ),
    Material(
        "genetics",
        "Mendelian Genetics",
        "Biology",
        "intermediate",
        ("biology", "exam-2"),
        "Alleles, genotype and phenotype, Punnett squares and Mendel's laws.",
        "genetics-notes.md",
        GENETICS_TEXT,
    ),
)
