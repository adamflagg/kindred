"""Override parent autouse fixtures for constants-only tests.

The parent conftest patches orchestrator/config modules that can't be imported
during the V2 transition (Tasks 8-9 will fix those imports). These no-op
overrides allow constants tests to run without the broken import chain.

Remove this file once Tasks 8-9 are complete and the parent conftest works again.
"""

import pytest


@pytest.fixture(autouse=True)
def mock_provider_factory():
    """No-op override of parent fixture — constants tests don't need provider mocking."""
    yield None


@pytest.fixture(autouse=True)
def mock_config_loader():
    """No-op override of parent fixture — constants tests don't need config mocking."""
    yield None
