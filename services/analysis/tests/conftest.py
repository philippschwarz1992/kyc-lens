import importlib.util
from pathlib import Path

import pytest

from app.config import get_settings
from app.pipeline import Analyzer

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session", autouse=True)
def models() -> Path:
    """Downloads the pinned models on the first run; later runs only re-verify their hashes."""
    spec = importlib.util.spec_from_file_location("fetch_models", ROOT / "scripts" / "fetch_models.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    directory = get_settings().models_dir
    module.fetch_all(directory)
    return directory


@pytest.fixture(scope="session")
def analyzer(models: Path) -> Analyzer:
    return Analyzer(models)
