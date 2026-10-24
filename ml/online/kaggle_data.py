"""Load and prepare Kaggle IEEE-CIS fraud detection data.

Reads train_transaction.csv and train_identity.csv, joins them,
and provides a time-based train/val split that mirrors the Kaggle setup.
"""

from __future__ import annotations

import os
from pathlib import Path

import pandas as pd

KAGGLE_DIR = Path(os.environ.get(
    "KAGGLE_IEEE_DIR",
    Path(__file__).resolve().parents[2] / ".." / "ieee-fraud-detection",
))


def load_raw() -> pd.DataFrame:
    """Join train_transaction + train_identity on TransactionID.

    Returns a single DataFrame with all columns. Identity columns will be NaN
    for transactions without a matching identity row (~75% of rows).
    """
    txn = pd.read_csv(KAGGLE_DIR / "train_transaction.csv")
    ident = pd.read_csv(KAGGLE_DIR / "train_identity.csv")
    df = txn.merge(ident, on="TransactionID", how="left")
    return df


def time_split(df: pd.DataFrame, val_frac: float = 0.2) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split by TransactionDT: last val_frac by time goes to validation.

    This mirrors the Kaggle train/test split and prevents future leakage.
    """
    df = df.sort_values("TransactionDT").reset_index(drop=True)
    split_idx = int(len(df) * (1 - val_frac))
    train_df = df.iloc[:split_idx].reset_index(drop=True)
    val_df = df.iloc[split_idx:].reset_index(drop=True)
    return train_df, val_df


def to_row_dicts(df: pd.DataFrame) -> list[dict]:
    """DataFrame rows to list[dict] with NaN -> None (not 0).

    LightGBM handles NaN natively — missingness is informative, so we preserve it.
    """
    records = df.to_dict(orient="records")
    for row in records:
        for k, v in row.items():
            if pd.isna(v):
                row[k] = None
    return records
