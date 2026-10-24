"""LightGBM loads on macOS without Homebrew's libomp (lgbm.py)."""
import subprocess
import sys
import types

import pytest

from ml.online import lgbm


def test_lightgbm_loads():
    assert hasattr(lgbm.load_lightgbm(), "LGBMClassifier")


def _imports(*outcomes):
    """A stand-in for importing lightgbm: each call raises or returns the next outcome."""
    calls = []

    def fake():
        outcome = outcomes[len(calls)]
        calls.append(outcome)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome
    return fake, calls


MISSING_OPENMP = OSError("dlopen(lib_lightgbm.dylib, 0x0006): Library not loaded: @rpath/libomp.dylib")


def test_a_missing_openmp_on_macos_is_fixed_with_scikit_learns_copy(monkeypatch):
    fake, calls = _imports(MISSING_OPENMP, types.SimpleNamespace(LGBMClassifier=object))
    preloaded = []
    monkeypatch.setattr(lgbm, "_import", fake)
    monkeypatch.setattr(lgbm, "_preload_openmp", lambda: preloaded.append(True) or True)
    monkeypatch.setattr(lgbm.sys, "platform", "darwin")
    assert lgbm.load_lightgbm().LGBMClassifier is object
    assert preloaded == [True] and len(calls) == 2


def test_when_no_copy_can_be_made_the_error_says_how_to_fix_it(monkeypatch):
    fake, _ = _imports(MISSING_OPENMP)
    monkeypatch.setattr(lgbm, "_import", fake)
    monkeypatch.setattr(lgbm, "_preload_openmp", lambda: False)
    monkeypatch.setattr(lgbm.sys, "platform", "darwin")
    with pytest.raises(ImportError, match="brew install libomp"):
        lgbm.load_lightgbm()


def test_other_systems_get_the_same_advice(monkeypatch):
    fake, _ = _imports(MISSING_OPENMP)
    monkeypatch.setattr(lgbm, "_import", fake)
    monkeypatch.setattr(lgbm.sys, "platform", "linux")
    with pytest.raises(ImportError, match="OpenMP"):
        lgbm.load_lightgbm()


def test_a_missing_package_is_not_mistaken_for_openmp(monkeypatch):
    fake, _ = _imports(ModuleNotFoundError("No module named 'lightgbm'"))
    monkeypatch.setattr(lgbm, "_import", fake)
    with pytest.raises(ImportError, match="pip install"):
        lgbm.load_lightgbm()


@pytest.mark.skipif(sys.platform != "darwin", reason="macOS only")
def test_the_copy_answers_to_the_name_lightgbm_asks_for(tmp_path):
    copy = lgbm._openmp_copy(tmp_path)
    assert copy is not None and copy.exists()
    assert subprocess.run(["otool", "-D", str(copy)], capture_output=True, text=True).stdout.strip().endswith(
        "@rpath/libomp.dylib")
