from app.api.accounts import _is_safe_precision_match, _token_identity_values


def test_token_identity_values_reads_embark_id_and_sub():
    payload = {
        "sub": "sub-123",
        "ext": {"embark_user_id": "8741641151698863222"},
    }

    assert _token_identity_values(payload) == [
        ("embark_user_id", "8741641151698863222"),
        ("sub", "sub-123"),
    ]


def test_token_identity_values_deduplicates_matching_ids():
    payload = {
        "sub": "8741641151698863222",
        "ext": {"embark_user_id": "8741641151698863222"},
    }

    assert _token_identity_values(payload) == [
        ("embark_user_id", "8741641151698863222"),
    ]


def test_precision_match_allows_js_rounded_large_ids():
    assert _is_safe_precision_match("8741641151698863222", "8741641151698863000")


def test_precision_match_rejects_short_or_different_prefix_ids():
    assert not _is_safe_precision_match("123456789", "123456700")
    assert not _is_safe_precision_match("8741641151698863222", "4994236526537943000")
