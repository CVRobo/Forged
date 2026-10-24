"""Feature extraction pipeline for the Kaggle IEEE-CIS fraud detection model.

Operates on full DataFrames (not row-by-row) because aggregations and encodings
need the whole dataset.  Returns a feature DataFrame with ~200 columns.

Feature groups:
  A. Base features (43)     — vectorized version of features.py:extract()
  B. V-column selection     — best V-column per NaN-group cluster after dedup
  C. UID + aggregations     — card1+addr1+D1n grouping
  D. Frequency encoding     — count of each value in train
  E. Target encoding        — Bayesian-smoothed fraud rate per category
  F. Amount engineering     — log, dollars, cents
  G. D-column missingness   — binary indicators
  H. M-column pattern       — NaN count across M1-M9
  I. Extra C/D columns      — all C/D columns not in base features
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ml.online.features import (
    ANONYMOUS_DOMAINS,
    COMMON_DOMAINS,
)

# Columns used for frequency encoding
_FREQ_COLS = [
    "card1", "card2", "card5", "addr1", "addr2",
    "P_emaildomain", "R_emaildomain", "DeviceInfo",
]

# Columns used for target encoding
_TARGET_COLS = ["card1", "addr1", "P_emaildomain", "ProductCD", "card4"]

# D-columns whose missingness is informative
_D_MISSING_COLS = ["D1", "D4", "D10", "D11", "D15"]

# M-columns for NaN-count pattern
_M_COLS = [f"M{i}" for i in range(1, 10)]

# All C-columns in the dataset
_ALL_C_COLS = [f"C{i}" for i in range(1, 15)]

# All D-columns in the dataset
_ALL_D_COLS = [f"D{i}" for i in range(1, 16)]

# C and D columns already in the base features (from features.py)
_BASE_NUMERIC = {
    "TransactionAmt", "dist1", "dist2",
    "C1", "C2", "C4", "C6", "C8", "C9", "C11", "C12", "C13", "C14",
    "D1", "D3", "D4", "D10", "D15",
}

# Extra C/D columns not in base features
_EXTRA_CD_COLS = sorted(
    (set(_ALL_C_COLS) | set(_ALL_D_COLS)) - _BASE_NUMERIC
)

# Bayesian smoothing parameter for target encoding
_TARGET_SMOOTH_M = 30


def select_v_columns(
    df: pd.DataFrame,
    corr_thresh: float = 0.9,
    min_fraud_corr: float = 0.05,
) -> list[str]:
    """Pick the best V-column from each NaN-group cluster after dropping correlated pairs.

    Groups V-columns by their NaN pattern, then within each group:
    1. Compute pairwise correlation and drop columns correlated > corr_thresh
       (keep the one with higher |fraud correlation|).
    2. Drop any remaining columns with |fraud correlation| < min_fraud_corr
       if the group has high missingness (>80%).
    """
    v_cols = [c for c in df.columns if c.startswith("V")]
    if not v_cols:
        return []

    # Group by NaN pattern
    nan_rates = df[v_cols].isna().mean()
    groups: dict[str, list[str]] = {}
    for col in v_cols:
        bucket = f"{nan_rates[col]:.2f}"
        groups.setdefault(bucket, []).append(col)

    # Fraud correlation for each V-column
    y = df["isFraud"]
    fraud_corr = {}
    for col in v_cols:
        try:
            fraud_corr[col] = abs(df[col].corr(y))
        except Exception:
            fraud_corr[col] = 0.0

    selected: list[str] = []

    for bucket, cols in groups.items():
        miss_rate = float(bucket)
        if len(cols) <= 1:
            if fraud_corr.get(cols[0], 0) >= min_fraud_corr:
                selected.extend(cols)
            continue

        # Compute pairwise correlation within group
        sub = df[cols].copy()
        corr_mat = sub.corr().abs()

        # Greedy dedup: sort by fraud_corr descending, drop correlated weaker columns
        ranked = sorted(cols, key=lambda c: fraud_corr.get(c, 0), reverse=True)
        keep = set()
        drop = set()
        for col in ranked:
            if col in drop:
                continue
            keep.add(col)
            for other in ranked:
                if other in keep or other in drop:
                    continue
                try:
                    if corr_mat.loc[col, other] > corr_thresh:
                        drop.add(other)
                except KeyError:
                    pass

        # For high-missingness groups, apply minimum fraud correlation filter
        for col in keep:
            if miss_rate > 0.80 and fraud_corr.get(col, 0) < min_fraud_corr * 2:
                continue
            if fraud_corr.get(col, 0) >= min_fraud_corr:
                selected.append(col)

    return sorted(selected)


@dataclass
class FeaturePipeline:
    """Fit on training data, transform train and val consistently."""

    v_columns: list[str] = field(default_factory=list)
    freq_maps: dict[str, dict] = field(default_factory=dict)
    target_maps: dict[str, dict] = field(default_factory=dict)
    agg_maps: dict[str, pd.DataFrame] = field(default_factory=dict)
    uid_agg: pd.DataFrame | None = None
    card1_agg: pd.DataFrame | None = None
    addr1_agg: pd.DataFrame | None = None
    global_fraud_rate: float = 0.0
    feature_names: list[str] = field(default_factory=list)
    _train_uids: set = field(default_factory=set)

    def fit(self, train_df: pd.DataFrame) -> "FeaturePipeline":
        """Fit encodings and aggregations on training data."""
        # V-column selection
        self.v_columns = select_v_columns(train_df)

        # Global fraud rate (for target encoding fallback)
        self.global_fraud_rate = float(train_df["isFraud"].mean())

        # Frequency encoding: count of each value in train
        for col in _FREQ_COLS:
            if col in train_df.columns:
                counts = train_df[col].value_counts(dropna=False).to_dict()
                self.freq_maps[col] = counts

        # Target encoding: Bayesian-smoothed mean isFraud per value
        for col in _TARGET_COLS:
            if col in train_df.columns:
                stats = train_df.groupby(col, dropna=False)["isFraud"].agg(["mean", "count"])
                m = _TARGET_SMOOTH_M
                global_mean = self.global_fraud_rate
                smoothed = (stats["count"] * stats["mean"] + m * global_mean) / (stats["count"] + m)
                self.target_maps[col] = smoothed.to_dict()

        # UID construction and aggregations
        train_with_uid = train_df.copy()
        train_with_uid["_uid"] = _make_uid(train_with_uid)
        self._train_uids = set(train_with_uid["_uid"].dropna().unique())

        # UID aggregations
        uid_stats = train_with_uid.groupby("_uid").agg(
            uid_count=("TransactionAmt", "size"),
            uid_mean_amt=("TransactionAmt", "mean"),
            uid_std_amt=("TransactionAmt", "std"),
            uid_nunique_ProductCD=("ProductCD", "nunique"),
            uid_nunique_addr2=("addr2", "nunique"),
            uid_nunique_DeviceType=("DeviceType", "nunique"),
        )
        uid_stats["uid_std_amt"] = uid_stats["uid_std_amt"].fillna(0)
        self.uid_agg = uid_stats

        # card1 aggregations
        card1_stats = train_df.groupby("card1").agg(
            card1_count=("TransactionAmt", "size"),
            card1_mean_amt=("TransactionAmt", "mean"),
            card1_std_amt=("TransactionAmt", "std"),
        )
        card1_stats["card1_std_amt"] = card1_stats["card1_std_amt"].fillna(0)
        self.card1_agg = card1_stats

        # addr1 aggregations
        addr1_stats = train_df.groupby("addr1").agg(
            addr1_count=("TransactionAmt", "size"),
            addr1_mean_amt=("TransactionAmt", "mean"),
        )
        self.addr1_agg = addr1_stats

        # Build feature names list
        self.feature_names = self._build_feature_names()
        return self

    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        """Transform a DataFrame into the feature matrix.

        Builds all feature arrays into a dict, then creates the DataFrame
        in one shot to avoid fragmentation.
        """
        n = len(df)
        arrays: dict[str, np.ndarray] = {}

        # A. Base features (vectorized)
        self._extract_base_into(df, arrays)

        # I. Extra C/D columns not in base features
        for col in _EXTRA_CD_COLS:
            if col in df.columns:
                arrays[col] = df[col].values
            else:
                arrays[col] = np.full(n, np.nan)

        # B. V-columns (pass through with NaN preserved)
        for col in self.v_columns:
            if col in df.columns:
                arrays[col] = df[col].values
            else:
                arrays[col] = np.full(n, np.nan)

        # C. UID + aggregations
        uid = _make_uid(df)
        arrays["uid_is_new"] = (~uid.isin(self._train_uids)).astype(np.float64).values

        if self.uid_agg is not None:
            arrays["uid_count"] = uid.map(self.uid_agg["uid_count"]).values
            for agg_col in ["uid_mean_amt", "uid_std_amt",
                            "uid_nunique_ProductCD", "uid_nunique_addr2",
                            "uid_nunique_DeviceType"]:
                arrays[agg_col] = uid.map(self.uid_agg[agg_col]).values

        if self.card1_agg is not None:
            for agg_col in ["card1_count", "card1_mean_amt", "card1_std_amt"]:
                arrays[agg_col] = df["card1"].map(self.card1_agg[agg_col]).values

        if self.addr1_agg is not None:
            for agg_col in ["addr1_count", "addr1_mean_amt"]:
                arrays[agg_col] = df["addr1"].map(self.addr1_agg[agg_col]).values

        # D. Frequency encoding
        for col in _FREQ_COLS:
            fe_name = f"{col}_FE"
            if col in self.freq_maps and col in df.columns:
                arrays[fe_name] = df[col].map(self.freq_maps[col]).values
            else:
                arrays[fe_name] = np.full(n, np.nan)

        # E. Target encoding
        for col in _TARGET_COLS:
            te_name = f"{col}_TE"
            if col in self.target_maps and col in df.columns:
                arrays[te_name] = df[col].map(self.target_maps[col]).fillna(
                    self.global_fraud_rate
                ).values
            else:
                arrays[te_name] = np.full(n, self.global_fraud_rate)

        # F. Amount engineering
        amt = df["TransactionAmt"].fillna(0).values
        arrays["amt_dollars"] = np.floor(amt)
        arrays["amt_cents"] = np.round((amt - np.floor(amt)) * 100)
        arrays["amt_log"] = np.log1p(amt)

        # G. D-column missingness
        for col in _D_MISSING_COLS:
            if col in df.columns:
                arrays[f"{col}_missing"] = df[col].isna().astype(np.float64).values
            else:
                arrays[f"{col}_missing"] = np.ones(n)

        # H. M-column NaN count
        m_cols = [c for c in _M_COLS if c in df.columns]
        if m_cols:
            arrays["M_nan_count"] = df[m_cols].isna().sum(axis=1).values.astype(np.float64)
        else:
            arrays["M_nan_count"] = np.zeros(n)

        # Build DataFrame from dict in one shot (avoids fragmentation)
        out = pd.DataFrame(
            {name: arrays.get(name, np.full(n, np.nan)) for name in self.feature_names},
            index=df.index,
        )
        return out

    def fit_transform(self, train_df: pd.DataFrame) -> pd.DataFrame:
        """Fit on training data and transform it."""
        self.fit(train_df)
        return self.transform(train_df)

    def extract_single(self, row: dict) -> dict[str, float]:
        """Extract features from a single row dict (for server predict path).

        Applies fitted encodings to one row, returning a feature dict compatible
        with the existing features.extract() interface.
        """
        out: dict[str, float] = {}

        # A. Base features
        out.update(self._extract_base_single(row))

        # I. Extra C/D columns
        for col in _EXTRA_CD_COLS:
            v = row.get(col)
            out[col] = float(v) if v is not None else float("nan")

        # B. V-columns
        for col in self.v_columns:
            v = row.get(col)
            out[col] = float(v) if v is not None else float("nan")

        # C. UID + aggregations
        uid = _make_uid_single(row)
        out["uid_is_new"] = 0.0 if uid in self._train_uids else 1.0

        if self.uid_agg is not None and uid in self.uid_agg.index:
            agg_row = self.uid_agg.loc[uid]
            for agg_col in ["uid_count", "uid_mean_amt", "uid_std_amt",
                            "uid_nunique_ProductCD", "uid_nunique_addr2",
                            "uid_nunique_DeviceType"]:
                out[agg_col] = float(agg_row[agg_col])
        else:
            for agg_col in ["uid_count", "uid_mean_amt", "uid_std_amt",
                            "uid_nunique_ProductCD", "uid_nunique_addr2",
                            "uid_nunique_DeviceType"]:
                out[agg_col] = float("nan")

        card1 = row.get("card1")
        if self.card1_agg is not None and card1 in self.card1_agg.index:
            agg_row = self.card1_agg.loc[card1]
            for agg_col in ["card1_count", "card1_mean_amt", "card1_std_amt"]:
                out[agg_col] = float(agg_row[agg_col])
        else:
            for agg_col in ["card1_count", "card1_mean_amt", "card1_std_amt"]:
                out[agg_col] = float("nan")

        addr1 = row.get("addr1")
        if self.addr1_agg is not None and addr1 in self.addr1_agg.index:
            agg_row = self.addr1_agg.loc[addr1]
            for agg_col in ["addr1_count", "addr1_mean_amt"]:
                out[agg_col] = float(agg_row[agg_col])
        else:
            for agg_col in ["addr1_count", "addr1_mean_amt"]:
                out[agg_col] = float("nan")

        # D. Frequency encoding
        for col in _FREQ_COLS:
            fe_name = f"{col}_FE"
            val = row.get(col)
            if col in self.freq_maps and val in self.freq_maps[col]:
                out[fe_name] = float(self.freq_maps[col][val])
            else:
                out[fe_name] = float("nan")

        # E. Target encoding
        for col in _TARGET_COLS:
            te_name = f"{col}_TE"
            val = row.get(col)
            if col in self.target_maps and val in self.target_maps[col]:
                out[te_name] = float(self.target_maps[col][val])
            else:
                out[te_name] = self.global_fraud_rate

        # F. Amount engineering
        amt = _safe_float(row.get("TransactionAmt"))
        out["amt_dollars"] = math.floor(amt)
        out["amt_cents"] = round((amt - math.floor(amt)) * 100)
        out["amt_log"] = math.log1p(amt)

        # G. D-column missingness
        for col in _D_MISSING_COLS:
            out[f"{col}_missing"] = 1.0 if row.get(col) is None else 0.0

        # H. M-column NaN count
        out["M_nan_count"] = sum(1 for c in _M_COLS if row.get(c) is None)

        return out

    def _extract_base_into(self, df: pd.DataFrame, arrays: dict[str, np.ndarray]) -> None:
        """Vectorized base features — populates arrays dict in-place."""
        n = len(df)

        # Numeric columns
        numeric_cols = [
            "TransactionAmt", "dist1", "dist2",
            "C1", "C2", "C4", "C6", "C8", "C9", "C11", "C12", "C13", "C14",
            "D1", "D3", "D4", "D10", "D15",
        ]
        for col in numeric_cols:
            if col in df.columns:
                arrays[col] = df[col].values
            else:
                arrays[col] = np.full(n, np.nan)

        # ProductCD dummies
        pcd = df["ProductCD"].fillna("").str.upper() if "ProductCD" in df.columns else pd.Series("", index=df.index)
        for code in ("W", "C", "H", "R", "S"):
            arrays[f"pcd_{code}"] = (pcd == code).astype(np.float64).values

        # Card brand dummies
        brand = df["card4"].fillna("").str.lower() if "card4" in df.columns else pd.Series("", index=df.index)
        arrays["brand_visa"] = brand.str.contains("visa", na=False).astype(np.float64).values
        arrays["brand_mastercard"] = brand.str.contains("master", na=False).astype(np.float64).values
        arrays["brand_amex"] = (brand.str.contains("amex", na=False) | brand.str.contains("american", na=False)).astype(np.float64).values

        # Credit vs debit
        card6 = df["card6"].fillna("").str.lower() if "card6" in df.columns else pd.Series("", index=df.index)
        arrays["is_credit"] = (card6 == "credit").astype(np.float64).values

        # Foreign card
        addr2 = df["addr2"] if "addr2" in df.columns else pd.Series(np.nan, index=df.index)
        arrays["is_foreign_card"] = (addr2 != 87).astype(np.float64).values

        # Mobile
        dev_type = df["DeviceType"].fillna("").str.lower() if "DeviceType" in df.columns else pd.Series("", index=df.index)
        arrays["is_mobile"] = (dev_type == "mobile").astype(np.float64).values

        # Proxy
        id23 = df["id_23"].fillna("").str.lower() if "id_23" in df.columns else pd.Series("", index=df.index)
        arrays["proxy_anonymous"] = id23.str.contains("anonymous", na=False).astype(np.float64).values
        arrays["proxy_hidden"] = id23.str.contains("hidden", na=False).astype(np.float64).values

        # Email features
        email = df["P_emaildomain"].fillna("").str.lower().str.strip() if "P_emaildomain" in df.columns else pd.Series("", index=df.index)
        arrays["is_anonymous_email"] = email.isin(ANONYMOUS_DOMAINS).astype(np.float64).values
        arrays["is_odd_domain"] = ((email != "") & ~email.isin(COMMON_DOMAINS) & ~email.isin(ANONYMOUS_DOMAINS)).astype(np.float64).values

        # Emulator
        dev_info = df["DeviceInfo"].fillna("").str.lower() if "DeviceInfo" in df.columns else pd.Series("", index=df.index)
        id30 = df["id_30"].fillna("").str.lower() if "id_30" in df.columns else pd.Series("", index=df.index)
        arrays["is_emulator"] = (dev_info.str.contains("generic", na=False) | ((id30 == "linux") & (dev_type == "mobile"))).astype(np.float64).values

        # Gift card
        arrays["is_gift_card"] = (pcd == "C").astype(np.float64).values

        # Time features
        dt = df["TransactionDT"].fillna(0) if "TransactionDT" in df.columns else pd.Series(0, index=df.index)
        hour = (dt / 3600) % 24
        arrays["is_night"] = ((hour >= 0) & (hour < 6)).astype(np.float64).values
        arrays["hour_sin"] = np.sin(2 * np.pi * hour / 24).values
        arrays["hour_cos"] = np.cos(2 * np.pi * hour / 24).values

        # M-flag features
        m1 = df["M1"].fillna("").str.upper() if "M1" in df.columns else pd.Series("", index=df.index)
        m2 = df["M2"].fillna("").str.upper() if "M2" in df.columns else pd.Series("", index=df.index)
        m3 = df["M3"].fillna("").str.upper() if "M3" in df.columns else pd.Series("", index=df.index)
        m5 = df["M5"].fillna("").str.upper() if "M5" in df.columns else pd.Series("", index=df.index)

        arrays["email_matches_holder"] = (m2 == "T").astype(np.float64).values
        arrays["name_matches_card"] = (m1 == "T").astype(np.float64).values
        arrays["is_hijacked"] = (m3 == "T").astype(np.float64).values
        arrays["ship_not_billing"] = (m5 == "T").astype(np.float64).values

        # High amount
        amt = df["TransactionAmt"].fillna(0) if "TransactionAmt" in df.columns else pd.Series(0, index=df.index)
        arrays["high_amount"] = (amt > 500).astype(np.float64).values

    def _extract_base_single(self, row: dict) -> dict[str, float]:
        """Single-row version of base features, mirroring features.py:extract()."""
        from ml.online.features import extract
        return extract(row)

    def _build_feature_names(self) -> list[str]:
        """Build the complete ordered list of feature names."""
        names: list[str] = []

        # A. Base features (same order as features.py FEATURE_NAMES)
        from ml.online.features import FEATURE_NAMES
        names.extend(FEATURE_NAMES)

        # I. Extra C/D columns not in base features
        names.extend(_EXTRA_CD_COLS)

        # B. V-columns
        names.extend(self.v_columns)

        # C. UID + aggregations
        names.extend([
            "uid_is_new",
            "uid_count", "uid_mean_amt", "uid_std_amt",
            "uid_nunique_ProductCD", "uid_nunique_addr2", "uid_nunique_DeviceType",
            "card1_count", "card1_mean_amt", "card1_std_amt",
            "addr1_count", "addr1_mean_amt",
        ])

        # D. Frequency encoding
        for col in _FREQ_COLS:
            names.append(f"{col}_FE")

        # E. Target encoding
        for col in _TARGET_COLS:
            names.append(f"{col}_TE")

        # F. Amount engineering
        names.extend(["amt_dollars", "amt_cents", "amt_log"])

        # G. D-column missingness
        for col in _D_MISSING_COLS:
            names.append(f"{col}_missing")

        # H. M-column NaN count
        names.append("M_nan_count")

        return names


def _make_uid(df: pd.DataFrame) -> pd.Series:
    """Construct UID = card1_addr1_day-D1 for cardholder grouping."""
    card1 = df["card1"].astype(str) if "card1" in df.columns else pd.Series("", index=df.index)
    addr1 = df["addr1"].astype(str) if "addr1" in df.columns else pd.Series("", index=df.index)

    dt = df["TransactionDT"].fillna(0) if "TransactionDT" in df.columns else pd.Series(0, index=df.index)
    d1 = df["D1"].fillna(0) if "D1" in df.columns else pd.Series(0, index=df.index)
    day = (dt / 86400).astype(int)
    d1n = (day - d1.astype(int)).astype(str)

    return card1 + "_" + addr1 + "_" + d1n


def _make_uid_single(row: dict) -> str:
    """Construct UID from a single row dict."""
    card1 = str(row.get("card1", ""))
    addr1 = str(row.get("addr1", ""))
    dt = _safe_float(row.get("TransactionDT"))
    d1 = _safe_float(row.get("D1"))
    day = int(dt / 86400)
    d1n = str(day - int(d1))
    return f"{card1}_{addr1}_{d1n}"


def _safe_float(v) -> float:
    """Coerce to float, default 0."""
    if v is None or v == "" or v == "null":
        return 0.0
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0
