"""The model's inputs: the IEEE-CIS columns a player's choices actually change.

The game fills some columns with constants (id_13 is always 49, C3 always 0) or random
noise (id_02, id_19). A model given those would learn "this row came from the game"
instead of "this is fraud", so they're left out. What's left is what a shop's risk
engine sees and what the checkout lets a player change: the amount and product, the
card's brand and type, distances, email domains, device and browser, proxy, the hour,
and the card/email/device/address history counts (C and D columns).

The real data is restricted to transactions with identity info (device, browser),
because every game order has it: the model learns the "online order with a device"
segment of the dataset.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent / "data"

NUMERIC = ["TransactionAmt", "hour", "dist1", "dist2", "C1", "C2", "C6", "C11", "C13", "C14", "D1", "D3", "D4", "D10", "D15"]
CATEGORICAL = ["ProductCD", "card4", "card6", "P_email", "R_email", "M4", "M5", "M6", "id_12", "id_16", "proxy",
               "os", "browser", "DeviceType", "device"]
FEATURES = NUMERIC + CATEGORICAL

# raw columns needed from the dataset
RAW_TX = ["TransactionID", "isFraud", "TransactionDT", "TransactionAmt", "ProductCD", "card4", "card6", "dist1", "dist2",
          "P_emaildomain", "R_emaildomain", "C1", "C2", "C6", "C11", "C13", "C14", "D1", "D3", "D4", "D10", "D15", "M4", "M5", "M6"]
RAW_ID = ["TransactionID", "id_12", "id_16", "id_23", "id_30", "id_31", "DeviceType", "DeviceInfo"]

ANON_EMAIL = {"protonmail.com", "anonymous.com", "mail.com", "mail.ru", "guerrillamail.com", "tutanota.com", "yandex.ru"}


def load_real() -> pd.DataFrame:
    """The dataset's train split, transactions with identity only. Cached as a pickle after the first load."""
    cache = DATA_DIR / "real_identity.pkl"
    if cache.exists():
        return pd.read_pickle(cache)
    tx = pd.read_csv(DATA_DIR / "train_transaction.csv", usecols=RAW_TX)
    ids = pd.read_csv(DATA_DIR / "train_identity.csv", usecols=RAW_ID)
    df = tx.merge(ids, on="TransactionID", how="inner").sort_values("TransactionDT").reset_index(drop=True)
    df["origin"] = "real"
    df.to_pickle(cache)
    return df


def _email(s: pd.Series) -> pd.Series:
    s = s.astype("string").str.lower()
    out = s.where(~s.isin(ANON_EMAIL), "anonymous")
    # yahoo.co.jp, yahoo.fr... → yahoo; hotmail.de → hotmail
    for family in ("gmail", "yahoo", "hotmail", "outlook", "aol", "icloud", "comcast", "live", "msn", "att"):
        out = out.where(~s.str.startswith(family + ".", na=False), family)
    return out


def _family(s: pd.Series, rules: list[tuple[str, str]], other: str = "other") -> pd.Series:
    s = s.astype("string").str.lower()
    out = pd.Series(pd.NA, index=s.index, dtype="string")
    for pattern, name in rules:
        out = out.where(out.notna() | ~s.str.contains(pattern, regex=True, na=False), name)
    return out.where(out.notna() | s.isna(), other)


OS_RULES = [("windows", "windows"), ("ios", "ios"), ("android", "android"), ("mac", "mac"), ("linux", "linux")]
BROWSER_RULES = [("samsung", "samsung"), ("edge", "edge"), ("chrome", "chrome"), ("safari", "safari"), ("firefox", "firefox"),
                 ("ie |internet explorer", "ie"), ("opera", "opera"), ("android", "android_webview")]
DEVICE_RULES = [("windows", "windows"), ("ios device", "ios"), ("macos", "mac"), ("trident", "ie"), ("^rv:", "firefox"),
                ("^sm-|samsung", "samsung"), ("moto", "motorola"), ("lg-|^lg", "lg"), ("huawei|^ale-|^hi6", "huawei"),
                ("pixel|nexus", "google"), ("linux", "linux"), ("emulator|sdk_gphone|generic", "emulator")]


def frame(df: pd.DataFrame) -> pd.DataFrame:
    """Raw IEEE-CIS rows (dataset or game) → the model's feature frame."""
    def col(name):
        return df[name] if name in df else pd.Series(np.nan, index=df.index)
    x = pd.DataFrame(index=df.index)
    for c in NUMERIC:
        if c != "hour":
            x[c] = pd.to_numeric(col(c), errors="coerce").astype("float64")
    x["hour"] = (pd.to_numeric(col("TransactionDT"), errors="coerce") // 3600 % 24).astype("float64")
    x["ProductCD"] = col("ProductCD").astype("string")
    x["card4"] = col("card4").astype("string").str.lower()
    x["card6"] = col("card6").astype("string").str.lower()
    x["P_email"] = _email(col("P_emaildomain"))
    x["R_email"] = _email(col("R_emaildomain"))
    for c in ("M4", "M5", "M6", "id_12", "id_16", "DeviceType"):
        x[c] = col(c).astype("string")
    x["proxy"] = col("id_23").astype("string").str.replace("IP_PROXY:", "", regex=False).str.lower()
    x["os"] = _family(col("id_30"), OS_RULES)
    x["browser"] = _family(col("id_31"), BROWSER_RULES)
    x["device"] = _family(col("DeviceInfo"), DEVICE_RULES)
    return x[FEATURES]


def vocab(x: pd.DataFrame, min_count: int = 30) -> dict[str, list[str]]:
    """Each categorical column's values seen at least min_count times in training; the rest become "other"."""
    out = {}
    for c in CATEGORICAL:
        counts = x[c].value_counts()
        out[c] = sorted(set(counts[counts >= min_count].index.astype(str)) | {"other"})
    return out


def encode(x: pd.DataFrame, voc: dict[str, list[str]]) -> pd.DataFrame:
    """Fixed categories, so a model trained on one vocabulary scores any row the same way."""
    x = x.copy()
    for c in CATEGORICAL:
        v = x[c].astype("string")
        v = v.where(v.isna() | v.isin(voc[c]), "other")
        x[c] = pd.Categorical(v, categories=voc[c])
    return x


def is_emulator(x: pd.DataFrame):
    """The game's emulator tell, as a boolean Series over a framed DataFrame (from `frame`).

    A "mobile" device carrying a desktop Firefox/Linux build string. One shared definition so the
    model's `emulator` tell and the report's family label can never disagree.
    """
    return (x["DeviceType"] == "mobile") & (x["device"].isin(["firefox", "linux", "emulator"]) | (x["os"] == "linux"))
