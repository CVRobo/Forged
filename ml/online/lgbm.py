"""Load LightGBM, also on Macs without Homebrew's libomp.

LightGBM's macOS wheels link OpenMP as @rpath/libomp.dylib and look for it where Homebrew
installs it (/opt/homebrew/opt/libomp). Without it, `import lightgbm` fails and the server
quietly answers with the browser's scripted Gus. scikit-learn's macOS wheels ship their own
libomp under another install name; a copy renamed to @rpath/libomp.dylib (and re-signed),
loaded before lightgbm, satisfies it. The copy is made once, inside the virtualenv.

On other systems, or when the copy can't be made, the error says what to install.
"""
from __future__ import annotations

import ctypes
import importlib
import logging
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

log = logging.getLogger(__name__)

FIX = ("LightGBM needs OpenMP (libomp): on macOS run `brew install libomp` (on Apple Silicon, with the "
       "/opt/homebrew Homebrew); on Linux install libgomp1")


def load_lightgbm():
    """The lightgbm module, or an ImportError that says how to get it working."""
    try:
        return _import()
    except ModuleNotFoundError as e:
        raise ImportError("lightgbm isn't installed: pip install -r ml/online/requirements.txt") from e
    except OSError as e:
        if sys.platform == "darwin" and "libomp" in str(e) and _preload_openmp():
            _forget_partial_import()
            try:
                return _import()
            except OSError as again:
                raise ImportError(f"{FIX} ({again})") from again
        raise ImportError(f"{FIX} ({e})") from e


def _import():
    return importlib.import_module("lightgbm")


def _forget_partial_import() -> None:
    """A failed import leaves half-initialized lightgbm modules behind; drop them before retrying."""
    for name in [n for n in sys.modules if n == "lightgbm" or n.startswith("lightgbm.")]:
        del sys.modules[name]


def _preload_openmp() -> bool:
    """Load a copy of scikit-learn's libomp that answers to @rpath/libomp.dylib. True if it worked."""
    for folder in (Path(sys.prefix) / "lib" / "forged-libomp", Path(tempfile.gettempdir()) / "forged-libomp"):
        copy = _openmp_copy(folder)
        if copy is None:
            continue
        try:
            ctypes.CDLL(str(copy), mode=ctypes.RTLD_GLOBAL)
        except OSError:
            log.warning("Couldn't load %s", copy, exc_info=True)
            continue
        log.info("LightGBM uses scikit-learn's libomp (%s)", copy)
        return True
    return False


def _openmp_copy(folder: Path) -> Path | None:
    """scikit-learn's libomp, renamed @rpath/libomp.dylib and re-signed, in `folder`; None if it can't be made."""
    target = folder / "libomp.dylib"
    if target.exists():
        return target
    try:
        import sklearn
    except ImportError:
        return None
    source = Path(sklearn.__file__).parent / ".dylibs" / "libomp.dylib"
    if not source.exists() or not shutil.which("install_name_tool") or not shutil.which("codesign"):
        return None
    try:
        folder.mkdir(parents=True, exist_ok=True)
        tmp = folder / "libomp.dylib.tmp"
        shutil.copy2(source, tmp)
        subprocess.run(["install_name_tool", "-id", "@rpath/libomp.dylib", str(tmp)], check=True, capture_output=True)
        subprocess.run(["codesign", "--force", "--sign", "-", str(tmp)], check=True, capture_output=True)
        tmp.replace(target)
    except (OSError, subprocess.CalledProcessError):
        log.warning("Couldn't make a copy of scikit-learn's libomp in %s", folder, exc_info=True)
        return None
    return target
