"""Mock factory for creating test objects with proper structure"""

from datetime import datetime
from typing import TYPE_CHECKING, Any
from unittest.mock import Mock

if TYPE_CHECKING:
    from bunking.models import Cabin, Camper


class MockFactory:
    """Factory for creating properly configured mock objects"""

    @staticmethod
    def create_pocketbase_record(collection: str, data: dict[str, Any]) -> Any:
        """Create a mock PocketBase record with proper attributes.

        Uses a simple namespace object to avoid Mock __dict__ issues.
        """
        # Use a simple namespace object instead of Mock
        record = type("MockRecord", (), {})()

        # Set default fields
        defaults = {
            "id": "test_id",
            "created": datetime.now().isoformat() + "Z",
            "updated": datetime.now().isoformat() + "Z",
            "collection_name": collection,
            "collection_id": f"mock_{collection}_collection",
        }

        # Merge with provided data
        all_data = {**defaults, **data}

        # Set all attributes
        for key, value in all_data.items():
            setattr(record, key, value)

        # Set __dict__ for compatibility
        record.__dict__.update(all_data)

        return record

    @staticmethod
    def create_pocketbase_client() -> Mock:
        """Create a mock PocketBase client with common methods"""
        mock_pb = Mock()

        # Auth methods
        mock_pb.admins.auth_with_password = Mock()
        mock_pb.auth_store.token = "mock_token"
        mock_pb.auth_store.is_valid = True

        # Collection methods
        def collection_factory(name: str) -> Mock:
            mock_collection = Mock()
            mock_collection.name = name
            mock_collection.get_full_list = Mock(return_value=[])
            mock_collection.get_list = Mock(return_value=Mock(items=[], total_items=0))
            mock_collection.get_first_list_item = Mock(side_effect=Exception("Not found"))
            mock_collection.get_one = Mock(side_effect=Exception("Not found"))
            mock_collection.create = Mock()
            mock_collection.update = Mock()
            mock_collection.delete = Mock()
            return mock_collection

        mock_pb.collection = Mock(side_effect=collection_factory)

        return mock_pb

    @staticmethod
    def create_campminder_client(season_id: int = 2025) -> Mock:
        """Create a mock CampMinder client"""
        mock_cm = Mock()

        # Config
        mock_cm.config = Mock()
        mock_cm.config.season_id = season_id
        mock_cm.config.username = "test_user"
        mock_cm.config.subdomain = "test"

        # Auth
        mock_cm.authenticate = Mock()
        mock_cm._jwt_token = "mock_jwt_token"
        mock_cm._get_jwt_token = Mock(return_value="mock_jwt_token")

        # API methods
        mock_cm.get_from_endpoint = Mock(return_value={"status": "ok", "data": []})
        mock_cm.get_persons = Mock(return_value=[])
        mock_cm.get_sessions = Mock(return_value=[])
        mock_cm.get_divisions = Mock(return_value=[])
        mock_cm.get_bunks = Mock(return_value=[])

        return mock_cm

    @staticmethod
    def create_mock_person(person_id: int = 12345, **kwargs: Any) -> dict[str, Any]:
        """Create a mock person/camper object"""
        defaults: dict[str, Any] = {
            "id": person_id,
            "preferredName": "Test",
            "firstName": "Test",
            "lastName": "User",
            "gender": "M",
            "birthDate": "2015-01-01",
            "currentGrade": 5,
            "email": f"test{person_id}@example.com",
            "isActive": True,
            "tags": [],
        }
        defaults.update(kwargs)
        return defaults

    @staticmethod
    def create_mock_attendee(
        attendee_id: int = 1, person_id: int = 12345, session_id: int = 1, **kwargs: Any
    ) -> dict[str, Any]:
        """Create a mock attendee object"""
        defaults: dict[str, Any] = {
            "id": attendee_id,
            "personID": person_id,
            "sessionID": session_id,
            "divisionID": 100,
            "isActive": True,
            "admittedDate": None,
            "departedDate": None,
        }
        defaults.update(kwargs)
        return defaults

    @staticmethod
    def create_mock_bunk_request(**kwargs: Any) -> Any:
        """Create a mock bunk request object"""
        defaults: dict[str, Any] = {
            "id": "br_test",
            "requester_cm_id": 12345,
            "requested_cm_id": 12346,
            "year": 2025,
            "session_cm_id": 1,
            "request_type": "bunk_with",
            "priority": 8,
            "notes": "Test request",
            "status": "pending",
            "confidence_score": 0.95,
            "confidence_level": "AUTO_ACCEPT",
            "ai_processed": True,
            "name_in_request": "Test User",
            "parse_source": "share_bunk_with",
            "source_text": "Test User",
            "parse_metadata": {"signals": ["exact_match"]},
            "created_by": "test_sync",
            "reviewed_by": None,
            "reviewed_at": None,
            "review_notes": None,
            "created": datetime.now().isoformat() + "Z",
            "updated": datetime.now().isoformat() + "Z",
        }
        defaults.update(kwargs)

        return MockFactory.create_pocketbase_record("bunk_requests", defaults)

    @staticmethod
    def create_mock_friend_group(**kwargs: Any) -> Any:
        """Create a mock friend group object"""
        defaults: dict[str, Any] = {
            "id": "fg_test",
            "name": "Test Friend Group",
            "session_cm_id": 1,
            "year": 2025,
            "member_cm_ids": [12345, 12346, 12347],
            "description": "Test friend group",
            "is_active": True,
            "created_by": "test_user",
            "created": datetime.now().isoformat() + "Z",
            "updated": datetime.now().isoformat() + "Z",
        }
        defaults.update(kwargs)

        return MockFactory.create_pocketbase_record("friend_groups", defaults)

    @staticmethod
    def create_solver_camper(camper_id: str = "1", **kwargs: Any) -> "Camper":
        """Create a mock Camper object for solver"""
        # Import here to avoid circular imports
        from bunking.models import Camper

        defaults: dict[str, Any] = {
            "id": camper_id,
            "name": f"Camper {camper_id}",
            "age": 10,
            "grade": 5,
            "friend_group_id": None,
        }
        defaults.update(kwargs)

        return Camper(**defaults)

    @staticmethod
    def create_solver_cabin(cabin_id: str = "1", **kwargs: Any) -> "Cabin":
        """Create a mock Cabin object for solver"""
        # Import here to avoid circular imports
        from bunking.models import Cabin

        defaults: dict[str, Any] = {
            "id": cabin_id,
            "max_capacity": 8,
        }
        defaults.update(kwargs)

        return Cabin(**defaults)

    @staticmethod
    def create_ai_response(names: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
        """Create a mock AI parsing response"""
        defaults: dict[str, Any] = {"names": names, "age_preference": None, "confidence_notes": "High confidence match"}
        defaults.update(kwargs)
        return defaults

    @staticmethod
    def patch_module_imports(module_patches: dict[str, Any]) -> dict[str, Mock]:
        """Create a dictionary of import patches for use with patch.dict

        Example:
            patches = MockFactory.patch_module_imports({
                'pocketbase': MockFactory.create_pocketbase_client(),
                'campminder.client': Mock(CampMinderClient=MockFactory.create_campminder_client)
            })

            with patch.dict(sys.modules, patches):
                # Import and test
        """
        return {name: Mock(**value) if isinstance(value, dict) else value for name, value in module_patches.items()}
